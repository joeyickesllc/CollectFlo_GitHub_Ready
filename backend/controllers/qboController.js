/**
 * QuickBooks Online Controller
 * 
 * Handles all QuickBooks Online OAuth and integration functionality:
 * - Initiating OAuth flow (generating authorization URL)
 * - Processing OAuth callback (exchanging code for tokens)
 * - Connection status checking
 * - Disconnecting from QuickBooks
 * - Retrieving company information
 */

const axios = require('axios');
const crypto = require('crypto');
const { URL } = require('url');
const secrets = require('../config/secrets');
const logger = require('../services/logger');
const { saveTokens, getTokens, getValidTokens, clearTokens, hasValidTokens } = require('../../services/tokenStore');
const { refreshAccessToken } = require('../../services/tokenRefresh');

// QuickBooks API endpoints
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

// QuickBooks scopes needed for the application
const QBO_SCOPES = [
  'com.intuit.quickbooks.accounting',
  'com.intuit.quickbooks.payment'
].join(' ');

/**
 * Generate a secure random state parameter for CSRF protection
 * 
 * @returns {string} A random state string
 */
function generateStateParam() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Store the state parameter in the user's session
 * 
 * @param {Object} req - Express request object
 * @param {string} state - The state parameter
 */
function storeStateInSession(req, state) {
  req.session.qboOAuthState = state;
  req.session.qboOAuthStateTimestamp = Date.now();
}

/**
 * Verify the state parameter from the callback matches what we stored
 * 
 * @param {Object} req - Express request object
 * @param {string} state - The state parameter from the callback
 * @returns {boolean} Whether the state is valid
 */
function verifyStateParam(req, state) {
  const storedState = req.session.qboOAuthState;
  const timestamp = req.session.qboOAuthStateTimestamp;
  
  // State must exist and match
  if (!storedState || storedState !== state) {
    return false;
  }
  
  // State should not be too old (10 minutes max)
  if (!timestamp || Date.now() - timestamp > 10 * 60 * 1000) {
    return false;
  }
  
  return true;
}

/**
 * Clear the OAuth state from the session
 * 
 * @param {Object} req - Express request object
 */
function clearStateFromSession(req) {
  delete req.session.qboOAuthState;
  delete req.session.qboOAuthStateTimestamp;
}

/**
 * Initiate QuickBooks OAuth flow
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function initiateOAuth(req, res) {
  try {
    // Generate and store a state parameter for CSRF protection
    const state = generateStateParam();
    storeStateInSession(req, state);
    
    // Get the redirect parameter if provided
    const redirectAfter = req.query.redirect || 'dashboard';
    req.session.qboRedirectAfter = redirectAfter;
    
    // Construct the authorization URL
    const authUrl = new URL(QBO_AUTH_URL);
    authUrl.searchParams.append('client_id', secrets.qbo.clientId);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', QBO_SCOPES);
    authUrl.searchParams.append('redirect_uri', secrets.qbo.redirectUri);
    authUrl.searchParams.append('state', state);
    
    // Redirect the user to the QuickBooks authorization page
    logger.info('Initiating QBO OAuth flow', { userId: req.user?.id, redirectAfter });
    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('QBO OAuth initiation failed', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      message: 'Failed to initiate QuickBooks connection'
    });
  }
}

/**
 * Handle QuickBooks OAuth callback
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleOAuthCallback(req, res) {
  const userId = req.user?.id;
  const redirectTo = req.session.qboRedirectAfter || 'beta-onboarding';
  
  // Log user authentication status during callback
  logger.info('QBO OAuth callback initiated', { 
    userId, 
    hasUser: !!req.user,
    userEmail: req.user?.email,
    redirectTo,
    sessionId: req.sessionID
  });
  
  try {
    const { code, state, realmId, error } = req.query;
    
    // Handle error from QuickBooks
    if (error) {
      logger.error('QBO OAuth error from Intuit', { 
        error, 
        userId,
        query: req.query,
        headers: req.headers
      });
      return res.redirect(`/${redirectTo}?error=qbo_oauth_failed&reason=${encodeURIComponent(error)}`);
    }
    
    // Verify required parameters
    if (!code || !state || !realmId) {
      const missingParams = [];
      if (!code) missingParams.push('code');
      if (!state) missingParams.push('state');
      if (!realmId) missingParams.push('realmId');
      
      logger.error('QBO OAuth callback missing parameters', { 
        userId, 
        missingParams,
        query: req.query
      });
      return res.redirect(`/${redirectTo}?error=qbo_missing_params&missing=${missingParams.join(',')}`);
    }
    
    // Verify state parameter to prevent CSRF attacks
    if (!verifyStateParam(req, state)) {
      logger.error('QBO OAuth state verification failed', { 
        userId,
        providedState: state,
        storedState: req.session.qboOAuthState,
        stateTimestamp: req.session.qboOAuthStateTimestamp,
        currentTime: Date.now(),
        timeDifference: req.session.qboOAuthStateTimestamp ? Date.now() - req.session.qboOAuthStateTimestamp : 'N/A'
      });
      return res.redirect(`/${redirectTo}?error=qbo_invalid_state`);
    }
    
    // Clear the state from session after verification
    clearStateFromSession(req);
    
    try {
      // Exchange the authorization code for tokens
      logger.debug('Exchanging authorization code for tokens', { 
        userId, 
        realmId,
        redirectUri: secrets.qbo.redirectUri
      });
      
      const tokenResponse = await axios.post(
        QBO_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: secrets.qbo.redirectUri
        }),
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${secrets.qbo.clientId}:${secrets.qbo.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      // Store the tokens with the realmId
      const tokens = {
        ...tokenResponse.data,
        realmId,
        connected_at: new Date().toISOString()
      };
      
      try {
        // Check if user is authenticated before saving tokens
        if (!userId) {
          logger.error('QBO OAuth callback: User not authenticated', { 
            hasUser: !!req.user,
            sessionID: req.sessionID,
            realmId 
          });
          return res.redirect(`/${redirectTo}?error=qbo_auth_required&reason=not_logged_in`);
        }
        
        // Save tokens to database
        await saveTokens(tokens, userId);
        
        logger.info('QBO OAuth successful', { userId, realmId });
        
        // Redirect to the original page or dashboard
        delete req.session.qboRedirectAfter;
        
        return res.redirect(`/${redirectTo}?qbo_connected=true`);
      } catch (storageError) {
        // Token storage failure
        logger.error('QBO token storage failed', { 
          error: storageError.message, 
          stack: storageError.stack,
          userId,
          realmId,
          dbError: storageError.cause || 'Unknown database error'
        });
        
        return res.redirect(`/${redirectTo}?error=qbo_storage_failed&reason=database`);
      }
    } catch (tokenExchangeError) {
      // Token exchange failure
      const responseData = tokenExchangeError.response?.data || {};
      const statusCode = tokenExchangeError.response?.status;
      
      logger.error('QBO token exchange failed', { 
        error: tokenExchangeError.message, 
        stack: tokenExchangeError.stack,
        statusCode,
        responseData,
        userId,
        realmId,
        requestId: tokenExchangeError.response?.headers['intuit-tid']
      });
      
      let errorReason = 'api_error';
      
      // Determine specific error type
      if (statusCode === 400) {
        errorReason = 'invalid_request';
      } else if (statusCode === 401) {
        errorReason = 'unauthorized';
      } else if (statusCode === 403) {
        errorReason = 'forbidden';
      } else if (statusCode >= 500) {
        errorReason = 'server_error';
      }
      
      return res.redirect(`/${redirectTo}?error=qbo_token_exchange_failed&reason=${errorReason}`);
    }
  } catch (error) {
    // General unexpected errors
    logger.error('QBO OAuth callback failed with unexpected error', { 
      error: error.message, 
      stack: error.stack,
      response: error.response?.data,
      userId,
      query: req.query,
      session: {
        hasQboState: !!req.session.qboOAuthState,
        hasRedirectAfter: !!req.session.qboRedirectAfter,
        redirectAfter: req.session.qboRedirectAfter
      }
    });
    
    // Determine error type for better user feedback
    let errorType = 'unknown';
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      errorType = 'connection';
    } else if (error.message && error.message.includes('database')) {
      errorType = 'database';
    } else if (error.message && error.message.includes('token')) {
      errorType = 'token';
    } else if (error.message && error.message.includes('validation')) {
      errorType = 'validation';
    }
    
    return res.redirect(`/${redirectTo}?error=qbo_connection_failed&type=${errorType}`);
  }
}

/**
 * Check QuickBooks connection status
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getConnectionStatus(req, res) {
  try {
    const userId = req.user.id;
    const isConnected = await hasValidTokens(userId);
    
    if (isConnected) {
      const tokens = await getTokens(userId);
      
      res.status(200).json({
        success: true,
        connected: true,
        realmId: tokens.realmId,
        connectedAt: tokens.connected_at,
        expiresAt: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
      });
    } else {
      res.status(200).json({
        success: true,
        connected: false
      });
    }
  } catch (error) {
    logger.error('QBO connection status check failed', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      message: 'Failed to check QuickBooks connection status'
    });
  }
}

/**
 * Disconnect from QuickBooks
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function disconnect(req, res) {
  try {
    const userId = req.user.id;
    const tokens = await getTokens(userId);
    
    if (!tokens) {
      return res.status(400).json({
        success: false,
        message: 'No QuickBooks connection found'
      });
    }
    
    // Revoke the tokens at Intuit
    try {
      await axios.post(
        QBO_REVOKE_URL,
        new URLSearchParams({
          token: tokens.refresh_token || tokens.access_token
        }),
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${secrets.qbo.clientId}:${secrets.qbo.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    } catch (revokeError) {
      // Log but continue - we'll still clear locally even if remote revoke fails
      logger.warn('QBO token revocation failed', { error: revokeError.message, userId });
    }
    
    // Clear tokens from our database
    await clearTokens(userId);
    
    logger.info('QBO disconnected successfully', { userId });
    
    res.status(200).json({
      success: true,
      message: 'Successfully disconnected from QuickBooks'
    });
  } catch (error) {
    logger.error('QBO disconnect failed', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect from QuickBooks'
    });
  }
}

/**
 * Get company information from QuickBooks
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getCompanyInfo(req, res) {
  try {
    const userId = req.user.id;
    logger.info('Getting QBO company info for user', { userId });
    
    const tokens = await getValidTokens(userId);
    logger.info('Retrieved QBO tokens for company info', { 
      userId,
      hasTokens: !!tokens,
      hasAccessToken: tokens ? !!tokens.access_token : false,
      hasRealmId: tokens ? !!tokens.realmId : false,
      tokenKeys: tokens ? Object.keys(tokens) : []
    });
    
    if (!tokens) {
      logger.warn('No tokens found for QBO company info', { userId });
      return res.status(400).json({
        success: false,
        message: 'QuickBooks not connected - no tokens found'
      });
    }
    
    if (!tokens.access_token) {
      logger.warn('No access token in QBO tokens', { userId, tokenKeys: Object.keys(tokens) });
      return res.status(400).json({
        success: false,
        message: 'QuickBooks not connected - no access token'
      });
    }
    
    if (!tokens.realmId) {
      logger.warn('No realmId in QBO tokens', { userId, tokenKeys: Object.keys(tokens) });
      return res.status(400).json({
        success: false,
        message: 'QuickBooks not connected - no realm ID'
      });
    }
    
    // Determine the API base URL based on environment
    const apiBaseUrl = secrets.qbo.environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company/'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
    
    try {
      // Get company info from QuickBooks API
      const response = await axios.get(
        `${apiBaseUrl}${tokens.realmId}/companyinfo/${tokens.realmId}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const companyInfo = response.data.CompanyInfo;
      
      res.status(200).json({
        success: true,
        company: {
          id: companyInfo.Id,
          name: companyInfo.CompanyName,
          legalName: companyInfo.LegalName,
          email: companyInfo.Email?.Address,
          phone: companyInfo.PrimaryPhone?.FreeFormNumber,
          address: companyInfo.CompanyAddr ? {
            line1: companyInfo.CompanyAddr.Line1,
            line2: companyInfo.CompanyAddr.Line2,
            city: companyInfo.CompanyAddr.City,
            state: companyInfo.CompanyAddr.CountrySubDivisionCode,
            postalCode: companyInfo.CompanyAddr.PostalCode,
            country: companyInfo.CompanyAddr.Country
          } : null
        }
      });
    } catch (apiError) {
      // Check if token expired (401 error)
      if (apiError.response?.status === 401) {
        try {
          // Try to refresh the token
          await refreshAccessToken(userId);
          
          // Return a specific response so client can retry
          return res.status(401).json({
            success: false,
            message: 'Token refreshed, please retry your request',
            tokenRefreshed: true
          });
        } catch (refreshError) {
          logger.error('QBO token refresh failed during company info fetch', { 
            error: refreshError.message, 
            userId 
          });
          
          return res.status(401).json({
            success: false,
            message: 'QuickBooks authentication expired. Please reconnect.',
            reconnectRequired: true
          });
        }
      }
      
      throw apiError;
    }
  } catch (error) {
    logger.error('QBO company info fetch failed', { 
      error: error.message, 
      response: error.response?.data,
      userId: req.user?.id 
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve QuickBooks company information'
    });
  }
}

module.exports = {
  initiateOAuth,
  handleOAuthCallback,
  getConnectionStatus,
  disconnect,
  getCompanyInfo
};

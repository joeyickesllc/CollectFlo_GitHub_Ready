/**
 * JWT Authentication Middleware
 * 
 * Middleware for authenticating requests using JWT tokens.
 * Supports both required and optional authentication modes.
 */

const jwtService = require('../services/jwtService');
const logger = require('../services/logger');

/**
 * Extract JWT token from various sources in the request
 * 
 * Priority order:
 * 1. Authorization header (Bearer token)
 * 2. accessToken cookie
 * 
 * @param {Object} req - Express request object
 * @returns {String|null} JWT token or null if not found
 */
function extractToken(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookies
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  
  return null;
}

/**
 * Extract refresh token from request
 * 
 * @param {Object} req - Express request object
 * @returns {String|null} Refresh token or null if not found
 */
function extractRefreshToken(req) {
  return req.cookies && req.cookies.refreshToken 
    ? req.cookies.refreshToken 
    : null;
}

/**
 * Middleware that requires authentication
 * 
 * If authentication fails, returns 401 Unauthorized
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  
  if (!token) {
    logger.debug('Authentication failed: No token provided');
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  try {
    // Verify the token
    const decoded = jwtService.verifyToken(token, 'access');
    
    // Add user data to request object
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      company_id: decoded.company_id
    };
    
    // Add token data for potential refresh
    req.token = {
      jti: decoded.jti,
      exp: decoded.exp
    };
    
    next();
  } catch (error) {
    logger.debug('Authentication failed', { error: error.message });
    
    // Handle token expiration specially
    if (error.message === 'Token has expired') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token',
      code: 'INVALID_TOKEN'
    });
  }
}

/**
 * Middleware that makes authentication optional
 * 
 * If token is present and valid, adds user to request
 * If token is missing or invalid, continues without authentication
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function optionalAuth(req, res, next) {
  // Always initialise user context so downstream code can rely on its presence
  req.user = null;
  req.token = null;

  const token = extractToken(req);
  
  if (!token) {
    // No token, continue without authentication
    return next();
  }
  
  try {
    // Verify the token
    const decoded = jwtService.verifyToken(token, 'access');
    
    // Add user data to request object
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      company_id: decoded.company_id
    };
    
    // Add token data for potential refresh
    req.token = {
      jti: decoded.jti,
      exp: decoded.exp
    };
  } catch (error) {
    // Token invalid, but authentication is optional so continue
    logger.debug('Optional authentication failed', { error: error.message });
    // keep req.user as null for clarity
  }
  
  next();
}

/**
 * Middleware that handles token refresh
 * 
 * Used when access token has expired but refresh token is valid
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleTokenRefresh(req, res) {
  const refreshToken = extractRefreshToken(req);
  
  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: 'Refresh token required'
    });
  }
  
  try {
    // Verify the refresh token
    const decoded = jwtService.verifyToken(refreshToken, 'refresh');
    
    // Get user data from database to ensure user still exists and has proper permissions
    const user = await getUserFromDatabase(decoded.sub);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = jwtService.refreshTokens(refreshToken, user);
    
    // Set cookies
    setAuthCookies(res, accessToken, newRefreshToken);
    
    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    logger.debug('Token refresh failed', { error: error.message });
    
    // Clear auth cookies on failure
    clearAuthCookies(res);
    
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN'
    });
  }
}

/**
 * Helper function to get user data from database
 * 
 * @param {String} userId - User ID
 * @returns {Promise<Object>} User object or null
 */
async function getUserFromDatabase(userId) {
  try {
    const db = require('../db/connection');
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    return user;
  } catch (error) {
    logger.error('Error fetching user for token refresh', { error: error.message, userId });
    return null;
  }
}

/**
 * Set authentication cookies
 * 
 * @param {Object} res - Express response object
 * @param {String} accessToken - JWT access token
 * @param {String} refreshToken - JWT refresh token
 */
function setAuthCookies(res, accessToken, refreshToken) {
  // In tests or non-Express contexts `res.cookie` may be undefined. Simply
  // skip cookie creation to avoid blowing up the request handler.
  if (typeof res.cookie !== 'function') {
    logger.debug('Response object missing cookie function; skipping auth cookies');
    return;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Set access token cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 60 * 1000 // 30 minutes
  });
  
  // Set refresh token cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth/refresh', // Restrict to refresh endpoint only
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

/**
 * Clear authentication cookies
 * 
 * @param {Object} res - Express response object
 */
function clearAuthCookies(res) {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
}

/**
 * Check if user has required role
 * 
 * @param {String|Array} roles - Required role(s)
 * @returns {Function} Middleware function
 */
function requireRole(roles) {
  // Convert single role to array
  const requiredRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    // First ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Check if user has required role
    if (!requiredRoles.includes(req.user.role)) {
      logger.warn('Unauthorized role access attempt', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles
      });
      
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource'
      });
    }
    
    next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  handleTokenRefresh,
  setAuthCookies,
  clearAuthCookies,
  requireRole
};

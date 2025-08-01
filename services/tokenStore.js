/**
 * Token Storage Service
 * 
 * Manages QuickBooks OAuth tokens in the database, providing secure storage
 * and retrieval with user association and encryption.
 */

const crypto = require('crypto');
const db = require('../backend/db/connection');
const logger = require('../backend/services/logger');
const secrets = require('../backend/config/secrets');

// Encryption settings
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16 bytes

// NOTE: GCM auth-tag length is fixed (16 bytes) and returned by `cipher.getAuthTag()`.
// We do not need an explicit constant – removed to keep code tidy.

/**
 * Encrypts sensitive token data
 * 
 * @param {string} text - The text to encrypt
 * @returns {Object} - Object containing encrypted data, iv, and authTag
 */
function encrypt(text) {
  try {
    // Use session secret as encryption key (hash it to get correct length)
    const sessionSecret = secrets.app.sessionSecret;
    const key = crypto.createHash('sha256').update(sessionSecret).digest();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    
    // Log SESSION_SECRET info for debugging (first/last 4 chars only for security)
    logger.info('Token encryption SESSION_SECRET', {
      secretStart: sessionSecret ? sessionSecret.substring(0, 4) : 'null',
      secretEnd: sessionSecret ? sessionSecret.substring(sessionSecret.length - 4) : 'null',
      secretLength: sessionSecret ? sessionSecret.length : 0,
      secretExists: !!sessionSecret,
      keyHash: key.toString('hex').substring(0, 8) + '...',
      fullKeyHash: crypto.createHash('sha256').update(key).digest('hex').substring(0, 16),
      processEnvSecret: process.env.SESSION_SECRET ? process.env.SESSION_SECRET.substring(0, 4) + '...' + process.env.SESSION_SECRET.substring(process.env.SESSION_SECRET.length - 4) : 'undefined'
    });
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // In GCM mode, we need to get the auth tag for decryption
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    logger.error('Token encryption failed', { error: error.message });
    throw new Error('Failed to encrypt token data');
  }
}

/**
 * Decrypts encrypted token data
 * 
 * @param {Object} encData - Object containing encrypted data, iv, and authTag
 * @returns {string} - Decrypted text
 */
function decrypt(encData) {
  try {
    const sessionSecret = secrets.app.sessionSecret;
    const key = crypto.createHash('sha256').update(sessionSecret).digest();
    const iv = Buffer.from(encData.iv, 'hex');
    const authTag = Buffer.from(encData.authTag, 'hex');
    
    // Log SESSION_SECRET info for debugging (first/last 4 chars only for security)
    logger.info('Token decryption SESSION_SECRET', {
      secretStart: sessionSecret ? sessionSecret.substring(0, 4) : 'null',
      secretEnd: sessionSecret ? sessionSecret.substring(sessionSecret.length - 4) : 'null',
      secretLength: sessionSecret ? sessionSecret.length : 0,
      secretExists: !!sessionSecret,
      keyHash: key.toString('hex').substring(0, 8) + '...',
      fullKeyHash: crypto.createHash('sha256').update(key).digest('hex').substring(0, 16),
      processEnvSecret: process.env.SESSION_SECRET ? process.env.SESSION_SECRET.substring(0, 4) + '...' + process.env.SESSION_SECRET.substring(process.env.SESSION_SECRET.length - 4) : 'undefined'
    });
    
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Token decryption failed', { 
      error: error.message,
      secretExists: !!secrets.app.sessionSecret,
      secretLength: secrets.app.sessionSecret ? secrets.app.sessionSecret.length : 0
    });
    throw new Error('Failed to decrypt token data');
  }
}

/**
 * Save or update QuickBooks OAuth tokens for a user
 * 
 * @param {Object} tokens - The tokens object from QuickBooks OAuth
 * @param {number} userId - The user ID to associate with these tokens (optional)
 * @returns {boolean} - Success status
 */
async function saveTokens(tokens, userId = null) {
  try {
    if (!tokens) {
      throw new Error('No tokens provided');
    }

    // Encrypt the entire tokens object
    const tokenStr = JSON.stringify(tokens);
    const encryptedData = encrypt(tokenStr);
    
    // Get current timestamp
    const now = new Date().toISOString();

    // Always clear existing tokens to avoid decryption conflicts
    await db.query('DELETE FROM qbo_tokens WHERE user_id = $1', [userId]);
    
    logger.info('Cleared existing QBO tokens before saving new ones', { userId });
    
    // Insert fresh tokens
    await db.query(
      `INSERT INTO qbo_tokens
        (user_id, encrypted_tokens, iv, auth_tag, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        encryptedData.encrypted,
        encryptedData.iv,
        encryptedData.authTag,
        now,
        now
      ]
    );
    
    logger.info('QBO tokens saved successfully', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to save QBO tokens', { 
      error: error.message, 
      stack: error.stack,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column,
      userId 
    });
    throw new Error(`Failed to save QuickBooks tokens: ${error.message}`);
  }
}

/**
 * Retrieve QuickBooks OAuth tokens for a user
 * 
 * @param {number} userId - The user ID to get tokens for (optional)
 * @returns {Object|null} - The tokens object or null if not found
 */
async function getTokens(userId = null) {
  try {
    // Get the encrypted tokens from the database
    const result = await db.query(
      `SELECT encrypted_tokens, iv, auth_tag
         FROM qbo_tokens
        WHERE user_id = $1
     ORDER BY updated_at DESC
        LIMIT 1`,
      [userId]
    );
    
    const rows = result?.rows || [];
    const tokenData = rows[0];
    
    if (!tokenData) {
      logger.debug('No QBO tokens found for user', { userId });
      return null;
    }
    
    // Log the token data structure before decryption attempt
    logger.info('About to decrypt token data', {
      userId,
      hasEncryptedTokens: !!tokenData.encrypted_tokens,
      hasIv: !!tokenData.iv,
      hasAuthTag: !!tokenData.auth_tag,
      encryptedLength: tokenData.encrypted_tokens ? tokenData.encrypted_tokens.length : 0,
      ivLength: tokenData.iv ? tokenData.iv.length : 0,
      authTagLength: tokenData.auth_tag ? tokenData.auth_tag.length : 0
    });

    // Decrypt the tokens
    const decrypted = decrypt({
      encrypted: tokenData.encrypted_tokens,
      iv: tokenData.iv,
      authTag: tokenData.auth_tag
    });
    
    logger.info('Token decryption completed successfully', { userId });
    return JSON.parse(decrypted);
  } catch (error) {
    logger.error('Failed to retrieve QBO tokens', { 
      error: error.message, 
      errorStack: error.stack,
      userId,
      tokenDataExists: !!tokenData,
      tokenDataKeys: tokenData ? Object.keys(tokenData) : []
    });
    return null;
  }
}

/**
 * Clear QuickBooks OAuth tokens for a user
 * 
 * @param {number} userId - The user ID to clear tokens for (optional)
 * @returns {boolean} - Success status
 */
async function clearTokens(userId = null) {
  try {
    // Delete the tokens from the database
    await db.query('DELETE FROM qbo_tokens WHERE user_id = $1', [userId]);
    
    logger.info('QBO tokens cleared successfully', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to clear QBO tokens', { error: error.message, userId });
    throw new Error(`Failed to clear QuickBooks tokens: ${error.message}`);
  }
}

/**
 * Check if a user has valid QuickBooks OAuth tokens
 * 
 * @param {number} userId - The user ID to check tokens for (optional)
 * @returns {boolean} - Whether the user has valid tokens
 */
async function hasValidTokens(userId = null) {
  try {
    const tokens = await getTokens(userId);
    
    if (!tokens || !tokens.access_token) {
      return false;
    }
    
    // Check if access token is expired
    // QuickBooks access tokens expire after 1 hour (3600 seconds)
    if (tokens.created_at || tokens.connected_at) {
      const tokenCreatedAt = new Date(tokens.created_at || tokens.connected_at);
      const expiresIn = tokens.expires_in || 3600; // Default to 1 hour
      const expirationTime = new Date(tokenCreatedAt.getTime() + (expiresIn * 1000));
      
      if (new Date() >= expirationTime) {
        logger.debug('QBO access token expired', { 
          userId, 
          tokenCreatedAt: tokenCreatedAt.toISOString(),
          expirationTime: expirationTime.toISOString(),
          now: new Date().toISOString()
        });
        return false;
      }
    }
    
    // Check if refresh token exists (needed for token refresh)
    if (!tokens.refresh_token) {
      logger.debug('QBO refresh token missing', { userId });
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('Failed to check QBO token validity', { error: error.message, userId });
    return false;
  }
}

/**
 * Get valid tokens for a user, automatically refreshing if needed
 * 
 * @param {number} userId - The user ID to get tokens for
 * @returns {Object|null} - The tokens object or null if unavailable
 */
async function getValidTokens(userId) {
  try {
    const tokens = await getTokens(userId);
    
    if (!tokens || !tokens.access_token) {
      return null;
    }
    
    // Check if access token is expired
    if (tokens.created_at || tokens.connected_at) {
      const tokenCreatedAt = new Date(tokens.created_at || tokens.connected_at);
      const expiresIn = tokens.expires_in || 3600; // Default to 1 hour
      const expirationTime = new Date(tokenCreatedAt.getTime() + (expiresIn * 1000));
      
      // If token is expired or will expire in next 5 minutes, refresh it
      const fiveMinutesFromNow = new Date(Date.now() + (5 * 60 * 1000));
      if (fiveMinutesFromNow >= expirationTime) {
        logger.debug('QBO access token expired or expiring soon, attempting refresh', { userId });
        
        try {
          const { refreshAccessToken } = require('./tokenRefresh');
          const refreshedTokens = await refreshAccessToken(userId);
          return refreshedTokens;
        } catch (refreshError) {
          logger.error('Failed to refresh expired QBO tokens', { 
            error: refreshError.message, 
            userId 
          });
          return null;
        }
      }
    }
    
    return tokens;
  } catch (error) {
    logger.error('Failed to get valid QBO tokens', { error: error.message, userId });
    return null;
  }
}

module.exports = {
  saveTokens,
  getTokens,
  getValidTokens,
  clearTokens,
  hasValidTokens
};

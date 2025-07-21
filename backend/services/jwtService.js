/**
 * JWT Authentication Service
 * 
 * Handles JWT token generation, verification, refresh, and blacklisting
 * for the CollectFlo authentication system.
 */

const jwt = require('jsonwebtoken');
const logger = require('./logger');

// Token blacklist (in-memory for now, could be moved to Redis for production)
// Maps token JTIs (JWT IDs) to expiration timestamps
const tokenBlacklist = new Map();

// Clean up expired blacklist entries periodically
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, expiry] of tokenBlacklist.entries()) {
    if (expiry < now) {
      tokenBlacklist.delete(jti);
    }
  }
}, 60 * 60 * 1000); // Run hourly

// Configuration
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'collectflo-access-dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'collectflo-refresh-dev-secret';
const JWT_ISSUER = process.env.JWT_ISSUER || 'collectflo-api';
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '30m';
const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

/**
 * Generate a JWT access token for a user
 * 
 * @param {Object} user - User object containing id, email, role, etc.
 * @returns {String} JWT access token
 */
function generateAccessToken(user) {
  try {
    if (!user || !user.id) {
      throw new Error('Invalid user object provided');
    }

    // Create a sanitized payload with only necessary user data
    const payload = {
      sub: user.id,                  // Subject (user ID)
      email: user.email,             // User's email
      role: user.role || 'user',     // User's role
      company_id: user.company_id,   // User's company
      jti: generateTokenId(),        // Unique token ID
      type: 'access'                 // Token type
    };

    const token = jwt.sign(payload, JWT_ACCESS_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      algorithm: 'HS256',
      issuer: JWT_ISSUER
    });

    logger.debug('Access token generated', { userId: user.id });
    return token;
  } catch (error) {
    logger.error('Error generating access token', { error: error.message });
    throw new Error(`Failed to generate access token: ${error.message}`);
  }
}

/**
 * Generate a JWT refresh token for a user
 * 
 * @param {Object} user - User object containing id, email, etc.
 * @returns {String} JWT refresh token
 */
function generateRefreshToken(user) {
  try {
    if (!user || !user.id) {
      throw new Error('Invalid user object provided');
    }

    // Minimal payload for refresh tokens (security best practice)
    const payload = {
      sub: user.id,                  // Subject (user ID)
      jti: generateTokenId(),        // Unique token ID
      type: 'refresh'                // Token type
    };

    const token = jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      algorithm: 'HS256',
      issuer: JWT_ISSUER
    });

    logger.debug('Refresh token generated', { userId: user.id });
    return token;
  } catch (error) {
    logger.error('Error generating refresh token', { error: error.message });
    throw new Error(`Failed to generate refresh token: ${error.message}`);
  }
}

/**
 * Verify and decode a JWT token
 * 
 * @param {String} token - JWT token to verify
 * @param {String} type - Token type ('access' or 'refresh')
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid, expired, or blacklisted
 */
function verifyToken(token, type = 'access') {
  try {
    if (!token) {
      throw new Error('No token provided');
    }

    // Select the appropriate secret based on token type
    const secret = type === 'access' ? JWT_ACCESS_SECRET : JWT_REFRESH_SECRET;
    
    // Verify the token
    const decoded = jwt.verify(token, secret, {
      issuer: JWT_ISSUER,
      algorithms: ['HS256']
    });

    // Check if token is blacklisted
    if (isTokenBlacklisted(decoded.jti)) {
      throw new Error('Token has been revoked');
    }

    // Verify token type matches expected type
    if (decoded.type !== type) {
      throw new Error(`Invalid token type. Expected ${type} token.`);
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Token expired', { type });
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token', { error: error.message, type });
      throw new Error('Invalid token');
    } else {
      logger.error('Token verification error', { error: error.message, type });
      throw error;
    }
  }
}

/**
 * Refresh an access token using a valid refresh token
 * 
 * @param {String} refreshToken - Valid refresh token
 * @param {Object} userData - User data from database (for validation)
 * @returns {Object} Object containing new access token and refresh token
 * @throws {Error} If refresh token is invalid or user data doesn't match
 */
function refreshTokens(refreshToken, userData) {
  try {
    // Verify the refresh token
    const decoded = verifyToken(refreshToken, 'refresh');
    
    // Verify user still exists and matches token subject
    if (!userData || userData.id !== decoded.sub) {
      throw new Error('Invalid user data for token refresh');
    }

    // Blacklist the used refresh token (prevent replay attacks)
    blacklistToken(decoded.jti, decoded.exp);
    
    // Generate new tokens
    const newAccessToken = generateAccessToken(userData);
    const newRefreshToken = generateRefreshToken(userData);

    logger.info('Tokens refreshed successfully', { userId: userData.id });
    
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  } catch (error) {
    logger.error('Token refresh failed', { error: error.message });
    throw new Error(`Failed to refresh token: ${error.message}`);
  }
}

/**
 * Add a token to the blacklist
 * 
 * @param {String} jti - JWT ID to blacklist
 * @param {Number} expiry - Token expiration timestamp
 */
function blacklistToken(jti, expiry) {
  if (!jti) {
    logger.warn('Attempted to blacklist token without JTI');
    return;
  }
  
  tokenBlacklist.set(jti, expiry);
  logger.debug('Token blacklisted', { jti });
}

/**
 * Check if a token is blacklisted
 * 
 * @param {String} jti - JWT ID to check
 * @returns {Boolean} True if token is blacklisted
 */
function isTokenBlacklisted(jti) {
  return tokenBlacklist.has(jti);
}

/**
 * Generate a unique token ID
 * 
 * @returns {String} Unique token ID
 */
function generateTokenId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Extract token from authorization header
 * 
 * @param {String} authHeader - Authorization header
 * @returns {String|null} Extracted token or null
 */
function extractTokenFromHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  return authHeader.substring(7);
}

/**
 * Handle logout by blacklisting tokens
 * 
 * @param {String} accessToken - Access token to blacklist
 * @param {String} refreshToken - Refresh token to blacklist
 */
function logout(accessToken, refreshToken) {
  try {
    if (accessToken) {
      const decodedAccess = jwt.decode(accessToken);
      if (decodedAccess && decodedAccess.jti) {
        blacklistToken(decodedAccess.jti, decodedAccess.exp);
      }
    }
    
    if (refreshToken) {
      const decodedRefresh = jwt.decode(refreshToken);
      if (decodedRefresh && decodedRefresh.jti) {
        blacklistToken(decodedRefresh.jti, decodedRefresh.exp);
      }
    }
    
    logger.info('User logged out, tokens blacklisted');
  } catch (error) {
    logger.error('Error during logout', { error: error.message });
    // Don't throw here - we want logout to succeed even if token blacklisting fails
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  refreshTokens,
  blacklistToken,
  isTokenBlacklisted,
  extractTokenFromHeader,
  logout
};

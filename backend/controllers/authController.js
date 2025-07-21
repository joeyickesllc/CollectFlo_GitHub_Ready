/**
 * Authentication Controller
 * 
 * Handles user authentication operations including login, signup, and logout.
 * Uses JSON Web Tokens (JWTs) stored in HTTP-only cookies for authentication and bcryptjs for password security.
 */

const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const logger = require('../services/logger');
const jwtService = require('../services/jwtService');
const {
  setAuthCookies,
  clearAuthCookies
} = require('../middleware/jwtAuthMiddleware');

/**
 * User login
 * 
 * Authenticates a user by email and password, creates a session upon successful login
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.login = async (req, res) => {
  try {
    const { email, password, redirect: redirectFromClient } = req.body;

    // Allow client to specify desired redirect – default to dashboard
    const redirect = redirectFromClient && typeof redirectFromClient === 'string'
      ? redirectFromClient
      : '/dashboard';

    logger.debug('Login attempt', { email, redirectRequested: redirectFromClient });

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Find user by email
    const user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
    
    // Check if user exists
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn('Invalid password attempt', { email });
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // ------------------------------------------------------------------
    // Generate JWT tokens & set secure cookies
    // ------------------------------------------------------------------
    const accessToken  = jwtService.generateAccessToken(user);
    const refreshToken = jwtService.generateRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);

    logger.info('User logged in', { userId: user.id, email: user.email });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      redirect,
      user: {
        id   : user.id,
        email: user.email,
        name : user.name,
        role : user.role
      }
    });
  } catch (error) {
    logger.error('Login error:', { error });
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred during login' 
    });
  }
};

/**
 * User signup
 * 
 * Creates a new user account and company profile
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.signup = async (req, res) => {
  try {
    // Accept either camelCase or snake_case sent from the client. The
    // security middleware already normalises these, but we keep this
    // fallback to stay backward-compatible.
    const company_name = req.body.company_name || req.body.companyName;
    const name        = req.body.name        || req.body.fullName;
    const { email, password } = req.body;

    // Validate input
    if (!name || !email || !password || !company_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, password, and company name are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Check if email already exists
    const existingUser = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);

    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already in use' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Use transaction to ensure company and user are created together
    const result = await db.transaction(async (client) => {
      // Create company
      const companyResult = await client.query(
        'INSERT INTO companies (name, created_at) VALUES ($1, NOW()) RETURNING id',
        [company_name]
      );
      const companyId = companyResult.rows[0].id;

      // Create user
      const userResult = await client.query(
        'INSERT INTO users (name, email, password, company_id, role, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, email, name, role',
        [name, email, hashedPassword, companyId, 'admin']
      );
      
      return {
        user: userResult.rows[0],
        companyId
      };
    });

    // ------------------------------------------------------------------
    // Generate JWT tokens & set cookies
    // ------------------------------------------------------------------
    const accessToken  = jwtService.generateAccessToken(result.user);
    const refreshToken = jwtService.generateRefreshToken(result.user);
    setAuthCookies(res, accessToken, refreshToken);

    logger.info('New user signed up', { userId: result.user.id, email: email });

    return res.status(201).json({
      success: true,
      message: 'Signup successful',
      user: {
        id   : result.user.id,
        email: result.user.email,
        name : result.user.name,
        role : result.user.role
      }
    });
  } catch (error) {
    logger.error('Signup error:', { error });
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred during signup' 
    });
  }
};

/**
 * User logout
 * 
 * Destroys the user session
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.logout = (req, res) => {
  try {
    const accessToken  = req.cookies?.accessToken || null;
    const refreshToken = req.cookies?.refreshToken || null;

    jwtService.logout(accessToken, refreshToken);
    clearAuthCookies(res);

    logger.info('User logged out');

    return res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', { error });
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred during logout' 
    });
  }
};

/**
 * Check authentication status
 * 
 * Verifies if a user is currently authenticated
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.checkAuth = (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = jwtService.extractTokenFromHeader(authHeader) || req.cookies?.accessToken;

    if (!token) {
      return res.status(200).json({ success: true, isAuthenticated: false });
    }

    const decoded = jwtService.verifyToken(token, 'access');

    return res.status(200).json({
      success: true,
      isAuthenticated: true,
      user: {
        id   : decoded.sub,
        email: decoded.email,
        role : decoded.role
      }
    });
  } catch {
    return res.status(200).json({ success: true, isAuthenticated: false });
  }
};

/**
 * Change password
 * 
 * Allows a user to change their password
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    // Get user with password
    const user = await db.queryOne('SELECT password FROM users WHERE id = $1', [userId]);

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await db.execute(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    logger.info(`User changed password: ${req.session.user.email}`, { userId });

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', { error, userId: req.session?.user?.id });
    return res.status(500).json({
      success: false,
      message: 'An error occurred while changing password'
    });
  }
};

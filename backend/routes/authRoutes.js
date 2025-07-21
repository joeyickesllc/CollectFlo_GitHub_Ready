/**
 * Authentication Routes
 * 
 * Handles all authentication-related routes including login, signup,
 * logout, token refresh, and authentication status checks.
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const jwtAuthMiddleware = require('../middleware/jwtAuthMiddleware');
const logger = require('../services/logger');

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get tokens
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    await authController.login(req, res);
  } catch (error) {
    logger.error('Login route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error during login' 
    });
  }
});

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post('/signup', async (req, res) => {
  try {
    await authController.signup(req, res);
  } catch (error) {
    logger.error('Signup route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error during signup' 
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user & clear cookies
 * @access  Public
 */
router.post('/logout', (req, res) => {
  try {
    authController.logout(req, res);
  } catch (error) {
    logger.error('Logout route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error during logout' 
    });
  }
});

/**
 * @route   GET /api/auth/check
 * @desc    Check if user is authenticated
 * @access  Public
 */
router.get('/check', (req, res) => {
  try {
    authController.checkAuth(req, res);
  } catch (error) {
    logger.error('Check auth route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error checking authentication' 
    });
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', async (req, res) => {
  try {
    await jwtAuthMiddleware.handleTokenRefresh(req, res);
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to refresh token' 
    });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', jwtAuthMiddleware.requireAuth, async (req, res) => {
  try {
    await authController.changePassword(req, res);
  } catch (error) {
    logger.error('Change password route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error during password change' 
    });
  }
});

/**
 * @route   GET /api/auth/user
 * @desc    Get current user data
 * @access  Private
 */
router.get('/user', jwtAuthMiddleware.requireAuth, (req, res) => {
  try {
    // Return user data from JWT payload
    res.status(200).json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        company_id: req.user.company_id
      }
    });
  } catch (error) {
    logger.error('User info route error', { error: error.message });
    res.status(500).json({ 
      success: false, 
      message: 'Server error retrieving user data' 
    });
  }
});

module.exports = router;

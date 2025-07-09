/**
 * CollectFlo API Routes
 * 
 * This file organizes all API routes for the CollectFlo application.
 * Routes are grouped by functionality for better maintainability.
 */

const express = require('express');
const router = express.Router();

// Import controllers
const authController = require('../controllers/authController');
const betaController = require('../controllers/betaController');
// const dashboardController = require('../controllers/dashboardController');
// const settingsController = require('../controllers/settingsController');
// const invoiceController = require('../controllers/invoiceController');
// const qboController = require('../controllers/qboController');
// const testController = require('../controllers/testController');

// Import middleware
const { requireAuth } = require('../middleware/authMiddleware');
const errorMiddleware = require('../middleware/errorMiddleware');
const { trackPageVisit, trackBetaSignup, trackLogin, trackUserAction } = require('../middleware/trackingMiddleware');
const {
  validateLogin,
  validateSignup,
  authRateLimiter,
  signupRateLimiter,
} = require('../middleware/securityMiddleware');
const logger = require('../services/logger');

// Apply request logger middleware to all API routes
router.use(logger.requestLogger);

/**
 * Authentication Routes
 */
router.post(
  '/login',
  authRateLimiter,          // Protect against brute-force
  validateLogin,            // Input validation / sanitisation
  trackLogin,               // Track successful / failed attempts
  async (req, res, next) => {
  try {
    await authController.login(req, res);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/signup',
  signupRateLimiter,        // Limit account creation
  validateSignup,           // Validate & sanitise input
  trackUserAction('user_signup'),
  async (req, res, next) => {
  try {
    await authController.signup(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await authController.logout(req, res);
  } catch (error) {
    next(error);
  }
});

router.get('/check-auth', async (req, res, next) => {
  try {
    await authController.checkAuth(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * Dashboard Routes
 * All dashboard routes require authentication
 */
router.get('/dashboard/stats', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with dashboardController.getStats
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.get('/invoices', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with dashboardController.getInvoices
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/invoices/:id/exclude', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with dashboardController.excludeInvoice
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

/**
 * Settings Routes
 * All settings routes require authentication
 */
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with settingsController.getSettings
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/settings', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with settingsController.updateSettings
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/logo', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with settingsController.uploadLogo
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.get('/templates', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with settingsController.getTemplates
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/templates/:id', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with settingsController.updateTemplate
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

/**
 * Invoice & Payment Routes
 */
router.get('/create-payment-link/:invoiceId', async (req, res, next) => {
  try {
    // Will be replaced with invoiceController.createPaymentLink
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/check-payments', async (req, res, next) => {
  try {
    // Will be replaced with invoiceController.checkPayments
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/sync-invoices', async (req, res, next) => {
  try {
    // Will be replaced with invoiceController.syncInvoices
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

/**
 * Beta Program Routes
 */
router.post(
  '/beta-signup',
  signupRateLimiter,
  validateSignup,
  trackBetaSignup,
  async (req, res, next) => {
  try {
    await betaController.signup(req, res);
  } catch (error) {
    next(error);
  }
});

router.get('/beta-stats', requireAuth, async (req, res, next) => {
  try {
    await betaController.getStats(req, res);
  } catch (error) {
    next(error);
  }
});

/**
 * QuickBooks Integration Routes
 */
router.get('/qbo/status', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with qboController.getStatus
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

router.post('/qbo/disconnect', requireAuth, async (req, res, next) => {
  try {
    // Will be replaced with qboController.disconnect
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

/**
 * Test Routes (for development only)
 */
router.post('/test-email', async (req, res, next) => {
  try {
    // Will be replaced with testController.sendTestEmail
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (error) {
    next(error);
  }
});

// Centralized error handling for API routes
router.use(errorMiddleware);

module.exports = router;

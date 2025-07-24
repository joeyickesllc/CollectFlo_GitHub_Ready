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
const qboController = require('../controllers/qboController');

// Import middleware
const {
  requireAuth,
  optionalAuth,
} = require('../middleware/jwtAuthMiddleware');
const errorMiddleware = require('../middleware/errorMiddleware');
const { trackPageVisit, trackBetaSignup, trackLogin, trackUserAction } = require('../middleware/trackingMiddleware');
const {
  validateLogin,
  validateSignup,
  authRateLimiter,
  signupRateLimiter,
} = require('../middleware/securityMiddleware');
const logger = require('../services/logger');

// Mount dedicated authentication routes (JWT-based)
const authRoutes = require('./authRoutes');
router.use('/auth', authRoutes);

/**
 * ---------------------------------------------------------------------------
 * Back-compat Authentication Endpoints
 * ---------------------------------------------------------------------------
 * Older front-end builds may still call the original top-level auth URLs
 * (/api/login, /api/signup, /api/logout, /api/check-auth).  These wrappers
 * delegate to the new JWT-based `/api/auth/*` handlers so we can migrate the
 * front-end incrementally without breaking existing clients.
 */

// POST /api/login  →  /api/auth/login
router.post(
  '/login',
  authRateLimiter,
  validateLogin,
  trackLogin,
  (req, res, next) => authController.login(req, res, next)
);

// POST /api/signup → /api/auth/signup
router.post(
  '/signup',
  signupRateLimiter,
  validateSignup,
  trackUserAction('user_signup'),
  (req, res, next) => authController.signup(req, res, next)
);

// POST /api/logout → /api/auth/logout
router.post('/logout', (req, res, next) => authController.logout(req, res, next));

// GET  /api/check-auth → /api/auth/check
router.get('/check-auth', (req, res, next) => authController.checkAuth(req, res, next));

// Apply request logger middleware to all API routes
router.use(logger.requestLogger);

/**
 * Authentication debug endpoint
 * ---------------------------------------------------------------
 * Returns detailed information about the current request/session.
 * This route is intentionally placed BEFORE any auth-guarded
 * routes or middleware so it always runs without interference.
 *
 * SECURITY NOTE:
 *   • Only non-sensitive data is returned.
 *   • Cookies are masked, authorisation headers are not exposed.
 *   • Intended for temporary diagnostics; restrict in production.
 */
router.get('/auth-debug', async (req, res) => {
  const debugPayload = {
    hasToken        : !!(req.cookies?.accessToken || req.headers.authorization),
    isAuthenticated : !!req.user,
    cookies         : (req.headers.cookie || '')
                        .split(';')
                        .map(c => c.trim())
                        .filter(Boolean),
    headers: {
      ...req.headers,
      cookie       : 'hidden for security',
      authorization: req.headers.authorization ? 'present' : 'absent'
    },
    connectionInfo: {
      ip         : req.ip,
      protocol   : req.protocol,
      secure     : req.secure,
      hostname   : req.hostname,
      method     : req.method,
      originalUrl: req.originalUrl,
    }
  };

  // Attach minimal user info when authenticated
  if (req.user) {
    const { id, email, role } = req.user;
    debugPayload.user = { id, email, role };
  }

  res.json(debugPayload);
});

/**
 * Return current authenticated user info
 * 
 * Front-end (nav.js) expects `/api/user-info` to return 200 with the
 * user object when a session exists, or 401 when not authenticated.
 */
router.get('/user-info', optionalAuth, async (req, res, next) => {
  try {
    if (req.user) {
      // Only expose non-sensitive fields
      const { id, email, role } = req.user;
      return res.status(200).json({
        success: true,
        user: { id, email, role }
      });
    }

    // Not authenticated
    return res.status(401).json({ success: false, message: 'Not authenticated' });
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
router.get(
  '/qbo/status',
  requireAuth,
  (req, res, next) => qboController.getConnectionStatus(req, res, next)
);

router.post(
  '/qbo/disconnect',
  requireAuth,
  (req, res, next) => qboController.disconnect(req, res, next)
);

router.get(
  '/qbo/company-info',
  requireAuth,
  (req, res, next) => qboController.getCompanyInfo(req, res, next)
);

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

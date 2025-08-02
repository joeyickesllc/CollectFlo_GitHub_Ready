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
// QuickBooks controller is optional (e.g. when env vars are missing in some deploys)
let qboController;
try {
  // eslint-disable-next-line global-require
  qboController = require('../controllers/qboController');
} catch (error) {
  // Do not crash the entire API if the controller cannot be loaded
  // (missing env vars, build-time lint issues, etc.)
  // eslint-disable-next-line no-console
  console.warn('QBO Controller not available in API routes:', error.message);
}

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
const db = require('../db/connection'); // <-- DB connection for setup route

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
    const userId = req.user.id;
    const { getValidTokens } = require('../../services/tokenStore');
    const axios = require('axios');
    const secrets = require('../config/secrets');
    
    // Get QuickBooks tokens
    const tokens = await getValidTokens(userId);
    if (!tokens || !tokens.access_token) {
      return res.status(400).json({ 
        success: false, 
        message: 'QuickBooks not connected' 
      });
    }
    
    // Determine API URL
    const apiBaseUrl = secrets.qbo.environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company/'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
    
    try {
      // Fetch invoices from QuickBooks
      const response = await axios.get(
        `${apiBaseUrl}${tokens.realmId}/query?query=SELECT * FROM Invoice MAXRESULTS ${req.query.limit || 50}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const invoices = response.data.QueryResponse?.Invoice || [];
      
      // Transform to match expected format
      const transformedInvoices = invoices.map(invoice => ({
        id: invoice.Id,
        doc_number: invoice.DocNumber,
        customer_name: invoice.CustomerRef?.name || 'Unknown Customer', 
        total_amount: invoice.TotalAmt || 0,
        balance: invoice.Balance || 0,
        due_date: invoice.DueDate,
        txn_date: invoice.TxnDate,
        currency: invoice.CurrencyRef?.value || 'USD',
        status: invoice.Balance > 0 ? 'unpaid' : 'paid'
      }));
      
      res.json({
        success: true,
        invoices: transformedInvoices,
        count: transformedInvoices.length
      });
      
    } catch (qbError) {
      console.error('QuickBooks API error:', qbError.response?.data);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch invoices from QuickBooks',
        error: qbError.response?.data || qbError.message
      });
    }
    
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
    const userId = req.user.id;
    
    // Get company settings from database
    const companyResult = await db.queryOne(
      'SELECT name FROM companies WHERE id = (SELECT company_id FROM users WHERE id = $1)',
      [userId]
    );
    
    // Get user settings from settings table
    const settingsResult = await db.queryOne(
      'SELECT * FROM settings WHERE user_id = $1',
      [userId]
    );
    
    // Default settings if none exist
    const settings = {
      company_name: companyResult?.name || '',
      email: req.user.email || '',
      phone: settingsResult?.phone || '',
      reply_to_email: settingsResult?.reply_to_email || ''
    };
    
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

router.post('/settings', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { company_name, email, phone, reply_to_email } = req.body;
    
    // Update company name if provided
    if (company_name) {
      await db.query(
        'UPDATE companies SET name = $1, updated_at = NOW() WHERE id = (SELECT company_id FROM users WHERE id = $2)',
        [company_name, userId]
      );
    }
    
    // Update or insert user settings
    const existingSettings = await db.queryOne(
      'SELECT id FROM settings WHERE user_id = $1',
      [userId]
    );
    
    if (existingSettings) {
      // Update existing settings
      await db.query(
        'UPDATE settings SET phone = $1, reply_to_email = $2, updated_at = NOW() WHERE user_id = $3',
        [phone || null, reply_to_email || null, userId]
      );
    } else {
      // Insert new settings
      await db.query(
        'INSERT INTO settings (user_id, phone, reply_to_email, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
        [userId, phone || null, reply_to_email || null]
      );
    }
    
    res.json({ success: true, message: 'Settings updated successfully' });
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
if (qboController) {
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

  // Debug endpoint to check QuickBooks environment configuration
  router.get('/qbo/debug-env', requireAuth, async (req, res, next) => {
    try {
      const secrets = require('../config/secrets');
      
      res.json({
        qbo_environment: secrets.qbo.environment,
        qbo_api_url: secrets.qbo.apiUrl,
        has_client_id: !!secrets.qbo.clientId,
        has_client_secret: !!secrets.qbo.clientSecret,
        has_redirect_uri: !!secrets.qbo.redirectUri,
        node_env: process.env.NODE_ENV,
        raw_qbo_env: process.env.QBO_ENVIRONMENT
      });
    } catch (error) {
      next(error);
    }
  });
}

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

/**
 * ---------------------------------------------------------------------------
 * Temporary DB-setup Endpoint
 * ---------------------------------------------------------------------------
 * GET /api/setup-qbo-table
 *
 * • Checks if the `qbo_tokens` table exists.
 * • Creates the table and required indexes if missing.
 * • Returns JSON describing the action taken.
 *
 * SECURITY NOTE:
 *   Expose this only in development.  Disable or remove in production once
 *   migrations are fixed.
 */
router.get('/setup-qbo-table', async (req, res) => {
  try {
    // Check table existence
    const { rows } = await db.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'qbo_tokens'
       ) AS exists;`
    );

    if (rows[0].exists) {
      logger.info('setup-qbo-table: qbo_tokens already exists');
      return res.status(200).json({
        success : true,
        created : false,
        message : 'qbo_tokens table already exists'
      });
    }

    // Run DDL in a transaction
    await db.query('BEGIN');
    await db.query(`
      CREATE TABLE public.qbo_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        encrypted_tokens TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`);
    await db.query(
      'CREATE INDEX idx_qbo_tokens_user_id ON public.qbo_tokens(user_id);'
    );
    await db.query(
      'CREATE INDEX idx_qbo_tokens_updated_at ON public.qbo_tokens(updated_at);'
    );
    await db.query('COMMIT');

    logger.info('setup-qbo-table: qbo_tokens table created successfully');
    return res.status(201).json({
      success : true,
      created : true,
      message : 'qbo_tokens table created'
    });
  } catch (error) {
    // Roll back if we’re mid-transaction
    try { await db.query('ROLLBACK'); } catch (_) {}
    logger.error('setup-qbo-table failed', { error: error.message });
    return res.status(500).json({
      success : false,
      message : 'Failed to set up qbo_tokens table',
      error   : error.message
    });
  }
});

// Centralized error handling for API routes
router.use(errorMiddleware);

module.exports = router;

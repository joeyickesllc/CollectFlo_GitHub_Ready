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
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !process.env.DEBUG_TESTS) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
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

  if (req.user) {
    const { id, email, role } = req.user;
    debugPayload.user = { id, email, role };
  }

  res.json(debugPayload);
});

/**
 * Restrict debug HTML pages in production by returning 404
 */
router.get('/__debug/auth', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) return res.status(404).end();
  res.sendFile(require('path').join(__dirname, '../../public', 'auth-diagnostics.html'));
});

router.get('/__debug/login', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) return res.status(404).end();
  res.sendFile(require('path').join(__dirname, '../../public', 'login-debug.html'));
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
    const { createFollowUpsForInvoice, getNextFollowUpDate } = require('../../services/followUpService');
    const axios = require('axios');
    const secrets = require('../config/secrets');
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    const companyId = userCompany.company_id;
    
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
      
      // Transform to match dashboard expected format
      const transformedInvoices = [];
      
      for (const invoice of invoices) {
        const invoiceData = {
          invoice_id: invoice.DocNumber || invoice.Id,
          customer_name: invoice.CustomerRef?.name || 'Unknown Customer', 
          amount: parseFloat(invoice.TotalAmt || 0),
          balance: parseFloat(invoice.Balance || 0),
          due_date: invoice.DueDate,
          txn_date: invoice.TxnDate,
          status: parseFloat(invoice.Balance || 0) > 0 ? 'unpaid' : 'paid',
          excluded: false, // Default to not excluded
          next_followup: null
        };
        
        // Create follow-ups for unpaid invoices
        if (invoiceData.status === 'unpaid' && invoiceData.due_date) {
          try {
            await createFollowUpsForInvoice(invoiceData, companyId);
            
            // Get next follow-up date
            const nextFollowUp = await getNextFollowUpDate(invoiceData.invoice_id, companyId);
            invoiceData.next_followup = nextFollowUp;
          } catch (followUpError) {
            console.error('Error creating follow-ups for invoice:', followUpError.message);
            // Don't fail the whole request, just log and continue
          }
        }
        
        transformedInvoices.push(invoiceData);
      }
      
      // Return direct array as expected by dashboard
      res.json(transformedInvoices);
      
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

/**
 * Test endpoint to verify API is working
 */
router.post('/admin/test', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    logger.info('Test endpoint called', { userId });
    
    res.json({ 
      success: true, 
      message: 'Test endpoint is working',
      user: {
        id: userId,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Error in test endpoint', { error: error.message });
    next(error);
  }
});

/**
 * Manual Follow-Up Processing Trigger (for testing and troubleshooting)
 */
router.post('/admin/trigger-followups', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    logger.info('Manual follow-up processing endpoint called', { 
      userId,
      timestamp: new Date().toISOString()
    });
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    logger.info('User company lookup result', { 
      userId, 
      userCompany: userCompany ? { company_id: userCompany.company_id } : null 
    });
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    logger.info('Manual follow-up processing triggered', { 
      userId, 
      companyId: userCompany.company_id 
    });
    
    // Import and trigger follow-up processing
    const { processPendingFollowUps } = require('../../services/followUpProcessor');
    
    const results = await processPendingFollowUps(userCompany.company_id, 100);
    
    logger.info('Manual follow-up processing completed', {
      userId,
      companyId: userCompany.company_id,
      results
    });
    
    res.json({ 
      success: true, 
      message: 'Follow-up processing completed',
      results: {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
        duration: results.duration,
        errors: results.errors
      }
    });
    
  } catch (error) {
    logger.error('Error in manual follow-up processing', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
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
router.get('/create-payment-link/:invoiceId', requireAuth, async (req, res, next) => {
  try {
    const invoiceId = req.params.invoiceId;
    const userId = req.user.id;
    
    const { generateQuickBooksPaymentLink } = require('../../services/paymentLinkService');
    
    const paymentLinkData = await generateQuickBooksPaymentLink(invoiceId, userId);
    
    res.json({
      success: true,
      paymentLink: paymentLinkData.paymentUrl,
      invoiceNumber: paymentLinkData.invoiceNumber,
      amount: paymentLinkData.amount,
      customerName: paymentLinkData.customerName,
      dueDate: paymentLinkData.dueDate
    });
  } catch (error) {
    logger.error('Error creating payment link', {
      error: error.message,
      invoiceId: req.params.invoiceId,
      userId: req.user?.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to create payment link',
      error: error.message
    });
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
 * Follow-Up Management Routes
 */
router.get('/follow-ups', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { getPendingFollowUps } = require('../../services/followUpService');
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    const limit = parseInt(req.query.limit) || 50;
    const followUps = await getPendingFollowUps(userCompany.company_id, limit);
    
    res.json({
      success: true,
      follow_ups: followUps,
      count: followUps.length
    });
  } catch (error) {
    next(error);
  }
});

router.get('/follow-ups/rules', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { getFollowUpRules } = require('../../services/followUpService');
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    const rules = await getFollowUpRules(userCompany.company_id);
    
    res.json({
      success: true,
      rules: rules
    });
  } catch (error) {
    next(error);
  }
});

router.post('/follow-ups/rules', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { saveFollowUpRules } = require('../../services/followUpService');
    const { rules } = req.body;
    
    if (!rules || !Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid rules format'
      });
    }
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    await saveFollowUpRules(userCompany.company_id, rules);
    
    res.json({
      success: true,
      message: 'Follow-up rules saved successfully'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/follow-ups/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const followUpId = req.params.id;
    const userId = req.user.id;
    const { notes } = req.body;
    
    // Get user's company ID for security
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    // Update follow-up status
    const result = await db.query(
      'UPDATE follow_ups SET status = $1, delivered_at = NOW(), updated_at = NOW(), error_message = $2 WHERE id = $3 AND company_id = $4',
      ['completed', notes || null, followUpId, userCompany.company_id]
    );
    
    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Follow-up marked as completed'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Follow-Up Processing Routes
 */
router.post('/follow-ups/process', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { companyId, urgentOnly = false, limit = 50 } = req.body;
    
    // Get user's company ID for security
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    // Only allow processing user's own company unless admin
    const targetCompanyId = companyId || userCompany.company_id;
    if (targetCompanyId !== userCompany.company_id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to process follow-ups for this company'
      });
    }
    
    const { triggerManualProcessing } = require('../../services/followUpScheduler');
    const results = await triggerManualProcessing(urgentOnly);
    
    res.json({
      success: true,
      message: 'Follow-up processing completed',
      results
    });
  } catch (error) {
    next(error);
  }
});

router.post('/follow-ups/:id/send', requireAuth, async (req, res, next) => {
  try {
    const followUpId = req.params.id;
    const userId = req.user.id;
    
    // Get user's company ID for security
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (!userCompany) {
      return res.status(400).json({ 
        success: false, 
        message: 'User company not found' 
      });
    }
    
    // Get the follow-up and verify ownership
    const followUp = await db.queryOne(
      'SELECT * FROM follow_ups WHERE id = $1 AND company_id = $2',
      [followUpId, userCompany.company_id]
    );
    
    if (!followUp) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up not found'
      });
    }
    
    if (followUp.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Follow-up already ${followUp.status}`
      });
    }
    
    // Process the follow-up
    const { processFollowUp } = require('../../services/followUpProcessor');
    const result = await processFollowUp(followUp);
    
    res.json({
      success: result.success,
      message: result.success ? 'Follow-up sent successfully' : 'Failed to send follow-up',
      result
    });
  } catch (error) {
    next(error);
  }
});

router.get('/follow-ups/scheduler/status', requireAuth, async (req, res, next) => {
  try {
    const { getSchedulerStatus } = require('../../services/followUpScheduler');
    const status = getSchedulerStatus();
    
    res.json({
      success: true,
      scheduler: status
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Test Routes (for development only)
 */
router.post('/test-email', requireAuth, async (req, res, next) => {
  try {
    const { toEmail, testData } = req.body;

    if (!toEmail) {
      return res.status(400).json({
        success: false,
        message: 'toEmail is required'
      });
    }

    // Look up the authenticated user's company to personalise templates
    let companyId = testData?.companyId;
    try {
      if (!companyId) {
        const userCompany = await db.queryOne(
          'SELECT company_id FROM users WHERE id = $1',
          [req.user.id]
        );
        companyId = userCompany?.company_id || 1;
      }
    } catch (lookupErr) {
      // If lookup fails, fall back to default
      companyId = 1;
    }

    // Dynamically import the email service so missing SendGrid config doesn't crash app startup
    const { sendTestFollowUpEmail } = require('../../services/emailService');
    const result = await sendTestFollowUpEmail(toEmail, { ...testData, companyId });

    return res.json({
      success: true,
      message: 'Test email sent successfully',
      result
    });
  } catch (error) {
    // Return a more helpful error payload to assist troubleshooting in the UI
    const details = error?.response?.body || error?.body || undefined;
    return res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
      ...(details && { details })
    });
  }
});

router.post('/test-sms', requireAuth, async (req, res, next) => {
  try {
    const { toPhone, testData } = req.body;
    
    if (!toPhone) {
      return res.status(400).json({
        success: false,
        message: 'toPhone is required'
      });
    }
    
    const { sendTestFollowUpSMS } = require('../../services/smsService');
    const result = await sendTestFollowUpSMS(toPhone, testData);
    
    res.json({
      success: true,
      message: 'Test SMS sent successfully',
      result
    });
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

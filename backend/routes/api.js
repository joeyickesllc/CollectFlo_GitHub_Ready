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
  requireRole,
} = require('../middleware/jwtAuthMiddleware');
const errorMiddleware = require('../middleware/errorMiddleware');
const { trackPageVisit, trackBetaSignup, trackLogin, trackUserAction } = require('../middleware/trackingMiddleware');
const {
  validateLogin,
  validateSignup,
  authRateLimiter,
  signupRateLimiter,
} = require('../middleware/securityMiddleware');
const { checkTrialStatus, requireActiveSubscription } = require('../middleware/trialMiddleware');
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
      // Get user info with trial status
      const user = await db.queryOne(
        'SELECT id, email, name, role, subscription_status, trial_end_date FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }

      const responseData = {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          subscription_status: user.subscription_status
        }
      };

      // Add trial info if user is on trial
      if (user.subscription_status === 'trial' && user.trial_end_date) {
        const now = new Date();
        const trialEndDate = new Date(user.trial_end_date);
        const daysRemaining = Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        
        responseData.user.trial_info = {
          trial_end_date: trialEndDate.toISOString(),
          days_remaining: daysRemaining,
          is_expired: now > trialEndDate
        };
      }

      return res.status(200).json(responseData);
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
router.get('/dashboard/stats', requireAuth, checkTrialStatus, async (req, res, next) => {
  try {
    const userId = req.user.id;
    console.log('Dashboard stats request for user:', userId);
    
    // Get user's company ID
    const userCompany = await db.queryOne(
      'SELECT company_id FROM users WHERE id = $1',
      [userId]
    );
    const companyId = userCompany?.company_id;
    console.log('User company:', userCompany, 'Company ID:', companyId);

    // Get follow-up stats
    const followUpStats = await db.queryOne(`
      SELECT 
        COUNT(*) as total_followups,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_followups,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_followups,
        COUNT(CASE WHEN DATE(scheduled_at) = CURRENT_DATE THEN 1 END) as followups_today
      FROM follow_ups 
      WHERE company_id = $1
    `, [companyId]);
    console.log('Follow-up stats:', followUpStats);

    // Get outstanding amount from invoices - debug version
    const outstandingStats = await db.queryOne(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'outstanding' THEN amount ELSE 0 END), 0) as total_outstanding,
        COUNT(*) as total_invoices,
        COUNT(CASE WHEN is_excluded = true THEN 1 END) as excluded_invoices,
        STRING_AGG(DISTINCT status, ', ') as statuses_found
      FROM invoices 
      WHERE company_id = $1
    `, [companyId]);
    console.log('Outstanding stats (debug):', outstandingStats);
    
    // Also get sample invoice data
    const sampleInvoices = await db.query(`
      SELECT id, qbo_invoice_id, status, amount, is_excluded 
      FROM invoices 
      WHERE company_id = $1 
      LIMIT 5
    `, [companyId]);
    console.log('Sample invoices:', sampleInvoices.rows);

    // Calculate basic open rate (simplified) - using follow_up_type for email vs delivered status
    const emailStats = await db.queryOne(`
      SELECT 
        COUNT(CASE WHEN follow_up_type = 'email' AND status = 'delivered' THEN 1 END) as delivered_emails,
        COUNT(CASE WHEN follow_up_type = 'email' THEN 1 END) as total_emails
      FROM follow_ups 
      WHERE company_id = $1
    `, [companyId]);
    console.log('Email stats:', emailStats);

    const openRate = emailStats?.total_emails > 0 
      ? Math.round((emailStats.delivered_emails / emailStats.total_emails) * 100)
      : 0;

    const result = {
      totalOutstanding: { total: parseFloat(outstandingStats?.total_outstanding || 0) },
      followupsToday: { count: parseInt(followUpStats?.followups_today || 0) },
      openRate: { rate: openRate }
    };
    console.log('Sending dashboard stats result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    // Return defaults on error
    res.json({
      totalOutstanding: { total: 0 },
      followupsToday: { count: 0 },
      openRate: { rate: 0 }
    });
  }
});

router.get('/invoices', requireAuth, checkTrialStatus, async (req, res, next) => {
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
router.get('/settings', requireAuth, checkTrialStatus, async (req, res, next) => {
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

router.post('/settings', requireAuth, checkTrialStatus, async (req, res, next) => {
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

router.post('/follow-ups/debug', requireAuth, async (req, res, next) => {
  try {
    const { companyId } = req.body;
    const isAdmin = req.user.role === 'admin';
    
    // If admin and no specific company requested, show all companies
    const targetCompanyId = companyId || (isAdmin ? null : req.user.company_id);
    
    let allFollowUps, recentInvoices, company;
    
    if (targetCompanyId) {
      // Specific company requested
      allFollowUps = await db.query(`
        SELECT f.*, c.name as company_name FROM follow_ups f
        JOIN companies c ON c.id = f.company_id
        WHERE f.company_id = $1 
        ORDER BY f.created_at DESC
        LIMIT 15
      `, [targetCompanyId]);
      
      recentInvoices = await db.query(`
        SELECT * FROM invoices 
        WHERE company_id = $1 
        ORDER BY due_date DESC 
        LIMIT 5
      `, [targetCompanyId]);
      
      company = await db.queryOne(`
        SELECT id, name FROM companies WHERE id = $1
      `, [targetCompanyId]);
    } else {
      // Admin view - show all companies
      allFollowUps = await db.query(`
        SELECT f.*, c.name as company_name FROM follow_ups f
        JOIN companies c ON c.id = f.company_id
        ORDER BY f.created_at DESC
        LIMIT 25
      `);
      
      recentInvoices = await db.query(`
        SELECT i.*, c.name as company_name FROM invoices i
        JOIN companies c ON c.id = i.company_id
        ORDER BY i.due_date DESC 
        LIMIT 10
      `);
      
      company = { id: 'ALL', name: 'All Companies (Admin View)' };
    }
    
    const pendingFollowUps = allFollowUps.filter(f => f.status === 'pending');
    
    // Check admin stats to compare
    const adminStats = await db.query(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int as pending_total,
        COUNT(CASE WHEN status = 'sent' THEN 1 END)::int as sent_total,
        COUNT(CASE WHEN status = 'failed' THEN 1 END)::int as failed_total,
        COUNT(*)::int as total_followups
      FROM follow_ups
    `);
    
    // Check follow-up rules
    const { getFollowUpRules } = require('../../services/followUpService');
    const rules = await getFollowUpRules(targetCompanyId);
    
    // Get scheduler status
    const { getSchedulerStatus } = require('../../services/followUpScheduler');
    const schedulerStatus = getSchedulerStatus();
    
    res.json({
      success: true,
      debug: {
        user: { id: req.user.id, role: req.user.role, company_id: req.user.company_id },
        company: company,
        companyId: targetCompanyId,
        isAdminView: !targetCompanyId && isAdmin,
        allFollowUps: allFollowUps,
        pendingFollowUps: pendingFollowUps,
        pendingCount: pendingFollowUps.length,
        recentInvoices: recentInvoices,
        followUpRules: rules,
        activeRules: rules.filter(r => r.active),
        scheduler: schedulerStatus,
        globalStats: adminStats[0] || {},
        currentTime: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/follow-ups/force-send', requireAuth, async (req, res, next) => {
  try {
    const { followUpId, companyId } = req.body;
    const isAdmin = req.user.role === 'admin';
    
    if (followUpId) {
      // Force send a specific follow-up
      const followUp = await db.queryOne('SELECT * FROM follow_ups WHERE id = $1', [followUpId]);
      if (!followUp) {
        return res.status(404).json({ success: false, message: 'Follow-up not found' });
      }
      
      const { processFollowUp } = require('../../services/followUpProcessor');
      const result = await processFollowUp(followUp);
      
      return res.json({
        success: true,
        message: 'Follow-up processing attempted',
        result
      });
    }
    
    // Or update all pending follow-ups for a company to be due now
    if (companyId) {
      // Check if user can access this company
      if (!isAdmin && req.user.company_id !== companyId) {
        return res.status(403).json({ 
          success: false, 
          message: 'Not authorized to modify follow-ups for this company' 
        });
      }
      
      const updateResult = await db.query(
        'UPDATE follow_ups SET scheduled_at = NOW() WHERE company_id = $1 AND status = $2',
        [companyId, 'pending']
      );
      
      return res.json({
        success: true,
        message: `Updated all pending follow-ups for company ${companyId} to be due now`,
        updatedCount: updateResult.rowCount || 0
      });
    }
    
    res.status(400).json({ success: false, message: 'followUpId or companyId required' });
  } catch (error) {
    next(error);
  }
});

router.post('/follow-ups/admin-process', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    const { companyId, limit = 5 } = req.body;
    
    const { triggerManualProcessing } = require('../../services/followUpScheduler');
    const results = await triggerManualProcessing(false);
    
    res.json({
      success: true,
      message: 'Admin follow-up processing completed',
      results,
      companyRequested: companyId
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
    // Log detailed error information for debugging
    logger.error('Test email API endpoint failed', {
      error: error.message,
      stack: error.stack,
      errorCode: error.code,
      errorType: error.name,
      sendGridResponse: error.response?.body,
      sendGridStatus: error.response?.status,
      requestBody: req.body,
      userId: req.user?.id,
      userEmail: req.user?.email
    });

    // Return a more helpful error payload to assist troubleshooting in the UI
    const details = error?.response?.body || error?.body || undefined;
    const errorInfo = {
      success: false,
      message: 'Failed to send test email',
      error: error.message,
      errorCode: error.code,
      errorType: error.name || 'Error'
    };

    // Add SendGrid specific error details if available
    if (error.response?.body) {
      errorInfo.sendGridError = error.response.body;
      errorInfo.sendGridStatus = error.response.status;
    }

    // Add additional context for common issues
    if (error.message?.includes('API key')) {
      errorInfo.troubleshoot = 'Check SendGrid API key configuration';
    } else if (error.message?.includes('from email')) {
      errorInfo.troubleshoot = 'Check SendGrid sender email verification';
    } else if (error.message?.includes('Unauthorized')) {
      errorInfo.troubleshoot = 'SendGrid API key may be invalid or expired';
    }

    return res.status(500).json(errorInfo);
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
    // Guard: only allow in non-production or if explicitly enabled
    const isProduction = process.env.NODE_ENV === 'production';
    const allowSetup = process.env.ALLOW_SETUP_QBO_TABLE === 'true';
    if (isProduction && !allowSetup) {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is disabled in production. Set ALLOW_SETUP_QBO_TABLE=true to enable temporarily.'
      });
    }

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
        user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
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

/**
 * Admin User Creation Route (protected by environment variable)
 * Only works when ADMIN_SETUP_SECRET is set in environment
 */
router.post('/create-admin', async (req, res, next) => {
  try {
    const { email, password, name, company_name, admin_secret } = req.body;
    
    // Check if admin setup is enabled and secret matches
    const expectedSecret = process.env.ADMIN_SETUP_SECRET;
    if (!expectedSecret || admin_secret !== expectedSecret) {
      return res.status(403).json({
        success: false,
        message: 'Admin setup not available or invalid secret'
      });
    }

    // Validate inputs
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and name are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Check if user already exists
    const existingUser = await db.queryOne('SELECT email FROM users WHERE email = $1', [email]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Hash password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    const result = await db.transaction(async (client) => {
      // Create company
      const companyResult = await client.query(
        'INSERT INTO companies (name, created_at, is_beta) VALUES ($1, NOW(), true) RETURNING id',
        [company_name || 'CollectFlo Admin']
      );
      const companyId = companyResult.rows[0].id;

      // Create admin user with active subscription
      const trialStartDate = new Date();
      const trialEndDate = new Date(trialStartDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year
      
      const userResult = await client.query(
        `INSERT INTO users 
         (name, email, password, company_id, role, is_beta, subscription_status, trial_start_date, trial_end_date, subscription_start_date, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         RETURNING id, email, name, role, subscription_status`,
        [name, email, hashedPassword, companyId, 'admin', true, 'active', trialStartDate, trialEndDate, new Date()]
      );

      return {
        user: userResult.rows[0],
        companyId
      };
    });

    logger.info('Admin user created', {
      userId: result.user.id,
      email: result.user.email,
      companyId: result.companyId
    });

    return res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        subscription_status: result.user.subscription_status
      }
    });

  } catch (error) {
    logger.error('Error creating admin user', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Failed to create admin user'
    });
  }
});

/**
 * Promote User to Admin Route (protected by environment variable)
 * Only works when ADMIN_SETUP_SECRET is set in environment
 */
router.post('/promote-to-admin', async (req, res, next) => {
  try {
    const { email, admin_secret } = req.body;
    
    // Check if admin setup is enabled and secret matches
    const expectedSecret = process.env.ADMIN_SETUP_SECRET;
    if (!expectedSecret || admin_secret !== expectedSecret) {
      return res.status(403).json({
        success: false,
        message: 'Admin setup not available or invalid secret'
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find the user
    const user = await db.queryOne('SELECT id, name, email, role, subscription_status FROM users WHERE email = $1', [email]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please sign up first at /beta-signup'
      });
    }

    if (user.role === 'admin') {
      return res.status(200).json({
        success: true,
        message: 'User is already an admin',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
    }

    // Try to promote with trial fields, fall back to basic promotion
    try {
      await db.execute(
        `UPDATE users SET 
          role = $1, 
          subscription_status = $2,
          subscription_start_date = $3,
          trial_end_date = $4
         WHERE id = $5`,
        ['admin', 'active', new Date(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), user.id]
      );
      
      logger.info('User promoted to admin with full subscription', {
        userId: user.id,
        email: user.email
      });

    } catch (error) {
      // Fall back to basic promotion if trial fields don't exist
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        await db.execute('UPDATE users SET role = $1 WHERE id = $2', ['admin', user.id]);
        
        logger.info('User promoted to admin (basic mode)', {
          userId: user.id,
          email: user.email,
          note: 'Trial fields not available'
        });
      } else {
        throw error;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'User promoted to admin successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'admin'
      },
      access: {
        login: 'https://www.collectflo.com/login',
        admin: 'https://www.collectflo.com/admin',
        betaStats: 'https://www.collectflo.com/beta-stats.html'
      }
    });

  } catch (error) {
    logger.error('Error promoting user to admin', { error: error.message, email: req.body.email });
    return res.status(500).json({
      success: false,
      message: 'Failed to promote user to admin'
    });
  }
});

/**
 * Stripe Subscription Routes
 * Handle subscription checkout and webhook events
 */

// Create Stripe Checkout Session
router.post('/create-checkout-session', requireAuth, checkTrialStatus, async (req, res, next) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { plan } = req.body;
    
    if (!plan || !['monthly', 'annual'].includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected. Choose monthly or annual.'
      });
    }

    // Get user info
    const userId = req.user.id;
    const user = await db.queryOne(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Determine which price ID to use
    const priceId = plan === 'monthly' 
      ? process.env.STRIPE_STANDARD_PRICE_ID 
      : process.env.STRIPE_PREMIUM_PRICE_ID;

    if (!priceId) {
      logger.error('Missing Stripe price ID for plan', { plan });
      return res.status(500).json({
        success: false,
        message: 'Subscription configuration error. Please contact support.'
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer_email: user.email,
      client_reference_id: userId.toString(),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.protocol}://${req.get('host')}/dashboard?subscription=success`,
      cancel_url: `${req.protocol}://${req.get('host')}/subscription?cancelled=true`,
      metadata: {
        user_id: userId.toString(),
        plan: plan,
        user_email: user.email
      },
      subscription_data: {
        metadata: {
          user_id: userId.toString(),
          plan: plan
        }
      }
    });

    logger.info('Stripe checkout session created', {
      userId,
      sessionId: session.id,
      plan,
      priceId
    });

    return res.status(200).json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
    });

  } catch (error) {
    logger.error('Error creating Stripe checkout session', { 
      error: error.message,
      userId: req.user?.id 
    });
    return res.status(500).json({
      success: false,
      message: 'Unable to create checkout session. Please try again.'
    });
  }
});

/**
 * Admin Routes
 */
router.get('/admin/stats', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    // Basic aggregated stats
    const usersCount = await db.queryOne('SELECT COUNT(*)::int AS count FROM users');
    const companiesCount = await db.queryOne('SELECT COUNT(*)::int AS count FROM companies');

    const invoicesAgg = await db.queryOne(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN status = 'outstanding' THEN 1 END)::int AS outstanding,
        COALESCE(SUM(CASE WHEN status = 'outstanding' THEN amount ELSE 0 END), 0)::numeric AS total_outstanding
      FROM invoices
    `);

    const followUpsAgg = await db.queryOne(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END)::int AS delivered
      FROM follow_ups
    `);

    const recentUsers = await db.query(`
      SELECT id, email, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    // Page view analytics
    let pageViewStats = {
      totalPageViews: 0,
      todayViews: 0,
      pagesByEndpoint: [],
      pagesBySource: [],
      topPages: []
    };

    try {
      // Total page views
      const totalViews = await db.queryOne(`
        SELECT COUNT(*)::int AS count 
        FROM user_activity 
        WHERE activity_type = 'page_visit'
      `);

      // Today's page views
      const todayViews = await db.queryOne(`
        SELECT COUNT(*)::int AS count
        FROM user_activity
        WHERE activity_type = 'page_visit'
          AND DATE(created_at) = CURRENT_DATE
      `);

      // Page views by endpoint (path)
      const viewsByEndpoint = await db.query(`
        SELECT 
          details->>'path' as path,
          COUNT(*)::int as views,
          COUNT(DISTINCT user_id)::int as unique_users
        FROM user_activity 
        WHERE activity_type = 'page_visit' 
        AND details->>'path' IS NOT NULL
        GROUP BY details->>'path'
        ORDER BY views DESC
        LIMIT 10
      `);

      // Page views by referral source  
      const viewsBySource = await db.query(`
        SELECT 
          CASE 
            WHEN details->>'referrer' IS NULL OR details->>'referrer' = '' THEN 'Direct'
            WHEN details->>'referrer' LIKE '%google%' THEN 'Google'
            WHEN details->>'referrer' LIKE '%facebook%' THEN 'Facebook'
            WHEN details->>'referrer' LIKE '%twitter%' THEN 'Twitter'
            WHEN details->>'referrer' LIKE '%linkedin%' THEN 'LinkedIn'
            WHEN details->>'referrer' LIKE '%youtube%' THEN 'YouTube'
            WHEN details->>'referrer' LIKE '%reddit%' THEN 'Reddit'
            WHEN details->>'source' IS NOT NULL THEN details->>'source'
            ELSE 'Other'
          END as source,
          COUNT(*)::int as views,
          COUNT(DISTINCT user_id)::int as unique_users
        FROM user_activity 
        WHERE activity_type = 'page_visit'
        GROUP BY source
        ORDER BY views DESC
        LIMIT 10
      `);

      // Top pages with additional details
      const topPages = await db.query(`
        SELECT 
          details->>'path' as path,
          COUNT(*)::int as views,
          COUNT(DISTINCT user_id)::int as unique_users,
          COUNT(DISTINCT DATE(created_at))::int as active_days,
          MAX(created_at) as last_visit
        FROM user_activity 
        WHERE activity_type = 'page_visit' 
        AND details->>'path' IS NOT NULL
        GROUP BY details->>'path'
        ORDER BY views DESC
        LIMIT 15
      `);

      pageViewStats = {
        totalViews: totalViews?.count || 0,
        todayViews: todayViews?.count || 0,
        topPages: (topPages || []).map(p => ({
          page: p.path,
          views: p.views
        })),
        sources: (viewsBySource || []).map(s => ({
          source: s.source,
          visits: s.views
        })),
        performance: (topPages || []).map(p => ({
          page: p.path,
          unique_users: p.unique_users,
          active_days: p.active_days
        })),
        detailed: (topPages || []).map(p => ({
          page: p.path,
          total_views: p.views,
          unique_users: p.unique_users,
          active_days: p.active_days,
          last_visit: p.last_visit
        }))
      };

    } catch (error) {
      logger.warn('Could not fetch page view statistics', { error: error.message });
      // Continue with empty stats if user_activity table doesn't exist yet
    }

    return res.json({
      success: true,
      stats: {
        users: usersCount?.count || 0,
        companies: companiesCount?.count || 0,
        invoices: {
          total: invoicesAgg?.total || 0,
          outstanding: invoicesAgg?.outstanding || 0,
          totalOutstandingAmount: parseFloat(invoicesAgg?.total_outstanding || 0)
        },
        followUps: {
          total: followUpsAgg?.total || 0,
          pending: followUpsAgg?.pending || 0,
          delivered: followUpsAgg?.delivered || 0
        },
        pageViews: pageViewStats,
        recentUsers: recentUsers || []
      }
    });
  } catch (error) {
    next(error);
  }
});

// Centralized error handling for API routes
router.use(errorMiddleware);

module.exports = router;

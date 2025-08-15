/**
 * CollectFlo API Server
 * 
 * Main application entry point that sets up Express, middleware,
 * database connections, and API routes.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const multer = require('multer');
const { applySecurityMiddleware } = require('./backend/middleware/securityMiddleware');
const cookieParser = require('cookie-parser');   // <-- added
const { optionalAuth } = require('./backend/middleware/jwtAuthMiddleware'); // new import
const jwtService   = require('./backend/services/jwtService'); // JWT verification
const secrets      = require('./backend/config/secrets');

// ---------------------------------------------------------------------------
// QuickBooks controller (optional)
// ---------------------------------------------------------------------------
let qboController;
try {
  qboController = require('./backend/controllers/qboController'); // Loads only if deps/env are present
} catch (error) {
  console.warn(
    'QBO Controller not loaded – QuickBooks features disabled:',
    error.message
  );
}
// Application modules
const db = require('./backend/db/connection');
const apiRoutes = require('./backend/routes/api');
const logger = require('./backend/services/logger');
const jobQueue = require('./backend/services/jobQueue');

// Migration runner
const runMigrations = require('./backend/scripts/runMigrations');
// Tracking middleware
const { trackPageVisit } = require('./backend/middleware/trackingMiddleware');

// ---------------------------------------------------------------------------
// Redis / Job-Queue mode check
// ---------------------------------------------------------------------------
if (jobQueue.usingMockImplementation) {
  logger.warn(
    'Redis is not available – job queues running in in-memory fallback mode. ' +
    'Jobs will NOT persist across restarts.'
  );
}

// Environment variables
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const IS_RENDER = process.env.RENDER === 'true';
const SESSION_SECRET = process.env.SESSION_SECRET || 'collectflo-dev-secret';

// HTTP server instance for graceful shutdown
let server;

// Create Express app
const app = express();

// ---------------------------------------------------------------------------
// Security / Hardening middleware (helmet, xss-clean, rate-limit, etc.)
// ---------------------------------------------------------------------------
applySecurityMiddleware(app);

// CORS configuration
const PROD_DOMAIN_REGEX = /^https?:\/\/([a-z0-9-]+\.)*collectflo\.com$/i;
const allowedOrigins = Array.isArray(secrets.security?.corsAllowedOrigins)
  ? secrets.security.corsAllowedOrigins
  : [];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser or same-origin requests (no Origin header)
    if (!origin) return callback(null, true);

    const explicitlyAllowed = allowedOrigins.includes(origin);
    const prodAllowed = IS_PRODUCTION && PROD_DOMAIN_REGEX.test(origin);

    if (explicitlyAllowed || prodAllowed) return callback(null, true);

    return callback(new Error('CORS: Origin not allowed'), false);
  },
  credentials: true
}));

// Request logging
if (IS_PRODUCTION) {
  // Production: use Winston for structured logging
  app.use((req, res, next) => {
    const start = Date.now();
    
    // Log when the response finishes
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
      
      logger[logLevel](`HTTP ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`, {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('content-length'),
        requestId: req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
    });
    
    next();
  });
} else {
  // Development: use Morgan for console-friendly logs
  app.use(morgan('dev'));
}

// Special raw body handling for Stripe webhooks (must be before express.json())
app.use('/stripe-webhook', express.raw({ type: 'application/json' }));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Cookie parsing middleware (must run BEFORE session middleware so that
// signed cookies such as accessToken / refreshToken are available)
// ---------------------------------------------------------------------------
app.use(cookieParser(SESSION_SECRET));

// ---------------------------------------------------------------------------
// Session configuration  (simple, memory-based for maximum reliability)
// ---------------------------------------------------------------------------
// NOTE:
// We intentionally use express-session's in-memory store.  This eliminates all
// database-connection-related failures (e.g. SSL/TLS to PG) at the cost of
// clearing sessions on server restart—acceptable for reliability.

app.set('trust proxy', 1); // secure cookies behind Render proxy

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  // MemoryStore is automatically used when no `store` provided
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: parseInt(process.env.SESSION_TTL_MS || 86_400_000, 10) // 24 h default
  }
}));

// Optional: lightweight debug log when a new session is generated
app.use((req, res, next) => {
  if (!req.session.initialised) {
    logger.info('New session created', { sessionID: req.sessionID });
    req.session.initialised = true;
  }
  next();
});

// ---------------------------------------------------------------------------
// Page-visit tracking
// ---------------------------------------------------------------------------
// Must be registered BEFORE static file middleware so it only runs once per
// real page view and not for every asset request.
app.use(trackPageVisit);

// Configure file uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Root route handler - MOVED BEFORE static file middleware
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Block debug HTML pages in production
if (IS_PRODUCTION) {
  const blockedDebugPages = ['/auth-diagnostics.html', '/login-debug.html'];
  app.get(blockedDebugPages, (req, res) => {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  });
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// API routes

// ---------------------------------------------------------------------------
// Inject optionalAuth ONLY for the auth-debug endpoint so that downstream
// handler has access to req.user when available, without enforcing auth.
// Must be registered before the main /api router for correct order.
// ---------------------------------------------------------------------------
app.use('/api/auth-debug', optionalAuth);

app.use('/api', apiRoutes);

// ---------------------------------------------------------------------------
// Stripe Webhook Route (matches existing Stripe dashboard configuration)
// ---------------------------------------------------------------------------
app.post('/stripe-webhook', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const logger = require('./backend/services/logger');
    const db = require('./backend/db/connection');
    
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      logger.error('Stripe webhook signature verification failed', { error: err.message });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleSuccessfulPayment(event.data.object, db, logger);
        break;
        
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object, db, logger);
        break;
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, db, logger);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object, db, logger);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, db, logger);
        break;

      default:
        logger.debug('Unhandled Stripe webhook event type', { type: event.type });
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    const logger = require('./backend/services/logger');
    logger.error('Error processing Stripe webhook', { error: error.message });
    return res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

// Webhook helper functions
async function handleSuccessfulPayment(session, db, logger) {
  try {
    const userId = session.client_reference_id;
    const customerEmail = session.customer_email;
    
    if (!userId) {
      logger.error('No user ID in successful payment session', { sessionId: session.id });
      return;
    }

    await db.execute(
      'UPDATE users SET subscription_status = $1, subscription_start_date = $2 WHERE id = $3',
      ['active', new Date(), userId]
    );

    logger.info('User subscription activated', {
      userId,
      sessionId: session.id,
      customerEmail
    });

  } catch (error) {
    logger.error('Error handling successful payment', { error: error.message, sessionId: session.id });
  }
}

async function handleSubscriptionCreated(subscription, db, logger) {
  try {
    const userId = subscription.metadata.user_id;
    
    if (!userId) {
      logger.error('No user ID in subscription metadata', { subscriptionId: subscription.id });
      return;
    }

    await db.execute(
      'UPDATE users SET subscription_status = $1, stripe_subscription_id = $2 WHERE id = $3',
      ['active', subscription.id, userId]
    );

    logger.info('Subscription created and linked to user', {
      userId,
      subscriptionId: subscription.id
    });

  } catch (error) {
    logger.error('Error handling subscription created', { error: error.message, subscriptionId: subscription.id });
  }
}

async function handleSubscriptionUpdated(subscription, db, logger) {
  try {
    const userId = subscription.metadata.user_id;
    
    if (!userId) {
      logger.error('No user ID in subscription metadata', { subscriptionId: subscription.id });
      return;
    }

    let status = 'active';
    if (subscription.status === 'canceled') {
      status = 'cancelled';
    } else if (subscription.status === 'past_due') {
      status = 'past_due';
    }

    await db.execute(
      'UPDATE users SET subscription_status = $1 WHERE id = $2',
      [status, userId]
    );

    logger.info('Subscription status updated', {
      userId,
      subscriptionId: subscription.id,
      newStatus: status
    });

  } catch (error) {
    logger.error('Error handling subscription updated', { error: error.message, subscriptionId: subscription.id });
  }
}

async function handleSubscriptionCancelled(subscription, db, logger) {
  try {
    const userId = subscription.metadata.user_id;
    
    if (!userId) {
      logger.error('No user ID in subscription metadata', { subscriptionId: subscription.id });
      return;
    }

    await db.execute(
      'UPDATE users SET subscription_status = $1 WHERE id = $2',
      ['cancelled', userId]
    );

    logger.info('Subscription cancelled', {
      userId,
      subscriptionId: subscription.id
    });

  } catch (error) {
    logger.error('Error handling subscription cancelled', { error: error.message, subscriptionId: subscription.id });
  }
}

async function handlePaymentFailed(invoice, db, logger) {
  try {
    const subscriptionId = invoice.subscription;
    
    if (!subscriptionId) {
      logger.error('No subscription ID in failed payment invoice', { invoiceId: invoice.id });
      return;
    }

    const user = await db.queryOne(
      'SELECT id FROM users WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );

    if (!user) {
      logger.error('No user found for failed payment', { subscriptionId });
      return;
    }

    await db.execute(
      'UPDATE users SET subscription_status = $1 WHERE id = $2',
      ['past_due', user.id]
    );

    logger.info('Payment failed, user marked as past due', {
      userId: user.id,
      subscriptionId,
      invoiceId: invoice.id
    });

  } catch (error) {
    logger.error('Error handling payment failed', { error: error.message, invoiceId: invoice.id });
  }
}

// ---------------------------------------------------------------------------
// QuickBooks OAuth routes – register only when controller is available
// ---------------------------------------------------------------------------
if (qboController) {
  // optionalAuth lets both logged-in & not-yet-logged-in users connect QBO
  app.get(
    '/auth/qbo',
    optionalAuth,
    (req, res, next) => qboController.initiateOAuth(req, res, next)
  );

  app.get(
    '/auth/qbo/callback',
    optionalAuth,
    (req, res, next) => qboController.handleOAuthCallback(req, res, next)
  );
} else {
  // Fallback route that makes it obvious QBO is disabled
  app.get('/auth/qbo', (_, res) => {
    res
      .status(503)
      .send('QuickBooks integration is currently unavailable on this deployment.');
  });
}

// ---------------------------------------------------------------------------
// TEMPORARY: redirect legacy /callback → /auth/qbo/callback
// ---------------------------------------------------------------------------
// Some QuickBooks app configurations pointed to `/callback` instead of the
// correct `/auth/qbo/callback`.  This route preserves all query parameters
// and forwards the request to the expected handler.
app.get('/callback', (req, res) => {
  const queryString = req.url.split('?')[1] || '';
  return res.redirect(`/auth/qbo/callback${queryString ? `?${queryString}` : ''}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Serve HTML pages for various routes
const htmlRoutes = [
  { path: '/login', file: 'login.html' },
  { path: '/signup', file: 'signup.html' },
  { path: '/dashboard', file: 'dashboard.html', auth: true },
  { path: '/settings', file: 'settings.html', auth: true },
  { path: '/templates', file: 'templates.html', auth: true },
  { path: '/onboarding', file: 'onboarding.html', auth: true },
  { path: '/beta', file: 'beta.html' },
  { path: '/beta-signup', file: 'beta-signup.html' },
  { path: '/beta-onboarding', file: 'beta-onboarding.html', auth: true },
  { path: '/beta-stats', file: 'beta-stats.html', auth: true },
  { path: '/pay/:invoiceId', file: 'pay.html' },
  { path: '/payment-success', file: 'payment-success.html' },
  { path: '/privacy', file: 'privacy.html' },
  { path: '/eula', file: 'eula.html' },
  { path: '/help', file: 'help.html' }
];

// Register HTML routes
htmlRoutes.forEach(route => {
  app.get(route.path, (req, res) => {
    // Check if route requires authentication
    if (route.auth) {
      const token = req.cookies && req.cookies.accessToken;

      // No token at all → redirect to login
      if (!token) {
        return res.redirect('/login?redirect=' + encodeURIComponent(req.path));
      }

      // Verify token; clear cookies & redirect on failure
      try {
        jwtService.verifyToken(token, 'access');
      } catch (err) {
        // Invalid / expired token – clean up and force re-login
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });
        return res.redirect('/login?redirect=' + encodeURIComponent(req.path));
      }
    }
    
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

// Catch-all route for 404s
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error in API route: ' + req.method + ' ' + req.url, {
    method: req.method,
    url: req.url,
    error: err.message,
    stack: err.stack
  });
  
  res.status(err.status || 500).json({
    error: IS_PRODUCTION ? 'An unexpected error occurred' : err.message
  });
});

// Application startup
async function startServer() {
  try {
    // Run database migrations
    await runMigrations();
    
    // Start the server and keep a reference for graceful shutdown
    server = app.listen(PORT, () => {
      logger.info(`CollectFlo server listening on port ${PORT} in ${NODE_ENV} mode`);
    });

    // Initialize scheduled jobs only after successful start
    try {
      const { startScheduler } = require('./services/followUpScheduler');
      // Run follow-up processing every 5 minutes (24/7)
      startScheduler({ followUpProcessing: '*/5 * * * *' });
      logger.info('Follow-up scheduler initialised successfully');
    } catch (schedErr) {
      logger.error('Follow-up scheduler failed to initialise', { error: schedErr });
      // Do NOT crash the whole app – core API can still function without scheduler
    }
  } catch (error) {
    logger.error('Failed to start application due to startup error', { error });
    process.exit(1); // Exit with failure so Render restarts / reports the issue
  }
}

// Start the application
startServer();

// Handle graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('Received shutdown signal, closing connections...');
  
  // Close the HTTP server first to stop accepting new requests
  if (server) {
    server.close();
  }
  
  try {
    // Shutdown job queues
    try {
      await jobQueue.shutdown();
    } catch (jqErr) {
      logger.error('Error shutting down job queues', { error: jqErr });
    }

    // Close database connections
    try {
      await db.close();
    } catch (dbErr) {
      logger.error('Error closing database connections', { error: dbErr });
    }
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error });
    process.exit(1);
  }
}

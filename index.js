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
const PgSession = require('connect-pg-simple')(session);
const { applySecurityMiddleware } = require('./backend/middleware/securityMiddleware');

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
app.use(cors({
  origin: IS_PRODUCTION ? 
    ['https://collectflo.com', /\.collectflo\.com$/] : 
    'http://localhost:3000',
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

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

let sessionStore; // PgSession or MemoryStore fallback

try {
  logger.info('Initializing PostgreSQL session store…');

  if (IS_PRODUCTION) {
    // Production / Render – explicit Pool with relaxed-cert SSL
    const { Pool } = require('pg');
    const pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    // quick connectivity probe (non-blocking)
    pgPool.query('SELECT 1', (err) => {
      if (err) {
        logger.error('PostgreSQL connectivity check failed', { error: err.message });
      } else {
        logger.info('PostgreSQL connectivity verified');
      }
    });

    sessionStore = new PgSession({
      pool: pgPool,
      createTableIfMissing: true
    });
  } else {
    // Development – simple connection string, no SSL
    sessionStore = new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true
    });
  }

  sessionStore.on('error', (err) => {
    logger.error('Session store error', { error: err.message });
  });
} catch (err) {
  // Fallback: in-memory store to keep app alive
  logger.error('PostgreSQL session store init failed – falling back to MemoryStore', {
    error: err.message,
    stack: err.stack
  });
  const MemoryStore = require('memorystore')(session);
  sessionStore = new MemoryStore({ checkPeriod: 86_400_000 }); // prune daily
  logger.warn('USING IN-MEMORY SESSION STORE – sessions lost on restart');
}

// Ensure secure cookies behind Render’s proxy
app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: parseInt(process.env.SESSION_TTL_MS || 86_400_000, 10) // 24 h default
  }
});

// Apply middleware with asset-skip + graceful error handling
app.use((req, res, next) => {
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|woff|ttf|eot)$/i)) {
    return next();
  }
  sessionMiddleware(req, res, (err) => {
    if (err) {
      logger.error('Session middleware error – continuing without session', {
        path: req.path,
        method: req.method,
        error: err.message
      });
      return next();
    }
    next();
  });
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

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// QuickBooks OAuth routes
app.get('/auth/qbo', (req, res) => {
  // This will be implemented in a separate controller
  res.status(501).send('QuickBooks OAuth flow not implemented yet');
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
    if (route.auth && !req.session.user) {
      return res.redirect('/login?redirect=' + encodeURIComponent(req.path));
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
      require('./services/scheduler');
      logger.info('Scheduler initialised successfully');
    } catch (schedErr) {
      logger.error('Scheduler failed to initialise', { error: schedErr });
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

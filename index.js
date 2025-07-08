/**
 * CollectFlo - Main Application Entry Point
 * 
 * This is the main entry point for the CollectFlo application.
 * It sets up the Express server, middleware, routes, and error handling.
 */

// Core dependencies
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const multer = require('multer');
require('dotenv').config();

// Database
const db = require('./backend/db/connection');

// Middleware
const { attachUser, requireAuth } = require('./backend/middleware/authMiddleware');
const errorMiddleware = require('./backend/middleware/errorMiddleware');

// Routes
const apiRoutes = require('./backend/routes/api');

// Services
const logger = require('./backend/services/logger');
const jobQueue = require('./backend/services/jobQueue');
// const errorHandler = require('./services/errorHandler'); // This is now replaced by errorMiddleware
// Migration runner
const runMigrations = require('./backend/scripts/runMigrations');

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
const SESSION_SECRET = process.env.SESSION_SECRET || 'collectflo-dev-secret';
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || (24 * 60 * 60 * 1000), 10); // 24 hours in ms

// Initialize Express app
const app = express();

// Configure session storage
// In production, you would use a more robust session store like Redis or PostgreSQL
// For simplicity, we're using the default MemoryStore here
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true,
    maxAge: SESSION_MAX_AGE
  }
}));

// Request logging middleware
app.use(logger.requestLogger);

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attach user to res.locals if authenticated
app.use(attachUser);

// Configure file uploads
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
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

app.get('/auth/qbo/callback', (req, res) => {
  // This will be implemented in a separate controller
  res.status(501).send('QuickBooks OAuth callback not implemented yet');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
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
  const handlers = [];
  
  // Add authentication middleware if required
  if (route.auth) {
    handlers.push(requireAuth);
  }
  
  // Add the route handler
  handlers.push((req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
  
  // Register the route
  app.get(route.path, ...handlers);
});

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error logging middleware
app.use(logger.errorLogger);

// Error handling middleware
app.use((err, req, res, next) => {
  // Use the existing error handler service
  errorMiddleware(err, req, res, next);
});

// -----------------------------------------------------------------------------
// Bootstrap sequence: run DB migrations, then start server & scheduler
// -----------------------------------------------------------------------------
let server; // will hold HTTP server instance for graceful shutdown

async function bootstrap() {
  try {
    // Run pending migrations before the app starts accepting traffic
    await runMigrations();

    // Start the HTTP server
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

// Kick off the bootstrap process
bootstrap();

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/**
 * Perform a graceful shutdown of the server and resources
 */
async function gracefulShutdown() {
  logger.info('Received shutdown signal, closing server...');
  
  // Close the HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
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
    logger.error('Error during graceful shutdown:', { error });
    process.exit(1);
  }
}

module.exports = app;

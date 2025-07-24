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
const qboController = require('./backend/controllers/qboController'); // QuickBooks OAuth controller

// Application modules
const db = require('./backend/db/connection');
const apiRoutes = require('./backend/routes/api');
const logger = require('./backend/services/logger');
const jobQueue = require('./backend/services/jobQueue');

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 3000;

// Set up session store with PostgreSQL
const pgSession = require('connect-pg-simple')(session);
const sessionConfig = {
  store: new pgSession({
    pool: db.pool,                // Connection pool
    tableName: 'session',         // Use a custom table to store sessions
    createTableIfMissing: true,   // Auto-create the sessions table if missing
  }),
  secret: process.env.SESSION_SECRET || 'collectflo-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours
    sameSite: 'lax'
  }
};

if (process.env.NODE_ENV === 'production' && sessionConfig.cookie.secure === true) {
  app.set('trust proxy', 1); // Trust first proxy
  logger.info('Session cookies set to secure in production mode');
} else {
  logger.warn('Session cookies not set to secure mode - only use in development');
}

// Set up middleware
app.use(session(sessionConfig));
app.use(cookieParser()); // Parse cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://collectflo.com', 'https://www.collectflo.com'] 
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));

// Apply security middleware (rate limiting, CSRF protection, etc.)
applySecurityMiddleware(app);

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Configure file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Authentication check middleware for protected routes
app.use((req, res, next) => {
  // Skip auth check for public routes
  const publicPaths = [
    '/', '/index.html', '/login.html', '/signup.html', '/beta.html', 
    '/beta-signup.html', '/api/login', '/api/signup', '/api/auth/login', 
    '/api/auth/signup', '/api/beta-signup', '/api/check-auth', 
    '/api/auth/check', '/api/auth/refresh', '/api/auth-debug',
    '/health', '/favicon.ico', '/robots.txt', '/sitemap.xml',
    '/css', '/js', '/images', '/auth-test.html', '/auth-diagnostics.html',
    '/login-debug.html', '/beta-stats.html'
  ];

  // Check if the path starts with any of the public paths
  const isPublicPath = publicPaths.some(publicPath => {
    return req.path === publicPath || 
           req.path.startsWith(`${publicPath}/`) ||
           (publicPath.endsWith('.html') && req.path === publicPath.replace('.html', ''));
  });

  // Also allow API routes to handle their own auth
  const isApiPath = req.path.startsWith('/api/');

  if (isPublicPath || isApiPath) {
    return next();
  }

  // For protected routes, check JWT token
  const token = req.cookies.accessToken || 
                (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    logger.debug(`Auth redirect: ${req.path} (no token)`);
    return res.redirect('/login.html?redirect=' + encodeURIComponent(req.path));
  }

  try {
    // Verify token (will throw if invalid)
    const decoded = jwtService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    logger.debug(`Auth redirect: ${req.path} (${err.message})`);
    res.redirect('/login.html?redirect=' + encodeURIComponent(req.path));
  }
});

// API Routes
app.use('/api', apiRoutes);

// ---------------------------------------------------------------------------
// QuickBooks OAuth routes
// ---------------------------------------------------------------------------
// optionalAuth allows both authenticated and unauthenticated users to
// connect their QuickBooks account.  When logged-in, the userId is stored
// with the tokens; otherwise the flow can still proceed for signup.
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Handle 404s
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  if (req.accepts('json')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  res.status(404).type('txt').send('Not found');
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  
  // Log the error
  logger.error(`Error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    statusCode
  });
  
  // Send appropriate response based on request type
  if (req.accepts('html')) {
    res.status(statusCode).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>Error</h1>
          <p>${process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message}</p>
          ${process.env.NODE_ENV === 'production' ? '' : `<pre>${err.stack}</pre>`}
          <p><a href="/">Return to home page</a></p>
        </body>
      </html>
    `);
  } else {
    res.status(statusCode).json({
      error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    });
  }
});

// Start the server
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  try {
    // Initialize job queue
    await jobQueue.init();
    logger.info('Job queue initialized successfully');
    
    // Run database migrations if needed
    if (process.env.AUTO_RUN_MIGRATIONS === 'true') {
      const { runMigrations } = require('./backend/scripts/runMigrations');
      await runMigrations();
      logger.info('Database migrations completed successfully');
    }
  } catch (error) {
    logger.error('Error during server initialization:', error);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  // Close database connections, job queues, etc.
  process.exit(0);
});

module.exports = app; // Export for testing

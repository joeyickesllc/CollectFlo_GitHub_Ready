/**
 * Security Middleware
 * 
 * Provides comprehensive security features for the CollectFlo application:
 * - Input validation and sanitization
 * - XSS protection
 * - Rate limiting
 * - Secure HTTP headers
 * 
 * These middlewares are designed to work in all environments and are
 * especially important for production deployments on Render.
 */

const { body, validationResult, oneOf } = require('express-validator');
const rateLimit = require('express-rate-limit');
const xssClean = require('xss-clean');
const helmet = require('helmet');
const logger = require('../services/logger');

// Environment configuration
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_RENDER = process.env.RENDER === 'true';

/**
 * Apply basic security middleware to Express app
 * 
 * @param {Object} app - Express app instance
 */
exports.applySecurityMiddleware = (app) => {
  /**
   * -------------------------------------------------------------------------
   * Content-Security-Policy (CSP)
   * -------------------------------------------------------------------------
   * The beta marketing pages (beta.html, beta-signup.html, etc.) currently rely
   * on small inline scripts and styles (e.g. Tailwind utility classes injected
   * by the CDN).  Helmet’s default CSP blocks these which breaks critical UI
   * elements such as the “Free Lifetime Access” button.
   *
   * For now we relax the CSP by:
   *   • explicitly allowing 'unsafe-inline' for script and style sources
   *   • allowing the jsDelivr CDN which hosts Tailwind
   *
   * NOTE:  This still blocks all remote code execution except from self or the
   *        approved CDN and can be tightened later once inline scripts are
   *        removed/refactored.
   */
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'self'"]
  };

  // Set secure HTTP headers with the adjusted CSP
  app.use(
    helmet({
      contentSecurityPolicy: IS_PRODUCTION ? { directives: cspDirectives } : false,
      crossOriginEmbedderPolicy: false, // Allow embedding in iframes
      crossOriginResourcePolicy: { policy: 'cross-origin' } // Allow cross-origin resource sharing
    })
  );

  /*
   * ---------------------------------------------------------------------------
   * X-XSS Protection
   * ---------------------------------------------------------------------------
   * `xss-clean@0.1.4` mutates `req.query` which became read-only in Express 5.
   * This results in the runtime error:
   *     "TypeError: Cannot set property query of #<IncomingMessage>..."
   *
   * Until a compatible version (or alternative middleware) is available we
   * temporarily disable xss-clean to keep the application functional.  Basic
   * protection is still provided by Helmet’s built-in X-XSS-Protection header.
   */
  logger.warn('xss-clean middleware disabled – incompatible with Express 5.x');

  // Apply global rate limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per window
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
      message: { success: false, message: 'Too many requests, please try again later.' },
      skip: (req) => req.path === '/health', // Don't rate limit health checks
      handler: (req, res, next, options) => {
        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          method: req.method
        });
        res.status(429).json(options.message);
      }
    })
  );

  logger.info('Security middleware applied', {
    helmet: true,
    xssProtection: false, // Temporarily disabled (see note above)
    rateLimit: true
  });
};

/**
 * More aggressive rate limiting for authentication routes
 * to prevent brute force attacks
 */
exports.authRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  handler: (req, res, next, options) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(429).json(options.message);
  }
});

/**
 * Rate limiting for signup routes
 */
exports.signupRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // 5 accounts per day
  message: { success: false, message: 'Account creation limit reached, please try again later.' },
  standardHeaders: true,
  handler: (req, res, next, options) => {
    logger.warn('Signup rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(429).json(options.message);
  }
});

/**
 * API rate limiting for specific endpoints
 */
exports.apiRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  message: { success: false, message: 'API rate limit exceeded, please try again later.' },
  standardHeaders: true
});

/**
 * Validation rules for user registration
 */
exports.validateSignup = [
  body('email')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail()
    .trim(),
  
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/[a-zA-Z]/).withMessage('Password must contain at least one letter')
    .matches(/\d/).withMessage('Password must contain at least one number')
    .trim(),
  
  body(['name', 'fullName', 'companyName'])
    .if(body('name').exists())
    .trim()
    .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
    .escape(),
  
  /*
   * Company name validation:
   * Accepts either `companyName` (camelCase) or `company_name` (snake_case).
   * The rule passes when at least one of the fields exists and meets length
   * requirements. Using oneOf() avoids the invalid `.or()` chain that caused
   * the TypeError.
   */
  oneOf([
    body('companyName')
      .exists().withMessage('Company name is required')
      .bail()
      .isLength({ min: 2 }).withMessage('Company name must be at least 2 characters long')
      .trim()
      .escape(),
    body('company_name')
      .exists().withMessage('Company name is required')
      .bail()
      .isLength({ min: 2 }).withMessage('Company name must be at least 2 characters long')
      .trim()
      .escape()
  ]),
  
  // Validation middleware handler
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    // Standardize field names for the API
    if (req.body.companyName && !req.body.company_name) {
      req.body.company_name = req.body.companyName;
    }
    
    if (req.body.fullName && !req.body.name) {
      req.body.name = req.body.fullName;
    }
    
    next();
  }
];

/**
 * Validation rules for login
 */
exports.validateLogin = [
  body('email')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail()
    .trim(),
  
  body('password')
    .not().isEmpty().withMessage('Password is required')
    .trim(),
  
  // Validation middleware handler
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    next();
  }
];

/**
 * Sanitize all request parameters to prevent injection attacks
 */
exports.sanitizeParams = (req, res, next) => {
  if (req.params) {
    Object.keys(req.params).forEach(key => {
      if (typeof req.params[key] === 'string') {
        req.params[key] = req.params[key].replace(/[<>]/g, '');
      }
    });
  }
  next();
};

/**
 * Log all requests for security monitoring
 */
exports.securityLogger = (req, res, next) => {
  // Only log certain paths that might be security-sensitive
  if (
    req.path.includes('/login') ||
    req.path.includes('/signup') ||
    req.path.includes('/auth') ||
    req.path.includes('/settings')
  ) {
    logger.info('Security-sensitive request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  }
  next();
};

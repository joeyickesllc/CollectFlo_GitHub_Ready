/**
 * Tracking Middleware
 * 
 * Middleware for tracking user activity and page visits.
 * This data is used to populate the beta statistics dashboard.
 */

const db = require('../db/connection');
const logger = require('../services/logger');

/**
 * Track page visit
 * Records when users visit pages, including referrer source and user info
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const trackPageVisit = (req, res, next) => {
  // Skip tracking for API requests, static files, and health checks
  if (
    req.path.startsWith('/api') || 
    req.path.includes('.') ||
    req.path === '/health' ||
    req.method !== 'GET'
  ) {
    return next();
  }

  // Capture the request asynchronously to avoid blocking
  setTimeout(async () => {
    try {
      // Extract user information if available
      const userId = req.session?.user?.id;
      
      // Extract request information
      const url = req.originalUrl || req.url;
      const referrer = req.headers.referer || req.headers.referrer || 'direct';
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip || req.connection.remoteAddress;
      
      // Determine the source from referrer
      let source = 'Direct';
      if (referrer) {
        if (referrer.includes('google')) source = 'Google';
        else if (referrer.includes('bing')) source = 'Bing';
        else if (referrer.includes('yahoo')) source = 'Yahoo';
        else if (referrer.includes('twitter') || referrer.includes('t.co')) source = 'Twitter';
        else if (referrer.includes('facebook') || referrer.includes('fb.com')) source = 'Facebook';
        else if (referrer.includes('linkedin')) source = 'LinkedIn';
        else if (referrer.includes('producthunt')) source = 'Product Hunt';
        else if (referrer.includes(req.hostname)) source = 'Internal';
        else source = 'Other';
      }

      // Store visit in database
      await db.query(
        `INSERT INTO user_activity 
         (user_id, activity_type, details, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [
          userId || null,
          'page_visit',
          {
            url,
            referrer,
            source,
            userAgent,
            ipAddress,
            timestamp: new Date().toISOString()
          }
        ]
      );

      logger.debug('Page visit tracked', { 
        url, 
        source, 
        userId: userId || 'anonymous' 
      });
    } catch (error) {
      // Don't let tracking errors affect the user experience
      logger.error('Error tracking page visit', { error });
    }
  }, 0);

  // Continue with the request immediately
  next();
};

/**
 * Track specific user action
 * Records when users perform specific actions like clicking buttons or submitting forms
 * 
 * @param {String} actionType - Type of action being tracked
 * @param {Object} details - Additional details about the action
 * @returns {Function} Express middleware
 */
const trackUserAction = (actionType, details = {}) => {
  return async (req, res, next) => {
    // Extract user information if available
    const userId = req.session?.user?.id;
    
    try {
      if (!actionType) {
        throw new Error('Action type is required for tracking');
      }

      // Combine passed details with request info
      const actionDetails = {
        ...details,
        url: req.originalUrl || req.url,
        timestamp: new Date().toISOString(),
        ipAddress: req.ip || req.connection.remoteAddress
      };

      // If there's form data, include it (but sanitize sensitive fields)
      if (req.body) {
        const sanitizedBody = { ...req.body };
        // Remove sensitive fields
        delete sanitizedBody.password;
        delete sanitizedBody.token;
        delete sanitizedBody.creditCard;
        
        actionDetails.formData = sanitizedBody;
      }

      // Store action in database
      await db.query(
        `INSERT INTO user_activity 
         (user_id, activity_type, details, created_at) 
         VALUES ($1, $2, $3, NOW())`,
        [
          userId || null,
          actionType,
          actionDetails
        ]
      );

      logger.debug(`User action tracked: ${actionType}`, { 
        actionType, 
        userId: userId || 'anonymous' 
      });
    } catch (error) {
      // Don't let tracking errors affect the user experience
      logger.error(`Error tracking user action: ${actionType}`, { error });
    }

    // Continue with the request
    next();
  };
};

/**
 * Track beta signup
 * Specialized middleware for tracking beta signups
 */
const trackBetaSignup = trackUserAction('beta_signup', { 
  program: 'beta',
  conversionPoint: true
});

/**
 * Track login
 * Specialized middleware for tracking user logins
 */
const trackLogin = trackUserAction('user_login');

module.exports = {
  trackPageVisit,
  trackUserAction,
  trackBetaSignup,
  trackLogin
};

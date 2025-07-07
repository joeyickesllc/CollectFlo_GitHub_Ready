/**
 * Authentication Middleware
 * 
 * Provides middleware functions to protect routes that require authentication
 * and implement role-based access control.
 */

/**
 * Require Authentication
 * 
 * Middleware that checks if a user is authenticated before allowing access to a route.
 * If not authenticated, returns a 401 Unauthorized response.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.requireAuth = (req, res, next) => {
  // Check if user exists in session
  if (req.session && req.session.user) {
    // User is authenticated, proceed to next middleware or route handler
    return next();
  }

  // User is not authenticated
  return res.status(401).json({
    success: false,
    message: 'Authentication required'
  });
};

/**
 * Require Role
 * 
 * Middleware that checks if an authenticated user has a specific role.
 * Requires the requireAuth middleware to be used first.
 * 
 * @param {String|Array} roles - Role or array of roles that are allowed access
 * @returns {Function} Middleware function
 */
exports.requireRole = (roles) => {
  // Convert single role to array for consistent handling
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req, res, next) => {
    // This middleware should be used after requireAuth, so user should exist
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user's role is in the allowed roles
    if (allowedRoles.includes(req.session.user.role)) {
      return next();
    }

    // User doesn't have the required role
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions'
    });
  };
};

/**
 * API Authentication
 * 
 * Middleware for API routes that should return JSON responses for auth failures
 * instead of redirecting. This is the same as requireAuth but with a different
 * response format.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.apiAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Authentication required',
    code: 'AUTH_REQUIRED'
  });
};

/**
 * Attach User
 * 
 * Middleware that attaches the user object to res.locals if authenticated.
 * Does not block unauthenticated requests, just makes user data available.
 * Useful for routes that work differently for authenticated and unauthenticated users.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.attachUser = (req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    res.locals.isAuthenticated = true;
  } else {
    res.locals.isAuthenticated = false;
  }
  
  next();
};

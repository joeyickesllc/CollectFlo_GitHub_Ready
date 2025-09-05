/**
 * Error Handling Middleware
 * 
 * This middleware captures detailed information about errors, including
 * route context, timestamps, and request details. It should be used
 * as the last middleware in the Express application to catch all errors.
 */

const logger = require('../services/logger');

/**
 * Centralized error handling middleware for API endpoints.
 * 
 * @param {Error} err - The error object.
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
module.exports = (err, req, res) => {
  // Log the error using the centralized logger
  logger.error(`Unhandled error in API route: ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId, // Assuming requestId is attached by a preceding middleware
    error: err,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.session?.user?.id, // Log user ID if available
    stack: err.stack // Include stack trace for debugging
  });

  // Determine status code (default to 500 if not set)
  const statusCode = err.statusCode || 500;

  // Prepare error response
  const errorResponse = {
    success: false,
    message: 'An unexpected error occurred. Please try again later.',
    timestamp: new Date().toISOString(),
  };

  // In development, send more detailed error information
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error = err.message;
    errorResponse.stack = err.stack;
    if (err.code) {
      errorResponse.code = err.code;
    }
  }

  // Send the error response
  res.status(statusCode).json(errorResponse);
};
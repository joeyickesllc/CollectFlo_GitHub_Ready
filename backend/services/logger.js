/**
 * Logger Service
 * 
 * A structured logging service using Winston with different transports
 * for development and production environments.
 * 
 * Usage:
 * const logger = require('./services/logger');
 * 
 * logger.info('User logged in', { userId: 123 });
 * logger.error('Database connection failed', { error: err });
 */

const winston = require('winston');
const { format, transports, createLogger } = winston;
const path = require('path');
require('dotenv').config();

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const MAX_LOG_SIZE = process.env.MAX_LOG_SIZE || '10m';
const MAX_LOG_FILES = parseInt(process.env.MAX_LOG_FILES || '5', 10);

// Custom format for development logs (colorized and readable)
const developmentFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.colorize(),
  format.printf(({ level, message, timestamp, ...metadata }) => {
    let metaStr = '';
    
    if (Object.keys(metadata).length > 0) {
      if (metadata.error && metadata.error instanceof Error) {
        // Format Error objects specially
        const errorMeta = {
          ...metadata,
          error: {
            message: metadata.error.message,
            stack: metadata.error.stack,
            ...(metadata.error.code && { code: metadata.error.code }),
          }
        };
        metaStr = JSON.stringify(errorMeta, null, 2);
      } else {
        metaStr = JSON.stringify(metadata, null, 2);
      }
    }
    
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Custom format for production logs (JSON for better parsing)
const productionFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

// Create transport array based on environment
const logTransports = [];

// Console transport (always included)
logTransports.push(
  new transports.Console({
    level: LOG_LEVEL,
    format: NODE_ENV === 'production' ? productionFormat : developmentFormat
  })
);

// File transports (production only)
if (NODE_ENV === 'production') {
  // Ensure log directory exists
  const fs = require('fs');
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  
  // Combined log file (all levels)
  logTransports.push(
    new transports.File({
      filename: path.join(LOG_DIR, 'collectflo.log'),
      level: LOG_LEVEL,
      format: productionFormat,
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      tailable: true
    })
  );
  
  // Error log file (error level only)
  logTransports.push(
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: productionFormat,
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      tailable: true
    })
  );
}

// Create the logger
const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true })
  ),
  defaultMeta: { service: 'collectflo-api' },
  transports: logTransports,
  exitOnError: false // Don't exit on handled exceptions
});

/**
 * Express middleware to log HTTP requests
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
logger.requestLogger = (req, res, next) => {
  // Get or generate request ID
  const requestId = req.headers['x-request-id'] || 
                   req.headers['x-correlation-id'] || 
                   `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  
  // Add request ID to request object for later use
  req.requestId = requestId;
  
  // Capture start time
  const start = Date.now();
  
  // Log request
  logger.info(`HTTP ${req.method} ${req.originalUrl}`, {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel](`HTTP ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`, {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('content-length')
    });
  });
  
  next();
};

/**
 * Add request context to logger
 * 
 * @param {Object} req - Express request object
 * @returns {Object} Logger with request context
 */
logger.withRequest = (req) => {
  return {
    error: (message, meta = {}) => logger.error(message, { requestId: req.requestId, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { requestId: req.requestId, ...meta }),
    info: (message, meta = {}) => logger.info(message, { requestId: req.requestId, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { requestId: req.requestId, ...meta }),
    verbose: (message, meta = {}) => logger.verbose(message, { requestId: req.requestId, ...meta })
  };
};

/**
 * Express error logging middleware
 * 
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
logger.errorLogger = (err, req, res, next) => {
  logger.error(`Error in ${req.method} ${req.originalUrl}`, {
    requestId: req.requestId,
    error: err,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.session?.user?.id
  });
  
  next(err);
};

// Add stream for Morgan integration (if used)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = logger;

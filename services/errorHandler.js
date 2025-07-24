
const db = require('../database.js');

function errorHandler(err, req, res, next) {
  // Log error to database
  db.prepare(`
    INSERT INTO error_logs (error_message, error_stack, context, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    err.message,
    err.stack,
    JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body
    })
  );

  // Send appropriate response
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred'
      : err.message
  });
}

module.exports = errorHandler;

const db = require('../backend/db/connection');

async function errorHandler(err, req, res) {
  try {
    await db.execute(
      `INSERT INTO error_logs (level, message, stack, meta, timestamp)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        'error',
        err.message,
        err.stack,
        {
          url: req.url,
          method: req.method,
          headers: { ...req.headers, cookie: undefined, authorization: undefined },
          body: req.body
        }
      ]
    );
  } catch (logErr) {
    // eslint-disable-next-line no-console
    console.error('Failed to log error to database:', logErr.message);
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred'
      : err.message
  });
}

module.exports = errorHandler;

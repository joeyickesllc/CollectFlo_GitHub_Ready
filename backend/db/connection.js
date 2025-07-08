/**
 * Database Connection Module
 * 
 * Provides a unified interface for PostgreSQL database connections.
 * Simplified to work reliably in all environments, especially Render.
 * 
 * Usage:
 * const db = require('./db/connection');
 * 
 * // Query example:
 * const users = await db.query('SELECT * FROM users WHERE company_id = $1', [companyId]);
 */

require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../services/logger');

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const IS_RENDER = process.env.RENDER === 'true';

// Log the database configuration
logger.info('Database configuration', {
  environment: NODE_ENV,
  isProduction: IS_PRODUCTION,
  isRender: IS_RENDER
});

// Get DATABASE_URL - no validation, accept as-is
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  const error = new Error('DATABASE_URL environment variable is required');
  logger.error('Missing DATABASE_URL', { error });
  throw error;
}

// Mask the password for logging
const maskedUrl = DATABASE_URL.replace(/:[^:@]*@/, ':***@');
logger.info('Using database connection', { url: maskedUrl });

// SSL is enabled by default in production/Render unless explicitly disabled
const DATABASE_SSL = 
  process.env.DATABASE_SSL === 'true' || 
  (IS_PRODUCTION || IS_RENDER) && process.env.DATABASE_SSL !== 'false';

// PostgreSQL connection pool configuration
const pgConfig = {
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.PG_MAX_CONNECTIONS || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Database connection object
let db;

/**
 * Initialize the database connection
 */
function initializeDatabase() {
  logger.info('Initializing PostgreSQL connection', { 
    ssl: DATABASE_SSL,
    maxConnections: pgConfig.max
  });
  
  // Create PostgreSQL connection pool
  const pool = new Pool(pgConfig);
  
  // Test the connection
  pool.query('SELECT NOW()')
    .then(() => logger.info('PostgreSQL database connected successfully'))
    .catch(err => {
      logger.error('PostgreSQL connection error', { 
        error: err,
        connectionString: maskedUrl,
        ssl: pgConfig.ssl,
        host: new URL(DATABASE_URL).hostname,
        database: new URL(DATABASE_URL).pathname.substring(1)
      });
      
      // In production, we should fail fast if we can't connect to the database
      if (IS_PRODUCTION || IS_RENDER) {
        process.exit(1);
      }
    });
    
  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error', { error: err });
    
    // In production, unexpected pool errors are critical
    if (IS_PRODUCTION || IS_RENDER) {
      logger.error('Critical database error in production, exiting process');
      process.exit(1);
    }
  });
  
  // Create a query function that works with promises
  db = {
    query: async (text, params) => {
      const start = Date.now();
      try {
        const result = await pool.query(text, params);
        logger.info('DB query success', {
          text,
          params,
          duration: Date.now() - start,
          rowCount: result.rowCount
        });
        return result.rows;
      } catch (err) {
        logger.error('Database query error', {
          text,
          params,
          error: err,
          duration: Date.now() - start
        });
        throw err;
      }
    },
    
    queryOne: async (text, params) => {
      const start = Date.now();
      try {
        const result = await pool.query(text, params);
        logger.info('DB queryOne success', {
          text,
          params,
          duration: Date.now() - start,
          found: result.rows.length > 0
        });
        return result.rows[0] || null;
      } catch (err) {
        logger.error('Database queryOne error', {
          text,
          params,
          error: err,
          duration: Date.now() - start
        });
        throw err;
      }
    },
    
    execute: async (text, params) => {
      const start = Date.now();
      try {
        const result = await pool.query(text, params);
        logger.info('DB execute success', {
          text,
          params,
          duration: Date.now() - start,
          rowCount: result.rowCount
        });
        return {
          rowCount: result.rowCount,
          rows: result.rows
        };
      } catch (err) {
        logger.error('Database execute error', {
          text,
          params,
          error: err,
          duration: Date.now() - start
        });
        throw err;
      }
    },
    
    // Get a client from the pool for transactions
    getClient: async () => {
      const client = await pool.connect();
      const originalRelease = client.release;
      
      // Override the release method to log errors
      client.release = () => {
        originalRelease.call(client);
      };
      
      return client;
    },
    
    // Transaction helper
    transaction: async (callback) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const start = Date.now();
        const result = await callback(client);
        await client.query('COMMIT');
        logger.info('DB transaction committed', { duration: Date.now() - start });
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        logger.error('DB transaction rolled back', { error: e });
        throw e;
      } finally {
        client.release();
      }
    },
    
    // Close the pool
    close: async () => {
      await pool.end();
      logger.info('PostgreSQL pool has ended');
    }
  };
}

// Initialize the database connection
initializeDatabase();

// Export the database interface
module.exports = db;

/**
 * Database Connection Module
 * 
 * Provides a unified interface for database connections, supporting both
 * PostgreSQL (production) and SQLite (development/test) databases.
 * 
 * Usage:
 * const db = require('./db/connection');
 * 
 * // Query example (works for both PostgreSQL and SQLite)
 * const users = await db.query('SELECT * FROM users WHERE company_id = $1', [companyId]);
 */

require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../services/logger'); // <— centralized Winston logger

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const IS_RENDER = process.env.RENDER === 'true';
// Force PostgreSQL in every environment
const DB_TYPE = 'postgres';

// Log the database configuration
logger.info('Database configuration', {
  environment: NODE_ENV,
  databaseType: DB_TYPE,
  isProduction: IS_PRODUCTION,
  isRender: IS_RENDER
});

/**
 * ---------------------------------------------------------------------------
 * Validate & Normalise DATABASE_URL
 * ---------------------------------------------------------------------------
 * Render supplies URLs that start with **postgresql://** while many libraries
 * still emit **postgres://**.  Both are valid — accept either form.
 */

const DATABASE_URL_RAW = process.env.DATABASE_URL;
let DATABASE_URL;

try {
  if (!DATABASE_URL_RAW) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const parsed = new URL(DATABASE_URL_RAW);

  // Accept both postgres:// and postgresql:// schemes
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `Unsupported DATABASE_URL protocol "${parsed.protocol}". ` +
      'Must be postgres:// or postgresql://'
    );
  }

  // Normalise to postgres:// (pg library is fine with either, but keep it tidy)
  if (parsed.protocol === 'postgresql:') {
    parsed.protocol = 'postgres:';
    DATABASE_URL = parsed.toString();
  } else {
    DATABASE_URL = DATABASE_URL_RAW;
  }
} catch (err) {
  logger.error('Invalid DATABASE_URL', { error: err });
  throw err;
}

// Validate required configuration for PostgreSQL
// (Redundant after the check above, but keep for clarity)
if (DB_TYPE === 'postgres' && !DATABASE_URL) {
  const error = new Error('DATABASE_URL environment variable is required when using PostgreSQL');
  logger.error('Missing DATABASE_URL for PostgreSQL connection', { error });
  throw error;
}

/**
 * ---------------------------------------------------------------------------
 * SSL Configuration
 * ---------------------------------------------------------------------------
 * Render Postgres requires SSL.  Enable it automatically in production / Render
 * unless the user explicitly disables it by setting DATABASE_SSL=false.
 */

const DATABASE_SSL =
  process.env.DATABASE_SSL === 'true' ||
  (process.env.DATABASE_SSL !== 'false' && (IS_PRODUCTION || IS_RENDER));

// Database connection object
let db;

// PostgreSQL connection pool configuration
const pgConfig = {
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL
    ? { rejectUnauthorized: false }
    : false,
  max: parseInt(process.env.PG_MAX_CONNECTIONS || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

/**
 * Initialize the database connection based on the environment
 */
function initializeDatabase() {
  // PostgreSQL only
    logger.info('Initializing PostgreSQL connection', { 
      ssl: process.env.DATABASE_SSL === 'true',
      maxConnections: pgConfig.max
    });
    
    // PostgreSQL connection
    const pool = new Pool(pgConfig);
    
    // Test the connection
    pool.query('SELECT NOW()')
      .then(() => logger.info('PostgreSQL database connected successfully'))
      .catch(err => {
        logger.error('PostgreSQL connection error', { 
          error: err,
          connectionString: DATABASE_URL ? DATABASE_URL.replace(/:[^:@]*@/, ':***@') : undefined, // Mask password
          ssl: pgConfig.ssl
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
            duration: Date.now() - start
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
            duration: Date.now() - start
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

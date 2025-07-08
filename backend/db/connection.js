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
const BetterSqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../services/logger'); // <— centralized Winston logger

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const IS_RENDER = process.env.RENDER === 'true';

// Determine database type with strong preference for PostgreSQL in production
// Force PostgreSQL if:
// 1. We're in production environment
// 2. We're on Render
// 3. DB_TYPE is explicitly set to 'postgres'
let DB_TYPE = process.env.DB_TYPE;
if (!DB_TYPE) {
  if (IS_PRODUCTION || IS_RENDER) {
    DB_TYPE = 'postgres';
  } else {
    DB_TYPE = 'sqlite';
  }
}

// Log the database configuration
logger.info('Database configuration', {
  environment: NODE_ENV,
  databaseType: DB_TYPE,
  isProduction: IS_PRODUCTION,
  isRender: IS_RENDER
});

const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../../data/collectflo.db');

// Validate required configuration for PostgreSQL
if (DB_TYPE === 'postgres' && !DATABASE_URL) {
  const error = new Error('DATABASE_URL environment variable is required when using PostgreSQL');
  logger.error('Missing DATABASE_URL for PostgreSQL connection', { error });
  throw error;
}

// Ensure data directory exists for SQLite (only in development)
if (DB_TYPE === 'sqlite') {
  if (IS_PRODUCTION) {
    const error = new Error('SQLite is not supported in production. Please configure PostgreSQL.');
    logger.error('Attempted to use SQLite in production', { error });
    throw error;
  }
  
  const dataDir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create SQLite data directory', { path: dataDir, error: err });
      throw err;
    }
  }
}

// Database connection object
let db;

// PostgreSQL connection pool configuration
const pgConfig = {
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? 
    { rejectUnauthorized: false } : 
    false,
  max: parseInt(process.env.PG_MAX_CONNECTIONS || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

/**
 * Initialize the database connection based on the environment
 */
function initializeDatabase() {
  if (DB_TYPE === 'postgres') {
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
    
  } else {
    // SQLite connection (only for development/test)
    logger.info('Initializing SQLite connection', { path: SQLITE_PATH });
    
    try {
      const sqlite = new BetterSqlite3(SQLITE_PATH, { 
        verbose: process.env.SQLITE_VERBOSE === 'true' ? console.log : null 
      });
      
      logger.info('SQLite database connected', { path: SQLITE_PATH });
      
      // Create a query interface that mimics the PostgreSQL one
      db = {
        query: (text, params = []) => {
          const start = Date.now();
          try {
            // Convert $1, $2, etc. to ?, ? for SQLite
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            const rows = stmt.all(params);
            logger.info('SQLite query success', {
              text,
              params,
              duration: Date.now() - start
            });
            return rows;
          } catch (err) {
            logger.error('SQLite query error', {
              text,
              params,
              error: err
            });
            throw err;
          }
        },
        
        queryOne: (text, params = []) => {
          const start = Date.now();
          try {
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            const row = stmt.get(params) || null;
            logger.info('SQLite queryOne success', {
              text,
              params,
              duration: Date.now() - start
            });
            return row;
          } catch (err) {
            logger.error('SQLite queryOne error', {
              text,
              params,
              error: err
            });
            throw err;
          }
        },
        
        execute: (text, params = []) => {
          const start = Date.now();
          try {
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            const info = stmt.run(params);
            logger.info('SQLite execute success', {
              text,
              params,
              rowCount: info.changes,
              duration: Date.now() - start
            });
            return {
              rowCount: info.changes,
              lastInsertRowid: info.lastInsertRowid
            };
          } catch (err) {
            logger.error('SQLite execute error', {
              text,
              params,
              error: err
            });
            throw err;
          }
        },
        
        // Transaction helper for SQLite
        transaction: (callback) => {
          try {
            sqlite.exec('BEGIN');
            const start = Date.now();
            const result = callback(sqlite);
            sqlite.exec('COMMIT');
            logger.info('SQLite transaction committed', { duration: Date.now() - start });
            return result;
          } catch (e) {
            sqlite.exec('ROLLBACK');
            logger.error('SQLite transaction rolled back', { error: e });
            throw e;
          }
        },
        
        // Close the database
        close: () => {
          sqlite.close();
          logger.info('SQLite database connection closed');
        }
      };
      
    } catch (err) {
      logger.error('SQLite connection error', { error: err, path: SQLITE_PATH });
      throw err;
    }
  }
}

// Initialize the database connection
initializeDatabase();

// Export the database interface
module.exports = db;

/**
 * Database Connection Module
 * 
 * Provides a unified interface for database connections, supporting both
 * PostgreSQL (production) and SQLite (development) databases.
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
const DB_TYPE = process.env.DB_TYPE || (NODE_ENV === 'production' ? 'postgres' : 'sqlite');
const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../../data/collectflo.db');

// Ensure data directory exists for SQLite
if (DB_TYPE === 'sqlite') {
  const dataDir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
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
    // PostgreSQL connection
    const pool = new Pool(pgConfig);
    
    // Test the connection
    pool.query('SELECT NOW()')
      .then(() => logger.info('PostgreSQL database connected'))
      .catch(err => logger.error('PostgreSQL connection error', { error: err }));
      
    // Handle pool errors
    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error', { error: err });
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
    // SQLite connection
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
      logger.error('SQLite connection error', { error: err });
      throw err;
    }
  }
}

// Initialize the database connection
initializeDatabase();

// Export the database interface
module.exports = db;

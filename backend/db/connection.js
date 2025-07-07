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
      .then(() => console.log('PostgreSQL database connected'))
      .catch(err => console.error('PostgreSQL connection error:', err));
      
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
    
    // Create a query function that works with promises
    db = {
      query: async (text, params) => {
        try {
          const result = await pool.query(text, params);
          return result.rows;
        } catch (err) {
          console.error('Database query error:', err);
          throw err;
        }
      },
      
      queryOne: async (text, params) => {
        try {
          const result = await pool.query(text, params);
          return result.rows[0] || null;
        } catch (err) {
          console.error('Database queryOne error:', err);
          throw err;
        }
      },
      
      execute: async (text, params) => {
        try {
          const result = await pool.query(text, params);
          return {
            rowCount: result.rowCount,
            rows: result.rows
          };
        } catch (err) {
          console.error('Database execute error:', err);
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
          const result = await callback(client);
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      
      // Close the pool
      close: async () => {
        await pool.end();
        console.log('PostgreSQL pool has ended');
      }
    };
    
  } else {
    // SQLite connection
    try {
      const sqlite = new BetterSqlite3(SQLITE_PATH, { 
        verbose: process.env.SQLITE_VERBOSE === 'true' ? console.log : null 
      });
      
      console.log(`SQLite database connected at ${SQLITE_PATH}`);
      
      // Create a query interface that mimics the PostgreSQL one
      db = {
        query: (text, params = []) => {
          try {
            // Convert $1, $2, etc. to ?, ? for SQLite
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            return stmt.all(params);
          } catch (err) {
            console.error('SQLite query error:', err);
            throw err;
          }
        },
        
        queryOne: (text, params = []) => {
          try {
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            return stmt.get(params) || null;
          } catch (err) {
            console.error('SQLite queryOne error:', err);
            throw err;
          }
        },
        
        execute: (text, params = []) => {
          try {
            const sqliteText = text.replace(/\$\d+/g, '?');
            const stmt = sqlite.prepare(sqliteText);
            const info = stmt.run(params);
            return {
              rowCount: info.changes,
              lastInsertRowid: info.lastInsertRowid
            };
          } catch (err) {
            console.error('SQLite execute error:', err);
            throw err;
          }
        },
        
        // Transaction helper for SQLite
        transaction: (callback) => {
          try {
            sqlite.exec('BEGIN');
            const result = callback(sqlite);
            sqlite.exec('COMMIT');
            return result;
          } catch (e) {
            sqlite.exec('ROLLBACK');
            throw e;
          }
        },
        
        // Close the database
        close: () => {
          sqlite.close();
          console.log('SQLite database connection closed');
        }
      };
      
    } catch (err) {
      console.error('SQLite connection error:', err);
      throw err;
    }
  }
}

// Initialize the database connection
initializeDatabase();

// Export the database interface
module.exports = db;

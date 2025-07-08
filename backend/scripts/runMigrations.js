/**
 * backend/scripts/runMigrations.js
 * 
 * Script to run database migrations using node-pg-migrate.
 * This script is designed to be called during application startup
 * to ensure the database schema is up-to-date.
 */

const migrate = require('node-pg-migrate');
const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Load .env from root
const logger = require('../services/logger'); // Our centralized logger

/**
 * Runs pending database migrations.
 * Logs progress and handles errors gracefully.
 */
async function runMigrations() {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const DATABASE_URL = process.env.DATABASE_URL;
  // In production / Render we default to true unless explicitly disabled
  const DATABASE_SSL =
    process.env.DATABASE_SSL === 'true' ||
    (NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false');

  // Helper to log fatal config errors and exit
  const logAndExit = (msg) => {
    logger.error(`[MIGRATION] ${msg}`);
    process.exit(1);
  };

  // ------------------------------------------------------------------
  // 1. Validate DATABASE_URL
  // ------------------------------------------------------------------
  if (!DATABASE_URL) {
    logAndExit('DATABASE_URL environment variable is not set. Cannot run migrations.');
  }

  // Very simple Postgres URL validator
  const POSTGRES_URL_REGEX = /^(postgres(ql)?):\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/i;
  if (!POSTGRES_URL_REGEX.test(DATABASE_URL)) {
    logAndExit(`Invalid DATABASE_URL "${DATABASE_URL}". It must be a valid PostgreSQL connection string.`);
  }

  const dbConfig = {
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  };

  // ------------------------------------------------------------------
  // 2. Validate migrations directory
  // ------------------------------------------------------------------
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  if (!fs.existsSync(migrationsDir)) {
    logAndExit(`Migrations directory "${migrationsDir}" does not exist.`);
  }

  const migrationOptions = {
    databaseUrl: dbConfig,
    migrationsTable: 'pgmigrations',
    dir: migrationsDir,
    direction: 'up', // Run migrations up
    count: Infinity, // Run all pending migrations
    logger: {
      // Custom logger for node-pg-migrate to use our Winston logger
      info: (msg) => logger.info(`[MIGRATION] ${msg}`),
      warn: (msg) => logger.warn(`[MIGRATION] ${msg}`),
      error: (msg) => logger.error(`[MIGRATION] ${msg}`),
    },
  };

  try {
    logger.info('Starting database migrations...');
    const migrated = await migrate(migrationOptions);

    if (migrated.length > 0) {
      logger.info(`Successfully ran ${migrated.length} migrations: ${migrated.join(', ')}`);
    } else {
      logger.info('No new database migrations to run.');
    }
    return true;
  } catch (error) {
    // Provide as much detail as possible for troubleshooting
    logger.error('Database migration failed!', {
      message: error.message,
      stack:   error.stack,
      detail:  error.detail,      // node-pg specific
      hint:    error.hint,        // node-pg specific
      code:    error.code
    });
    // In a real application, you might want to exit the process or take other recovery actions
    throw error; // Re-throw to allow the calling process (e.g., index.js) to handle it
  }
}

module.exports = runMigrations;

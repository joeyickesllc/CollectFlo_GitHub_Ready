/**
 * backend/scripts/runMigrations.js
 * 
 * Script to run database migrations using node-pg-migrate.
 * This script is designed to be called during application startup
 * to ensure the database schema is up-to-date.
 */

const migrate = require('node-pg-migrate');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Load .env from root
const logger = require('../services/logger'); // Our centralized logger

/**
 * Runs pending database migrations.
 * Logs progress and handles errors gracefully.
 */
async function runMigrations() {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const DATABASE_URL = process.env.DATABASE_URL;
  const DATABASE_SSL = process.env.DATABASE_SSL === 'true';

  if (!DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is not set. Cannot run migrations.');
    process.exit(1);
  }

  const dbConfig = {
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  };

  const migrationOptions = {
    databaseUrl: dbConfig,
    migrationsTable: 'pgmigrations',
    dir: path.resolve(__dirname, '../../db/migrations'),
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
    logger.error('Database migration failed!', { error });
    // In a real application, you might want to exit the process or take other recovery actions
    throw error; // Re-throw to allow the calling process (e.g., index.js) to handle it
  }
}

module.exports = runMigrations;

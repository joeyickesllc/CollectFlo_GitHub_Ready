/**
 * 1720000000000_add_session_store.js
 * 
 * Migration to update the sessions table to work with connect-pg-simple.
 * The session table already exists from the initial migration, but we need
 * to add an index on the expire column for better session cleanup performance.
 */

exports.up = async (pgm) => {
  // Check if the sessions table exists
  const tableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'sessions'
    );
  `);

  // If the table doesn't exist, create it with the structure connect-pg-simple expects
  if (!tableExists.rows[0].exists) {
    pgm.createTable('sessions', {
      sid: {
        type: 'VARCHAR(255)',
        primaryKey: true
      },
      sess: {
        type: 'JSONB',
        notNull: true
      },
      expire: {
        type: 'TIMESTAMPTZ',
        notNull: true
      }
    });
  }

  // Check if the expire index exists
  const indexExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename = 'sessions'
      AND indexname = 'sessions_expire_idx'
    );
  `);

  // Create index on expire column if it doesn't exist
  if (!indexExists.rows[0].exists) {
    pgm.createIndex('sessions', ['expire'], {
      name: 'sessions_expire_idx',
      method: 'btree'
    });
  }
};

exports.down = async (pgm) => {
  // Drop the index if it exists
  pgm.dropIndex('sessions', ['expire'], {
    name: 'sessions_expire_idx',
    ifExists: true
  });
  
  // Note: We don't drop the sessions table in down migration
  // since it was created in the initial schema migration
};

#!/usr/bin/env node

require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const DATABASE_SSL = process.env.DATABASE_SSL === 'true' || (NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false');

  if (!DATABASE_URL) {
    console.error('[PREFLIGHT] ERROR: DATABASE_URL is not set');
    process.exit(2);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();

    // 1) Ensure settings table exists
    const existsRes = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'settings'
      ) AS exists;
    `);

    if (!existsRes.rows[0]?.exists) {
      console.log('[PREFLIGHT] OK: settings table does not exist – nothing to validate');
      process.exit(0);
    }

    // 2) Check if user_id column exists
    const colsRes = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'settings'
    `);
    const columns = colsRes.rows.map(r => r.column_name);
    const hasUserId = columns.includes('user_id');

    if (!hasUserId) {
      console.log('[PREFLIGHT] Detected legacy settings schema (no user_id). Running pre-migration checks...');

      // a) Companies with multiple settings rows – will cause unique(user_id) conflict after naive backfill
      const multiSettingsRes = await client.query(`
        SELECT company_id, COUNT(*) AS count
        FROM settings
        GROUP BY company_id
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `);

      if (multiSettingsRes.rows.length > 0) {
        console.error('\n[PREFLIGHT] ERROR: Multiple settings rows detected for the same company.');
        console.table(multiSettingsRes.rows);
        console.error('Action required: Consolidate to one settings row per company BEFORE running the migration.');
        console.error('Example (review carefully before executing):');
        console.error('  -- Keep the newest row and delete the rest per company');
        console.error('  WITH ranked AS (\n' +
                      '    SELECT id, company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY updated_at DESC) rn\n' +
                      '    FROM settings\n' +
                      '  )\n' +
                      '  DELETE FROM settings s\n' +
                      '  USING ranked r\n' +
                      '  WHERE s.id = r.id AND r.rn > 1;');
        process.exit(1);
      }

      // b) Companies that have zero users – backfill cannot set user_id
      const noUsersRes = await client.query(`
        SELECT s.company_id, COUNT(u.id) AS user_count
        FROM settings s
        LEFT JOIN users u ON u.company_id = s.company_id
        GROUP BY s.company_id
        HAVING COUNT(u.id) = 0
      `);

      if (noUsersRes.rows.length > 0) {
        console.error('\n[PREFLIGHT] ERROR: Some companies in settings have no users – cannot backfill user_id.');
        console.table(noUsersRes.rows);
        console.error('Action required: Create at least one user for each listed company (or remove the settings rows) before migration.');
        process.exit(1);
      }

      console.log('[PREFLIGHT] OK: Legacy settings can be safely migrated (single row per company, and each company has users).');
      process.exit(0);
    }

    // Already has user_id – validate integrity before enforcing constraints
    console.log('[PREFLIGHT] Detected user-based settings schema. Validating integrity...');

    // a) Null user_id
    const nullUserIdRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM settings WHERE user_id IS NULL`);
    if (nullUserIdRes.rows[0].cnt > 0) {
      console.error(`[PREFLIGHT] ERROR: ${nullUserIdRes.rows[0].cnt} settings rows have NULL user_id.`);
      console.error('Action required: Backfill user_id for these rows before applying NOT NULL constraint.');
      process.exit(1);
    }

    // b) Orphaned user references
    const orphanRes = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM settings s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE u.id IS NULL
    `);
    if (orphanRes.rows[0].cnt > 0) {
      console.error(`[PREFLIGHT] ERROR: ${orphanRes.rows[0].cnt} settings rows reference non-existent users.`);
      console.error('Action required: Fix or remove orphaned rows before adding FK constraint.');
      process.exit(1);
    }

    // c) Duplicate settings by user_id (would violate unique index on user_id)
    const dupRes = await client.query(`
      SELECT user_id, COUNT(*) AS count
      FROM settings
      GROUP BY user_id
      HAVING COUNT(*) > 1
    `);
    if (dupRes.rows.length > 0) {
      console.error('[PREFLIGHT] ERROR: Duplicate settings rows per user_id detected.');
      console.table(dupRes.rows);
      console.error('Action required: Reduce to one settings row per user before enforcing unique(user_id).');
      process.exit(1);
    }

    console.log('[PREFLIGHT] OK: user-based settings are consistent.');
    process.exit(0);
  } catch (err) {
    console.error('[PREFLIGHT] ERROR:', err.message);
    process.exit(2);
  } finally {
    try { await client.end(); } catch (closeErr) { console.warn('[PREFLIGHT] Failed to close client:', closeErr?.message); }
  }
}

main();
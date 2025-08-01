/**
 * Clear all QBO tokens for user ID 3 to ensure clean slate
 */

require('dotenv').config();
const pg = require('pg');

async function clearAllTokens() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check existing tokens
    const checkResult = await client.query(
      'SELECT id, user_id, created_at, updated_at FROM qbo_tokens WHERE user_id = 3 ORDER BY created_at DESC'
    );
    console.log(`Found ${checkResult.rows.length} existing tokens for user 3:`);
    checkResult.rows.forEach(row => {
      console.log(`- Token ID ${row.id}: created ${row.created_at}, updated ${row.updated_at}`);
    });

    if (checkResult.rows.length > 0) {
      // Delete all tokens for user 3
      const deleteResult = await client.query('DELETE FROM qbo_tokens WHERE user_id = 3');
      console.log(`\nDeleted ${deleteResult.rowCount} tokens for user 3`);
    } else {
      console.log('\nNo tokens found to delete');
    }

    // Verify deletion
    const verifyResult = await client.query('SELECT COUNT(*) FROM qbo_tokens WHERE user_id = 3');
    console.log(`\nVerification: ${verifyResult.rows[0].count} tokens remaining for user 3`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

clearAllTokens();
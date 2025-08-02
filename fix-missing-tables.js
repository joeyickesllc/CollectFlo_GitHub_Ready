/**
 * Fix Missing Tables in New Database
 * Creates the qbo_tokens table that failed during migration
 */

const { Client } = require('pg');

const NEW_DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function fixMissingTables() {
  const client = new Client({
    connectionString: NEW_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to new database\n');
    
    // Create qbo_tokens table
    console.log('🏗️  Creating qbo_tokens table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS qbo_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        encrypted_tokens TEXT NOT NULL,
        iv VARCHAR(32) NOT NULL,
        auth_tag VARCHAR(32) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    console.log('✅ Created qbo_tokens table');
    
    // Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qbo_tokens_user_id ON qbo_tokens(user_id)
    `);
    
    console.log('✅ Created qbo_tokens index');
    
    console.log('\n🎉 All missing tables created successfully!');
    console.log('\n📋 Your database is now ready for deployment!');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    await client.end();
  }
}

fixMissingTables();
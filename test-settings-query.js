const { Client } = require('pg');

const DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function testSettingsQuery() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Get a user ID to test with
    const user = await client.query('SELECT id FROM users ORDER BY id LIMIT 1');
    
    if (user.rows.length === 0) {
      console.log('❌ No users found');
      return;
    }
    
    const userId = user.rows[0].id;
    console.log('🧪 Testing with user ID:', userId);
    
    // Test the query that was failing
    const settings = await client.query('SELECT * FROM settings WHERE user_id = $1', [userId]);
    
    console.log('✅ Settings query successful');
    console.log('📊 Found settings:', settings.rows.length);
    
    if (settings.rows.length > 0) {
      console.log('Sample setting:', settings.rows[0]);
    }
    
    // Show table structure
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Settings table structure:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    await client.end();
    console.log('📡 Disconnected');
  }
}

testSettingsQuery();
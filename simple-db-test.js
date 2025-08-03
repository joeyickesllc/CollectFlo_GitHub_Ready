const { Client } = require('pg');

const DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function testConnection() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  
  try {
    console.log('Connecting...');
    await client.connect();
    console.log('✅ Connected');
    
    const result = await client.query('SELECT NOW()');
    console.log('✅ Query successful:', result.rows[0]);
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    try {
      await client.end();
      console.log('📡 Disconnected');
    } catch (e) {
      console.log('Error disconnecting:', e.message);
    }
  }
}

testConnection();
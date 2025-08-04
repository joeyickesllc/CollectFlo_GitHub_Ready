const { Client } = require('pg');

const DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function dropConstraint() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected');
    
    // Drop the specific constraint that's causing issues
    await client.query('ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_invoice_id_fkey');
    console.log('✅ Dropped follow_ups_invoice_id_fkey');
    
    // Also drop any customer constraint just in case
    await client.query('ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_customer_id_fkey');
    console.log('✅ Dropped follow_ups_customer_id_fkey (if existed)');
    
    // Test insert
    const result = await client.query(`
      INSERT INTO follow_ups (company_id, invoice_id, follow_up_type, status, scheduled_at, message_content, created_at, updated_at) 
      VALUES (3, '1001', 'email', 'pending', NOW(), 'Test', NOW(), NOW()) 
      RETURNING id
    `);
    console.log('✅ Test insert worked, ID:', result.rows[0].id);
    
    // Clean up
    await client.query('DELETE FROM follow_ups WHERE id = $1', [result.rows[0].id]);
    console.log('✅ Cleaned up test record');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    await client.end();
  }
}

dropConstraint();
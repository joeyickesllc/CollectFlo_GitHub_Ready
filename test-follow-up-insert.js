/**
 * Test Follow-Up Insert
 * Test if we can now insert follow-ups without constraint errors
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function testFollowUpInsert() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Test inserting a follow-up
    console.log('🧪 Testing follow-up insert...');
    
    const testInsert = `
      INSERT INTO follow_ups (
        company_id, customer_id, invoice_id, follow_up_type, status, 
        scheduled_at, message_content, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, invoice_id
    `;
    
    const result = await client.query(testInsert, [
      3,                                    // company_id
      null,                                 // customer_id (nullable)
      '1001',                              // invoice_id (QuickBooks ID as string)
      'email',                             // follow_up_type
      'pending',                           // status
      '2025-08-03T00:00:00.000Z',         // scheduled_at
      'Test follow-up for invoice 1001'   // message_content
    ]);
    
    console.log('✅ Follow-up inserted successfully!');
    console.log(`📋 Created follow-up ID: ${result.rows[0].id} for invoice: ${result.rows[0].invoice_id}`);
    
    // Clean up test record
    await client.query('DELETE FROM follow_ups WHERE id = $1', [result.rows[0].id]);
    console.log('🧹 Test record cleaned up');
    
  } catch (error) {
    console.error('💥 Error testing follow-up insert:', error.message);
    console.error('Code:', error.code);
    console.error('Detail:', error.detail);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

testFollowUpInsert();
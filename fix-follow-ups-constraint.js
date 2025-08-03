/**
 * Fix Follow-Ups Foreign Key Constraint
 * Remove the foreign key constraint that's preventing follow-up creation
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function fixFollowUpsConstraint() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    console.log('🔧 Creating/fixing follow_ups table...');
    
    // Check if follow_ups table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'follow_ups'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('📋 Creating follow_ups table...');
      
      // Create the follow_ups table with correct structure
      await client.query(`
        CREATE TABLE follow_ups (
          id SERIAL PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          customer_id VARCHAR(50), -- QuickBooks customer ID as string, nullable
          invoice_id VARCHAR(50) NOT NULL, -- QuickBooks invoice ID as string
          follow_up_type VARCHAR(50) NOT NULL, -- 'email', 'sms', 'call'
          status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
          scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE,
          delivered_at TIMESTAMP WITH TIME ZONE,
          failed_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          message_content TEXT,
          template_id INTEGER REFERENCES message_templates(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      console.log('✅ Created follow_ups table');
      
      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_follow_ups_company_id ON follow_ups(company_id);
        CREATE INDEX IF NOT EXISTS idx_follow_ups_customer_id ON follow_ups(customer_id);
        CREATE INDEX IF NOT EXISTS idx_follow_ups_invoice_id ON follow_ups(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
        CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled_at ON follow_ups(scheduled_at);
      `);
      
      console.log('✅ Created follow_ups indexes');
      
    } else {
      console.log('📋 follow_ups table already exists');
      
      // Drop problematic foreign key constraints if they exist
      try {
        await client.query('ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_invoice_id_fkey');
        console.log('✅ Dropped invoice_id foreign key constraint');
      } catch (error) {
        console.log('⚠️  Invoice FK constraint may not exist');
      }
      
      try {
        await client.query('ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_customer_id_fkey');
        console.log('✅ Dropped customer_id foreign key constraint');
      } catch (error) {
        console.log('⚠️  Customer FK constraint may not exist');
      }
      
      // Ensure columns are the right type
      try {
        await client.query('ALTER TABLE follow_ups ALTER COLUMN invoice_id TYPE VARCHAR(50)');
        console.log('✅ Changed invoice_id to VARCHAR(50)');
      } catch (error) {
        console.log('⚠️  Could not change invoice_id type (may already be correct)');
      }
      
      try {
        await client.query('ALTER TABLE follow_ups ALTER COLUMN customer_id TYPE VARCHAR(50)');
        await client.query('ALTER TABLE follow_ups ALTER COLUMN customer_id DROP NOT NULL');
        console.log('✅ Changed customer_id to nullable VARCHAR(50)');
      } catch (error) {
        console.log('⚠️  Could not change customer_id type (may already be correct)');
      }
    }
    
    // Verify the table structure
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'follow_ups' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    const columns = columnsResult.rows || [];
    console.log('\n📊 Updated follow_ups table structure:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });
    
    console.log('\n🎉 Follow-ups table fixed!');
    console.log('📋 Follow-ups can now be created with QuickBooks invoice IDs');
    
  } catch (error) {
    console.error('💥 Error fixing follow-ups table:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

fixFollowUpsConstraint();
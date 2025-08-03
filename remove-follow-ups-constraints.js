/**
 * Remove Foreign Key Constraints from Follow-Ups Table
 * The follow_ups table still has foreign key constraints that prevent QuickBooks integration
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function removeFollowUpsConstraints() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check if follow_ups table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'follow_ups'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ follow_ups table does not exist');
      return;
    }
    
    console.log('📋 follow_ups table exists, checking constraints...');
    
    // List all constraints on follow_ups table
    const constraints = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint 
      WHERE conrelid = 'follow_ups'::regclass
    `);
    
    console.log('📊 Current constraints on follow_ups table:');
    constraints.rows.forEach(constraint => {
      console.log(`  - ${constraint.constraint_name} (${constraint.constraint_type}): ${constraint.constraint_definition}`);
    });
    
    // Drop foreign key constraints
    const foreignKeyConstraints = constraints.rows.filter(c => c.constraint_type === 'f');
    
    for (const constraint of foreignKeyConstraints) {
      try {
        console.log(`🔧 Dropping foreign key constraint: ${constraint.constraint_name}`);
        await client.query(`ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS ${constraint.constraint_name}`);
        console.log(`✅ Dropped constraint: ${constraint.constraint_name}`);
      } catch (error) {
        console.log(`⚠️  Could not drop constraint ${constraint.constraint_name}: ${error.message}`);
      }
    }
    
    // Ensure invoice_id and customer_id are correct types
    try {
      console.log('🔧 Updating column types...');
      await client.query('ALTER TABLE follow_ups ALTER COLUMN invoice_id TYPE VARCHAR(50)');
      console.log('✅ Changed invoice_id to VARCHAR(50)');
    } catch (error) {
      console.log('⚠️  Could not change invoice_id type:', error.message);
    }
    
    try {
      await client.query('ALTER TABLE follow_ups ALTER COLUMN customer_id TYPE VARCHAR(50)');
      await client.query('ALTER TABLE follow_ups ALTER COLUMN customer_id DROP NOT NULL');
      console.log('✅ Changed customer_id to nullable VARCHAR(50)');
    } catch (error) {
      console.log('⚠️  Could not change customer_id type:', error.message);
    }
    
    // Verify final constraints
    const finalConstraints = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type
      FROM pg_constraint 
      WHERE conrelid = 'follow_ups'::regclass AND contype = 'f'
    `);
    
    console.log('\n📊 Remaining foreign key constraints:');
    if (finalConstraints.rows.length === 0) {
      console.log('  ✅ No foreign key constraints remaining!');
    } else {
      finalConstraints.rows.forEach(constraint => {
        console.log(`  - ${constraint.constraint_name}`);
      });
    }
    
    // Check column structure
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'follow_ups' AND table_schema = 'public'
      AND column_name IN ('invoice_id', 'customer_id')
      ORDER BY column_name
    `);
    
    console.log('\n📊 Key column types:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });
    
    console.log('\n🎉 Follow-ups constraints removed!');
    console.log('📋 Follow-ups can now be created with QuickBooks invoice IDs');
    
  } catch (error) {
    console.error('💥 Error removing follow-ups constraints:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

removeFollowUpsConstraints();
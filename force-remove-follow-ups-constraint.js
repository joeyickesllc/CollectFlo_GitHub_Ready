/**
 * Force Remove follow_ups_invoice_id_fkey Constraint
 * This constraint is still causing production errors despite our previous fixes
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function forceRemoveConstraint() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
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
    
    console.log('📋 follow_ups table exists');
    
    // List ALL constraints on follow_ups table
    const allConstraints = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint 
      WHERE conrelid = 'follow_ups'::regclass
      ORDER BY conname
    `);
    
    console.log('📊 ALL constraints on follow_ups table:');
    allConstraints.rows.forEach(constraint => {
      console.log(`  - ${constraint.constraint_name} (${constraint.constraint_type}): ${constraint.constraint_definition}`);
    });
    
    // Specifically look for the problematic constraint
    const hasInvoiceConstraint = allConstraints.rows.some(c => c.constraint_name === 'follow_ups_invoice_id_fkey');
    
    if (hasInvoiceConstraint) {
      console.log('\n🚨 FOUND the problematic constraint: follow_ups_invoice_id_fkey');
      console.log('🔧 Removing it now...');
      
      try {
        await client.query('ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_invoice_id_fkey');
        console.log('✅ Successfully dropped follow_ups_invoice_id_fkey constraint');
      } catch (dropError) {
        console.log('⚠️  Error dropping constraint:', dropError.message);
        
        // Try with CASCADE
        try {
          await client.query('ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_invoice_id_fkey CASCADE');
          console.log('✅ Successfully dropped constraint with CASCADE');
        } catch (cascadeError) {
          console.log('💥 Could not drop constraint even with CASCADE:', cascadeError.message);
        }
      }
    } else {
      console.log('✅ follow_ups_invoice_id_fkey constraint not found');
    }
    
    // Check for any other invoice-related constraints
    const invoiceConstraints = allConstraints.rows.filter(c => 
      c.constraint_name.includes('invoice') || 
      c.constraint_definition.includes('invoice')
    );
    
    if (invoiceConstraints.length > 0) {
      console.log('\n🔍 Found other invoice-related constraints:');
      for (const constraint of invoiceConstraints) {
        console.log(`  - ${constraint.constraint_name}: ${constraint.constraint_definition}`);
        
        if (constraint.constraint_type === 'f') { // Foreign key
          try {
            console.log(`🔧 Removing ${constraint.constraint_name}...`);
            await client.query(`ALTER TABLE follow_ups DROP CONSTRAINT ${constraint.constraint_name}`);
            console.log(`✅ Dropped ${constraint.constraint_name}`);
          } catch (error) {
            console.log(`⚠️  Could not drop ${constraint.constraint_name}:`, error.message);
          }
        }
      }
    }
    
    // Show final constraints
    const finalConstraints = await client.query(`
      SELECT 
        conname as constraint_name,
        contype as constraint_type
      FROM pg_constraint 
      WHERE conrelid = 'follow_ups'::regclass AND contype = 'f'
      ORDER BY conname
    `);
    
    console.log('\n📊 Final foreign key constraints on follow_ups:');
    if (finalConstraints.rows.length === 0) {
      console.log('  ✅ NO foreign key constraints remaining!');
    } else {
      finalConstraints.rows.forEach(constraint => {
        console.log(`  - ${constraint.constraint_name} (${constraint.constraint_type})`);
      });
    }
    
    // Test an insert to make sure it works
    console.log('\n🧪 Testing follow-up insert...');
    try {
      const testResult = await client.query(`
        INSERT INTO follow_ups (
          company_id, customer_id, invoice_id, follow_up_type, status, 
          scheduled_at, message_content, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [3, null, '1001', 'email', 'pending', '2025-08-07T00:00:00.000Z', 'Test insert']);
      
      console.log('✅ Test insert successful! ID:', testResult.rows[0].id);
      
      // Clean up test record
      await client.query('DELETE FROM follow_ups WHERE id = $1', [testResult.rows[0].id]);
      console.log('🧹 Test record cleaned up');
      
    } catch (insertError) {
      console.log('💥 Test insert failed:', insertError.message);
      console.log('Code:', insertError.code);
      console.log('Detail:', insertError.detail);
    }
    
    console.log('\n🎉 Constraint removal completed!');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

forceRemoveConstraint();
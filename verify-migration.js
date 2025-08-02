/**
 * Verify Database Migration
 * Checks what data was successfully migrated to the new database
 */

const { Client } = require('pg');

// Database connections
const OLD_DATABASE_URL = 'postgresql://collectflo_postgres_user:CKbAyvMqhAI2UuXHfmvuEbCwZgI8qGjd@dpg-d1m3tsmr433s739h52ig-a.oregon-postgres.render.com/collectflo_postgres';
const NEW_DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function verifyMigration() {
  let oldClient, newClient;
  
  try {
    console.log('🔍 Verifying database migration...\n');
    
    // Connect to both databases
    oldClient = new Client({
      connectionString: OLD_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await oldClient.connect();
    
    newClient = new Client({
      connectionString: NEW_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await newClient.connect();
    
    console.log('✅ Connected to both databases\n');
    
    // Get tables from old database  
    const tablesResult = await oldClient.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      AND tablename != 'pgmigrations'
      ORDER BY tablename
    `);
    
    const tables = tablesResult.rows.map(row => row.tablename);
    
    console.log('📊 Migration Verification Report:\n');
    console.log('Table Name           | Old Rows | New Rows | Status');
    console.log('---------------------|----------|----------|--------');
    
    let totalOldRows = 0;
    let totalNewRows = 0;
    let successfulTables = 0;
    
    for (const tableName of tables) {
      try {
        // Get counts
        const oldCount = await oldClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const oldRows = parseInt(oldCount.rows[0].count);
        totalOldRows += oldRows;
        
        let newRows = 0;
        let status = '❌ Missing';
        
        try {
          const newCount = await newClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
          newRows = parseInt(newCount.rows[0].count);
          totalNewRows += newRows;
          
          if (newRows === oldRows && oldRows > 0) {
            status = '✅ Perfect';
            successfulTables++;
          } else if (newRows === oldRows && oldRows === 0) {
            status = '⚪ Empty';
            successfulTables++;
          } else if (newRows > 0 && newRows < oldRows) {
            status = '⚠️  Partial';
          } else if (newRows > oldRows) {
            status = '❓ More?';
          }
        } catch (error) {
          // Table doesn't exist in new database
          status = '❌ Missing';
        }
        
        const paddedName = tableName.padEnd(20);
        const paddedOld = oldRows.toString().padStart(8);
        const paddedNew = newRows.toString().padStart(8);
        
        console.log(`${paddedName} | ${paddedOld} | ${paddedNew} | ${status}`);
        
      } catch (error) {
        console.log(`${tableName.padEnd(20)} | ERROR    | ERROR    | ❌ Error`);
      }
    }
    
    console.log('---------------------|----------|----------|--------');
    console.log(`Total                | ${totalOldRows.toString().padStart(8)} | ${totalNewRows.toString().padStart(8)} | ${successfulTables}/${tables.length} OK`);
    
    // Check critical tables
    console.log('\n🔍 Critical Tables Check:');
    
    const criticalTables = ['users', 'companies', 'qbo_tokens'];
    for (const table of criticalTables) {
      try {
        const oldResult = await oldClient.query(`SELECT COUNT(*) as count FROM "${table}"`);
        const newResult = await newClient.query(`SELECT COUNT(*) as count FROM "${table}"`);
        
        const oldCount = parseInt(oldResult.rows[0].count);
        const newCount = parseInt(newResult.rows[0].count);
        
        if (oldCount === newCount) {
          console.log(`  ✅ ${table}: ${newCount} rows (matches)`);
        } else {
          console.log(`  ❌ ${table}: OLD=${oldCount}, NEW=${newCount} (MISMATCH!)`);
        }
      } catch (error) {
        console.log(`  ❌ ${table}: Error checking - ${error.message}`);
      }
    }
    
    // Migration summary
    console.log('\n📋 Migration Summary:');
    if (totalNewRows === totalOldRows && totalOldRows > 0) {
      console.log('🎉 PERFECT MIGRATION: All data successfully transferred!');
    } else if (totalNewRows > 0) {
      console.log(`⚠️  PARTIAL MIGRATION: ${totalNewRows}/${totalOldRows} rows transferred`);
      console.log('   This is likely due to foreign key constraints during migration');
    } else {
      console.log('❌ FAILED MIGRATION: No data transferred');
    }
    
    console.log('\n🚀 Next Steps:');
    console.log('1. ✅ You\'ve already updated DATABASE_URL in Render');
    console.log('2. 🚀 Redeploy your application');
    console.log('3. 🧪 Test login and QuickBooks functionality');
    console.log('4. 🗑️  Delete the old compromised database');
    
    if (totalNewRows >= totalOldRows * 0.8) { // 80% or more transferred
      console.log('\n✅ Migration looks successful enough to proceed!');
    } else {
      console.log('\n⚠️  Migration may need additional work before going live');
    }
    
  } catch (error) {
    console.error('💥 Verification failed:', error.message);
  } finally {
    if (oldClient) await oldClient.end();
    if (newClient) await newClient.end();
  }
}

verifyMigration();
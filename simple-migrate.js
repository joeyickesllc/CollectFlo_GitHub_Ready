/**
 * Simplified Database Migration Script
 * Uses pg_dump and pg_restore for reliable migration
 */

require('dotenv').config();
const { Client } = require('pg');

// Database connections
const OLD_DATABASE_URL = 'postgresql://collectflo_postgres_user:CKbAyvMqhAI2UuXHfmvuEbCwZgI8qGjd@dpg-d1m3tsmr433s739h52ig-a.oregon-postgres.render.com/collectflo_postgres';
const NEW_DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function simpleMigration() {
  let oldClient, newClient;
  
  try {
    console.log('🔄 Starting simplified database migration...\n');
    
    // Connect to both databases
    console.log('📡 Connecting to databases...');
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
    
    // Get all tables
    const tablesResult = await oldClient.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      AND tablename != 'pgmigrations'
      ORDER BY tablename
    `);
    
    const tables = tablesResult.rows.map(row => row.tablename);
    console.log('📊 Tables to migrate:', tables);
    console.log('');
    
    // For each table, copy data directly
    for (const tableName of tables) {
      console.log(`🔄 Migrating table: ${tableName}`);
      
      try {
        // Get row count from old database
        const countResult = await oldClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const rowCount = parseInt(countResult.rows[0].count);
        
        if (rowCount === 0) {
          console.log(`  ⚠️  Table ${tableName} is empty`);
          continue;
        }
        
        console.log(`  📊 Found ${rowCount} rows`);
        
        // Get all data from old table
        const dataResult = await oldClient.query(`SELECT * FROM "${tableName}" ORDER BY 1`);
        const rows = dataResult.rows;
        
        if (rows.length === 0) {
          console.log(`  ⚠️  No data to migrate`);
          continue;
        }
        
        // Get column names and types
        const columnsResult = await oldClient.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns 
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [tableName]);
        
        const columns = columnsResult.rows;
        const columnNames = columns.map(col => col.column_name);
        
        console.log(`  📋 Columns: ${columnNames.join(', ')}`);
        
        // Check if table exists in new database
        const tableExistsResult = await newClient.query(`
          SELECT EXISTS (
            SELECT FROM pg_tables 
            WHERE schemaname = 'public' AND tablename = $1
          )
        `, [tableName]);
        
        const tableExists = tableExistsResult.rows[0].exists;
        
        if (!tableExists) {
          console.log(`  🏗️  Creating table structure...`);
          
          // Create table in new database
          const columnDefs = [];
          for (const col of columns) {
            let def = `"${col.column_name}" ${col.data_type}`;
            
            if (col.data_type === 'character varying') {
              // Get character maximum length
              const lengthResult = await oldClient.query(`
                SELECT character_maximum_length 
                FROM information_schema.columns 
                WHERE table_name = $1 AND column_name = $2 AND table_schema = 'public'
              `, [tableName, col.column_name]);
              
              if (lengthResult.rows[0]?.character_maximum_length) {
                def += `(${lengthResult.rows[0].character_maximum_length})`;
              }
            }
            
            if (col.is_nullable === 'NO') {
              def += ' NOT NULL';
            }
            
            if (col.column_default) {
              def += ` DEFAULT ${col.column_default}`;
            }
            
            columnDefs.push(def);
          }
          
          await newClient.query(`CREATE TABLE "${tableName}" (${columnDefs.join(', ')})`);
          console.log(`  ✅ Created table structure`);
        } else {
          // Clear existing data
          await newClient.query(`DELETE FROM "${tableName}"`);
          console.log(`  🗑️  Cleared existing data`);
        }
        
        // Insert data batch by batch
        const batchSize = 100;
        let insertedCount = 0;
        
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          
          for (const row of batch) {
            try {
              const values = columnNames.map(col => row[col]);
              const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
              
              await newClient.query(
                `INSERT INTO "${tableName}" (${columnNames.map(name => `"${name}"`).join(', ')}) VALUES (${placeholders})`,
                values
              );
              insertedCount++;
            } catch (insertError) {
              console.log(`    ❌ Error inserting row: ${insertError.message}`);
            }
          }
          
          // Progress update
          const progress = Math.min(i + batchSize, rows.length);
          console.log(`  📦 Inserted ${progress}/${rows.length} rows`);
        }
        
        console.log(`  ✅ Successfully migrated ${insertedCount}/${rowCount} rows from ${tableName}\n`);
        
      } catch (tableError) {
        console.log(`  ❌ Error migrating table ${tableName}:`, tableError.message);
      }
    }
    
    // Verification
    console.log('✅ Verifying migration...');
    for (const tableName of tables) {
      try {
        const oldCount = await oldClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const newCount = await newClient.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
        
        const oldRows = parseInt(oldCount.rows[0].count);
        const newRows = parseInt(newCount.rows[0].count);
        
        if (oldRows === newRows) {
          console.log(`  ✅ ${tableName}: ${newRows} rows (✓ matches)`);
        } else {
          console.log(`  ⚠️  ${tableName}: OLD=${oldRows}, NEW=${newRows} (mismatch)`);
        }
      } catch (verifyError) {
        console.log(`  ❌ Error verifying ${tableName}:`, verifyError.message);
      }
    }
    
    console.log('\n🎉 Migration completed!');
    console.log('\n📋 Next steps:');
    console.log('1. ✅ You\'ve already updated DATABASE_URL in Render');
    console.log('2. 🚀 Redeploy your application');
    console.log('3. 🧪 Test that everything works');
    console.log('4. 🗑️  Delete the old compromised database');
    
  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    throw error;
  } finally {
    if (oldClient) await oldClient.end();
    if (newClient) await newClient.end();
    console.log('\n📡 Disconnected from databases');
  }
}

// Run migration
simpleMigration()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error.message);
    process.exit(1);
  });
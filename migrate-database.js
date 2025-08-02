/**
 * Database Migration Script
 * Migrates all data from the compromised database to the new secure database
 */

require('dotenv').config();
const { Client } = require('pg');

// Old (compromised) database connection
const OLD_DATABASE_URL = 'postgresql://collectflo_postgres_user:CKbAyvMqhAI2UuXHfmvuEbCwZgI8qGjd@dpg-d1m3tsmr433s739h52ig-a.oregon-postgres.render.com/collectflo_postgres';

// New (secure) database connection
const NEW_DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function migrateDatabase() {
  let oldClient, newClient;
  
  try {
    console.log('🔄 Starting database migration...\n');
    
    // Connect to both databases
    console.log('📡 Connecting to old database...');
    oldClient = new Client({
      connectionString: OLD_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await oldClient.connect();
    console.log('✅ Connected to old database\n');
    
    console.log('📡 Connecting to new database...');
    newClient = new Client({
      connectionString: NEW_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await newClient.connect();
    console.log('✅ Connected to new database\n');
    
    // Get list of all tables from old database
    console.log('📋 Getting list of tables...');
    const tablesResult = await oldClient.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    const tables = tablesResult.rows.map(row => row.tablename);
    console.log('📊 Found tables:', tables);
    console.log('');
    
    if (tables.length === 0) {
      console.log('⚠️  No tables found in old database');
      return;
    }
    
    // Step 1: Copy table structures
    console.log('🏗️  Step 1: Copying table structures...');
    for (const tableName of tables) {
      console.log(`  Creating table: ${tableName}`);
      
      // Get table structure
      const createTableResult = await oldClient.query(`
        SELECT 
          'CREATE TABLE ' || schemaname || '.' || tablename || ' (' ||
          array_to_string(
            array_agg(
              column_name || ' ' || data_type ||
              CASE 
                WHEN character_maximum_length IS NOT NULL 
                THEN '(' || character_maximum_length || ')'
                WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL
                THEN '(' || numeric_precision || ',' || numeric_scale || ')'
                ELSE ''
              END ||
              CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
            ), ', '
          ) || ');' as create_statement
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = 'public'
        GROUP BY schemaname, tablename
      `, [tableName]);
      
      if (createTableResult.rows.length > 0) {
        const createStatement = createTableResult.rows[0].create_statement;
        try {
          await newClient.query(createStatement);
          console.log(`  ✅ Created table: ${tableName}`);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log(`  ⚠️  Table ${tableName} already exists, skipping creation`);
          } else {
            console.log(`  ❌ Error creating table ${tableName}:`, error.message);
          }
        }
      }
    }
    console.log('');
    
    // Step 2: Copy data
    console.log('📦 Step 2: Copying data...');
    for (const tableName of tables) {
      console.log(`  Copying data from: ${tableName}`);
      
      // Get row count
      const countResult = await oldClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const rowCount = parseInt(countResult.rows[0].count);
      
      if (rowCount === 0) {
        console.log(`  ⚠️  Table ${tableName} is empty, skipping`);
        continue;
      }
      
      console.log(`  📊 Found ${rowCount} rows to copy`);
      
      // Get all data
      const dataResult = await oldClient.query(`SELECT * FROM ${tableName}`);
      const rows = dataResult.rows;
      
      if (rows.length > 0) {
        // Get column names
        const columns = Object.keys(rows[0]);
        const columnList = columns.join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        
        // Insert data row by row
        let successCount = 0;
        for (const row of rows) {
          try {
            const values = columns.map(col => row[col]);
            await newClient.query(
              `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`,
              values
            );
            successCount++;
          } catch (error) {
            console.log(`    ❌ Error inserting row:`, error.message);
          }
        }
        
        console.log(`  ✅ Copied ${successCount}/${rowCount} rows from ${tableName}`);
      }
    }
    console.log('');
    
    // Step 3: Copy indexes and constraints
    console.log('🔗 Step 3: Copying indexes and constraints...');
    
    // Get primary keys
    const pkResult = await oldClient.query(`
      SELECT 
        tc.table_name, 
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
      GROUP BY tc.table_name, tc.constraint_name
    `);
    
    for (const pk of pkResult.rows) {
      try {
        await newClient.query(`
          ALTER TABLE ${pk.table_name} 
          ADD CONSTRAINT ${pk.constraint_name} 
          PRIMARY KEY (${pk.columns})
        `);
        console.log(`  ✅ Added primary key to ${pk.table_name}`);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.log(`  ⚠️  Could not add primary key to ${pk.table_name}:`, error.message);
        }
      }
    }
    
    // Get foreign keys
    const fkResult = await oldClient.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `);
    
    for (const fk of fkResult.rows) {
      try {
        await newClient.query(`
          ALTER TABLE ${fk.table_name}
          ADD CONSTRAINT ${fk.constraint_name}
          FOREIGN KEY (${fk.column_name})
          REFERENCES ${fk.foreign_table_name} (${fk.foreign_column_name})
        `);
        console.log(`  ✅ Added foreign key ${fk.constraint_name}`);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.log(`  ⚠️  Could not add foreign key ${fk.constraint_name}:`, error.message);
        }
      }
    }
    console.log('');
    
    // Step 4: Verification
    console.log('✅ Step 4: Verifying migration...');
    for (const tableName of tables) {
      const oldCount = await oldClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const newCount = await newClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      
      const oldRows = parseInt(oldCount.rows[0].count);
      const newRows = parseInt(newCount.rows[0].count);
      
      if (oldRows === newRows) {
        console.log(`  ✅ ${tableName}: ${newRows} rows (matches)`);
      } else {
        console.log(`  ❌ ${tableName}: OLD=${oldRows}, NEW=${newRows} (MISMATCH!)`);
      }
    }
    
    console.log('\n🎉 Database migration completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Update your Render web service DATABASE_URL environment variable');
    console.log('2. Redeploy your application');
    console.log('3. Test that everything works');
    console.log('4. Delete the old compromised database');
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
    throw error;
  } finally {
    // Close connections
    if (oldClient) {
      try {
        await oldClient.end();
        console.log('\n📡 Disconnected from old database');
      } catch (e) {
        console.log('⚠️  Error disconnecting from old database:', e.message);
      }
    }
    
    if (newClient) {
      try {
        await newClient.end();
        console.log('📡 Disconnected from new database');
      } catch (e) {
        console.log('⚠️  Error disconnecting from new database:', e.message);
      }
    }
  }
}

// Run migration
if (require.main === module) {
  if (!NEW_DATABASE_URL) {
    console.error('❌ NEW_DATABASE_URL is not configured');
    process.exit(1);
  }
  
  migrateDatabase()
    .then(() => {
      console.log('\n✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { migrateDatabase };
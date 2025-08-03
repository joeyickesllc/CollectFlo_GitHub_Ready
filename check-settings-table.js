/**
 * Check Settings Table Structure
 * Investigate the settings table structure and fix missing user_id column
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function checkSettingsTable() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check if settings table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'settings'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ settings table does not exist');
      console.log('🔧 Creating settings table...');
      
      await client.query(`
        CREATE TABLE settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          phone VARCHAR(20),
          reply_to_email VARCHAR(255),
          email_signature TEXT,
          sms_enabled BOOLEAN DEFAULT false,
          email_enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      console.log('✅ Created settings table');
      
      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
        CREATE INDEX IF NOT EXISTS idx_settings_company_id ON settings(company_id);
      `);
      
      console.log('✅ Created settings indexes');
      
    } else {
      console.log('📋 settings table exists, checking structure...');
      
      // Get current table structure
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'settings' AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      
      console.log('📊 Current settings table structure:');
      columns.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });
      
      // Check if user_id column exists
      const hasUserId = columns.rows.some(col => col.column_name === 'user_id');
      
      if (!hasUserId) {
        console.log('\n🔧 Adding missing user_id column...');
        
        try {
          await client.query(`
            ALTER TABLE settings 
            ADD COLUMN user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
          `);
          console.log('✅ Added user_id column');
          
          // Create index
          await client.query('CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)');
          console.log('✅ Created user_id index');
          
        } catch (error) {
          console.log('⚠️  Error adding user_id column:', error.message);
          
          // Try adding without NOT NULL first, then populate, then add constraint
          console.log('🔧 Trying alternative approach...');
          
          await client.query('ALTER TABLE settings ADD COLUMN user_id INTEGER');
          console.log('✅ Added user_id column (nullable)');
          
          // Get all users to populate settings
          const users = await client.query('SELECT id FROM users');
          
          if (users.rows.length > 0) {
            // If there are existing settings without user_id, assign them to the first user
            await client.query('UPDATE settings SET user_id = $1 WHERE user_id IS NULL', [users.rows[0].id]);
            console.log('✅ Populated user_id for existing settings');
          }
          
          // Now add the NOT NULL constraint and foreign key
          await client.query('ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL');
          await client.query('ALTER TABLE settings ADD CONSTRAINT fk_settings_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
          await client.query('CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)');
          console.log('✅ Added constraints and index');
        }
      } else {
        console.log('✅ user_id column already exists');
      }
    }
    
    // Show final table structure
    const finalColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'settings' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Final settings table structure:');
    finalColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULLABLE'}`);
    });
    
    console.log('\n🎉 Settings table fixed!');
    
  } catch (error) {
    console.error('💥 Error checking settings table:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

checkSettingsTable();
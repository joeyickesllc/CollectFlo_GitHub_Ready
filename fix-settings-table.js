/**
 * Fix Settings Table - Add Missing user_id Column
 */

require('dotenv').config();
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function fixSettingsTable() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check if settings table exists and get its structure
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'settings' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('📋 Settings table does not exist, creating it...');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone VARCHAR(20),
          reply_to_email VARCHAR(255),
          email_signature TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      await client.query('CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)');
      console.log('✅ Created settings table with user_id column');
      
    } else {
      console.log('📋 Settings table exists');
      console.log('Current columns:');
      tableCheck.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
      
      const hasUserId = tableCheck.rows.some(col => col.column_name === 'user_id');
      
      if (!hasUserId) {
        console.log('\n🔧 Adding user_id column...');
        
        // Add user_id column
        await client.query('ALTER TABLE settings ADD COLUMN user_id INTEGER');
        
        // Get first user to assign to existing settings
        const firstUser = await client.query('SELECT id FROM users ORDER BY id LIMIT 1');
        
        if (firstUser.rows.length > 0) {
          await client.query('UPDATE settings SET user_id = $1 WHERE user_id IS NULL', [firstUser.rows[0].id]);
          console.log('✅ Populated user_id for existing settings');
        }
        
        // Add constraints
        await client.query('ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL');
        await client.query('ALTER TABLE settings ADD CONSTRAINT fk_settings_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
        await client.query('CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)');
        
        console.log('✅ Added user_id column with constraints');
      } else {
        console.log('✅ user_id column already exists');
      }
    }
    
    console.log('\n🎉 Settings table is ready!');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    await client.end();
  }
}

fixSettingsTable();
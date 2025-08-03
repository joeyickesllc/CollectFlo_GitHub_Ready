const { Client } = require('pg');

const DATABASE_URL = 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function addUserIdToSettings() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Check if settings table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'settings'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      console.log('📋 Creating settings table...');
      await client.query(`
        CREATE TABLE settings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          phone VARCHAR(20),
          reply_to_email VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      console.log('✅ Created settings table');
      return;
    }
    
    // Check if user_id column exists
    const hasUserId = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'settings' AND column_name = 'user_id'
      )
    `);
    
    if (!hasUserId.rows[0].exists) {
      console.log('🔧 Adding user_id column...');
      
      // Add column as nullable first
      await client.query('ALTER TABLE settings ADD COLUMN user_id INTEGER');
      
      // Get first user
      const firstUser = await client.query('SELECT id FROM users ORDER BY id LIMIT 1');
      
      if (firstUser.rows.length > 0) {
        // Update existing rows
        await client.query('UPDATE settings SET user_id = $1', [firstUser.rows[0].id]);
      }
      
      // Make it NOT NULL and add foreign key
      await client.query('ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL');
      await client.query('ALTER TABLE settings ADD CONSTRAINT fk_settings_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
      
      console.log('✅ Added user_id column');
    } else {
      console.log('✅ user_id column already exists');
    }
    
  } catch (error) {
    console.error('💥 Error:', error.message);
  } finally {
    await client.end();
    console.log('📡 Disconnected');
  }
}

addUserIdToSettings();
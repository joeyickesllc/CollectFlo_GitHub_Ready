const { Client } = require('pg');

async function fixQboTokensTable() {
  const client = new Client({
    connectionString: 'postgresql://collectflo_postgres_user:CKbAyvMqhAI2UuXHfmvuEbCwZgI8qGjd@dpg-d1m3tsmr433s739h52ig-a.oregon-postgres.render.com/collectflo_postgres',
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');
    
    // First, let's check if the table exists and what its structure is
    console.log('\n1. Checking existing table structure...');
    const existingTable = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'qbo_tokens'
      ORDER BY ordinal_position
    `);
    
    if (existingTable.rows.length > 0) {
      console.log('Existing qbo_tokens table structure:');
      existingTable.rows.forEach(col => {
        console.log(`- ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
    } else {
      console.log('qbo_tokens table does not exist');
    }
    
    // Check if users table exists (for foreign key reference)
    console.log('\n2. Checking users table exists...');
    const usersTable = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    
    if (usersTable.rows.length === 0) {
      console.log('❌ ERROR: users table does not exist!');
      console.log('The qbo_tokens table requires a users table for the foreign key constraint.');
      return;
    } else {
      console.log('✅ users table exists');
    }
    
    // Create the corrected qbo_tokens table
    console.log('\n3. Creating/updating qbo_tokens table...');
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS public.qbo_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          encrypted_tokens TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_qbo_tokens_user_id ON public.qbo_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_qbo_tokens_updated_at ON public.qbo_tokens(updated_at);
    `;
    
    await client.query(createTableSQL);
    console.log('✅ qbo_tokens table created/updated successfully');
    
    // Verify the final table structure
    console.log('\n4. Verifying final table structure...');
    const finalTable = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'qbo_tokens'
      ORDER BY ordinal_position
    `);
    
    console.log('Final qbo_tokens table structure:');
    finalTable.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
    
    // Check indexes
    console.log('\n5. Checking indexes...');
    const indexes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'qbo_tokens'
    `);
    
    console.log('Indexes:');
    indexes.rows.forEach(idx => {
      console.log(`- ${idx.indexname}`);
    });
    
    console.log('\n✅ qbo_tokens table is ready for use!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

fixQboTokensTable();
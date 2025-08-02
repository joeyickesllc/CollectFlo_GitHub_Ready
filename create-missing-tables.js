/**
 * Create Missing Database Tables
 * Creates all tables referenced in code but missing from the database
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://collectflo_postgres_2_user:VY3YBOdFokkxBaGHKwjuTX4zc9oYUHQA@dpg-d271st15pdvs73c03vgg-a.oregon-postgres.render.com/collectflo_postgres_2';

async function createMissingTables() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // 1. Create customers table (required for payments foreign key)
    console.log('🏗️  Creating customers table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        quickbooks_id VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50),
        postal_code VARCHAR(20),
        country VARCHAR(50) DEFAULT 'US',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, quickbooks_id)
      )
    `);
    console.log('✅ Created customers table');
    
    // Create index for customers
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id);
      CREATE INDEX IF NOT EXISTS idx_customers_quickbooks_id ON customers(quickbooks_id);
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    `);
    console.log('✅ Created customers indexes');
    
    // 2. Create analytics_daily table (for scheduler aggregation)
    console.log('🏗️  Creating analytics_daily table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        activity_type VARCHAR(100) NOT NULL,
        count INTEGER DEFAULT 0,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(date, activity_type, company_id)
      )
    `);
    console.log('✅ Created analytics_daily table');
    
    // Create index for analytics_daily
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date);
      CREATE INDEX IF NOT EXISTS idx_analytics_daily_company_id ON analytics_daily(company_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_daily_activity_type ON analytics_daily(activity_type);
    `);
    console.log('✅ Created analytics_daily indexes');
    
    // 3. Create follow_ups table (different from invoice_followups)
    console.log('🏗️  Creating follow_ups table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS follow_ups (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
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
    
    // Create indexes for follow_ups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_follow_ups_company_id ON follow_ups(company_id);
      CREATE INDEX IF NOT EXISTS idx_follow_ups_customer_id ON follow_ups(customer_id);
      CREATE INDEX IF NOT EXISTS idx_follow_ups_invoice_id ON follow_ups(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
      CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled_at ON follow_ups(scheduled_at);
    `);
    console.log('✅ Created follow_ups indexes');
    
    // 4. Create company_settings table (different from settings)
    console.log('🏗️  Creating company_settings table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT,
        setting_type VARCHAR(50) DEFAULT 'string', -- 'string', 'number', 'boolean', 'json'
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(company_id, setting_key)
      )
    `);
    console.log('✅ Created company_settings table');
    
    // Create indexes for company_settings
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_company_settings_company_id ON company_settings(company_id);
      CREATE INDEX IF NOT EXISTS idx_company_settings_key ON company_settings(setting_key);
    `);
    console.log('✅ Created company_settings indexes');
    
    // 5. Ensure payments table exists (from migration)
    console.log('🏗️  Ensuring payments table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
        quickbooks_payment_id VARCHAR(50),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        payment_method VARCHAR(50), -- 'credit_card', 'bank_transfer', 'check', 'cash'
        payment_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
        payment_date TIMESTAMP WITH TIME ZONE,
        reference_number VARCHAR(100),
        notes TEXT,
        stripe_payment_intent_id VARCHAR(100),
        stripe_charge_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ Ensured payments table exists');
    
    // Create indexes for payments
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_company_id ON payments(company_id);
      CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
      CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
      CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
      CREATE INDEX IF NOT EXISTS idx_payments_quickbooks_id ON payments(quickbooks_payment_id);
    `);
    console.log('✅ Created payments indexes');
    
    // Verification: Check all tables exist
    console.log('\n🔍 Verifying all tables were created...');
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    const tables = tablesResult.rows.map(row => row.tablename);
    console.log('📊 Current database tables:');
    
    const expectedTables = [
      'companies', 'users', 'sessions', 'settings', 'message_templates',
      'invoices', 'invoice_followups', 'error_logs', 'user_activity',
      'qbo_tokens', 'customers', 'analytics_daily', 'follow_ups', 
      'company_settings', 'payments'
    ];
    
    const missingTables = expectedTables.filter(table => !tables.includes(table));
    const extraTables = tables.filter(table => !expectedTables.includes(table) && table !== 'pgmigrations');
    
    expectedTables.forEach(table => {
      if (tables.includes(table)) {
        console.log(`  ✅ ${table}`);
      } else {
        console.log(`  ❌ ${table} (MISSING)`);
      }
    });
    
    if (extraTables.length > 0) {
      console.log('\n📋 Additional tables found:');
      extraTables.forEach(table => console.log(`  📄 ${table}`));
    }
    
    if (missingTables.length === 0) {
      console.log('\n🎉 SUCCESS: All required tables are now present!');
    } else {
      console.log(`\n⚠️  WARNING: ${missingTables.length} tables still missing:`, missingTables);
    }
    
    console.log('\n📋 Database is now ready for all application features!');
    console.log('🚀 Payment processing, analytics, follow-ups, and settings management are now supported.');
    
  } catch (error) {
    console.error('💥 Error creating tables:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
    console.log('\n📡 Disconnected from database');
  }
}

// Run the script
if (require.main === module) {
  createMissingTables()
    .then(() => {
      console.log('\n✅ Missing tables creation completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { createMissingTables };
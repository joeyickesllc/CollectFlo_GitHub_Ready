exports.up = async (pgm) => {
  // qbo_tokens
  const qboTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'qbo_tokens'
    ) AS exists;
  `);

  if (!qboTableExists.rows[0].exists) {
    pgm.createTable('qbo_tokens', {
      id: 'id',
      user_id: { type: 'integer', references: 'users(id)', onDelete: 'CASCADE' },
      encrypted_tokens: { type: 'text', notNull: true },
      iv: { type: 'text', notNull: true },
      auth_tag: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    }, { comment: 'Stores encrypted QuickBooks OAuth tokens for users' });

    // Align index names with route-created indexes to avoid duplicates
    pgm.createIndex('qbo_tokens', 'user_id', { name: 'idx_qbo_tokens_user_id' });
    pgm.createIndex('qbo_tokens', 'updated_at', { name: 'idx_qbo_tokens_updated_at' });
  } else {
    // Table exists; do not attempt to recreate or add potentially duplicate indexes
  }

  // customers
  const customersTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'customers'
    ) AS exists;
  `);
  if (!customersTableExists.rows[0].exists) {
    pgm.createTable('customers', {
      id: 'id',
      company_id: { type: 'integer', references: 'companies(id)', onDelete: 'CASCADE' },
      quickbooks_id: { type: 'varchar(50)' },
      name: { type: 'varchar(255)', notNull: true },
      email: { type: 'varchar(255)' },
      phone: { type: 'varchar(50)' },
      address_line1: { type: 'varchar(255)' },
      address_line2: { type: 'varchar(255)' },
      city: { type: 'varchar(100)' },
      state: { type: 'varchar(50)' },
      postal_code: { type: 'varchar(20)' },
      country: { type: 'varchar(50)', notNull: true, default: 'US' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
    pgm.addConstraint('customers', 'uq_customers_company_qbo', { unique: ['company_id', 'quickbooks_id'] });
    pgm.createIndex('customers', 'company_id', { ifNotExists: true });
    pgm.createIndex('customers', 'quickbooks_id', { ifNotExists: true });
    pgm.createIndex('customers', 'email', { ifNotExists: true });
  }

  // follow_ups
  const followUpsTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'follow_ups'
    ) AS exists;
  `);
  if (!followUpsTableExists.rows[0].exists) {
    pgm.createTable('follow_ups', {
      id: 'id',
      company_id: { type: 'integer' },
      customer_id: { type: 'varchar(50)' },
      invoice_id: { type: 'varchar(50)' },
      follow_up_type: { type: 'varchar(50)', notNull: true },
      status: { type: 'varchar(50)', notNull: true, default: 'pending' },
      scheduled_at: { type: 'timestamptz', notNull: true },
      sent_at: { type: 'timestamptz' },
      delivered_at: { type: 'timestamptz' },
      failed_at: { type: 'timestamptz' },
      error_message: { type: 'text' },
      message_content: { type: 'text' },
      template_id: { type: 'integer' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
    pgm.createIndex('follow_ups', 'company_id', { ifNotExists: true });
    pgm.createIndex('follow_ups', 'customer_id', { ifNotExists: true });
    pgm.createIndex('follow_ups', 'invoice_id', { ifNotExists: true });
    pgm.createIndex('follow_ups', 'status', { ifNotExists: true });
    pgm.createIndex('follow_ups', 'scheduled_at', { ifNotExists: true });
  }

  // company_settings
  const companySettingsTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'company_settings'
    ) AS exists;
  `);
  if (!companySettingsTableExists.rows[0].exists) {
    pgm.createTable('company_settings', {
      id: 'id',
      company_id: { type: 'integer', references: 'companies(id)', onDelete: 'CASCADE' },
      setting_key: { type: 'varchar(100)', notNull: true },
      setting_value: { type: 'text' },
      setting_type: { type: 'varchar(50)', notNull: true, default: 'string' },
      description: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
    pgm.addConstraint('company_settings', 'uq_company_settings_key', { unique: ['company_id', 'setting_key'] });
    pgm.createIndex('company_settings', 'company_id', { ifNotExists: true });
    pgm.createIndex('company_settings', 'setting_key', { ifNotExists: true });
  }

  // analytics_daily
  const analyticsDailyTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'analytics_daily'
    ) AS exists;
  `);
  if (!analyticsDailyTableExists.rows[0].exists) {
    pgm.createTable('analytics_daily', {
      id: 'id',
      date: { type: 'date', notNull: true },
      activity_type: { type: 'varchar(100)', notNull: true },
      count: { type: 'integer', notNull: true, default: 0 },
      company_id: { type: 'integer', references: 'companies(id)', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
    pgm.addConstraint('analytics_daily', 'uq_analytics_daily', { unique: ['date', 'activity_type', 'company_id'] });
    pgm.createIndex('analytics_daily', 'date', { ifNotExists: true });
    pgm.createIndex('analytics_daily', 'company_id', { ifNotExists: true });
    pgm.createIndex('analytics_daily', 'activity_type', { ifNotExists: true });
  }

  // payments
  const paymentsTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'payments'
    ) AS exists;
  `);
  if (!paymentsTableExists.rows[0].exists) {
    pgm.createTable('payments', {
      id: 'id',
      company_id: { type: 'integer', references: 'companies(id)', onDelete: 'CASCADE' },
      customer_id: { type: 'integer', references: 'customers(id)', onDelete: 'CASCADE' },
      invoice_id: { type: 'integer', references: 'invoices(id)', onDelete: 'CASCADE' },
      quickbooks_payment_id: { type: 'varchar(50)' },
      amount: { type: 'decimal(10,2)', notNull: true },
      currency: { type: 'varchar(3)', notNull: true, default: 'USD' },
      payment_method: { type: 'varchar(50)' },
      payment_status: { type: 'varchar(50)', notNull: true, default: 'pending' },
      payment_date: { type: 'timestamptz' },
      reference_number: { type: 'varchar(100)' },
      notes: { type: 'text' },
      stripe_payment_intent_id: { type: 'varchar(100)' },
      stripe_charge_id: { type: 'varchar(100)' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
    pgm.createIndex('payments', 'company_id', { ifNotExists: true });
    pgm.createIndex('payments', 'customer_id', { ifNotExists: true });
    pgm.createIndex('payments', 'invoice_id', { ifNotExists: true });
    pgm.createIndex('payments', 'payment_status', { ifNotExists: true });
    pgm.createIndex('payments', 'payment_date', { ifNotExists: true });
    pgm.createIndex('payments', 'quickbooks_payment_id', { ifNotExists: true });
  }
};

exports.down = async (pgm) => {
  pgm.dropTable('payments', { ifExists: true, cascade: true });
  pgm.dropTable('analytics_daily', { ifExists: true, cascade: true });
  pgm.dropTable('company_settings', { ifExists: true, cascade: true });
  pgm.dropTable('follow_ups', { ifExists: true, cascade: true });
  pgm.dropTable('customers', { ifExists: true, cascade: true });
  pgm.dropTable('qbo_tokens', { ifExists: true, cascade: true });
};
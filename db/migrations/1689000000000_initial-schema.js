/**
 * 1689000000000_initial-schema.js.simple
 *
 * Simplified initial database schema for the CollectFlo application.
 * Uses BIGSERIAL IDs instead of UUIDs to avoid dependency on extensions.
 * Sets up tables for users, companies, invoices, follow-ups,
 * message templates, settings, and error logs.
 */

exports.up = async (pgm) => {
  // 1. Companies Table
  pgm.createTable('companies', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    name: {
      type: 'VARCHAR(255)',
      notNull: true,
    },
    is_beta: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 2. Users Table
  pgm.createTable('users', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    name: {
      type: 'VARCHAR(255)',
      notNull: true,
    },
    email: {
      type: 'VARCHAR(255)',
      notNull: true,
      unique: true,
    },
    password: {
      type: 'TEXT', // Hashed password
      notNull: true,
    },
    company_id: {
      type: 'BIGINT',
      notNull: true,
      references: '"companies" (id)',
      onDelete: 'CASCADE',
    },
    role: {
      type: 'VARCHAR(50)',
      notNull: true,
      default: 'user',
    },
    is_beta: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 3. Sessions Table (for express-session if using a database store)
  pgm.createTable('sessions', {
    sid: {
      type: 'VARCHAR(255)',
      primaryKey: true,
    },
    sess: {
      type: 'JSONB',
      notNull: true,
    },
    expire: {
      type: 'TIMESTAMPTZ',
      notNull: true,
    },
  });

  // 4. Settings Table (for company-specific configurations)
  pgm.createTable('settings', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    company_id: {
      type: 'BIGINT',
      notNull: true,
      unique: true, // One settings entry per company
      references: '"companies" (id)',
      onDelete: 'CASCADE',
    },
    qbo_access_token: {
      type: 'TEXT',
    },
    qbo_refresh_token: {
      type: 'TEXT',
    },
    qbo_realm_id: {
      type: 'VARCHAR(255)',
    },
    qbo_token_expiry: {
      type: 'TIMESTAMPTZ',
    },
    logo_url: {
      type: 'TEXT',
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 5. Message Templates Table
  pgm.createTable('message_templates', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    company_id: {
      type: 'BIGINT',
      references: '"companies" (id)',
      onDelete: 'CASCADE',
      // Nullable if it's a global template
    },
    name: {
      type: 'VARCHAR(255)',
      notNull: true,
    },
    type: {
      type: 'VARCHAR(50)', // 'email' or 'sms'
      notNull: true,
    },
    subject: {
      type: 'TEXT', // For email templates
    },
    body: {
      type: 'TEXT',
      notNull: true,
    },
    day_offset: {
      type: 'INTEGER', // e.g., 0 for due date, 7 for 7 days overdue
      notNull: true,
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Add unique constraint for company_id, name, type, day_offset
  pgm.addConstraint('message_templates', 'unique_template_per_company_and_day', {
    unique: ['company_id', 'name', 'type', 'day_offset'],
  });

  // 6. Invoices Table
  pgm.createTable('invoices', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    company_id: {
      type: 'BIGINT',
      notNull: true,
      references: '"companies" (id)',
      onDelete: 'CASCADE',
    },
    qbo_invoice_id: {
      type: 'VARCHAR(255)', // ID from QuickBooks Online
      notNull: true,
    },
    customer_name: {
      type: 'VARCHAR(255)',
      notNull: true,
    },
    customer_email: {
      type: 'VARCHAR(255)',
      notNull: true,
    },
    amount: {
      type: 'DECIMAL(10, 2)',
      notNull: true,
    },
    due_date: {
      type: 'DATE',
      notNull: true,
    },
    status: {
      type: 'VARCHAR(50)', // e.g., 'outstanding', 'paid', 'overdue', 'partially_paid'
      notNull: true,
      default: 'outstanding',
    },
    last_followup_date: {
      type: 'TIMESTAMPTZ',
    },
    is_excluded: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Add unique constraint for qbo_invoice_id per company
  pgm.addConstraint('invoices', 'unique_qbo_invoice_per_company', {
    unique: ['company_id', 'qbo_invoice_id'],
  });

  // 7. Invoice Follow-ups Table
  pgm.createTable('invoice_followups', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    invoice_id: {
      type: 'BIGINT',
      notNull: true,
      references: '"invoices" (id)',
      onDelete: 'CASCADE',
    },
    type: {
      type: 'VARCHAR(50)', // 'email' or 'sms'
      notNull: true,
    },
    template_id: {
      type: 'BIGINT',
      references: '"message_templates" (id)',
      onDelete: 'SET NULL', // If template is deleted, keep record but nullify template_id
    },
    sent_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    status: {
      type: 'VARCHAR(50)', // e.g., 'sent', 'delivered', 'failed', 'opened', 'clicked'
      notNull: true,
      default: 'sent',
    },
    response_data: {
      type: 'JSONB', // Store raw response from SendGrid/Twilio
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 8. Error Logs Table
  pgm.createTable('error_logs', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    level: {
      type: 'VARCHAR(50)', // 'error', 'warn', 'info', 'debug'
      notNull: true,
    },
    message: {
      type: 'TEXT',
      notNull: true,
    },
    stack: {
      type: 'TEXT',
    },
    meta: {
      type: 'JSONB', // Additional context (e.g., requestId, userId, route)
    },
    timestamp: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // 9. User Activity Log (for beta stats and general user tracking)
  pgm.createTable('user_activity', {
    id: {
      type: 'BIGSERIAL',
      primaryKey: true,
    },
    user_id: {
      type: 'BIGINT',
      references: '"users" (id)',
      onDelete: 'CASCADE',
    },
    activity_type: {
      type: 'VARCHAR(255)', // e.g., 'login', 'view_dashboard', 'update_settings', 'send_followup'
      notNull: true,
    },
    details: {
      type: 'JSONB', // Additional details about the activity
    },
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });
};

exports.down = async (pgm) => {
  // Drop tables in reverse order of creation to handle foreign key dependencies
  pgm.dropTable('user_activity');
  pgm.dropTable('error_logs');
  pgm.dropTable('invoice_followups');
  pgm.dropTable('invoices');
  pgm.dropTable('message_templates');
  pgm.dropTable('settings');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
  pgm.dropTable('companies');
};

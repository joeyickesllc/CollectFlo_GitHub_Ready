/**
 * Migration: Create Payments Table
 * 
 * Creates the payments table to track invoice payment transactions.
 * This table stores payment attempts, their status, and related metadata.
 */

exports.up = pgm => {
  // Create payment status enum type
  pgm.createType('payment_status', [
    'pending',    // Payment initiated but not completed
    'completed',  // Payment successfully processed
    'failed',     // Payment attempt failed
    'expired',    // Payment link/attempt expired
    'refunded',   // Payment was refunded
    'cancelled'   // Payment was cancelled
  ]);

  // Create payment method enum type
  pgm.createType('payment_method', [
    'credit_card',
    'bank_transfer',
    'paypal',
    'stripe',
    'other'
  ]);

  // Create payments table
  pgm.createTable('payments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    invoice_id: {
      type: 'uuid',
      notNull: true,
      references: 'invoices(id)',
      onDelete: 'CASCADE'
    },
    customer_id: {
      type: 'uuid',
      references: 'customers(id)',
      onDelete: 'SET NULL'
    },
    amount: {
      type: 'numeric(10,2)',
      notNull: true
    },
    currency: {
      type: 'varchar(3)',
      notNull: true,
      default: 'USD'
    },
    status: {
      type: 'payment_status',
      notNull: true,
      default: 'pending'
    },
    payment_method: {
      type: 'payment_method',
      default: null
    },
    transaction_id: {
      type: 'varchar(255)',
      comment: 'External payment processor transaction ID'
    },
    payment_link: {
      type: 'varchar(255)',
      comment: 'URL for payment page'
    },
    payment_date: {
      type: 'timestamp',
      comment: 'When payment was completed'
    },
    metadata: {
      type: 'jsonb',
      default: '{}'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('NOW()')
    }
  }, {
    comment: 'Stores payment transactions for invoices'
  });

  // Add indexes for common queries
  pgm.createIndex('payments', 'invoice_id');
  pgm.createIndex('payments', 'customer_id');
  pgm.createIndex('payments', 'status');
  pgm.createIndex('payments', 'created_at');
  
  // Add trigger to automatically update the updated_at column
  pgm.createFunction(
    'update_updated_at_column',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
    },
    `
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    `
  );
  
  pgm.createTrigger(
    'payments',
    'update_updated_at_trigger',
    {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'update_updated_at_column',
    }
  );
};

exports.down = pgm => {
  // Drop trigger and function
  pgm.dropTrigger('payments', 'update_updated_at_trigger', { ifExists: true });
  pgm.dropFunction('update_updated_at_column', [], { ifExists: true });
  
  // Drop table
  pgm.dropTable('payments', { ifExists: true, cascade: true });
  
  // Drop custom types
  pgm.dropType('payment_status', { ifExists: true, cascade: true });
  pgm.dropType('payment_method', { ifExists: true, cascade: true });
};

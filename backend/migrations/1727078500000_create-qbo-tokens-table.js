/**
 * Migration: Create QBO Tokens Table
 * 
 * Creates a table for storing encrypted QuickBooks OAuth tokens with user association.
 */

exports.up = pgm => {
  pgm.createTable('qbo_tokens', {
    id: {
      type: 'serial',
      primaryKey: true
    },
    user_id: {
      type: 'integer',
      references: 'users(id)',
      onDelete: 'CASCADE',
      nullable: true
    },
    encrypted_tokens: {
      type: 'text',
      notNull: true,
      comment: 'Encrypted QuickBooks OAuth tokens'
    },
    iv: {
      type: 'text',
      notNull: true,
      comment: 'Initialization vector for AES-GCM encryption'
    },
    auth_tag: {
      type: 'text',
      notNull: true,
      comment: 'Authentication tag for AES-GCM encryption'
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  }, {
    comment: 'Stores encrypted QuickBooks OAuth tokens for users'
  });

  // Add index on user_id for faster lookups
  pgm.createIndex('qbo_tokens', 'user_id');
  
  // Add index on updated_at for sorting by most recent tokens
  pgm.createIndex('qbo_tokens', 'updated_at');
};

exports.down = pgm => {
  pgm.dropTable('qbo_tokens');
};

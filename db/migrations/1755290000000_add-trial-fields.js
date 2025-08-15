/**
 * 1755290000000_add-trial-fields.js
 *
 * Adds trial and subscription related fields to the users table
 * to support 14-day free trial functionality.
 */

exports.up = async (pgm) => {
  // Add trial and subscription fields to users table
  pgm.addColumns('users', {
    subscription_status: {
      type: 'VARCHAR(50)',
      notNull: true,
      default: 'trial', // 'trial', 'active', 'expired', 'cancelled'
    },
    trial_start_date: {
      type: 'TIMESTAMPTZ',
      notNull: false, // Will be set on first login/signup
    },
    trial_end_date: {
      type: 'TIMESTAMPTZ',
      notNull: false, // Will be calculated as trial_start_date + 14 days
    },
    subscription_start_date: {
      type: 'TIMESTAMPTZ',
      notNull: false, // Set when user upgrades from trial
    },
    last_trial_check: {
      type: 'TIMESTAMPTZ',
      notNull: false, // For optimization - track when we last checked trial status
    },
    stripe_subscription_id: {
      type: 'VARCHAR(255)',
      notNull: false, // Stripe subscription ID for active subscribers
    }
  });

  // Add index on subscription_status for faster queries
  pgm.createIndex('users', ['subscription_status'], {
    name: 'users_subscription_status_idx'
  });

  // Add index on trial_end_date for efficient trial expiration checks
  pgm.createIndex('users', ['trial_end_date'], {
    name: 'users_trial_end_date_idx'
  });
};

exports.down = async (pgm) => {
  // Drop indexes first
  pgm.dropIndex('users', ['trial_end_date'], {
    name: 'users_trial_end_date_idx'
  });
  
  pgm.dropIndex('users', ['subscription_status'], {
    name: 'users_subscription_status_idx'
  });

  // Drop columns
  pgm.dropColumns('users', [
    'subscription_status',
    'trial_start_date', 
    'trial_end_date',
    'subscription_start_date',
    'last_trial_check',
    'stripe_subscription_id'
  ]);
};
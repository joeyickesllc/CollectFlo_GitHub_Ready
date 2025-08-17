#!/usr/bin/env node
/**
 * Admin User Creation Script
 * 
 * Creates an admin user for accessing the beta stats dashboard and admin functions.
 * Usage: node scripts/create-admin.js <email> <password> <name> [company_name]
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../backend/db/connection');

async function createAdmin() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
      console.log('Usage: node scripts/create-admin.js <email> <password> <name> [company_name]');
      console.log('Example: node scripts/create-admin.js admin@collectflo.com adminpass123 "Admin User" "CollectFlo Admin"');
      process.exit(1);
    }

    const [email, password, name, companyName = 'CollectFlo Admin'] = args;

    // Validate inputs
    if (password.length < 8) {
      console.error('Error: Password must be at least 8 characters long');
      process.exit(1);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('Error: Invalid email format');
      process.exit(1);
    }

    console.log('Creating admin user...');
    console.log(`Email: ${email}`);
    console.log(`Name: ${name}`);
    console.log(`Company: ${companyName}`);

    // Check if user already exists
    const existingUser = await db.queryOne('SELECT email FROM users WHERE email = $1', [email]);
    if (existingUser) {
      console.error(`Error: User with email ${email} already exists`);
      process.exit(1);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user in transaction
    const result = await db.transaction(async (client) => {
      // Create company
      const companyResult = await client.query(
        'INSERT INTO companies (name, created_at, is_beta) VALUES ($1, NOW(), true) RETURNING id',
        [companyName]
      );
      const companyId = companyResult.rows[0].id;

      // Create admin user with active subscription (no trial limitations)
      const trialStartDate = new Date();
      const trialEndDate = new Date(trialStartDate.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year from now
      
      const userResult = await client.query(
        `INSERT INTO users 
         (name, email, password, company_id, role, is_beta, subscription_status, trial_start_date, trial_end_date, subscription_start_date, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         RETURNING id, email, name, role, subscription_status`,
        [name, email, hashedPassword, companyId, 'admin', true, 'active', trialStartDate, trialEndDate, new Date()]
      );

      return {
        user: userResult.rows[0],
        companyId
      };
    });

    console.log('✅ Admin user created successfully!');
    console.log('User Details:');
    console.log(`  ID: ${result.user.id}`);
    console.log(`  Email: ${result.user.email}`);
    console.log(`  Name: ${result.user.name}`);
    console.log(`  Role: ${result.user.role}`);
    console.log(`  Subscription: ${result.user.subscription_status}`);
    console.log(`  Company ID: ${result.companyId}`);
    console.log('');
    console.log('🎯 Admin Access:');
    console.log(`  Login at: https://collectflo.com/login`);
    console.log(`  Beta Stats: https://collectflo.com/beta-stats.html`);
    console.log(`  Dashboard: https://collectflo.com/dashboard`);

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  } finally {
    // Close database connection
    await db.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Interrupted. Cleaning up...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⏹️  Terminated. Cleaning up...');
  await db.close();
  process.exit(0);
});

// Run the script
createAdmin();
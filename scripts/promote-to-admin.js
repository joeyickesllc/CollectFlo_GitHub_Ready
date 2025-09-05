#!/usr/bin/env node
/**
 * Promote User to Admin Script
 * 
 * Finds a user by email and promotes them to admin role with active subscription
 * Usage: node scripts/promote-to-admin.js <email>
 */

require('dotenv').config();
const db = require('../backend/db/connection');

async function promoteToAdmin() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.log('Usage: node scripts/promote-to-admin.js <email>');
      console.log('Example: node scripts/promote-to-admin.js admin@collectflo.com');
      process.exit(1);
    }

    const [email] = args;

    console.log(`Looking for user with email: ${email}`);

    // Find the user
    const user = await db.queryOne('SELECT id, name, email, role, subscription_status FROM users WHERE email = $1', [email]);
    
    if (!user) {
      console.error(`❌ No user found with email: ${email}`);
      console.log('Please make sure the user has signed up first at: https://www.collectflo.com/signup');
      process.exit(1);
    }

    console.log('Current user details:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Subscription: ${user.subscription_status || 'trial'}`);

    if (user.role === 'admin') {
      console.log('✅ User is already an admin!');
      process.exit(0);
    }

    // Promote to admin with active subscription
    await db.execute(
      `UPDATE users SET 
        role = $1, 
        subscription_status = $2,
        subscription_start_date = $3,
        trial_end_date = $4
       WHERE id = $5`,
      ['admin', 'active', new Date(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), user.id]
    );

    console.log('✅ User promoted to admin successfully!');
    console.log('Updated details:');
    console.log(`  Role: admin`);
    console.log(`  Subscription: active (no trial limits)`);
    console.log(`  Trial End: 1 year from now`);
    console.log('');
    console.log('🎯 Admin Access:');
    console.log(`  Login: https://www.collectflo.com/login`);
    console.log(`  Admin Dashboard: https://www.collectflo.com/admin`);
    console.log(`  Beta Stats: https://www.collectflo.com/beta-stats.html`);

  } catch (error) {
    // Handle cases where trial fields don't exist yet
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.log('⚠️  Trial fields not in database yet, using basic admin promotion...');
      
      try {
        const [email] = process.argv.slice(2);
        await db.execute('UPDATE users SET role = $1 WHERE email = $2', ['admin', email]);
        console.log('✅ User promoted to admin (basic mode)!');
      } catch (basicError) {
        console.error('❌ Error with basic promotion:', basicError.message);
        process.exit(1);
      }
    } else {
      console.error('❌ Error promoting user:', error.message);
      process.exit(1);
    }
  } finally {
    await db.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Interrupted. Cleaning up...');
  await db.close();
  process.exit(0);
});

// Run the script
promoteToAdmin();
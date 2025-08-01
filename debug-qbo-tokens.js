/**
 * Debug QuickBooks OAuth tokens
 * This script helps diagnose QBO API 403 errors by checking token validity and configuration
 */

require('dotenv').config();
const { getValidTokens } = require('./services/tokenStore');
const logger = require('./backend/services/logger');

async function debugQBOTokens() {
  try {
    // Test user ID 3 (from the logs)
    const userId = 3;
    
    console.log('🔍 Debugging QuickBooks OAuth tokens...\n');
    
    // Get tokens from database
    const tokens = await getValidTokens(userId);
    
    if (!tokens) {
      console.log('❌ No tokens found for user', userId);
      return;
    }
    
    console.log('✅ Tokens retrieved successfully');
    console.log('📊 Token Analysis:');
    console.log('  - Access Token:', tokens.access_token ? `${tokens.access_token.substring(0, 10)}...` : 'MISSING');
    console.log('  - Refresh Token:', tokens.refresh_token ? `${tokens.refresh_token.substring(0, 10)}...` : 'MISSING');
    console.log('  - Realm ID:', tokens.realmId || 'MISSING');
    console.log('  - Connected At:', tokens.connected_at || 'UNKNOWN');
    console.log('  - Expires In:', tokens.expires_in || 'UNKNOWN', 'seconds');
    
    // Check token expiration
    if (tokens.connected_at) {
      const connectedAt = new Date(tokens.connected_at);
      const expiresIn = tokens.expires_in || 3600;
      const expirationTime = new Date(connectedAt.getTime() + (expiresIn * 1000));
      const now = new Date();
      const isExpired = now >= expirationTime;
      const timeLeft = expirationTime - now;
      
      console.log('\n⏰ Token Expiration Analysis:');
      console.log('  - Token Created:', connectedAt.toISOString());
      console.log('  - Token Expires:', expirationTime.toISOString());
      console.log('  - Current Time:', now.toISOString());
      console.log('  - Is Expired:', isExpired ? '❌ YES' : '✅ NO');
      
      if (!isExpired) {
        console.log('  - Time Remaining:', Math.floor(timeLeft / 60000), 'minutes');
      }
    }
    
    // Show expected QBO environment settings
    console.log('\n🔧 Expected Environment Configuration:');
    console.log('  - QBO_ENVIRONMENT should be set to "sandbox" or "production"');
    console.log('  - QBO_CLIENT_ID should be your app\'s Client ID');
    console.log('  - QBO_CLIENT_SECRET should be your app\'s Client Secret');  
    console.log('  - QBO_REDIRECT_URI should match your app\'s redirect URI');
    
    console.log('\n💡 Common 403 Error Causes:');
    console.log('  1. Token expired (most common)');
    console.log('  2. Environment mismatch (sandbox tokens vs production API)');
    console.log('  3. Insufficient OAuth scopes');
    console.log('  4. QuickBooks app authorization revoked by user');
    console.log('  5. Incorrect realm ID');
    
    console.log('\n🚀 Next Steps:');
    if (tokens.connected_at) {
      const connectedAt = new Date(tokens.connected_at);
      const expiresIn = tokens.expires_in || 3600;
      const expirationTime = new Date(connectedAt.getTime() + (expiresIn * 1000));
      const now = new Date();
      
      if (now >= expirationTime) {
        console.log('  1. ❗ Token is EXPIRED - Need to refresh using refresh_token');
        console.log('  2. Try the "Reconnect QuickBooks" button in Settings');
      } else {
        console.log('  1. ✅ Token is still valid - 403 error likely due to environment mismatch');
        console.log('  2. Check if QBO_ENVIRONMENT matches the token source (sandbox vs production)');
      }
    }
    
  } catch (error) {
    console.error('❌ Error debugging tokens:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the debug
debugQBOTokens().then(() => {
  console.log('\n🏁 Debug complete');
  process.exit(0);
}).catch(error => {
  console.error('💥 Debug failed:', error);
  process.exit(1);
});
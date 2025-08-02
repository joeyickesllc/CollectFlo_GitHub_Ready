/**
 * Debug QuickBooks 403 API Error
 * Investigates why the QBO API continues to return 403 after successful OAuth
 */

require('dotenv').config();
const { getValidTokens } = require('./services/tokenStore');
const secrets = require('./backend/config/secrets');
const axios = require('axios');

async function debugQBO403() {
  try {
    console.log('🔍 Debugging QuickBooks 403 API Error...\n');
    
    const userId = 3; // Your user ID
    
    // Step 1: Check if tokens exist and can be retrieved
    console.log('📋 Step 1: Checking token retrieval...');
    const tokens = await getValidTokens(userId);
    
    if (!tokens) {
      console.log('❌ No tokens found - OAuth may have failed');
      return;
    }
    
    console.log('✅ Tokens retrieved successfully');
    console.log('📊 Token details:');
    console.log('  - Access Token:', tokens.access_token ? `${tokens.access_token.substring(0, 20)}...` : 'MISSING');
    console.log('  - Refresh Token:', tokens.refresh_token ? `${tokens.refresh_token.substring(0, 20)}...` : 'MISSING');
    console.log('  - Realm ID:', tokens.realmId || 'MISSING');
    console.log('  - Connected At:', tokens.connected_at || 'UNKNOWN');
    console.log('  - Token Type:', tokens.token_type || 'UNKNOWN');
    console.log('  - Expires In:', tokens.expires_in || 'UNKNOWN', 'seconds');
    
    // Step 2: Check token expiration
    console.log('\n⏰ Step 2: Checking token expiration...');
    if (tokens.connected_at) {
      const connectedAt = new Date(tokens.connected_at);
      const expiresIn = tokens.expires_in || 3600;
      const expirationTime = new Date(connectedAt.getTime() + (expiresIn * 1000));
      const now = new Date();
      const isExpired = now >= expirationTime;
      
      console.log('  - Token Created:', connectedAt.toISOString());
      console.log('  - Token Expires:', expirationTime.toISOString());
      console.log('  - Current Time:', now.toISOString());
      console.log('  - Is Expired:', isExpired ? '❌ YES' : '✅ NO');
      
      if (isExpired) {
        console.log('⚠️  Token is EXPIRED - this explains the 403 error');
        return;
      }
    }
    
    // Step 3: Check environment configuration
    console.log('\n🔧 Step 3: Checking environment configuration...');
    console.log('  - QBO Environment:', process.env.QBO_ENVIRONMENT || 'NOT SET');
    console.log('  - Expected:', 'production (for production QB company)');
    
    // Step 4: Determine correct API URL
    const environment = process.env.QBO_ENVIRONMENT || 'sandbox';
    const apiBaseUrl = environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company/'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
    
    console.log('  - API Base URL:', apiBaseUrl);
    console.log('  - Full URL:', `${apiBaseUrl}${tokens.realmId}/companyinfo/${tokens.realmId}`);
    
    // Step 5: Test the API call manually
    console.log('\n🧪 Step 5: Testing QuickBooks API call...');
    
    try {
      const response = await axios.get(
        `${apiBaseUrl}${tokens.realmId}/companyinfo/${tokens.realmId}`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      console.log('✅ API call successful!');
      console.log('📊 Response status:', response.status);
      console.log('📊 Company info:', response.data.QueryResponse?.CompanyInfo?.[0]?.CompanyName || 'Company name not found');
      
    } catch (apiError) {
      console.log('❌ API call failed');
      console.log('📊 Status:', apiError.response?.status);
      console.log('📊 Status Text:', apiError.response?.statusText);
      console.log('📊 Error Details:', JSON.stringify(apiError.response?.data, null, 2));
      
      // Analyze the specific error
      if (apiError.response?.status === 403) {
        const errorData = apiError.response.data;
        if (errorData?.fault?.error?.[0]?.code === '3100') {
          console.log('\n🔍 Error Analysis:');
          console.log('  - Error Code 3100: ApplicationAuthorizationFailed');
          console.log('  - This typically means:');
          console.log('    1. Token is for different environment (sandbox vs production)');
          console.log('    2. App lacks required permissions/scopes');
          console.log('    3. QuickBooks company revoked app access');
          console.log('    4. Realm ID doesn\'t match the token');
        }
      }
    }
    
    // Step 6: Environment analysis
    console.log('\n🎯 Step 6: Environment Analysis...');
    console.log('Your realm ID:', tokens.realmId);
    console.log('Realm ID type:', tokens.realmId && tokens.realmId.toString().length > 10 ? 'Production format' : 'Sandbox format');
    
    if (environment === 'sandbox' && apiBaseUrl.includes('sandbox')) {
      console.log('✅ Using sandbox API with sandbox environment');
    } else if (environment === 'production' && !apiBaseUrl.includes('sandbox')) {
      console.log('✅ Using production API with production environment');
    } else {
      console.log('❌ MISMATCH: Environment and API URL don\'t match');
    }
    
    console.log('\n💡 Recommendations:');
    console.log('1. If realm ID is from production QB, set QBO_ENVIRONMENT=production');
    console.log('2. If realm ID is from sandbox QB, set QBO_ENVIRONMENT=sandbox');
    console.log('3. Make sure to reconnect QB after changing environment');
    console.log('4. Verify your QB app has the right scopes enabled');
    
  } catch (error) {
    console.error('💥 Debug failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

debugQBO403();
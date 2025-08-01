const axios = require('axios');
const { saveTokens, getTokens } = require('./tokenStore');
const secrets = require('../backend/config/secrets');

async function refreshAccessToken(userId) {
  if (!userId) {
    throw new Error('User ID is required for token refresh');
  }

  const tokens = await getTokens(userId);
  
  if (!tokens || !tokens.refresh_token) {
    throw new Error('No refresh token available. Please reconnect to QuickBooks.');
  }
  
  try {
    const response = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token
      }),
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${secrets.qbo.clientId}:${secrets.qbo.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const newTokens = {
      ...tokens,
      ...response.data,
      refreshed_at: new Date().toISOString()
    };
    
    await saveTokens(newTokens, userId);
    return newTokens;
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data);
    throw new Error('Failed to refresh access token. Please reconnect to QuickBooks.');
  }
}

module.exports = { refreshAccessToken };

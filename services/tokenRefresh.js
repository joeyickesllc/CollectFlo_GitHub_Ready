
const axios = require('axios');
<<<<<<< HEAD
const { saveTokens, getTokens } = require('./tokenStore');
=======
const { saveTokens, getTokens } = require('../tokenstore');
>>>>>>> 54a0db131b87d99dd424663ed5c47ac915410d7c

async function refreshAccessToken() {
  const tokens = getTokens();
  
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
          'Authorization': `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const newTokens = {
      ...tokens,
      ...response.data,
      refreshed_at: new Date().toISOString()
    };
    
    saveTokens(newTokens);
    return newTokens;
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data);
    throw new Error('Failed to refresh access token. Please reconnect to QuickBooks.');
  }
}

module.exports = { refreshAccessToken };


const axios = require('axios');
<<<<<<< HEAD
const { getTokens } = require('./tokenStore');
const db = require('../backend/db/connection');
=======
const { getTokens } = require('../tokenstore');
const db = require('../database.js');
>>>>>>> 54a0db131b87d99dd424663ed5c47ac915410d7c

const QBO_API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://quickbooks.api.intuit.com/v3/company'
  : 'https://sandbox-quickbooks.api.intuit.com/v3/company';

// Rate limiting configuration
const MAX_REQUESTS_PER_MINUTE = 30;
let requestCount = 0;
let lastResetTime = Date.now();

function checkRateLimit() {
  const now = Date.now();
  if (now - lastResetTime >= 60000) {
    requestCount = 0;
    lastResetTime = now;
  }
  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }
  requestCount++;
}

async function logError(error, context) {
<<<<<<< HEAD
  try {
    await db.query(
      `INSERT INTO error_logs (error_message, error_stack, context)
       VALUES ($1, $2, $3)`,
      [error.message, error.stack, JSON.stringify(context)]
    );
  } catch (e) {
    // Failing to record an error should never crash the flow
    // eslint-disable-next-line no-console
    console.error('Failed to record error log', e);
  }
}

async function makeQBORequest(endpoint, params = {}, userId = null) {
  const tokens = await getTokens(userId);
=======
  db.prepare(`
    INSERT INTO error_logs (error_message, error_stack, context, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(error.message, error.stack, JSON.stringify(context));
}

async function makeQBORequest(endpoint, params = {}, userId = null) {
  const tokens = getTokens(userId);
>>>>>>> 54a0db131b87d99dd424663ed5c47ac915410d7c
  if (!tokens?.access_token || !tokens?.realmId) {
    throw new Error('QuickBooks not connected. Please connect your QuickBooks account first.');
  }

  checkRateLimit();

  try {
    const response = await axios.get(
      `${QBO_API_BASE}/${tokens.realmId}${endpoint}`,
      {
        params,
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    await logError(error, { endpoint, params });
    
    // Try to refresh token on 401 error
    if (error.response?.status === 401) {
      try {
        const { refreshAccessToken } = require('./tokenRefresh');
        await refreshAccessToken();
        
        // Retry the request with new token
<<<<<<< HEAD
        const newTokens = await getTokens(userId);
=======
        const newTokens = getTokens();
>>>>>>> 54a0db131b87d99dd424663ed5c47ac915410d7c
        const retryResponse = await axios.get(
          `${QBO_API_BASE}/${newTokens.realmId}${endpoint}`,
          {
            params,
            headers: {
              'Authorization': `Bearer ${newTokens.access_token}`,
              'Accept': 'application/json'
            }
          }
        );
        return retryResponse.data;
      } catch (refreshError) {
        throw new Error('QBO authentication expired. Please reconnect.');
      }
    }
    
    if (error.response?.status === 429) {
      throw new Error('QuickBooks API rate limit exceeded.');
    }
    throw new Error(`QuickBooks API error: ${error.message}`);
  }
}

async function getInvoices(userId = null) {
  const response = await makeQBORequest('/query', {
    query: `SELECT * FROM Invoice WHERE Balance > '0' ORDER BY DueDate`
  }, userId);
  return response.QueryResponse?.Invoice || [];
}

async function getCustomer(customerId, userId = null) {
  const response = await makeQBORequest(`/customer/${customerId}`, {}, userId);
  return response.QueryResponse?.Customer?.[0] || response.Customer;
}

async function checkPaymentStatus(invoiceId) {
  const response = await makeQBORequest(`/invoice/${invoiceId}`);
  return response.Invoice.Balance === 0;
}

// Create payment link for QuickBooks invoice
async function createPaymentLink(invoiceId, amount) {
  const tokens = getTokens();
  if (!tokens || !tokens.access_token) {
    throw new Error('No valid QuickBooks tokens available');
  }

  try {
    // For QuickBooks, we'll create a direct payment URL
    // This assumes you have QuickBooks Payments enabled
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://collectflo.com' 
      : 'https://follow-up-flow-joeyickesllc.replit.app';
    
    // Create a secure payment URL that redirects to QuickBooks payment portal
    const paymentUrl = `${baseUrl}/qbo-payment?invoice=${invoiceId}&amount=${amount}`;
    
    return paymentUrl;
  } catch (error) {
    console.error('Error creating payment link:', error);
    throw error;
  }
}

module.exports = {
  getInvoices,
  getCustomer,
  checkPaymentStatus,
  createPaymentLink
};

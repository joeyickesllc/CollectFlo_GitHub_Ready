/**
 * Payment Link Service
 * Generates secure payment links for QuickBooks invoices
 */

const axios = require('axios');
const { getValidTokens } = require('./tokenStore');
const secrets = require('../backend/config/secrets');
const logger = require('../backend/services/logger');

/**
 * Generate QuickBooks payment link for an invoice
 * @param {string} invoiceId - QuickBooks invoice ID
 * @param {number} userId - User ID for token lookup
 * @returns {string} Payment link URL
 */
async function generateQuickBooksPaymentLink(invoiceId, userId) {
  try {
    // Get QuickBooks tokens
    const tokens = await getValidTokens(userId);
    if (!tokens || !tokens.access_token) {
      throw new Error('QuickBooks tokens not available');
    }

    // Determine API URL
    const apiBaseUrl = secrets.qbo.environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company/'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';

    // First, get the invoice details to ensure it exists
    const invoiceResponse = await axios.get(
      `${apiBaseUrl}${tokens.realmId}/query?query=SELECT * FROM Invoice WHERE Id = '${invoiceId}'`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    const invoices = invoiceResponse.data.QueryResponse?.Invoice || [];
    if (invoices.length === 0) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    const invoice = invoices[0];

    // QuickBooks provides a direct customer payment portal URL
    // Format: https://c{realmId}.qbo.intuit.com/qbo{realmId}/CustomerPortal.htm?invoiceId={invoiceId}
    let paymentUrl;
    
    if (secrets.qbo.environment === 'production') {
      // Production QuickBooks payment portal
      paymentUrl = `https://c${tokens.realmId}.qbo.intuit.com/qbo${tokens.realmId}/CustomerPortal.htm?invoiceId=${invoiceId}`;
    } else {
      // Sandbox QuickBooks payment portal
      paymentUrl = `https://c${tokens.realmId}.sandbox-qbo.intuit.com/qbo${tokens.realmId}/CustomerPortal.htm?invoiceId=${invoiceId}`;
    }

    logger.info('Generated QuickBooks payment link', {
      invoiceId,
      userId,
      environment: secrets.qbo.environment,
      paymentUrl
    });

    return {
      paymentUrl,
      invoiceNumber: invoice.DocNumber || invoiceId,
      amount: parseFloat(invoice.Balance || invoice.TotalAmt || 0),
      customerName: invoice.CustomerRef?.name || 'Customer',
      dueDate: invoice.DueDate
    };

  } catch (error) {
    logger.error('Error generating QuickBooks payment link', {
      error: error.message,
      invoiceId,
      userId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Generate a CollectFlo-hosted payment link (alternative approach)
 * @param {string} invoiceId - QuickBooks invoice ID  
 * @param {number} userId - User ID
 * @returns {string} CollectFlo payment link
 */
async function generateCollectFloPaymentLink(invoiceId, userId) {
  try {
    // Generate a secure payment token
    const paymentToken = generateSecureToken(invoiceId, userId);
    
    // Create CollectFlo payment URL
    const baseUrl = secrets.app.appUrl || 'https://your-collectflo-domain.com';
    const paymentUrl = `${baseUrl}/pay/${paymentToken}`;

    logger.info('Generated CollectFlo payment link', {
      invoiceId,
      userId,
      paymentUrl
    });

    return {
      paymentUrl,
      paymentToken
    };

  } catch (error) {
    logger.error('Error generating CollectFlo payment link', {
      error: error.message,
      invoiceId,
      userId
    });
    throw error;
  }
}

/**
 * Generate secure token for payment links
 * @param {string} invoiceId - Invoice ID
 * @param {number} userId - User ID
 * @returns {string} Secure token
 */
function generateSecureToken(invoiceId, userId) {
  const crypto = require('crypto');
  const data = `${invoiceId}-${userId}-${Date.now()}`;
  return crypto.createHash('sha256').update(data + secrets.app.sessionSecret).digest('hex');
}

/**
 * Get invoice payment status from QuickBooks
 * @param {string} invoiceId - QuickBooks invoice ID
 * @param {number} userId - User ID for token lookup
 * @returns {Object} Payment status information
 */
async function getInvoicePaymentStatus(invoiceId, userId) {
  try {
    const tokens = await getValidTokens(userId);
    if (!tokens || !tokens.access_token) {
      throw new Error('QuickBooks tokens not available');
    }

    const apiBaseUrl = secrets.qbo.environment === 'production'
      ? 'https://quickbooks.api.intuit.com/v3/company/'
      : 'https://sandbox-quickbooks.api.intuit.com/v3/company/';

    // Get current invoice status
    const response = await axios.get(
      `${apiBaseUrl}${tokens.realmId}/query?query=SELECT Balance, TotalAmt FROM Invoice WHERE Id = '${invoiceId}'`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    const invoices = response.data.QueryResponse?.Invoice || [];
    if (invoices.length === 0) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    const invoice = invoices[0];
    const balance = parseFloat(invoice.Balance || 0);
    const total = parseFloat(invoice.TotalAmt || 0);
    const paid = total - balance;

    return {
      invoiceId,
      totalAmount: total,
      paidAmount: paid,
      balance: balance,
      isPaid: balance <= 0,
      paymentStatus: balance <= 0 ? 'paid' : balance < total ? 'partial' : 'unpaid'
    };

  } catch (error) {
    logger.error('Error getting invoice payment status', {
      error: error.message,
      invoiceId,
      userId
    });
    throw error;
  }
}

/**
 * Format payment link for email/SMS templates
 * @param {string|Object} paymentLink - Payment link URL or object with details
 * @returns {string} Formatted payment link
 */
function formatPaymentLinkForCommunication(paymentLink) {
  if (typeof paymentLink === 'string') {
    return paymentLink;
  }
  
  return paymentLink.paymentUrl || paymentLink;
}

module.exports = {
  generateQuickBooksPaymentLink,
  generateCollectFloPaymentLink,
  getInvoicePaymentStatus,
  formatPaymentLinkForCommunication,
  generateSecureToken
};
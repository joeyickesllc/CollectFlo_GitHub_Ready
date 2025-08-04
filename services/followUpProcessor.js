/**
 * Follow-Up Processor Service
 * Handles the actual sending of follow-up communications (email, SMS, calls)
 */

const db = require('../backend/db/connection');
const logger = require('../backend/services/logger');
const { getValidTokens } = require('./tokenStore');
const secrets = require('../backend/config/secrets');
const axios = require('axios');

/**
 * Fetch invoice details from QuickBooks for follow-up context
 * @param {string} invoiceId - QuickBooks invoice ID
 * @param {number} userId - User ID for token lookup
 * @returns {Object|null} Invoice details or null if not found
 */
async function fetchInvoiceFromQuickBooks(invoiceId, userId) {
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

    // Fetch specific invoice
    const response = await axios.get(
      `${apiBaseUrl}${tokens.realmId}/item/${invoiceId}`,
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        }
      }
    );

    const invoice = response.data.QueryResponse?.Invoice?.[0];
    if (!invoice) {
      // Try alternative query
      const queryResponse = await axios.get(
        `${apiBaseUrl}${tokens.realmId}/query?query=SELECT * FROM Invoice WHERE Id = '${invoiceId}'`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.access_token}`,
            'Accept': 'application/json'
          }
        }
      );
      
      const invoices = queryResponse.data.QueryResponse?.Invoice || [];
      if (invoices.length === 0) {
        throw new Error(`Invoice ${invoiceId} not found in QuickBooks`);
      }
      
      return invoices[0];
    }

    return invoice;
  } catch (error) {
    logger.error('Error fetching invoice from QuickBooks', {
      error: error.message,
      invoiceId,
      userId
    });
    return null;
  }
}

/**
 * Process a single follow-up
 * @param {Object} followUp - Follow-up record from database
 * @returns {Object} Processing result
 */
async function processFollowUp(followUp) {
  const startTime = Date.now();
  const result = {
    followUpId: followUp.id,
    success: false,
    error: null,
    method: followUp.follow_up_type,
    duration: 0
  };

  try {
    logger.info('Processing follow-up', {
      followUpId: followUp.id,
      invoiceId: followUp.invoice_id,
      type: followUp.follow_up_type,
      companyId: followUp.company_id
    });

    // Get user for this company to fetch QuickBooks data
    const user = await db.queryOne(
      'SELECT id FROM users WHERE company_id = $1 ORDER BY id LIMIT 1',
      [followUp.company_id]
    );

    if (!user) {
      throw new Error('No user found for company');
    }

    // Fetch invoice details from QuickBooks
    const invoice = await fetchInvoiceFromQuickBooks(followUp.invoice_id, user.id);
    if (!invoice) {
      throw new Error('Could not fetch invoice details from QuickBooks');
    }

    // Prepare follow-up context
    const context = {
      invoice: {
        id: followUp.invoice_id,
        docNumber: invoice.DocNumber || followUp.invoice_id,
        customerName: invoice.CustomerRef?.name || 'Valued Customer',
        totalAmount: parseFloat(invoice.TotalAmt || 0),
        balance: parseFloat(invoice.Balance || 0),
        dueDate: invoice.DueDate,
        txnDate: invoice.TxnDate,
        daysOverdue: calculateDaysOverdue(invoice.DueDate)
      },
      followUp: {
        type: followUp.follow_up_type,
        message: followUp.message_content,
        scheduledAt: followUp.scheduled_at
      },
      company: {
        id: followUp.company_id
      }
    };

    // Send the follow-up based on type
    let sendResult;
    switch (followUp.follow_up_type) {
      case 'email':
        sendResult = await sendEmailFollowUp(context);
        break;
      case 'sms':
        sendResult = await sendSMSFollowUp(context);
        break;
      case 'call':
        sendResult = await scheduleCallFollowUp(context);
        break;
      default:
        throw new Error(`Unsupported follow-up type: ${followUp.follow_up_type}`);
    }

    // Update follow-up status to sent
    await db.query(
      'UPDATE follow_ups SET status = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2',
      ['sent', followUp.id]
    );

    result.success = true;
    result.details = sendResult;

    logger.info('Follow-up processed successfully', {
      followUpId: followUp.id,
      invoiceId: followUp.invoice_id,
      method: followUp.follow_up_type,
      customerName: context.invoice.customerName
    });

  } catch (error) {
    logger.error('Error processing follow-up', {
      error: error.message,
      followUpId: followUp.id,
      invoiceId: followUp.invoice_id,
      stack: error.stack
    });

    // Update follow-up status to failed
    await db.query(
      'UPDATE follow_ups SET status = $1, failed_at = NOW(), error_message = $2, updated_at = NOW() WHERE id = $3',
      ['failed', error.message, followUp.id]
    );

    result.success = false;
    result.error = error.message;
  } finally {
    result.duration = Date.now() - startTime;
  }

  return result;
}

/**
 * Send email follow-up
 * @param {Object} context - Follow-up context with invoice and company data
 * @returns {Object} Send result
 */
async function sendEmailFollowUp(context) {
  const emailService = require('./emailService');
  
  // Determine email template based on days overdue
  let templateType = 'gentle_reminder';
  if (context.invoice.daysOverdue >= 21) {
    templateType = 'final_notice';
  } else if (context.invoice.daysOverdue >= 14) {
    templateType = 'firm_reminder';
  } else if (context.invoice.daysOverdue >= 7) {
    templateType = 'second_reminder';
  }

  return await emailService.sendFollowUpEmail({
    invoiceId: context.invoice.id,
    customerName: context.invoice.customerName,
    amount: context.invoice.balance,
    dueDate: context.invoice.dueDate,
    daysOverdue: context.invoice.daysOverdue,
    templateType: templateType,
    companyId: context.company.id
  });
}

/**
 * Send SMS follow-up
 * @param {Object} context - Follow-up context
 * @returns {Object} Send result
 */
async function sendSMSFollowUp(context) {
  const smsService = require('./smsService');
  
  return await smsService.sendFollowUpSMS({
    invoiceId: context.invoice.id,
    customerName: context.invoice.customerName,
    amount: context.invoice.balance,
    daysOverdue: context.invoice.daysOverdue,
    companyId: context.company.id
  });
}

/**
 * Schedule call follow-up (creates task for manual calling)
 * @param {Object} context - Follow-up context
 * @returns {Object} Schedule result
 */
async function scheduleCallFollowUp(context) {
  // For now, just mark as requiring manual action
  logger.info('Call follow-up scheduled for manual processing', {
    invoiceId: context.invoice.id,
    customerName: context.invoice.customerName,
    amount: context.invoice.balance
  });

  return {
    method: 'call',
    status: 'scheduled',
    message: `Call scheduled for ${context.invoice.customerName} regarding invoice ${context.invoice.docNumber}`
  };
}

/**
 * Process all pending follow-ups for a company
 * @param {number} companyId - Company ID (optional, processes all if not specified)
 * @param {number} limit - Maximum number of follow-ups to process
 * @returns {Object} Processing summary
 */
async function processPendingFollowUps(companyId = null, limit = 50) {
  const startTime = Date.now();
  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    errors: [],
    duration: 0
  };

  try {
    logger.info('Starting follow-up processing', { companyId, limit });

    // Get pending follow-ups
    let query = `
      SELECT * FROM follow_ups 
      WHERE status = 'pending' 
        AND scheduled_at <= NOW()
    `;
    const params = [];

    if (companyId) {
      query += ' AND company_id = $1';
      params.push(companyId);
    }

    query += ' ORDER BY scheduled_at ASC LIMIT $' + (params.length + 1);
    params.push(limit);

    const followUps = await db.query(query, params);

    logger.info('Found pending follow-ups', { count: followUps.length });

    // Process each follow-up
    for (const followUp of followUps) {
      const result = await processFollowUp(followUp);
      results.processed++;
      
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        results.errors.push({
          followUpId: result.followUpId,
          error: result.error
        });
      }
    }

  } catch (error) {
    logger.error('Error in follow-up processing', { error: error.message });
    results.errors.push({
      general: error.message
    });
  } finally {
    results.duration = Date.now() - startTime;
  }

  logger.info('Follow-up processing completed', results);
  return results;
}

/**
 * Calculate days overdue for an invoice
 * @param {string} dueDate - Invoice due date
 * @returns {number} Days overdue
 */
function calculateDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  
  const diffTime = today - due;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

module.exports = {
  processFollowUp,
  processPendingFollowUps,
  fetchInvoiceFromQuickBooks,
  sendEmailFollowUp,
  sendSMSFollowUp,
  scheduleCallFollowUp
};
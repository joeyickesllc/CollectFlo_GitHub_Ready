/**
 * SMS Service
 * Handles sending follow-up SMS messages using Twilio
 */

const twilio = require('twilio');
const db = require('../backend/db/connection');
const logger = require('../backend/services/logger');
const secrets = require('../backend/config/secrets');

// Initialize Twilio client
let twilioClient;
try {
  twilioClient = twilio(secrets.twilio.accountSid, secrets.twilio.authToken);
} catch (error) {
  logger.warn('Twilio not configured', { error: error.message });
}

/**
 * SMS templates for different follow-up types
 */
const SMS_TEMPLATES = {
  gentle_reminder: `Hi {{customerName}}, hope you're well. Just a reminder that invoice {{invoiceNumber}} (${{amount}}) was due {{daysOverdue}} days ago. Please send payment when you get a chance. Thanks! - {{companyName}}`,
  
  second_reminder: `Hi {{customerName}}, following up on invoice {{invoiceNumber}} (${{amount}}) - it's {{daysOverdue}} days past due. I need to get this resolved soon. Can you send payment today? Call me if any issues. - {{companyName}}`,
  
  firm_reminder: `{{customerName}}, I haven't received payment for invoice {{invoiceNumber}} (${{amount}}, {{daysOverdue}} days overdue). I need payment in 48 hours to avoid escalation. Please call me today. - {{companyName}}`,
  
  final_notice: `{{customerName}}, FINAL NOTICE: Invoice {{invoiceNumber}} (${{amount}}) is {{daysOverdue}} days overdue. I must receive payment in 7 days or turn this over to legal. Please call me now. - {{companyName}}`
};

/**
 * Replace template variables with actual values
 * @param {string} template - Template string with {{variable}} placeholders
 * @param {Object} variables - Object with variable values
 * @returns {string} Processed template
 */
function processSMSTemplate(template, variables) {
  let processed = template;
  
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regex, value || '');
  });
  
  return processed;
}

/**
 * Get company settings for SMS customization
 * @param {number} companyId - Company ID
 * @returns {Object} Company settings
 */
async function getCompanySettings(companyId) {
  try {
    const company = await db.queryOne(
      'SELECT name FROM companies WHERE id = $1',
      [companyId]
    );
    
    const settings = await db.queryOne(
      'SELECT * FROM settings WHERE user_id = (SELECT id FROM users WHERE company_id = $1 LIMIT 1)',
      [companyId]
    );
    
    // Try to use company's actual phone number if configured and valid for Twilio
    const companyPhone = settings?.phone;
    let fromNumber = secrets.twilio.phoneNumber; // Default fallback
    
    // If company has a phone number configured, try to format it for Twilio
    if (companyPhone) {
      const formattedCompanyPhone = formatPhoneNumber(companyPhone);
      if (formattedCompanyPhone) {
        // In a full implementation, you'd verify this number is configured in Twilio
        // For now, we'll use it if it looks valid, but fallback to default if sending fails
        fromNumber = formattedCompanyPhone;
      }
    }
    
    return {
      companyName: company?.name || 'Your Company',
      companyPhone: companyPhone,
      // Use company's phone number if available, otherwise Twilio default
      fromNumber: fromNumber,
      twilioNumber: secrets.twilio.phoneNumber, // Keep as fallback
      smsEnabled: settings?.sms_enabled !== false // Default to true unless explicitly disabled
    };
  } catch (error) {
    logger.error('Error getting company settings for SMS', { error: error.message, companyId });
    return {
      companyName: 'Your Company',
      companyPhone: null,
      fromNumber: secrets.twilio.phoneNumber,
      twilioNumber: secrets.twilio.phoneNumber,
      smsEnabled: false
    };
  }
}

/**
 * Format phone number for SMS sending
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  // Remove all non-numeric characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add +1 if it's a 10-digit US number
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // Add + if it doesn't have it
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  // Return as-is if it already looks international
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }
  
  return null; // Invalid phone number
}

/**
 * Send follow-up SMS
 * @param {Object} params - SMS parameters
 * @returns {Object} Send result
 */
async function sendFollowUpSMS(params) {
  const {
    invoiceId,
    customerName,
    amount,
    daysOverdue,
    templateType = 'gentle_reminder',
    companyId,
    customerPhone
  } = params;

  try {
    if (!twilioClient) {
      throw new Error('Twilio not configured');
    }

    // Get company settings
    const companySettings = await getCompanySettings(companyId);
    
    if (!companySettings.smsEnabled) {
      throw new Error('SMS not enabled for this company');
    }

    // Get template
    const template = SMS_TEMPLATES[templateType];
    if (!template) {
      throw new Error(`Unknown SMS template type: ${templateType}`);
    }

    // Format customer phone number
    const toNumber = formatPhoneNumber(customerPhone);
    if (!toNumber) {
      throw new Error('Invalid customer phone number');
    }

    // Prepare template variables
    const variables = {
      customerName: customerName || 'Customer',
      invoiceNumber: invoiceId,
      amount: parseFloat(amount || 0).toFixed(2),
      daysOverdue: daysOverdue || 0,
      companyName: companySettings.companyName
    };

    // Process template
    const message = processSMSTemplate(template, variables);

    // Ensure message is under SMS character limit (160 characters)
    const maxLength = 160;
    const finalMessage = message.length > maxLength 
      ? message.substring(0, maxLength - 3) + '...'
      : message;

    // Use company's phone number as "from" for authenticity
    const smsData = {
      body: finalMessage,
      from: companySettings.fromNumber, // Use company's number if available
      to: toNumber
    };

    // Send the SMS via Twilio
    let sendResult;
    let actualStatus = 'prepared';
    let actualMessageId = 'no-phone-' + Date.now();

    if (customerPhone && toNumber) {
      try {
        sendResult = await twilioClient.messages.create(smsData);
        actualStatus = sendResult.status || 'sent';
        actualMessageId = sendResult.sid;
        
        logger.info('Follow-up SMS sent successfully', {
          invoiceId,
          customerName,
          templateType,
          message: finalMessage,
          to: toNumber,
          from: smsData.from,
          messageId: actualMessageId,
          status: actualStatus
        });
      } catch (sendError) {
        // If sending failed with company number, try with default Twilio number as fallback
        if (smsData.from !== companySettings.twilioNumber && companySettings.twilioNumber) {
          logger.warn('SMS failed with company number, retrying with Twilio number', {
            invoiceId,
            originalFrom: smsData.from,
            fallbackFrom: companySettings.twilioNumber,
            error: sendError.message
          });
          
          try {
            const fallbackSmsData = {
              ...smsData,
              from: companySettings.twilioNumber
            };
            
            sendResult = await twilioClient.messages.create(fallbackSmsData);
            actualStatus = sendResult.status || 'sent';
            actualMessageId = sendResult.sid;
            
            logger.info('Follow-up SMS sent successfully with fallback number', {
              invoiceId,
              customerName,
              templateType,
              message: finalMessage,
              to: toNumber,
              from: fallbackSmsData.from,
              messageId: actualMessageId,
              status: actualStatus
            });
          } catch (fallbackError) {
            actualStatus = 'failed';
            logger.error('Failed to send follow-up SMS even with fallback', {
              invoiceId,
              customerName,
              templateType,
              originalError: sendError.message,
              fallbackError: fallbackError.message,
              to: toNumber,
              message: finalMessage
            });
            throw fallbackError;
          }
        } else {
          actualStatus = 'failed';
          logger.error('Failed to send follow-up SMS', {
            invoiceId,
            customerName,
            templateType,
            error: sendError.message,
            to: toNumber,
            message: finalMessage
          });
          throw sendError;
        }
      }
    } else {
      // Log when no customer phone is available
      logger.warn('Follow-up SMS prepared but not sent - no customer phone available', {
        invoiceId,
        customerName,
        templateType,
        message: finalMessage
      });
    }

    return {
      method: 'sms',
      status: actualStatus,
      templateType,
      message: finalMessage,
      recipient: toNumber,
      messageId: actualMessageId,
      characterCount: finalMessage.length,
      sendResult: sendResult ? 'success' : 'no-phone-available'
    };

  } catch (error) {
    logger.error('Error sending follow-up SMS', {
      error: error.message,
      invoiceId,
      templateType,
      customerPhone,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Send test SMS (for debugging)
 * @param {string} toPhone - Recipient phone number
 * @param {Object} testData - Test invoice data
 * @returns {Object} Send result
 */
async function sendTestFollowUpSMS(toPhone, testData = {}) {
  const testParams = {
    invoiceId: testData.invoiceId || 'TEST-001',
    customerName: testData.customerName || 'Test Customer',
    amount: testData.amount || 1500.00,
    daysOverdue: testData.daysOverdue || 5,
    templateType: testData.templateType || 'gentle_reminder',
    companyId: testData.companyId || 1,
    customerPhone: toPhone
  };

  return await sendFollowUpSMS(testParams);
}

/**
 * Validate SMS configuration
 * @returns {Object} Configuration status
 */
function validateSMSConfig() {
  const isConfigured = !!(
    secrets.twilio.accountSid && 
    secrets.twilio.authToken && 
    secrets.twilio.phoneNumber
  );

  return {
    isConfigured,
    hasAccountSid: !!secrets.twilio.accountSid,
    hasAuthToken: !!secrets.twilio.authToken,
    hasPhoneNumber: !!secrets.twilio.phoneNumber,
    twilioClientReady: !!twilioClient
  };
}

module.exports = {
  sendFollowUpSMS,
  sendTestFollowUpSMS,
  validateSMSConfig,
  SMS_TEMPLATES,
  processSMSTemplate,
  formatPhoneNumber,
  getCompanySettings
};
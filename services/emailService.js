/**
 * Email Service
 * Handles sending follow-up emails using SendGrid with customizable templates
 */

const sgMail = require('@sendgrid/mail');
const db = require('../backend/db/connection');
const logger = require('../backend/services/logger');
const secrets = require('../backend/config/secrets');

// Initialize SendGrid
sgMail.setApiKey(secrets.sendgrid.apiKey);

/**
 * Email templates for different follow-up types
 */
const EMAIL_TEMPLATES = {
  pre_due_reminder: {
    subject: 'Invoice {{invoiceNumber}} - Due Tomorrow',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hi {{customerName}},</p>
        
        <p>I hope you're having a great day. I wanted to give you a friendly heads up that invoice {{invoiceNumber}} is due tomorrow ({{dueDate}}).</p>
        
        <div style="background-color: #e3f2fd; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2196f3;">
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
        </div>
        
        <p>Just a quick reminder to help you stay on top of things. If you've already scheduled the payment, you can disregard this message.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{paymentLink}}" style="background-color: #2196f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            💳 Pay Invoice Online
          </a>
        </div>
        
        <p>You can easily pay online using the button above. If you have any questions or need to discuss anything, just reply to this email or give me a call.</p>
        
        <p>Thanks for being a valued customer!</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  due_date_notice: {
    subject: 'Invoice {{invoiceNumber}} - Due Today',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hi {{customerName}},</p>
        
        <p>I wanted to reach out because invoice {{invoiceNumber}} is due today ({{dueDate}}).</p>
        
        <div style="background-color: #fff3e0; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ff9800;">
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}} (Today)</p>
        </div>
        
        <p>If you've already sent the payment, please disregard this message. If not, you can pay quickly and securely online.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{paymentLink}}" style="background-color: #ff9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            💳 Pay Invoice Today
          </a>
        </div>
        
        <p>You can pay online using the button above. If you need to discuss payment arrangements or have any questions, please reply to this email or give me a call.</p>
        
        <p>Thank you!</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  gentle_reminder: {
    subject: 'Invoice {{invoiceNumber}} - Payment Due',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hi {{customerName}},</p>
        
        <p>I hope you're doing well. I wanted to reach out regarding invoice {{invoiceNumber}} which was due on {{dueDate}}.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
        </div>
        
        <p>I know things can get busy, so I just wanted to make sure this didn't slip through the cracks. If you've already sent the payment, please disregard this message.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{paymentLink}}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            💳 Pay Invoice Online
          </a>
        </div>
        
        <p>You can pay securely online using the button above, or if you have any questions or need to discuss payment arrangements, just hit reply or give me a call. I'm here to help.</p>
        
        <p>Thanks so much!</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  second_reminder: {
    subject: 'Re: Invoice {{invoiceNumber}} - Past Due',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>Hi {{customerName}},</p>
        
        <p>I'm following up on my previous email about invoice {{invoiceNumber}}. The payment is now {{daysOverdue}} days past due and I haven't received payment or heard back from you.</p>
        
        <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Original Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Past Due:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p>I need to get this resolved quickly to keep your account in good standing. Please send payment today or give me a call to discuss payment arrangements.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{paymentLink}}" style="background-color: #FF9800; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            💳 Pay Now - Keep Account Current
          </a>
        </div>
        
        <p>You can pay immediately using the button above. If you've already sent payment, please let me know so I can check on it.</p>
        
        <p>I appreciate your prompt attention to this.</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  firm_reminder: {
    subject: 'URGENT: Invoice {{invoiceNumber}} - Immediate Action Required',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>{{customerName}},</p>
        
        <p>I've sent multiple emails about invoice {{invoiceNumber}} and haven't received payment or any response. This is now seriously overdue and requires immediate attention.</p>
        
        <div style="background-color: #f8d7da; padding: 20px; border-left: 4px solid #dc3545; margin: 20px 0;">
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Past Due:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p><strong>I need payment within 48 hours to avoid escalating this matter.</strong></p>
        
        <p>If you've already sent payment, please send me confirmation immediately so I can locate it.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{paymentLink}}" style="background-color: #f44336; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
            🚨 PAY NOW - AVOID ESCALATION
          </a>
        </div>
        
        <p>If there's a problem with the invoice or you need to work out payment arrangements, call me right away. I want to resolve this, but I need to hear from you.</p>
        
        <p>Please don't ignore this - continued non-payment may result in service suspension and additional collection costs.</p>
        
        <p>Call me today.</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  fourth_reminder: {
    subject: 'CRITICAL: Invoice {{invoiceNumber}} - Account in Jeopardy',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>{{customerName}},</p>
        
        <p><strong>Your account is now in serious jeopardy.</strong> Invoice {{invoiceNumber}} has been outstanding for {{daysOverdue}} days and I have not received payment despite multiple attempts to contact you.</p>
        
        <div style="background-color: #ffebee; padding: 20px; border: 2px solid #d32f2f; margin: 20px 0; border-radius: 5px;">
          <p style="color: #d32f2f; font-weight: bold; margin: 0 0 10px 0;">⚠️ ACCOUNT STATUS: CRITICAL</p>
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Past Due:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p><strong>This is your last opportunity to resolve this before I escalate to our legal department and credit reporting agencies.</strong></p>
        
        <div style="text-align: center; margin: 30px 0; background-color: #ffcdd2; padding: 20px; border-radius: 5px;">
          <p style="margin: 0 0 15px 0; font-weight: bold; color: #b71c1c;">🚨 FINAL WARNING - IMMEDIATE ACTION REQUIRED 🚨</p>
          <a href="{{paymentLink}}" style="background-color: #b71c1c; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
            💳 PAY NOW - PREVENT LEGAL ACTION
          </a>
        </div>
        
        <p><strong>If I don't receive payment within 7 days, I will have no choice but to:</strong></p>
        <ul style="color: #d32f2f; font-weight: bold;">
          <li>Report this delinquency to credit bureaus</li>
          <li>Turn your account over to our legal department</li>
          <li>Suspend all services immediately</li>
          <li>Add collection fees and legal costs to your balance</li>
        </ul>
        
        <p>I don't want it to come to this. Please pay online immediately or call me to arrange payment today.</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  },
  
  final_notice: {
    subject: 'FINAL NOTICE: Invoice {{invoiceNumber}} - Action Required',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>{{customerName}},</p>
        
        <p><strong>This is my final attempt to collect payment before taking further action.</strong></p>
        
        <p>Invoice {{invoiceNumber}} is now {{daysOverdue}} days past due and I have not received payment despite multiple requests.</p>
        
        <div style="background-color: #f8d7da; padding: 20px; border: 2px solid #dc3545; margin: 20px 0;">
          <p><strong style="color: #721c24;">FINAL DEMAND</strong></p>
          <p><strong>Invoice #{{invoiceNumber}}</strong></p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Past Due:</strong> {{daysOverdue}} days</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0; background-color: #ffebee; padding: 20px; border-radius: 5px;">
          <p style="margin: 0 0 15px 0; font-weight: bold; color: #d32f2f;">⚠️ FINAL OPPORTUNITY TO PAY ONLINE ⚠️</p>
          <a href="{{paymentLink}}" style="background-color: #d32f2f; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; font-size: 16px;">
            💳 PAY NOW - AVOID LEGAL ACTION
          </a>
        </div>
        
        <p><strong>You have 7 days to pay the full amount or contact me to resolve this.</strong></p>
        
        <p>If I don't receive payment or hear from you within 7 days, I will have no choice but to:</p>
        <ul>
          <li>Turn this over to our legal department</li>
          <li>Report the delinquency to credit agencies</li>
          <li>Pursue collection through the courts</li>
          <li>Add collection costs and legal fees to your balance</li>
        </ul>
        
        <p>I don't want it to come to this. Please pay online using the button above or call me immediately to avoid legal action.</p>
        
        <p>{{companyName}}</p>
      </div>
    `
  }
};

/**
 * Replace template variables with actual values
 * @param {string} template - Template string with {{variable}} placeholders
 * @param {Object} variables - Object with variable values
 * @returns {string} Processed template
 */
function processTemplate(template, variables) {
  let processed = template;
  
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regex, value || '');
  });
  
  return processed;
}

/**
 * Get company settings for email customization
 * @param {number} companyId - Company ID
 * @returns {Object} Company settings
 */
async function getCompanySettings(companyId) {
  try {
    const company = await db.queryOne(
      'SELECT name FROM companies WHERE id = $1',
      [companyId]
    );
    
    // Get user and settings for this company
    const user = await db.queryOne(
      'SELECT email FROM users WHERE company_id = $1 ORDER BY id LIMIT 1',
      [companyId]
    );
    
    const settings = await db.queryOne(
      'SELECT * FROM settings WHERE user_id = (SELECT id FROM users WHERE company_id = $1 LIMIT 1)',
      [companyId]
    );
    
    // Use verified SendGrid sender for fromEmail to avoid sender identity errors
    // Route replies to the company's actual email if available
    const companyEmail = settings?.reply_to_email || user?.email;
    const companyPhone = settings?.phone;
    const companyName = company?.name || 'Your Company';
    
    return {
      companyName: companyName,
      phone: companyPhone || '[PHONE]',
      fromEmail: secrets.sendgrid.fromEmail,
      fromName: companyName,
      replyToEmail: companyEmail || secrets.sendgrid.fromEmail
    };
  } catch (error) {
    logger.error('Error getting company settings', { error: error.message, companyId });
    return {
      companyName: 'Your Company',
      phone: '[PHONE]',
      fromEmail: secrets.sendgrid.fromEmail,
      fromName: secrets.sendgrid.fromName,
      replyToEmail: secrets.sendgrid.fromEmail
    };
  }
}

/**
 * Send follow-up email
 * @param {Object} params - Email parameters
 * @returns {Object} Send result
 */
async function sendFollowUpEmail(params) {
  const {
    invoiceId,
    customerName,
    amount,
    dueDate,
    daysOverdue,
    templateType = 'gentle_reminder',
    companyId,
    customerEmail,
    paymentLink
  } = params;

  try {
    // Get template
    const template = EMAIL_TEMPLATES[templateType];
    if (!template) {
      throw new Error(`Unknown template type: ${templateType}`);
    }

    // Get company settings
    const companySettings = await getCompanySettings(companyId);

    // Prepare template variables
    const variables = {
      customerName: customerName || 'Valued Customer',
      invoiceNumber: invoiceId,
      amount: parseFloat(amount || 0).toFixed(2),
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString() : 'N/A',
      daysOverdue: daysOverdue || 0,
      companyName: companySettings.companyName,
      paymentLink: paymentLink || '#payment-not-available'
    };

    // Process templates
    const subject = processTemplate(template.subject, variables);
    const html = processTemplate(template.html, variables)
      .replace(/\[PHONE\]/g, companySettings.phone);

    // For now, we'll log the email instead of sending it
    // In production, you'd need the customer's email address
    const emailData = {
      to: customerEmail || 'customer@example.com', // Would need to get from QuickBooks
      from: {
        email: companySettings.fromEmail,
        name: companySettings.fromName
      },
      replyTo: companySettings.replyToEmail,
      subject: subject,
      html: html
    };

    // Send the email via SendGrid
    let sendResult;
    let actualStatus = 'prepared';
    let actualMessageId = 'no-email-' + Date.now();

    if (customerEmail && customerEmail !== 'customer@example.com') {
      try {
        sendResult = await sgMail.send(emailData);
        actualStatus = 'sent';
        actualMessageId = sendResult[0].headers['x-message-id'] || sendResult[0].messageId || 'sent-' + Date.now();
        
        logger.info('Follow-up email sent successfully', {
          invoiceId,
          customerName,
          templateType,
          subject: subject,
          to: emailData.to,
          messageId: actualMessageId
        });
      } catch (sendError) {
        actualStatus = 'failed';
        logger.error('Failed to send follow-up email', {
          invoiceId,
          customerName,
          templateType,
          error: sendError.message,
          to: emailData.to
        });
        throw sendError;
      }
    } else {
      // Log when no customer email is available
      logger.warn('Follow-up email prepared but not sent - no customer email available', {
        invoiceId,
        customerName,
        templateType,
        subject: subject
      });
    }

    return {
      method: 'email',
      status: actualStatus,
      templateType,
      subject,
      recipient: emailData.to,
      messageId: actualMessageId,
      sendResult: sendResult ? 'success' : 'no-email-available'
    };

  } catch (error) {
    logger.error('Error sending follow-up email', {
      error: error.message,
      invoiceId,
      templateType,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Send test email (for debugging)
 * @param {string} toEmail - Recipient email
 * @param {Object} testData - Test invoice data
 * @returns {Object} Send result
 */
async function sendTestFollowUpEmail(toEmail, testData = {}) {
  const testParams = {
    invoiceId: testData.invoiceId || 'TEST-001',
    customerName: testData.customerName || 'Test Customer',
    amount: testData.amount || 1500.00,
    dueDate: testData.dueDate || '2025-07-15',
    daysOverdue: testData.daysOverdue || 5,
    templateType: testData.templateType || 'gentle_reminder',
    companyId: testData.companyId || 1,
    customerEmail: toEmail,
    paymentLink: testData.paymentLink || 'https://example.com/pay/test-123'
  };

  return await sendFollowUpEmail(testParams);
}

module.exports = {
  sendFollowUpEmail,
  sendTestFollowUpEmail,
  EMAIL_TEMPLATES,
  processTemplate,
  getCompanySettings
};
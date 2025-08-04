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
  gentle_reminder: {
    subject: 'Friendly Reminder: Invoice {{invoiceNumber}} Due',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Payment Reminder</h2>
        <p>Dear {{customerName}},</p>
        <p>We hope this message finds you well. This is a friendly reminder that your invoice payment is now due.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #495057;">Invoice Details</h3>
          <p><strong>Invoice Number:</strong> {{invoiceNumber}}</p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Overdue:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p>We understand that sometimes invoices can be overlooked, so we wanted to bring this to your attention.</p>
        
        <p>If you have any questions about this invoice or need to discuss payment arrangements, please don't hesitate to contact us.</p>
        
        <p>Thank you for your prompt attention to this matter.</p>
        
        <p>Best regards,<br>{{companyName}}</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">
          This is an automated reminder. If you have already made this payment, please disregard this message.
        </p>
      </div>
    `
  },
  
  second_reminder: {
    subject: 'Second Notice: Invoice {{invoiceNumber}} Payment Required',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Payment Notice</h2>
        <p>Dear {{customerName}},</p>
        <p>This is our second notice regarding the overdue payment for the invoice below.</p>
        
        <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #856404;">Invoice Details</h3>
          <p><strong>Invoice Number:</strong> {{invoiceNumber}}</p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Original Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Overdue:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p><strong>Please remit payment immediately to avoid any service interruption or additional fees.</strong></p>
        
        <p>If you have already sent payment, please contact us immediately so we can update our records.</p>
        
        <p>If you're experiencing financial difficulties, please contact us to discuss payment arrangements.</p>
        
        <p>We appreciate your immediate attention to this matter.</p>
        
        <p>Sincerely,<br>{{companyName}} Accounts Receivable</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">
          This is an automated notice. Please contact us if you have any questions.
        </p>
      </div>
    `
  },
  
  firm_reminder: {
    subject: 'URGENT: Invoice {{invoiceNumber}} - Payment Required',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">URGENT: Payment Required</h2>
        <p>Dear {{customerName}},</p>
        <p>Your account is now seriously overdue. <strong>Immediate payment is required</strong> for the invoice detailed below.</p>
        
        <div style="background-color: #f8d7da; padding: 20px; border-left: 4px solid #dc3545; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #721c24;">OVERDUE INVOICE</h3>
          <p><strong>Invoice Number:</strong> {{invoiceNumber}}</p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Original Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Overdue:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p><strong>ACTION REQUIRED:</strong> Please remit payment within 48 hours to avoid collection action.</p>
        
        <p>If payment has been made, please provide proof of payment immediately.</p>
        
        <p>Failure to respond to this notice may result in:</p>
        <ul>
          <li>Suspension of service</li>
          <li>Additional collection fees</li>
          <li>Referral to a collection agency</li>
          <li>Impact on your credit rating</li>
        </ul>
        
        <p>Contact us immediately at [PHONE] or reply to this email to resolve this matter.</p>
        
        <p>{{companyName}} Collections Department</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">
          This is a formal collection notice. Please treat this matter with urgency.
        </p>
      </div>
    `
  },
  
  final_notice: {
    subject: 'FINAL NOTICE: Invoice {{invoiceNumber}} - Legal Action Pending',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545; text-transform: uppercase;">Final Notice - Legal Action Pending</h2>
        <p>Dear {{customerName}},</p>
        <p><strong>This is your FINAL NOTICE</strong> before we pursue legal remedies for the collection of the overdue amount below.</p>
        
        <div style="background-color: #f8d7da; padding: 20px; border: 2px solid #dc3545; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #721c24; text-transform: uppercase;">Final Demand</h3>
          <p><strong>Invoice Number:</strong> {{invoiceNumber}}</p>
          <p><strong>Amount Due:</strong> ${{amount}}</p>
          <p><strong>Original Due Date:</strong> {{dueDate}}</p>
          <p><strong>Days Overdue:</strong> {{daysOverdue}} days</p>
        </div>
        
        <p><strong>YOU HAVE 7 DAYS FROM THE DATE OF THIS NOTICE TO PAY THE FULL AMOUNT DUE.</strong></p>
        
        <p>If payment is not received within this time frame, we will:</p>
        <ul>
          <li>Refer your account to our legal department</li>
          <li>Pursue collection through the courts</li>
          <li>Report delinquency to credit agencies</li>
          <li>Seek recovery of collection costs and legal fees</li>
        </ul>
        
        <p>This may negatively impact your credit score and result in additional costs.</p>
        
        <p><strong>TO AVOID LEGAL ACTION:</strong> Contact us immediately at [PHONE] or respond to this email.</p>
        
        <p>{{companyName}} Legal Department</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #dee2e6;">
        <p style="font-size: 12px; color: #6c757d;">
          This is a legal notice. Failure to respond may result in legal proceedings without further notice.
        </p>
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
    
    const settings = await db.queryOne(
      'SELECT * FROM settings WHERE user_id = (SELECT id FROM users WHERE company_id = $1 LIMIT 1)',
      [companyId]
    );
    
    return {
      companyName: company?.name || 'Your Company',
      phone: settings?.phone || '[PHONE]',
      replyToEmail: settings?.reply_to_email || secrets.sendgrid.fromEmail,
      fromEmail: secrets.sendgrid.fromEmail,
      fromName: company?.name || secrets.sendgrid.fromName
    };
  } catch (error) {
    logger.error('Error getting company settings', { error: error.message, companyId });
    return {
      companyName: 'Your Company',
      phone: '[PHONE]',
      replyToEmail: secrets.sendgrid.fromEmail,
      fromEmail: secrets.sendgrid.fromEmail,
      fromName: secrets.sendgrid.fromName
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
    customerEmail
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
      companyName: companySettings.companyName
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
    customerEmail: toEmail
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
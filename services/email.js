const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendTestEmail() {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY is not set');
    }
    if (!process.env.BUSINESS_EMAIL) {
      throw new Error('BUSINESS_EMAIL is not set');
    }

    console.log('Starting test email send...');
    console.log('Email Config:', {
      to: process.env.BUSINESS_EMAIL,
      from: process.env.BUSINESS_EMAIL,
      sendgridKey: 'Set'
    });

    const msg = {
      to: process.env.BUSINESS_EMAIL,
      from: {
        email: process.env.BUSINESS_EMAIL,
        name: 'CollectFlo Support'
      },
      subject: 'FollowUpFlow Test Email',
      text: 'If you receive this, your email integration is working!',
      html: '<p>If you receive this, your email integration is working!</p>',
      headers: {
        'List-Unsubscribe': '<mailto:unsubscribe@collectflow.com>',
        'Precedence': 'Bulk'
      },
      categories: ['test-email'],
      trackingSettings: {
        clickTracking: {
          enable: true
        },
        openTracking: {
          enable: true
        }
      }
    };

    const result = await sgMail.send(msg);
    console.log('Email sent successfully:', result[0].statusCode);
    return result;
  } catch (error) {
    console.error('SendGrid Error Details:', {
      message: error.message,
      response: error.response?.body,
      code: error.code,
      statusCode: error.statusCode
    });
    throw error;
  }
}

async function sendPaymentNotification(invoice, amount, user = null) {
  let subject = 'Payment Received!';
  let htmlContent = `<p>Payment received for invoice #${invoice.Id}.</p><p>Amount: $${amount}</p>`;
  let textContent = `Payment received for invoice #${invoice.Id}. Amount: $${amount}`;
  
  // Add trial-specific messaging if user is on trial
  if (user && user.subscription_status === 'trial') {
    subject = '🎉 First Payment Received During Your Trial!';
    
    htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10B981;">🎉 Congratulations! Your first payment was received!</h2>
        
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Invoice #${invoice.invoice_id || invoice.Id}</strong></p>
          <p><strong>Amount Received: $${amount}</strong></p>
        </div>
        
        <div style="background-color: #EFF6FF; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3B82F6;">
          <h3 style="color: #1E40AF; margin-top: 0;">This is just the beginning! 🚀</h3>
          <p>You just experienced the power of automated invoice collection firsthand. Your CollectFlo system worked behind the scenes to:</p>
          <ul>
            <li>Send professional follow-up reminders</li>
            <li>Provide secure payment links</li>
            <li>Automatically detect the payment</li>
            <li>Notify you instantly</li>
          </ul>
          <p><strong>All without you having to make a single phone call or send a manual email!</strong></p>
        </div>
        
        <div style="background-color: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #92400E; margin-top: 0;">⏰ Your trial expires soon</h3>
          <p>Don't let this automated cash flow magic stop! Continue receiving payments effortlessly by subscribing to CollectFlo.</p>
          <p style="text-align: center; margin: 25px 0;">
            <a href="https://collectflo.com/signup" style="background-color: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Continue with CollectFlo - $299/month</a>
          </p>
          <p style="font-size: 14px; color: #6B7280;">Start your paid subscription and keep this automated collection system working for your business.</p>
        </div>
        
        <p style="color: #6B7280; font-size: 14px;">This payment was processed securely through Intuit Payments and automatically detected by your CollectFlo system.</p>
      </div>
    `;
    
    textContent = `🎉 Congratulations! Your first payment was received during your CollectFlo trial!

Invoice #${invoice.invoice_id || invoice.Id} - Amount: $${amount}

This is just the beginning! You just experienced automated invoice collection firsthand. Your CollectFlo system worked behind the scenes without you having to make a single phone call or send a manual email.

⏰ Your trial expires soon - Don't let this automated cash flow magic stop! 

Continue with CollectFlo for $299/month: https://collectflo.com/signup

This payment was processed securely through Intuit Payments and automatically detected by your CollectFlo system.`;
  }

  const msg = {
    to: process.env.BUSINESS_EMAIL,
    from: {
      email: process.env.BUSINESS_EMAIL,
      name: 'CollectFlo Notifications'
    },
    subject: subject,
    text: textContent,
    html: htmlContent,
    categories: ['payment-notification'],
    trackingSettings: {
      clickTracking: { enable: true },
      openTracking: { enable: true }
    }
  };

  return sgMail.send(msg);
}

async function sendTestSMS() {
  const twilio = require('twilio');
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER || !process.env.TEST_PHONE_NUMBER) {
      throw new Error('Missing required Twilio configuration');
    }

    console.log('Twilio Config:', {
        accountSid: process.env.TWILIO_ACCOUNT_SID?.substring(0, 5) + '...',
        authToken: process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Not Set',
        fromNumber: process.env.TWILIO_PHONE_NUMBER,
        toNumber: process.env.TEST_PHONE_NUMBER
      });

    const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    console.log('Attempting to send SMS message...');
    const message = await client.messages.create({
      body: 'FollowUpFlow Test SMS - If you receive this, your Twilio integration is working!',
      to: process.env.TEST_PHONE_NUMBER,
      from: process.env.TWILIO_PHONE_NUMBER
    });

    console.log('SMS Response:', {
        sid: message.sid,
        status: message.status,
        dateCreated: message.dateCreated,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage
      });

    return message;
  } catch (error) {
    console.error('Twilio SMS Error:', error);
    throw error;
  }
}

module.exports = {
  sendTestEmail,
  sendTestSMS,
  sendPaymentNotification
};
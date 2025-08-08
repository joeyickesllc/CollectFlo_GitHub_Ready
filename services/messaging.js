
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
// Legacy local sqlite module (../database.js) is not used elsewhere. Use Postgres connection for consistency.
const db = require('../backend/db/connection');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendMessage(followUp, template) {
  try {
    // Get company settings for customization
    const settings = await db.queryOne('SELECT * FROM company_settings ORDER BY id DESC LIMIT 1');
    const companyName = settings?.setting_key === 'company_name' ? settings.setting_value : (settings?.company_name || 'CollectFlo');
    
    // Replace template variables
    const subject = template.subject
      .replace(/\{\{company_name\}\}/g, companyName)
      .replace(/\{\{customer_name\}\}/g, followUp.customer_name);
    
    const body = template.body
      .replace(/\{\{company_name\}\}/g, companyName)
      .replace(/\{\{customer_name\}\}/g, followUp.customer_name)
      .replace(/\{\{amount\}\}/g, followUp.amount)
      .replace(/\{\{balance\}\}/g, followUp.balance);
    
    if (followUp.channel === 'email') {
      const emailConfig = {
        to: followUp.customer_email,
        from: {
          email: process.env.BUSINESS_EMAIL,
          name: companyName
        },
        subject: subject,
        text: body,
      };
      
      // Add reply-to if configured
      if (settings?.reply_to_email) {
        emailConfig.replyTo = {
          email: settings.reply_to_email,
          name: companyName
        };
      }
      
      await sgMail.send(emailConfig);
    } else if (followUp.channel === 'sms') {
      await twilioClient.messages.create({
        body: body,
        to: followUp.customer_phone,
        from: process.env.TWILIO_PHONE_NUMBER
      });
    }
    
    await db.execute(
      'UPDATE follow_ups SET delivered_at = NOW(), updated_at = NOW() WHERE id = $1',
      [followUp.id]
    );
    
    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}

module.exports = { sendMessage };

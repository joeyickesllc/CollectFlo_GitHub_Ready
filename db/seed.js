
const Database = require('better-sqlite3');
const db = new Database('followup.db');

const templates = [
  {day_offset: -1, channel: 'email', subject: 'Invoice Due Tomorrow - {{company_name}}', body: 'Hello {{customer_name}},\n\nYour invoice is due tomorrow. Please ensure timely payment to avoid any late fees.\n\nBest regards,\n{{company_name}}'},
  {day_offset: 0, channel: 'email', subject: 'Invoice Due Today - {{company_name}}', body: 'Hello {{customer_name}},\n\nThis is a reminder that your invoice is due today.\n\nBest regards,\n{{company_name}}'},
  {day_offset: 1, channel: 'sms', subject: 'Payment Overdue', body: 'Hi {{customer_name}}, your {{company_name}} invoice payment is now overdue. Please make the payment as soon as possible.'},
  {day_offset: 3, channel: 'email', subject: 'Payment Reminder - {{company_name}}', body: 'Hello {{customer_name}},\n\nYour invoice payment is 3 days overdue. Please contact us if you need to discuss payment options.\n\nBest regards,\n{{company_name}}'},
  {day_offset: 7, channel: 'sms', subject: 'Urgent: Payment Required', body: 'Hi {{customer_name}}, your {{company_name}} invoice is now 7 days overdue. Please make the payment or contact us immediately.'},
  {day_offset: 15, channel: 'email', subject: 'Final Notice - {{company_name}}', body: 'Hello {{customer_name}},\n\nThis is a final notice regarding your overdue invoice. Please contact us immediately.\n\nBest regards,\n{{company_name}}'}
];

templates.forEach(template => {
  db.prepare(`
    INSERT INTO message_templates (day_offset, channel, subject, body) 
    VALUES (@day_offset, @channel, @subject, @body)
  `).run(template);
});

console.log('Database seeded successfully!');

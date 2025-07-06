const schedule = require('node-schedule');
const db = require('../database.js');
const { sendMessage } = require('./messaging.js');

function startScheduler() {
  // Check for due follow-ups every hour
  schedule.scheduleJob('0 * * * *', async () => {
    const dueFollowUps = db.prepare(`
      SELECT f.*, t.subject, t.body 
      FROM follow_ups f
      JOIN message_templates t ON 
        CAST(JULIANDAY(f.scheduled_date) - JULIANDAY(f.due_date) AS INTEGER) = t.day_offset 
        AND f.channel = t.channel
      WHERE f.status = 'pending' 
      AND f.excluded = 0
      AND DATE(f.scheduled_date) <= DATE('now')
      AND f.delivered_at IS NULL
    `).all();

    for (const followUp of dueFollowUps) {
      await sendMessage(followUp, {
        subject: followUp.subject,
        body: followUp.body
      });
    }
  });

  // Check for payments every hour
  schedule.scheduleJob('0 * * * *', async () => {
    await fetch('http://localhost:5000/api/check-payments', {
      method: 'POST'
    });
  });

  // Sync invoices daily at 6 AM
  schedule.scheduleJob('0 6 * * *', async () => {
    console.log('Starting daily invoice sync...');
    try {
      await fetch('http://localhost:5000/api/sync-invoices', {
        method: 'POST'
      });
      console.log('Daily invoice sync completed successfully');
    } catch (error) {
      console.error('Daily invoice sync failed:', error);
    }
  });
}

module.exports = { startScheduler };
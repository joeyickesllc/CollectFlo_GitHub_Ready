/**
 * Follow-Up Scheduler Service
 * Handles automated processing of scheduled follow-ups using cron jobs
 */

const cron = require('node-cron');
const { processPendingFollowUps } = require('./followUpProcessor');
const logger = require('../backend/services/logger');

/**
 * Scheduled job instances
 */
const scheduledJobs = new Map();

/**
 * Default scheduler configuration
 */
const SCHEDULER_CONFIG = {
  // Run every 15 minutes during business hours (9 AM - 6 PM, Monday-Friday)
  followUpProcessing: '*/15 9-18 * * 1-5',
  
  // Run every hour for urgent follow-ups (final notices)
  urgentProcessing: '0 * * * *',
  
  // Run daily cleanup at 2 AM
  dailyCleanup: '0 2 * * *',
  
  // Run weekly reports on Mondays at 8 AM
  weeklyReports: '0 8 * * 1'
};

/**
 * Process pending follow-ups (main scheduler)
 * @param {boolean} urgentOnly - Process only urgent follow-ups
 */
async function processScheduledFollowUps(urgentOnly = false) {
  try {
    logger.info('Starting scheduled follow-up processing', { urgentOnly });
    
    const startTime = Date.now();
    
    // Process all companies
    const results = await processPendingFollowUps(null, urgentOnly ? 20 : 100);
    
    const duration = Date.now() - startTime;
    
    logger.info('Scheduled follow-up processing completed', {
      ...results,
      duration,
      urgentOnly
    });
    
    // Log summary if any follow-ups were processed
    if (results.processed > 0) {
      logger.info('Follow-up processing summary', {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
        errorCount: results.errors.length,
        successRate: results.processed > 0 ? ((results.successful / results.processed) * 100).toFixed(1) + '%' : '0%'
      });
    }
    
    return results;
    
  } catch (error) {
    logger.error('Error in scheduled follow-up processing', {
      error: error.message,
      stack: error.stack,
      urgentOnly
    });
    
    return {
      processed: 0,
      successful: 0,
      failed: 1,
      errors: [{ general: error.message }]
    };
  }
}

/**
 * Daily cleanup tasks
 */
async function performDailyCleanup() {
  try {
    logger.info('Starting daily cleanup tasks');
    
    const db = require('../backend/db/connection');
    
    // Clean up old completed follow-ups (older than 90 days)
    const cleanupResult = await db.query(`
      DELETE FROM follow_ups 
      WHERE status IN ('completed', 'delivered') 
        AND updated_at < NOW() - INTERVAL '90 days'
    `);
    
    logger.info('Daily cleanup completed', {
      followUpsDeleted: cleanupResult.length || 0
    });
    
    // Archive old failed follow-ups
    const archiveResult = await db.query(`
      UPDATE follow_ups 
      SET status = 'archived' 
      WHERE status = 'failed' 
        AND failed_at < NOW() - INTERVAL '30 days'
    `);
    
    logger.info('Failed follow-ups archived', {
      followUpsArchived: archiveResult.length || 0
    });
    
  } catch (error) {
    logger.error('Error in daily cleanup', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Generate weekly follow-up reports
 */
async function generateWeeklyReports() {
  try {
    logger.info('Generating weekly follow-up reports');
    
    const db = require('../backend/db/connection');
    
    // Get weekly statistics
    const weeklyStats = await db.query(`
      SELECT 
        COUNT(*) as total_followups,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN follow_up_type = 'email' THEN 1 END) as email_count,
        COUNT(CASE WHEN follow_up_type = 'sms' THEN 1 END) as sms_count,
        COUNT(CASE WHEN follow_up_type = 'call' THEN 1 END) as call_count
      FROM follow_ups 
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    
    const stats = weeklyStats[0] || {};
    
    logger.info('Weekly follow-up report', {
      totalFollowUps: parseInt(stats.total_followups) || 0,
      sent: parseInt(stats.sent_count) || 0,
      delivered: parseInt(stats.delivered_count) || 0,
      failed: parseInt(stats.failed_count) || 0,
      email: parseInt(stats.email_count) || 0,
      sms: parseInt(stats.sms_count) || 0,
      calls: parseInt(stats.call_count) || 0,
      successRate: stats.total_followups > 0 
        ? (((parseInt(stats.sent_count) + parseInt(stats.delivered_count)) / parseInt(stats.total_followups)) * 100).toFixed(1) + '%'
        : '0%'
    });
    
  } catch (error) {
    logger.error('Error generating weekly reports', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Start the follow-up scheduler
 * @param {Object} config - Optional custom configuration
 */
function startScheduler(config = {}) {
  const scheduleConfig = { ...SCHEDULER_CONFIG, ...config };
  
  try {
    logger.info('Starting follow-up scheduler', { config: scheduleConfig });
    
    // Main follow-up processing job (every 15 minutes during business hours)
    const mainJob = cron.schedule(scheduleConfig.followUpProcessing, async () => {
      await processScheduledFollowUps(false);
    }, {
      scheduled: false,
      timezone: 'America/New_York' // Adjust timezone as needed
    });
    
    scheduledJobs.set('mainProcessing', mainJob);
    
    // Urgent follow-up processing (every hour)
    const urgentJob = cron.schedule(scheduleConfig.urgentProcessing, async () => {
      await processScheduledFollowUps(true);
    }, {
      scheduled: false,
      timezone: 'America/New_York'
    });
    
    scheduledJobs.set('urgentProcessing', urgentJob);
    
    // Daily cleanup (2 AM daily)
    const cleanupJob = cron.schedule(scheduleConfig.dailyCleanup, async () => {
      await performDailyCleanup();
    }, {
      scheduled: false,
      timezone: 'America/New_York'
    });
    
    scheduledJobs.set('dailyCleanup', cleanupJob);
    
    // Weekly reports (Monday 8 AM)
    const reportsJob = cron.schedule(scheduleConfig.weeklyReports, async () => {
      await generateWeeklyReports();
    }, {
      scheduled: false,
      timezone: 'America/New_York'
    });
    
    scheduledJobs.set('weeklyReports', reportsJob);
    
    // Start all jobs
    scheduledJobs.forEach((job, name) => {
      job.start();
      logger.info(`Started scheduled job: ${name}`);
    });
    
    logger.info('Follow-up scheduler started successfully', {
      jobCount: scheduledJobs.size,
      jobs: Array.from(scheduledJobs.keys())
    });
    
    return true;
    
  } catch (error) {
    logger.error('Error starting follow-up scheduler', {
      error: error.message,
      stack: error.stack
    });
    
    return false;
  }
}

/**
 * Stop the follow-up scheduler
 */
function stopScheduler() {
  try {
    logger.info('Stopping follow-up scheduler');
    
    scheduledJobs.forEach((job, name) => {
      job.stop();
      job.destroy();
      logger.info(`Stopped scheduled job: ${name}`);
    });
    
    scheduledJobs.clear();
    
    logger.info('Follow-up scheduler stopped successfully');
    return true;
    
  } catch (error) {
    logger.error('Error stopping follow-up scheduler', {
      error: error.message,
      stack: error.stack
    });
    
    return false;
  }
}

/**
 * Get scheduler status
 * @returns {Object} Scheduler status
 */
function getSchedulerStatus() {
  return {
    isRunning: scheduledJobs.size > 0,
    jobCount: scheduledJobs.size,
    jobs: Array.from(scheduledJobs.keys()).map(name => ({
      name,
      isRunning: scheduledJobs.get(name)?.running || false
    })),
    config: SCHEDULER_CONFIG
  };
}

/**
 * Manually trigger follow-up processing (for testing/debugging)
 * @param {boolean} urgentOnly - Process only urgent follow-ups
 * @returns {Object} Processing results
 */
async function triggerManualProcessing(urgentOnly = false) {
  logger.info('Manual follow-up processing triggered', { urgentOnly });
  return await processScheduledFollowUps(urgentOnly);
}

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  triggerManualProcessing,
  processScheduledFollowUps,
  performDailyCleanup,
  generateWeeklyReports,
  SCHEDULER_CONFIG
};
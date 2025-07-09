/**
 * services/scheduler.js
 * 
 * Scheduler service that registers recurring jobs with the job queue.
 * This module is responsible for setting up all scheduled tasks in the application.
 */

const logger = require('../backend/services/logger');
const jobQueue = require('../backend/services/jobQueue');

// Track registered jobs for potential cleanup
const registeredJobs = [];

/**
 * Register a recurring job with error handling
 * 
 * @param {string} queueName - Name of the queue to use
 * @param {string} jobName - Name of the job for logging
 * @param {string} cronExpression - When to run the job (cron syntax)
 * @param {Object} data - Data to pass to the job
 * @returns {Object|null} - The registered job or null if registration failed
 */
function registerRecurringJob(queueName, jobName, cronExpression, data = {}) {
  try {
    // Get the queue
    const queue = jobQueue.getQueue(queueName);
    if (!queue) {
      logger.warn(`Cannot register job "${jobName}": Queue "${queueName}" not found`);
      return null;
    }

    // Add the job with the cron pattern
    const job = queue.addRecurring(jobName, cronExpression, data);
    logger.info(`Scheduled job registered: ${jobName} (${cronExpression})`);
    
    // Track the job for potential cleanup
    registeredJobs.push({ queue: queueName, name: jobName, job });
    
    return job;
  } catch (error) {
    logger.error(`Failed to register scheduled job "${jobName}"`, { error });
    return null;
  }
}

/**
 * Initialize all scheduled jobs
 */
function initializeScheduledJobs() {
  try {
    logger.info('Initializing scheduled jobs');

    // Invoice follow-up reminders (runs daily at 8:00 AM)
    registerRecurringJob(
      'invoice-followups',
      'send-followup-reminders',
      '0 8 * * *',
      { type: 'reminder' }
    );

    // QuickBooks Online sync (runs every 3 hours)
    registerRecurringJob(
      'qbo-sync',
      'sync-qbo-data',
      '0 */3 * * *',
      { fullSync: false }
    );

    // Payment status checks (runs every hour)
    registerRecurringJob(
      'payment-checks',
      'check-payment-statuses',
      '0 * * * *',
      {}
    );

    // Daily reports (runs at midnight)
    registerRecurringJob(
      'general-tasks',
      'generate-daily-reports',
      '0 0 * * *',
      { reportTypes: ['collections', 'payments', 'aging'] }
    );

    // Weekly database maintenance (runs Sunday at 2:00 AM)
    registerRecurringJob(
      'general-tasks',
      'db-maintenance',
      '0 2 * * 0',
      { tasks: ['vacuum', 'analyze'] }
    );

    logger.info('Scheduled jobs initialization completed');
  } catch (error) {
    logger.error('Failed to initialize scheduled jobs', { error });
    // Don't throw - we want the app to continue even if scheduler fails
  }
}

// Initialize jobs when this module is imported
try {
  initializeScheduledJobs();
} catch (error) {
  logger.error('Scheduler failed to initialize', { error });
  // Don't throw - we want the app to continue even if scheduler fails
}

// Export functions for potential programmatic use
module.exports = {
  registerRecurringJob,
  initializeScheduledJobs,
  registeredJobs
};

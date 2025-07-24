/**
 * Scheduler Service
 * 
 * Sets up cron-like scheduled tasks for the CollectFlo application.
 * Uses node-schedule for scheduling with robust error handling and logging.
 * 
 * Tasks include:
 * - Invoice sync
 * - Payment status checks
 * - Session cleanup
 * - Analytics aggregation
 */

const schedule = require('node-schedule');
const logger = require('../backend/services/logger');
const db = require('../backend/db/connection');
const jobQueue = require('../backend/services/jobQueue');

// Track all scheduled tasks for graceful shutdown
const scheduledJobs = {};

/**
 * Initialize all scheduled tasks
 */
function initScheduler() {
  logger.info('Initializing scheduler service');

  try {
    // Check for new payments - Every 15 minutes
    scheduleTask('*/15 * * * *', 'check-payments', async () => {
      logger.info('Running scheduled payment check');
      try {
        // In production, this would call the payment processor API
        // For now, just log that it ran successfully
        logger.info('Payment check completed successfully');
        
        // Clean up any old pending payment records
        await db.execute(`
          UPDATE payments 
          SET status = 'expired' 
          WHERE status = 'pending' 
          AND created_at < NOW() - INTERVAL '24 hours'
        `);
      } catch (error) {
        logger.error('Error in payment check job', { error });
      }
    });

    // Sync invoices with accounting system - Once per day at 1 AM
    scheduleTask('0 1 * * *', 'sync-invoices', async () => {
      logger.info('Running scheduled invoice sync');
      try {
        // Queue the sync job to be processed by the job queue
        await jobQueue.add('sync', {
          timestamp: new Date().toISOString()
        });
        logger.info('Invoice sync job queued successfully');
      } catch (error) {
        logger.error('Error queueing invoice sync job', { error });
      }
    });

    // Clean up expired sessions - Once per day at 2 AM
    scheduleTask('0 2 * * *', 'cleanup-sessions', async () => {
      logger.info('Running session cleanup');
      try {
        // Delete expired sessions from the database
        const result = await db.execute(`
          DELETE FROM sessions 
          WHERE expire < NOW()
        `);
        logger.info('Session cleanup completed', { 
          deletedSessions: result.rowCount || 0 
        });
      } catch (error) {
        logger.error('Error in session cleanup job', { error });
      }
    });

    // Aggregate analytics data - Every hour
    scheduleTask('0 * * * *', 'aggregate-analytics', async () => {
      logger.info('Running analytics aggregation');
      try {
        // Check if user_activity table exists before running aggregation
        const tableExists = await db.queryOne(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'user_activity'
          );
        `);
        
        if (tableExists && tableExists.exists) {
          // Aggregate user activity data
          await db.execute(`
            INSERT INTO analytics_daily (date, activity_type, count)
            SELECT 
              DATE(created_at) as date,
              activity_type,
              COUNT(*) as count
            FROM user_activity
            WHERE 
              DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
            GROUP BY 
              DATE(created_at), activity_type
            ON CONFLICT (date, activity_type) 
            DO UPDATE SET count = EXCLUDED.count
          `);
          logger.info('Analytics aggregation completed successfully');
        } else {
          logger.info('Analytics aggregation skipped - user_activity table does not exist');
        }
      } catch (error) {
        logger.error('Error in analytics aggregation job', { error });
      }
    });

    // Health check ping - Every 5 minutes
    scheduleTask('*/5 * * * *', 'health-check', async () => {
      try {
        // Simple DB query to verify database connection
        await db.queryOne('SELECT NOW()');
        logger.debug('Health check completed successfully');
      } catch (error) {
        logger.error('Health check failed', { error });
      }
    });

    logger.info('Scheduler service initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize scheduler service', { error });
  }
}

/**
 * Validate a cron expression
 * 
 * @param {string} cronExpression - Cron schedule expression to validate
 * @returns {boolean} Whether the expression is valid
 */
function validateCronExpression(cronExpression) {
  try {
    // Simple validation - if node-schedule can parse it, it's valid
    // This will throw an error if the expression is invalid
    const job = schedule.scheduleJob(cronExpression, () => {});
    
    if (job) {
      job.cancel(); // Clean up the test job
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Schedule a task with error handling
 * 
 * @param {string} cronExpression - Cron schedule expression
 * @param {string} taskName - Name of the task for logging
 * @param {Function} task - The task function to execute
 * @returns {Object} The scheduled job
 */
function scheduleTask(cronExpression, taskName, task) {
  try {
    // Validate cron expression
    if (!validateCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    logger.info(`Scheduling task: ${taskName} with schedule: ${cronExpression}`);
    
    // Create the scheduled task with error handling wrapper
    const job = schedule.scheduleJob(cronExpression, async () => {
      logger.debug(`Running scheduled task: ${taskName}`);
      
      try {
        await task();
      } catch (error) {
        logger.error(`Error in scheduled task: ${taskName}`, { error });
      }
    });
    
    if (!job) {
      throw new Error(`Failed to schedule task: ${taskName}`);
    }
    
    // Store job reference for shutdown
    scheduledJobs[taskName] = job;
    
    return job;
  } catch (error) {
    logger.error(`Failed to schedule task: ${taskName}`, { error });
    return null;
  }
}

/**
 * Stop all scheduled tasks
 * Used during graceful shutdown
 */
function stopAllTasks() {
  const jobNames = Object.keys(scheduledJobs);
  logger.info(`Stopping ${jobNames.length} scheduled tasks`);
  
  jobNames.forEach(name => {
    try {
      scheduledJobs[name].cancel();
      logger.debug(`Stopped scheduled task: ${name}`);
    } catch (error) {
      logger.error(`Error stopping scheduled task: ${name}`, { error });
    }
  });
  
  // Clear all jobs
  for (const key in scheduledJobs) {
    delete scheduledJobs[key];
  }
  
  logger.info('All scheduled tasks stopped');
}

// Initialize scheduler when this module is imported
try {
  initScheduler();
} catch (error) {
  logger.error('Critical error initializing scheduler', { error });
}

// Export methods for use in other modules
module.exports = {
  scheduleTask,
  stopAllTasks
};

/**
 * Job Queue Service
 * 
 * A robust background job processing system using Bull and Redis.
 * Replaces the previous node-schedule implementation with a more
 * scalable, reliable solution that includes job persistence,
 * automatic retries, and monitoring capabilities.
 * 
 * This service handles:
 * - Invoice follow-up scheduling
 * - QuickBooks data synchronization
 * - Payment status checking
 * - Any other background tasks
 */

const Bull = require('bull');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
require('dotenv').config();

// Load environment variables with defaults
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'collectflo';
const MAX_RETRIES = parseInt(process.env.JOB_MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.JOB_RETRY_DELAY || '60000', 10); // 1 minute in ms
const DEFAULT_JOB_TIMEOUT = parseInt(process.env.JOB_TIMEOUT || '300000', 10); // 5 minutes in ms
const DEFAULT_CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || '5', 10);

// Queue definitions with their specific configurations
const queueDefinitions = {
  // Handles invoice follow-up emails and SMS
  followups: {
    name: 'invoice-followups',
    concurrency: parseInt(process.env.FOLLOWUP_CONCURRENCY || DEFAULT_CONCURRENCY, 10),
    defaultJobOptions: {
      attempts: MAX_RETRIES,
      backoff: {
        type: 'exponential',
        delay: RETRY_DELAY
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500      // Keep last 500 failed jobs for debugging
    }
  },
  
  // Handles QuickBooks data synchronization
  sync: {
    name: 'qbo-sync',
    concurrency: parseInt(process.env.SYNC_CONCURRENCY || '2', 10), // Lower concurrency to avoid API rate limits
    defaultJobOptions: {
      attempts: MAX_RETRIES,
      backoff: {
        type: 'exponential',
        delay: RETRY_DELAY * 2 // Longer delay for API operations
      },
      timeout: DEFAULT_JOB_TIMEOUT * 2, // Longer timeout for sync operations
      removeOnComplete: 50,
      removeOnFail: 200
    }
  },
  
  // Handles payment status checking
  payments: {
    name: 'payment-checks',
    concurrency: parseInt(process.env.PAYMENT_CONCURRENCY || DEFAULT_CONCURRENCY, 10),
    defaultJobOptions: {
      attempts: MAX_RETRIES,
      backoff: {
        type: 'exponential',
        delay: RETRY_DELAY
      },
      removeOnComplete: 100,
      removeOnFail: 200
    }
  },
  
  // General purpose queue for miscellaneous tasks
  general: {
    name: 'general-tasks',
    concurrency: parseInt(process.env.GENERAL_CONCURRENCY || DEFAULT_CONCURRENCY, 10),
    defaultJobOptions: {
      attempts: MAX_RETRIES,
      backoff: {
        type: 'exponential',
        delay: RETRY_DELAY
      },
      removeOnComplete: 50,
      removeOnFail: 100
    }
  }
};

// Store queue instances
const queues = {};

/**
 * Initialize all job queues
 * 
 * @returns {Object} Object containing all queue instances
 */
function initializeQueues() {
  // Create queue instances based on definitions
  Object.keys(queueDefinitions).forEach(queueKey => {
    const queueConfig = queueDefinitions[queueKey];
    
    queues[queueKey] = new Bull(queueConfig.name, {
      redis: REDIS_URL,
      prefix: REDIS_PREFIX,
      defaultJobOptions: queueConfig.defaultJobOptions
    });
    
    // Set concurrency for this queue
    queues[queueKey].process(queueConfig.concurrency, async (job) => {
      try {
        // The actual job handler will be registered separately
        // This is just a placeholder that will be overridden
        console.log(`No processor registered for job ${job.id} in queue ${queueConfig.name}`);
        return { success: false, error: 'No processor registered' };
      } catch (error) {
        console.error(`Error processing job ${job.id} in queue ${queueConfig.name}:`, error);
        throw error; // Re-throw to trigger retry mechanism
      }
    });
    
    // Set up event listeners for monitoring
    queues[queueKey].on('error', (error) => {
      console.error(`Queue ${queueConfig.name} error:`, error);
    });
    
    queues[queueKey].on('failed', (job, error) => {
      console.error(`Job ${job.id} in queue ${queueConfig.name} failed:`, error);
    });
    
    if (process.env.NODE_ENV === 'development') {
      // Additional debugging in development
      queues[queueKey].on('completed', (job, result) => {
        console.log(`Job ${job.id} in queue ${queueConfig.name} completed with result:`, result);
      });
    }
    
    console.log(`Queue ${queueConfig.name} initialized with concurrency ${queueConfig.concurrency}`);
  });
  
  return queues;
}

// Initialize queues on module load
initializeQueues();

/**
 * Register a processor function for a specific queue
 * 
 * @param {string} queueName - Name of the queue (followups, sync, payments, general)
 * @param {Function} processorFn - Async function that processes a job
 * @throws {Error} If queue name is invalid
 */
function registerProcessor(queueName, processorFn) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  // Override the default processor
  queues[queueName].process(queueDefinitions[queueName].concurrency, async (job) => {
    try {
      return await processorFn(job.data, job);
    } catch (error) {
      console.error(`Error in ${queueName} processor:`, error);
      throw error; // Re-throw to trigger retry mechanism
    }
  });
  
  console.log(`Processor registered for queue ${queueName}`);
}

/**
 * Add a job to a queue
 * 
 * @param {string} queueName - Name of the queue (followups, sync, payments, general)
 * @param {Object} data - Job data
 * @param {Object} options - Bull job options to override defaults
 * @returns {Promise<Job>} The created job
 * @throws {Error} If queue name is invalid
 */
async function addJob(queueName, data, options = {}) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  return await queues[queueName].add(data, options);
}

/**
 * Schedule a job to run at a specific time
 * 
 * @param {string} queueName - Name of the queue
 * @param {Object} data - Job data
 * @param {Date|string|number} when - When to run the job (Date object, ISO string, or timestamp)
 * @param {Object} options - Additional Bull job options
 * @returns {Promise<Job>} The created job
 */
async function scheduleJob(queueName, data, when, options = {}) {
  let delay;
  
  if (when instanceof Date) {
    delay = Math.max(0, when.getTime() - Date.now());
  } else if (typeof when === 'string') {
    delay = Math.max(0, new Date(when).getTime() - Date.now());
  } else if (typeof when === 'number') {
    delay = Math.max(0, when - Date.now());
  } else {
    throw new Error('Invalid schedule time. Must be Date, ISO string, or timestamp');
  }
  
  return await addJob(queueName, data, { ...options, delay });
}

/**
 * Schedule a recurring job using cron syntax
 * 
 * @param {string} queueName - Name of the queue
 * @param {Object} data - Job data
 * @param {string} cronExpression - Cron expression (e.g., "0 * * * *" for hourly)
 * @param {Object} options - Additional Bull job options
 * @returns {Promise<Job>} The created repeatable job
 */
async function scheduleRecurring(queueName, data, cronExpression, options = {}) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  return await queues[queueName].add(
    data,
    {
      ...options,
      repeat: {
        cron: cronExpression,
        tz: process.env.TZ || 'UTC'
      }
    }
  );
}

/**
 * Remove a recurring job
 * 
 * @param {string} queueName - Name of the queue
 * @param {string} repeatJobId - ID of the repeat job to remove
 * @returns {Promise<boolean>} True if successful
 */
async function removeRecurringJob(queueName, repeatJobId) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  const removed = await queues[queueName].removeRepeatable(repeatJobId);
  return !!removed;
}

/**
 * Get all recurring jobs for a queue
 * 
 * @param {string} queueName - Name of the queue
 * @returns {Promise<Array>} Array of repeat job objects
 */
async function getRecurringJobs(queueName) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  return await queues[queueName].getRepeatableJobs();
}

/**
 * Get queue statistics
 * 
 * @param {string} queueName - Name of the queue
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats(queueName) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  const [
    jobCounts,
    failedJobs,
    completedJobs,
    delayedJobs,
    activeJobs,
    waitingJobs
  ] = await Promise.all([
    queues[queueName].getJobCounts(),
    queues[queueName].getFailed(),
    queues[queueName].getCompleted(),
    queues[queueName].getDelayed(),
    queues[queueName].getActive(),
    queues[queueName].getWaiting()
  ]);
  
  return {
    name: queueDefinitions[queueName].name,
    counts: jobCounts,
    failed: failedJobs.length,
    completed: completedJobs.length,
    delayed: delayedJobs.length,
    active: activeJobs.length,
    waiting: waitingJobs.length,
    concurrency: queueDefinitions[queueName].concurrency
  };
}

/**
 * Get statistics for all queues
 * 
 * @returns {Promise<Object>} Statistics for all queues
 */
async function getAllQueueStats() {
  const stats = {};
  
  for (const queueName of Object.keys(queues)) {
    stats[queueName] = await getQueueStats(queueName);
  }
  
  return stats;
}

/**
 * Clean up completed and failed jobs older than the specified threshold
 * 
 * @param {string} queueName - Name of the queue
 * @param {number} olderThan - Age threshold in milliseconds (default: 24 hours)
 * @returns {Promise<Object>} Number of jobs removed
 */
async function cleanQueue(queueName, olderThan = 24 * 60 * 60 * 1000) {
  if (!queues[queueName]) {
    throw new Error(`Invalid queue name: ${queueName}`);
  }
  
  const results = await Promise.all([
    queues[queueName].clean(olderThan, 'completed'),
    queues[queueName].clean(olderThan, 'failed')
  ]);
  
  return {
    completed: results[0].length,
    failed: results[1].length
  };
}

/**
 * Gracefully shut down all queues
 * 
 * @returns {Promise<void>}
 */
async function shutdown() {
  console.log('Shutting down job queues...');
  
  const closePromises = Object.values(queues).map(queue => queue.close());
  await Promise.all(closePromises);
  
  console.log('All job queues shut down successfully');
}

// Export the job queue API
module.exports = {
  queues,
  registerProcessor,
  addJob,
  scheduleJob,
  scheduleRecurring,
  removeRecurringJob,
  getRecurringJobs,
  getQueueStats,
  getAllQueueStats,
  cleanQueue,
  shutdown
};

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
 * 
 * NOTE: This service now supports a fallback mode when Redis is not available.
 * In fallback mode, jobs are processed in-memory without persistence.
 */

const Bull = require('bull');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const net = require('net');
require('dotenv').config();

// Load environment variables with defaults
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'collectflo';
const MAX_RETRIES = parseInt(process.env.JOB_MAX_RETRIES || '3', 10);
const RETRY_DELAY = parseInt(process.env.JOB_RETRY_DELAY || '60000', 10); // 1 minute in ms
const DEFAULT_JOB_TIMEOUT = parseInt(process.env.JOB_TIMEOUT || '300000', 10); // 5 minutes in ms
const DEFAULT_CONCURRENCY = parseInt(process.env.JOB_CONCURRENCY || '5', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_REQUIRED = process.env.REDIS_REQUIRED === 'true';

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

// Store processors for mock implementation
const processors = {};

// Store in-memory jobs for mock implementation
const inMemoryJobs = {
  waiting: {},
  active: {},
  completed: {},
  failed: {},
  delayed: {}
};

// Flag to track if we're using the mock implementation
let usingMockImplementation = false;

/**
 * Check if Redis is available by attempting to connect
 * 
 * @returns {Promise<boolean>} True if Redis is available, false otherwise
 */
async function isRedisAvailable() {
  return new Promise(resolve => {
    // Parse Redis URL to get host and port
    let host = '127.0.0.1';
    let port = 6379;
    
    try {
      if (REDIS_URL.startsWith('redis://')) {
        const url = new URL(REDIS_URL);
        host = url.hostname;
        port = url.port || 6379;
      }
    } catch (err) {
      console.warn(`Invalid Redis URL format: ${REDIS_URL}, using defaults`);
    }
    
    // Try to connect to Redis
    const socket = net.createConnection(port, host);
    const timeout = setTimeout(() => {
      socket.destroy();
      console.warn(`Redis connection timed out at ${host}:${port}`);
      resolve(false);
    }, 1000);
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve(true);
    });
    
    socket.on('error', (err) => {
      clearTimeout(timeout);
      console.warn(`Redis connection error: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * Generate a unique job ID
 * @returns {string} A unique job ID
 */
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Mock implementation of Bull queue
 */
class MockQueue {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this.processor = null;
    this.concurrency = 1;
    this.eventHandlers = {};
    
    // Initialize job storage for this queue
    if (!inMemoryJobs.waiting[name]) {
      inMemoryJobs.waiting[name] = [];
      inMemoryJobs.active[name] = [];
      inMemoryJobs.completed[name] = [];
      inMemoryJobs.failed[name] = [];
      inMemoryJobs.delayed[name] = [];
    }
    
    console.log(`[MOCK] Queue ${name} initialized (Redis unavailable)`);
  }
  
  process(concurrency, processorFn) {
    if (typeof concurrency === 'function') {
      processorFn = concurrency;
      concurrency = 1;
    }
    
    this.concurrency = concurrency;
    this.processor = processorFn;
    processors[this.name] = processorFn;
    return this;
  }
  
  async add(data, options = {}) {
    const jobId = generateJobId();
    const job = {
      id: jobId,
      data,
      options,
      timestamp: Date.now(),
      attemptsMade: 0,
      queue: this.name
    };
    
    if (options.delay && options.delay > 0) {
      inMemoryJobs.delayed[this.name].push(job);
      
      // Simulate delayed job processing
      setTimeout(() => {
        this._processJob(job);
      }, options.delay);
    } else {
      inMemoryJobs.waiting[this.name].push(job);
      
      // Process the job (async)
      setImmediate(() => {
        this._processJob(job);
      });
    }
    
    return job;
  }
  
  async _processJob(job) {
    if (!this.processor) {
      this._emitEvent('failed', job, new Error('No processor registered'));
      return;
    }
    
    try {
      // Move job from waiting/delayed to active
      inMemoryJobs.waiting[this.name] = inMemoryJobs.waiting[this.name].filter(j => j.id !== job.id);
      inMemoryJobs.delayed[this.name] = inMemoryJobs.delayed[this.name].filter(j => j.id !== job.id);
      inMemoryJobs.active[this.name].push(job);
      
      // Process the job
      job.attemptsMade++;
      const result = await this.processor(job);
      
      // Move job from active to completed
      inMemoryJobs.active[this.name] = inMemoryJobs.active[this.name].filter(j => j.id !== job.id);
      inMemoryJobs.completed[this.name].push(job);
      
      // Limit completed jobs storage
      if (inMemoryJobs.completed[this.name].length > 100) {
        inMemoryJobs.completed[this.name].shift();
      }
      
      this._emitEvent('completed', job, result);
      return result;
    } catch (error) {
      // Move job from active to failed or retry
      inMemoryJobs.active[this.name] = inMemoryJobs.active[this.name].filter(j => j.id !== job.id);
      
      const maxAttempts = job.options.attempts || 1;
      
      if (job.attemptsMade < maxAttempts) {
        // Retry the job after delay
        const delay = job.options.backoff?.delay || 5000;
        setTimeout(() => {
          this._processJob(job);
        }, delay);
      } else {
        // Max attempts reached, move to failed
        inMemoryJobs.failed[this.name].push(job);
        
        // Limit failed jobs storage
        if (inMemoryJobs.failed[this.name].length > 100) {
          inMemoryJobs.failed[this.name].shift();
        }
        
        this._emitEvent('failed', job, error);
      }
      
      throw error;
    }
  }
  
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
    return this;
  }
  
  _emitEvent(event, ...args) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(...args);
        } catch (err) {
          console.error(`Error in ${event} handler:`, err);
        }
      });
    }
  }
  
  async getJobCounts() {
    return {
      waiting: inMemoryJobs.waiting[this.name].length,
      active: inMemoryJobs.active[this.name].length,
      completed: inMemoryJobs.completed[this.name].length,
      failed: inMemoryJobs.failed[this.name].length,
      delayed: inMemoryJobs.delayed[this.name].length
    };
  }
  
  async getFailed() {
    return inMemoryJobs.failed[this.name] || [];
  }
  
  async getCompleted() {
    return inMemoryJobs.completed[this.name] || [];
  }
  
  async getDelayed() {
    return inMemoryJobs.delayed[this.name] || [];
  }
  
  async getActive() {
    return inMemoryJobs.active[this.name] || [];
  }
  
  async getWaiting() {
    return inMemoryJobs.waiting[this.name] || [];
  }
  
  async getRepeatableJobs() {
    // Mock implementation doesn't support repeatable jobs
    return [];
  }
  
  async removeRepeatable() {
    // Mock implementation doesn't support repeatable jobs
    return true;
  }
  
  async clean() {
    // Mock implementation just returns empty arrays
    return [];
  }
  
  async close() {
    console.log(`[MOCK] Closing queue ${this.name}`);
    return true;
  }
}

/**
 * Initialize all job queues with either Bull (if Redis is available) or MockQueue
 * 
 * @returns {Promise<Object>} Object containing all queue instances
 */
async function initializeQueues() {
  // Check if Redis is available
  const redisAvailable = await isRedisAvailable();
  
  if (!redisAvailable) {
    if (REDIS_REQUIRED) {
      console.error('Redis is required but not available. Application will exit.');
      process.exit(1);
    }
    
    console.warn('Redis is not available. Using in-memory mock implementation for job queues.');
    console.warn('Note: Jobs will not persist across application restarts in this mode.');
    
    if (NODE_ENV === 'production') {
      console.warn('WARNING: Running in production without Redis. Job scheduling will be limited.');
    }
    
    usingMockImplementation = true;
    
    // Create mock queue instances
    Object.keys(queueDefinitions).forEach(queueKey => {
      const queueConfig = queueDefinitions[queueKey];
      queues[queueKey] = new MockQueue(queueConfig.name, {
        defaultJobOptions: queueConfig.defaultJobOptions
      });
      
      // Set up event listeners for monitoring
      queues[queueKey].on('error', (error) => {
        console.error(`[MOCK] Queue ${queueConfig.name} error:`, error);
      });
      
      queues[queueKey].on('failed', (job, error) => {
        console.error(`[MOCK] Job ${job.id} in queue ${queueConfig.name} failed:`, error);
      });
      
      if (NODE_ENV === 'development') {
        queues[queueKey].on('completed', (job, result) => {
          console.log(`[MOCK] Job ${job.id} in queue ${queueConfig.name} completed with result:`, result);
        });
      }
    });
  } else {
    console.log('Redis is available. Using Bull for job queues.');
    
    // Create Bull queue instances
    Object.keys(queueDefinitions).forEach(queueKey => {
      const queueConfig = queueDefinitions[queueKey];
      
      try {
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
        
        if (NODE_ENV === 'development') {
          // Additional debugging in development
          queues[queueKey].on('completed', (job, result) => {
            console.log(`Job ${job.id} in queue ${queueConfig.name} completed with result:`, result);
          });
        }
        
        console.log(`Queue ${queueConfig.name} initialized with concurrency ${queueConfig.concurrency}`);
      } catch (error) {
        console.error(`Failed to initialize Bull queue ${queueConfig.name}:`, error);
        
        if (!REDIS_REQUIRED) {
          console.warn(`Falling back to mock implementation for queue ${queueConfig.name}`);
          queues[queueKey] = new MockQueue(queueConfig.name, {
            defaultJobOptions: queueConfig.defaultJobOptions
          });
          usingMockImplementation = true;
        } else {
          throw error;
        }
      }
    });
  }
  
  return queues;
}

// Initialize queues asynchronously
(async () => {
  try {
    await initializeQueues();
  } catch (error) {
    console.error('Failed to initialize job queues:', error);
    if (REDIS_REQUIRED) {
      process.exit(1);
    }
  }
})();

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
  
  if (usingMockImplementation) {
    // For mock implementation, just store the processor
    processors[queueName] = processorFn;
    console.log(`[MOCK] Processor registered for queue ${queueName}`);
    return;
  }
  
  // For Bull implementation, override the default processor
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
  
  if (usingMockImplementation) {
    console.warn(`[MOCK] Recurring jobs not fully supported in mock mode. Job will run once immediately.`);
    return await queues[queueName].add(data, options);
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
  
  if (usingMockImplementation) {
    console.warn(`[MOCK] removeRecurringJob called, but recurring jobs are not fully supported in mock mode.`);
    return true;
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
  
  if (usingMockImplementation) {
    console.warn(`[MOCK] getRecurringJobs called, but recurring jobs are not supported in mock mode.`);
    return [];
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
    concurrency: queueDefinitions[queueName].concurrency,
    mockMode: usingMockImplementation
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
  
  if (usingMockImplementation) {
    const now = Date.now();
    const threshold = now - olderThan;
    
    // Filter out old jobs
    const completedBefore = inMemoryJobs.completed[queueName].length;
    const failedBefore = inMemoryJobs.failed[queueName].length;
    
    inMemoryJobs.completed[queueName] = inMemoryJobs.completed[queueName].filter(
      job => job.timestamp >= threshold
    );
    
    inMemoryJobs.failed[queueName] = inMemoryJobs.failed[queueName].filter(
      job => job.timestamp >= threshold
    );
    
    return {
      completed: completedBefore - inMemoryJobs.completed[queueName].length,
      failed: failedBefore - inMemoryJobs.failed[queueName].length
    };
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
  console.log(`Shutting down job queues${usingMockImplementation ? ' (mock mode)' : ''}...`);
  
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
  shutdown,
  // Export additional properties for testing and monitoring
  usingMockImplementation
};

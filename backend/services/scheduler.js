/**
 * Scheduler Service
 * 
 * Manages scheduled background jobs for the application.
 * Uses node-schedule to reliably run tasks at specified intervals.
 */

const schedule = require('node-schedule');
const logger = require('./logger');
const paymentService = require('./paymentService');

class Scheduler {
  constructor() {
    this.jobs = {};
    this.initialized = false;
  }

  /**
   * Initialize the scheduler and register all jobs
   */
  initialize() {
    if (this.initialized) {
      logger.warn('Scheduler already initialized');
      return;
    }

    logger.info('Initializing scheduler service');
    
    try {
      // Register all scheduled jobs
      this.registerJobs();
      this.initialized = true;
      logger.info('Scheduler initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler', { error });
      // Don't mark as initialized so we can retry later if needed
    }
  }

  /**
   * Register all scheduled jobs
   */
  registerJobs() {
    // Check expired payments every hour
    this.registerJob('expiredPayments', '0 * * * *', this.checkExpiredPayments);
    
    // Add more scheduled jobs here as needed
    // this.registerJob('jobName', 'cronPattern', this.jobFunction);
  }

  /**
   * Register a single job with error handling
   * 
   * @param {string} name - Job name
   * @param {string} cronPattern - Cron pattern for scheduling
   * @param {Function} jobFunction - Function to execute
   */
  registerJob(name, cronPattern, jobFunction) {
    try {
      logger.info(`Registering scheduled job: ${name}`, { cronPattern });
      
      // Create a wrapper that adds error handling
      const safeJobFunction = async () => {
        const startTime = Date.now();
        logger.info(`Running scheduled job: ${name}`);
        
        try {
          await jobFunction.call(this);
          const duration = Date.now() - startTime;
          logger.info(`Completed scheduled job: ${name}`, { duration });
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error(`Error in scheduled job: ${name}`, { 
            error: error.message,
            stack: error.stack,
            duration 
          });
          // Job errors are caught here to prevent crashing the scheduler
        }
      };
      
      // Schedule the job
      this.jobs[name] = schedule.scheduleJob(cronPattern, safeJobFunction);
      
      logger.info(`Successfully registered job: ${name}`);
    } catch (error) {
      logger.error(`Failed to register job: ${name}`, { 
        error: error.message,
        cronPattern 
      });
      // Registration errors are caught here to prevent crashing the initialization
    }
  }

  /**
   * Check for expired payments
   * This job will mark pending payments as expired after 24 hours
   */
  async checkExpiredPayments() {
    try {
      logger.info('Starting expired payments check job');
      
      // Use the payment service to check for expired payments
      const result = await paymentService.checkExpiredPayments(24);
      
      if (result.success) {
        if (!result.tableExists) {
          logger.info('Payments table does not exist yet, skipping expired payment check');
        } else {
          logger.info(`Expired payments check completed, ${result.count} payments marked as expired`);
        }
      } else {
        logger.error('Failed to check expired payments', { error: result.error });
      }
    } catch (error) {
      // This try/catch is redundant since we have the wrapper,
      // but it's good practice for clarity and additional context
      logger.error('Error in expired payments check job', { 
        error: error.message,
        stack: error.stack 
      });
    }
  }

  /**
   * Cancel all scheduled jobs
   */
  shutdown() {
    logger.info('Shutting down scheduler');
    
    Object.entries(this.jobs).forEach(([name, job]) => {
      try {
        job.cancel();
        logger.info(`Cancelled scheduled job: ${name}`);
      } catch (error) {
        logger.error(`Error cancelling job: ${name}`, { error: error.message });
      }
    });
    
    this.jobs = {};
    this.initialized = false;
    logger.info('Scheduler shutdown complete');
  }
}

// Create and initialize the scheduler
const scheduler = new Scheduler();

// Don't initialize immediately to allow for controlled startup
// This will be called from the main application entry point
// scheduler.initialize();

module.exports = scheduler;

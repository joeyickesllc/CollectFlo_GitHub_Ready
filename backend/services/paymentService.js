/**
 * Payment Service
 * 
 * Handles payment operations including checking for expired payments,
 * processing payment status updates, and managing payment-related tasks.
 */

const db = require('../db/connection');
const logger = require('./logger');

/**
 * Payment Service class that encapsulates payment-related operations
 */
class PaymentService {
  /**
   * Check if the payments table exists in the database
   * 
   * @returns {Promise<boolean>} True if the table exists, false otherwise
   */
  async tableExists() {
    try {
      const result = await db.queryOne(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'payments'
        ) as exists
      `);
      return result && result.exists;
    } catch (error) {
      logger.error('Error checking if payments table exists:', { error });
      return false;
    }
  }

  /**
   * Execute a database operation with retry logic
   * 
   * @param {Function} operation - Database operation to execute
   * @param {string} operationName - Name of the operation for logging
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} retryDelay - Delay between retries in milliseconds
   * @returns {Promise<any>} Result of the operation
   */
  async withRetry(operation, operationName, maxRetries = 3, retryDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // If table doesn't exist, don't retry
        if (error.code === '42P01') {
          logger.warn(`${operationName} failed: Table does not exist`, { 
            error: error.message,
            attempt
          });
          throw error;
        }
        
        // Log retry attempt
        logger.warn(`${operationName} failed, retrying (${attempt}/${maxRetries})`, { 
          error: error.message,
          attempt
        });
        
        // Wait before retrying
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }
    
    // If we get here, all retries failed
    logger.error(`${operationName} failed after ${maxRetries} attempts`, { 
      error: lastError.message 
    });
    throw lastError;
  }

  /**
   * Check for and update expired payments
   * 
   * @param {number} expirationHours - Hours after which pending payments expire
   * @returns {Promise<{success: boolean, count: number}>} Result of the operation
   */
  async checkExpiredPayments(expirationHours = 24) {
    logger.info('Checking for expired payments', { expirationHours });
    
    try {
      // First check if the payments table exists
      const exists = await this.tableExists();
      if (!exists) {
        logger.info('Payments table does not exist yet, skipping expired payment check');
        return { success: true, count: 0, tableExists: false };
      }
      
      // If table exists, proceed with the update
      const result = await this.withRetry(
        async () => {
          return await db.execute(`
            UPDATE payments 
            SET status = 'expired' 
            WHERE status = 'pending' 
            AND created_at < NOW() - INTERVAL '${expirationHours} hours'
            RETURNING id
          `);
        },
        'Check expired payments'
      );
      
      const count = result.rowCount || 0;
      
      logger.info('Expired payments check completed', { 
        expiredCount: count,
        expirationHours
      });
      
      return { success: true, count, tableExists: true };
    } catch (error) {
      // Handle specific error for table not existing
      if (error.code === '42P01') {
        logger.warn('Payments table does not exist yet, skipping expired payment check');
        return { success: true, count: 0, tableExists: false };
      }
      
      logger.error('Error checking expired payments', { 
        error: error.message,
        stack: error.stack
      });
      
      return { 
        success: false, 
        error: error.message,
        count: 0
      };
    }
  }

  /**
   * Create a new payment record
   * 
   * @param {Object} paymentData - Payment data
   * @returns {Promise<Object>} Created payment
   */
  async createPayment(paymentData) {
    try {
      // Check if table exists first
      const exists = await this.tableExists();
      if (!exists) {
        throw new Error('Payments table does not exist yet');
      }
      
      const { invoice_id, customer_id, amount, currency, payment_method, metadata } = paymentData;
      
      const result = await this.withRetry(
        async () => {
          return await db.queryOne(`
            INSERT INTO payments (
              invoice_id, customer_id, amount, currency, 
              status, payment_method, metadata
            ) VALUES (
              $1, $2, $3, $4, 'pending', $5, $6
            ) RETURNING *
          `, [
            invoice_id, 
            customer_id, 
            amount, 
            currency || 'USD', 
            payment_method, 
            metadata || {}
          ]);
        },
        'Create payment'
      );
      
      logger.info('Payment created', { 
        paymentId: result.id,
        invoiceId: invoice_id,
        amount,
        currency: currency || 'USD'
      });
      
      return result;
    } catch (error) {
      logger.error('Error creating payment', { 
        error: error.message,
        paymentData
      });
      throw error;
    }
  }

  /**
   * Update payment status
   * 
   * @param {string} paymentId - Payment ID
   * @param {string} status - New status
   * @param {Object} updateData - Additional data to update
   * @returns {Promise<Object>} Updated payment
   */
  async updatePaymentStatus(paymentId, status, updateData = {}) {
    try {
      // Build update fields
      const updates = ['status = $1'];
      const values = [status];
      let paramIndex = 2;
      
      // Add additional update fields
      Object.entries(updateData).forEach(([key, value]) => {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      });
      
      // Add payment_date for completed payments
      if (status === 'completed' && !updateData.payment_date) {
        updates.push(`payment_date = NOW()`);
      }
      
      // Add payment ID as the last parameter
      values.push(paymentId);
      
      const result = await this.withRetry(
        async () => {
          return await db.queryOne(`
            UPDATE payments 
            SET ${updates.join(', ')} 
            WHERE id = $${paramIndex}
            RETURNING *
          `, values);
        },
        'Update payment status'
      );
      
      logger.info('Payment status updated', { 
        paymentId,
        status,
        updateData
      });
      
      return result;
    } catch (error) {
      logger.error('Error updating payment status', { 
        error: error.message,
        paymentId,
        status
      });
      throw error;
    }
  }

  /**
   * Get payment by ID
   * 
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Payment object
   */
  async getPayment(paymentId) {
    try {
      return await this.withRetry(
        async () => {
          return await db.queryOne('SELECT * FROM payments WHERE id = $1', [paymentId]);
        },
        'Get payment'
      );
    } catch (error) {
      logger.error('Error getting payment', { 
        error: error.message,
        paymentId
      });
      throw error;
    }
  }

  /**
   * Get payments for an invoice
   * 
   * @param {string} invoiceId - Invoice ID
   * @returns {Promise<Array>} Array of payment objects
   */
  async getPaymentsForInvoice(invoiceId) {
    try {
      return await this.withRetry(
        async () => {
          return await db.query(
            'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC',
            [invoiceId]
          );
        },
        'Get payments for invoice'
      );
    } catch (error) {
      // Handle table not existing gracefully
      if (error.code === '42P01') {
        logger.warn('Payments table does not exist yet, returning empty array');
        return [];
      }
      
      logger.error('Error getting payments for invoice', { 
        error: error.message,
        invoiceId
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PaymentService();

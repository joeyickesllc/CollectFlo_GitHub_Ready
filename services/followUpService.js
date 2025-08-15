/**
 * Follow-Up Service
 * Core service for managing invoice follow-up scheduling and processing
 */

const db = require('../backend/db/connection');
const logger = require('../backend/services/logger');

/**
 * Default follow-up rules configuration
 * Companies can customize these rules
 */
const DEFAULT_FOLLOWUP_RULES = [
  {
    name: 'Pre-Due Reminder',
    trigger_days_overdue: -1,
    follow_up_type: 'email',
    template_type: 'pre_due_reminder',
    active: true
  },
  {
    name: 'Due Date Notice',
    trigger_days_overdue: 0,
    follow_up_type: 'email',
    template_type: 'due_date_notice',
    active: true
  },
  {
    name: 'First Reminder',
    trigger_days_overdue: 7,
    follow_up_type: 'email',
    template_type: 'gentle_reminder',
    active: true
  },
  {
    name: 'Second Reminder', 
    trigger_days_overdue: 10,
    follow_up_type: 'email',
    template_type: 'second_reminder',
    active: true
  },
  {
    name: 'Third Reminder',
    trigger_days_overdue: 14,
    follow_up_type: 'email',
    template_type: 'firm_reminder',
    active: true
  },
  {
    name: 'Fourth Reminder',
    trigger_days_overdue: 21,
    follow_up_type: 'email',
    template_type: 'fourth_reminder',
    active: true
  },
  {
    name: 'Final Notice',
    trigger_days_overdue: 28,
    follow_up_type: 'email',
    template_type: 'final_notice',
    active: true
  },
  {
    name: 'Phone Call Follow-up',
    trigger_days_overdue: 30,
    follow_up_type: 'call',
    template_type: 'phone_script',
    active: false // Disabled by default, requires manual setup
  }
];

/**
 * Get follow-up rules for a company
 * @param {number} companyId - Company ID
 * @returns {Array} Follow-up rules
 */
async function getFollowUpRules(companyId) {
  try {
    const rules = await db.query(
      'SELECT * FROM company_settings WHERE company_id = $1 AND setting_key = $2',
      [companyId, 'followup_rules']
    );
    
    if (rules.length > 0) {
      return JSON.parse(rules[0].setting_value);
    }
    
    // Return default rules if none configured
    return DEFAULT_FOLLOWUP_RULES;
  } catch (error) {
    logger.error('Error getting follow-up rules', { error: error.message, companyId });
    return DEFAULT_FOLLOWUP_RULES;
  }
}

/**
 * Save follow-up rules for a company
 * @param {number} companyId - Company ID
 * @param {Array} rules - Follow-up rules
 */
async function saveFollowUpRules(companyId, rules) {
  try {
    const existingRule = await db.queryOne(
      'SELECT id FROM company_settings WHERE company_id = $1 AND setting_key = $2',
      [companyId, 'followup_rules']
    );
    
    if (existingRule) {
      await db.query(
        'UPDATE company_settings SET setting_value = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(rules), existingRule.id]
      );
    } else {
      await db.query(
        'INSERT INTO company_settings (company_id, setting_key, setting_value, setting_type, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [companyId, 'followup_rules', JSON.stringify(rules), 'json', 'Follow-up scheduling rules']
      );
    }
    
    logger.info('Follow-up rules saved', { companyId, rulesCount: rules.length });
  } catch (error) {
    logger.error('Error saving follow-up rules', { error: error.message, companyId });
    throw error;
  }
}

/**
 * Calculate days overdue for an invoice
 * @param {string} dueDate - Invoice due date (YYYY-MM-DD)
 * @returns {number} Days overdue (negative if not due yet)
 */
function calculateDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of day
  due.setHours(0, 0, 0, 0);
  
  const diffTime = today - due;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Create follow-ups for an invoice based on company rules
 * @param {Object} invoice - Invoice object from QuickBooks
 * @param {number} companyId - Company ID
 * @param {number} customerId - Customer ID (optional)
 */
async function createFollowUpsForInvoice(invoice, companyId, customerId = null) {
  try {
    if (!invoice.due_date || parseFloat(invoice.balance || 0) <= 0) {
      // Skip invoices without due dates or already paid
      return;
    }
    
    const rules = await getFollowUpRules(companyId);
    const activeRules = rules.filter(rule => rule.active);
    
    if (activeRules.length === 0) {
      logger.debug('No active follow-up rules for company', { companyId });
      return;
    }
    
    // Clear existing follow-ups for this invoice to avoid duplicates
    await db.query(
      'DELETE FROM follow_ups WHERE invoice_id = $1 AND status = $2',
      [invoice.invoice_id, 'pending']
    );
    
    logger.info('Creating follow-ups for invoice', { 
      invoiceId: invoice.invoice_id, 
      companyId, 
      rulesCount: activeRules.length 
    });
    
    for (const rule of activeRules) {
      const dueDate = new Date(invoice.due_date);
      const scheduledDate = new Date(dueDate);
      scheduledDate.setDate(scheduledDate.getDate() + rule.trigger_days_overdue);
      
      // Only create follow-ups for future dates or recently past dates
      const now = new Date();
      const maxPastDays = 1; // Allow creating follow-ups up to 1 day in the past
      const minScheduleDate = new Date(now.getTime() - (maxPastDays * 24 * 60 * 60 * 1000));
      
      if (scheduledDate >= minScheduleDate) {
        try {
          await db.query(`
            INSERT INTO follow_ups (
              company_id, customer_id, invoice_id, follow_up_type, status, 
              scheduled_at, message_content, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          `, [
            companyId,
            customerId,
            invoice.invoice_id,
            rule.follow_up_type,
            'pending',
            scheduledDate.toISOString(),
            `${rule.name}: ${rule.template_type} for invoice ${invoice.invoice_id}`
          ]);
          
          logger.debug('Follow-up created', {
            invoiceId: invoice.invoice_id,
            type: rule.follow_up_type,
            scheduledAt: scheduledDate.toISOString(),
            rule: rule.name
          });
        } catch (insertError) {
          logger.error('Failed to create follow-up', {
            error: insertError.message,
            invoiceId: invoice.invoice_id,
            rule: rule.name
          });
        }
      }
    }
    
  } catch (error) {
    logger.error('Error creating follow-ups for invoice', {
      error: error.message,
      invoiceId: invoice.invoice_id,
      companyId
    });
    throw error;
  }
}

/**
 * Process all overdue invoices and create follow-ups
 * This should be called periodically (e.g., daily via cron job)
 * @param {number} companyId - Company ID (optional, processes all companies if not specified)
 */
async function processOverdueInvoices(companyId = null) {
  try {
    logger.info('Starting overdue invoice processing', { companyId });
    
    // Get all companies or specific company
    const companies = companyId 
      ? [{ id: companyId }]
      : await db.query("SELECT id FROM companies c WHERE is_beta = true OR EXISTS (SELECT 1 FROM users u JOIN qbo_tokens qt ON qt.user_id = u.id WHERE u.company_id = c.id)");
    
    let totalInvoicesProcessed = 0;
    let totalFollowUpsCreated = 0;
    
    for (const company of companies) {
      try {
        // Get QuickBooks tokens for this company
        const tokens = await db.queryOne(
          'SELECT * FROM qbo_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1) ORDER BY updated_at DESC LIMIT 1',
          [company.id]
        );
        
        if (!tokens) {
          logger.debug('No QuickBooks tokens found for company', { companyId: company.id });
          continue;
        }
        
        // Here we would fetch invoices from QuickBooks and process them
        // For now, we'll create a placeholder that can be called from the invoices API
        logger.info('Company ready for follow-up processing', { companyId: company.id });
        
      } catch (companyError) {
        logger.error('Error processing company for follow-ups', {
          error: companyError.message,
          companyId: company.id
        });
      }
    }
    
    logger.info('Overdue invoice processing completed', {
      companiesProcessed: companies.length,
      totalInvoicesProcessed,
      totalFollowUpsCreated
    });
    
  } catch (error) {
    logger.error('Error in overdue invoice processing', { error: error.message });
    throw error;
  }
}

/**
 * Get pending follow-ups for a company
 * @param {number} companyId - Company ID
 * @param {number} limit - Maximum number of follow-ups to return
 * @returns {Array} Pending follow-ups
 */
async function getPendingFollowUps(companyId, limit = 50) {
  try {
    // Query follow-ups directly since we use QuickBooks IDs, not local invoice/customer records
    const followUps = await db.query(`
      SELECT 
        f.*,
        f.invoice_id as invoice_number,  -- QuickBooks invoice ID
        NULL as invoice_amount,          -- Will be fetched from QuickBooks when needed
        NULL as customer_name            -- Will be fetched from QuickBooks when needed
      FROM follow_ups f
      WHERE f.company_id = $1 
        AND f.status = 'pending'
        AND f.scheduled_at <= NOW() + INTERVAL '1 hour'
      ORDER BY f.scheduled_at ASC
      LIMIT $2
    `, [companyId, limit]);
    
    return followUps;
  } catch (error) {
    logger.error('Error getting pending follow-ups', { error: error.message, companyId });
    return [];
  }
}

/**
 * Get next follow-up date for an invoice
 * @param {string} invoiceId - Invoice ID
 * @param {number} companyId - Company ID
 * @returns {string|null} Next follow-up date or null
 */
async function getNextFollowUpDate(invoiceId, companyId) {
  try {
    const nextFollowUp = await db.queryOne(`
      SELECT scheduled_at
      FROM follow_ups
      WHERE invoice_id = $1 AND company_id = $2 AND status = 'pending'
      ORDER BY scheduled_at ASC
      LIMIT 1
    `, [invoiceId, companyId]);
    
    return nextFollowUp ? nextFollowUp.scheduled_at : null;
  } catch (error) {
    logger.error('Error getting next follow-up date', { 
      error: error.message, 
      invoiceId, 
      companyId 
    });
    return null;
  }
}

module.exports = {
  getFollowUpRules,
  saveFollowUpRules,
  calculateDaysOverdue,
  createFollowUpsForInvoice,
  processOverdueInvoices,
  getPendingFollowUps,
  getNextFollowUpDate,
  DEFAULT_FOLLOWUP_RULES
};
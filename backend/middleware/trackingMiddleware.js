/**
 * User Activity Tracking Middleware
 * 
 * This middleware tracks various user activities for analytics purposes:
 * - Page visits
 * - Login attempts (successful and failed)
 * - Beta signups
 * - Other user actions
 * 
 * Data is stored in the user_activity table and used for analytics dashboards
 * and conversion tracking.
 */

const db = require('../db/connection');
const logger = require('../services/logger');

// ---------------------------------------------------------------------------
// Tracking state
// ---------------------------------------------------------------------------
// Keep a single in-memory flag so the application only checks/patches the
// `user_activity` table structure (ip_address column) once per lifecycle
// instead of on every request.  This avoids unnecessary queries at runtime.
let userActivityColumnChecked = false;
let sequenceSyncChecked = false;

/**
 * Track page visits
 * 
 * Records when users visit pages, including referral source
 * and user agent information for analytics
 */
exports.trackPageVisit = async (req, res, next) => {
  // Skip tracking for asset requests, API calls, and health checks
  if (
    req.path.includes('.') || 
    req.path.startsWith('/api/') || 
    req.path === '/health' ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }

  try {
    const userId = req.session?.user?.id || null;
    const path = req.path;
    const referrer = req.get('Referrer') || null;
    const userAgent = req.get('User-Agent') || null;
    const source = req.query.source || req.query.utm_source || extractSourceFromReferrer(referrer);
    
    // Store activity asynchronously (don't block request)
    storeActivity({
      user_id: userId,
      activity_type: 'page_visit',
      details: {
        path,
        referrer,
        userAgent,
        source,
        query: req.query
      },
      ip_address: req.ip
    }).catch(err => {
      logger.warn('Failed to track page visit', { error: err, path });
    });
  } catch (error) {
    // Log error but don't interrupt request flow
    logger.warn('Error in trackPageVisit middleware', { error });
  }
  
  next();
};

/**
 * Track login attempts
 * 
 * Records both successful and failed login attempts
 * for security monitoring and analytics
 */
exports.trackLogin = async (req, res, next) => {
  // Capture the original send method to intercept the response
  const originalSend = res.send;
  
  res.send = function(data) {
    // Restore original method to avoid infinite recursion
    res.send = originalSend;
    
    try {
      // Parse response data if it's JSON
      let responseData = data;
      if (typeof data === 'string') {
        try {
          responseData = JSON.parse(data);
        } catch (e) {
          // Not JSON, ignore
        }
      }
      
      // Determine if login was successful
      const isSuccessful = responseData?.success === true;
      const userId = isSuccessful && req.session?.user?.id ? req.session.user.id : null;
      const email = req.body?.email;
      
      // Store activity asynchronously
      storeActivity({
        user_id: userId,
        activity_type: 'login_attempt',
        details: {
          email,
          success: isSuccessful,
          userAgent: req.get('User-Agent')
        },
        ip_address: req.ip
      }).catch(err => {
        logger.warn('Failed to track login attempt', { error: err, email });
      });
    } catch (error) {
      logger.warn('Error in trackLogin middleware', { error });
    }
    
    // Call the original method
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Track beta program signups
 * 
 * Records when users sign up for the beta program
 * for conversion tracking and analytics
 */
exports.trackBetaSignup = async (req, res, next) => {
  // Capture the original send method to intercept the response
  const originalSend = res.send;
  
  res.send = function(data) {
    // Restore original method to avoid infinite recursion
    res.send = originalSend;
    
    try {
      // Parse response data if it's JSON
      let responseData = data;
      if (typeof data === 'string') {
        try {
          responseData = JSON.parse(data);
        } catch (e) {
          // Not JSON, ignore
        }
      }
      
      // Determine if signup was successful
      const isSuccessful = responseData?.success === true;
      const userId = isSuccessful && responseData?.user?.id ? responseData.user.id : null;
      const email = req.body?.email;
      const company = req.body?.company_name || req.body?.companyName;
      
      // Store activity asynchronously
      storeActivity({
        user_id: userId,
        activity_type: 'beta_signup',
        details: {
          email,
          company,
          success: isSuccessful,
          source: req.query.source || req.query.utm_source || extractSourceFromReferrer(req.get('Referrer'))
        },
        ip_address: req.ip
      }).catch(err => {
        logger.warn('Failed to track beta signup', { error: err, email });
      });
    } catch (error) {
      logger.warn('Error in trackBetaSignup middleware', { error });
    }
    
    // Call the original method
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Generic user action tracker
 * 
 * Factory function that creates middleware to track any user action
 * 
 * @param {string} actionType - The type of action to track
 * @param {Function} detailsExtractor - Optional function to extract details from request
 * @returns {Function} Express middleware
 */
exports.trackUserAction = (actionType, detailsExtractor) => {
  return async (req, res, next) => {
    // Capture the original send method to intercept the response
    const originalSend = res.send;
    
    res.send = function(data) {
      // Restore original method to avoid infinite recursion
      res.send = originalSend;
      
      try {
        // Parse response data if it's JSON
        let responseData = data;
        if (typeof data === 'string') {
          try {
            responseData = JSON.parse(data);
          } catch (e) {
            // Not JSON, ignore
          }
        }
        
        // Determine if action was successful
        const isSuccessful = responseData?.success === true;
        const userId = req.session?.user?.id || (isSuccessful && responseData?.user?.id ? responseData.user.id : null);
        
        // Extract details using provided function or default to basic info
        const details = detailsExtractor 
          ? detailsExtractor(req, responseData, isSuccessful)
          : {
              path: req.path,
              method: req.method,
              success: isSuccessful,
              userAgent: req.get('User-Agent')
            };
        
        // Store activity asynchronously
        storeActivity({
          user_id: userId,
          activity_type: actionType,
          details,
          ip_address: req.ip
        }).catch(err => {
          logger.warn(`Failed to track user action: ${actionType}`, { error: err });
        });
      } catch (error) {
        logger.warn(`Error in trackUserAction middleware for ${actionType}`, { error });
      }
      
      // Call the original method
      return originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Ensure the user_activity sequence is properly synchronized
 * This fixes issues where the sequence gets out of sync with existing data
 */
async function ensureSequenceSync() {
  if (sequenceSyncChecked) return;
  
  try {
    // Get the current maximum ID from the table
    const maxIdResult = await db.queryOne('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM user_activity');
    const nextId = maxIdResult?.next_id || 1;
    
    // Get the current sequence value
    const seqResult = await db.queryOne("SELECT nextval('user_activity_id_seq') AS current_seq");
    const currentSeq = seqResult?.current_seq || 1;
    
    // If sequence is behind the actual max ID, fix it
    if (currentSeq <= nextId) {
      await db.execute(`SELECT setval('user_activity_id_seq', $1, false)`, [nextId]);
      logger.info('Fixed user_activity sequence synchronization', {
        oldSequence: currentSeq,
        newSequence: nextId,
        maxTableId: nextId - 1
      });
    }
    
    sequenceSyncChecked = true;
  } catch (error) {
    logger.warn('Failed to check/fix user_activity sequence', { error: error.message });
    // Don't throw - this is a best-effort fix
  }
}

/**
 * Store activity in the database
 * 
 * @param {Object} activity - Activity data to store
 * @param {number|null} activity.user_id - User ID or null for anonymous
 * @param {string} activity.activity_type - Type of activity
 * @param {Object} activity.details - Activity details
 * @param {string} activity.ip_address - IP address
 * @returns {Promise} Database query promise
 */
async function storeActivity({ user_id, activity_type, details, ip_address }) {
  try {
    // Check if the user_activity table exists
    const tableExists = await db.queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'user_activity'
      );
    `);
    
    // If table doesn't exist, create it
    if (!tableExists || !tableExists.exists) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS user_activity (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          activity_type VARCHAR(50) NOT NULL,
          details JSONB NOT NULL,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS user_activity_user_id_idx ON user_activity(user_id);
        CREATE INDEX IF NOT EXISTS user_activity_type_idx ON user_activity(activity_type);
        CREATE INDEX IF NOT EXISTS user_activity_created_at_idx ON user_activity(created_at);
      `);
    }
    
    /* ------------------------------------------------------------------
     * Ensure ip_address column exists (older DBs may miss this column)
     * ------------------------------------------------------------------ */
    if (!userActivityColumnChecked) {
      const colExists = await db.queryOne(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name   = 'user_activity'
             AND column_name  = 'ip_address'
         ) AS exists;`
      );

      if (!colExists || !colExists.exists) {
        logger.info('Adding missing ip_address column to user_activity table');
        await db.execute(`ALTER TABLE user_activity ADD COLUMN ip_address VARCHAR(45);`);
      }
      userActivityColumnChecked = true;
    }
    
    // Insert activity
    // ------------------------------------------------------------------
    // Safety-check: make sure details is ALWAYS a JSON object
    // ------------------------------------------------------------------
    const safeDetails = details || {};

    // Helpful debug log – can be filtered by `activity_type`
    logger.info('Storing user activity', {
      activity_type,
      user_id,
      details_keys: Object.keys(safeDetails)
    });

    // Check and fix sequence if needed before inserting
    await ensureSequenceSync();

    return await db.execute(
      'INSERT INTO user_activity (user_id, activity_type, details, ip_address, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [user_id, activity_type, safeDetails, ip_address]
    );
  } catch (error) {
    // Log error but don't throw - tracking should never break the app
    logger.error('Failed to store user activity', { 
      errorCode: error.code,
      errorMessage: error.message,
      activity_type,
      user_id,
      detailsKeys: details ? Object.keys(details) : 'no details provided'
    });
  }
}

/**
 * Extract source from referrer URL
 * 
 * @param {string|null} referrer - Referrer URL
 * @returns {string|null} Source name or null
 */
function extractSourceFromReferrer(referrer) {
  if (!referrer) return null;
  
  try {
    const url = new URL(referrer);
    const hostname = url.hostname.toLowerCase();
    
    // Extract source from common referrers
    if (hostname.includes('google')) return 'Google';
    if (hostname.includes('bing')) return 'Bing';
    if (hostname.includes('yahoo')) return 'Yahoo';
    if (hostname.includes('facebook') || hostname.includes('fb.com')) return 'Facebook';
    if (hostname.includes('twitter') || hostname.includes('t.co')) return 'Twitter';
    if (hostname.includes('linkedin')) return 'LinkedIn';
    if (hostname.includes('instagram')) return 'Instagram';
    if (hostname.includes('producthunt')) return 'Product Hunt';
    if (hostname.includes('reddit')) return 'Reddit';
    if (hostname.includes('youtube')) return 'YouTube';
    
    // If it's our own domain, it's a direct visit
    if (hostname.includes('collectflo.com') || hostname === 'localhost') return 'Direct';
    
    // Otherwise, just use the hostname
    return hostname;
  } catch (error) {
    return null;
  }
}

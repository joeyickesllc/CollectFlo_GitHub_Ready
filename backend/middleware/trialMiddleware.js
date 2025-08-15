/**
 * Trial Middleware
 * 
 * Handles trial period validation and enforcement for users.
 * Checks if user's trial has expired and blocks access to protected features.
 */

const db = require('../db/connection');
const logger = require('../services/logger');

/**
 * Check if user's trial has expired and update their status accordingly
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {Function} next - Express next function
 */
exports.checkTrialStatus = async (req, res, next) => {
  try {
    // Skip trial check if no authenticated user
    const userId = req.user?.id || req.session?.user?.id;
    if (!userId) {
      return next();
    }

    // Get user's current trial information
    const user = await db.queryOne(
      'SELECT id, subscription_status, trial_end_date, last_trial_check FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return next();
    }

    // Skip if user is not on trial
    if (user.subscription_status !== 'trial') {
      return next();
    }

    // Skip if no trial end date set (shouldn't happen with new signups)
    if (!user.trial_end_date) {
      logger.warn('User on trial but no trial_end_date set', { userId });
      return next();
    }

    const now = new Date();
    const trialEndDate = new Date(user.trial_end_date);

    // Check if trial has expired
    if (now > trialEndDate) {
      // Update user status to expired (only if not already updated recently)
      const lastCheck = user.last_trial_check ? new Date(user.last_trial_check) : null;
      const shouldUpdate = !lastCheck || (now.getTime() - lastCheck.getTime()) > (60 * 60 * 1000); // 1 hour

      if (shouldUpdate) {
        await db.execute(
          'UPDATE users SET subscription_status = $1, last_trial_check = $2 WHERE id = $3',
          ['expired', now, userId]
        );

        logger.info('User trial expired', { 
          userId, 
          trialEndDate: trialEndDate.toISOString(),
          expiredAt: now.toISOString()
        });
      }

      // Block access to protected features
      return res.status(403).json({
        success: false,
        message: 'Your free trial has expired. Please upgrade to continue using CollectFlo.',
        code: 'TRIAL_EXPIRED',
        trial_end_date: trialEndDate.toISOString(),
        redirect: '/trial-expired'
      });
    }

    // Trial is still active - update last check time if needed
    const lastCheck = user.last_trial_check ? new Date(user.last_trial_check) : null;
    if (!lastCheck || (now.getTime() - lastCheck.getTime()) > (24 * 60 * 60 * 1000)) { // 24 hours
      await db.execute(
        'UPDATE users SET last_trial_check = $1 WHERE id = $2',
        [now, userId]
      );
    }

    // Add trial info to request for use in other middleware/routes
    req.trialInfo = {
      status: 'active',
      end_date: trialEndDate,
      days_remaining: Math.ceil((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    };

    next();
  } catch (error) {
    logger.error('Error in trial status check middleware', { error, userId: req.user?.id });
    // Don't block request on middleware error, just log and continue
    next();
  }
};

/**
 * Middleware that only allows access for users with active subscriptions
 * (blocks trial users from certain premium features)
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
exports.requireActiveSubscription = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.session?.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const user = await db.queryOne(
      'SELECT subscription_status FROM users WHERE id = $1',
      [userId]
    );

    if (!user || !['active', 'trial'].includes(user.subscription_status)) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required for this feature',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }

    next();
  } catch (error) {
    logger.error('Error in subscription requirement middleware', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Server error checking subscription status'
    });
  }
};

/**
 * Get trial status for a user (utility function)
 * 
 * @param {number} userId - User ID
 * @returns {Object} Trial status information
 */
exports.getTrialStatus = async (userId) => {
  try {
    const user = await db.queryOne(
      'SELECT subscription_status, trial_start_date, trial_end_date FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const trialEndDate = user.trial_end_date ? new Date(user.trial_end_date) : null;
    const trialStartDate = user.trial_start_date ? new Date(user.trial_start_date) : null;

    return {
      subscription_status: user.subscription_status,
      trial_start_date: trialStartDate,
      trial_end_date: trialEndDate,
      is_trial_active: user.subscription_status === 'trial' && trialEndDate && now <= trialEndDate,
      days_remaining: trialEndDate ? Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 0,
      trial_expired: trialEndDate && now > trialEndDate
    };
  } catch (error) {
    logger.error('Error getting trial status', { error, userId });
    throw error;
  }
};
/**
 * Beta Controller
 * 
 * Handles operations related to the beta program, including
 * beta user signup and beta program statistics.
 */

const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const logger = require('../services/logger');

/**
 * Beta Program Signup
 * 
 * Registers a new user for the beta program with their company
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.signup = async (req, res) => {
  try {
    const { companyName, fullName, email, password } = req.body;
    
    // Validate required fields
    if (!companyName || !fullName || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }
    
    // Check if user already exists
    const existingUser = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Use transaction to ensure company and user are created together
    const result = await db.transaction(async (client) => {
      // Create company
      const companyResult = await client.query(
        'INSERT INTO companies (name, created_at, is_beta) VALUES ($1, NOW(), true) RETURNING id',
        [companyName]
      );
      const companyId = companyResult.rows[0].id;
      
      // Create user
      const userResult = await client.query(
        'INSERT INTO users (name, email, password, company_id, role, is_beta, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, email, name, role',
        [fullName, email, hashedPassword, companyId, 'admin', true]
      );
      
      return {
        user: userResult.rows[0],
        companyId
      };
    });
    
    // Create session for auto-login
    req.session.user = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      company_id: result.companyId,
      role: result.user.role,
      is_beta: true
    };
    
    // Log beta signup
    logger.info(`New beta user signed up: ${email} for company: ${companyName}`, { 
      userId: result.user.id,
      isBeta: true 
    });
    
    // Return success
    return res.status(201).json({
      success: true,
      message: 'Beta signup successful',
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        is_beta: true
      }
    });
  } catch (error) {
    logger.error('Beta signup error:', { error });
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred during beta signup' 
    });
  }
};

/**
 * Get Beta Program Statistics
 * 
 * Retrieves statistics about the beta program, including
 * number of users, companies, and activity metrics
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getStats = async (req, res) => {
  try {
    // Verify user has admin access
    if (!req.session.user || req.session.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to beta statistics'
      });
    }
    
    // Get beta program statistics from database
    const stats = await db.transaction(async (client) => {
      // Get total beta users count
      const usersResult = await client.query(
        'SELECT COUNT(*) as total_users FROM users WHERE is_beta = true'
      );
      
      // Get total beta companies count
      const companiesResult = await client.query(
        'SELECT COUNT(*) as total_companies FROM companies WHERE is_beta = true'
      );
      
      // Get users registered in the last 7 days
      const newUsersResult = await client.query(
        'SELECT COUNT(*) as new_users FROM users WHERE is_beta = true AND created_at > NOW() - INTERVAL \'7 days\''
      );
      
      // Get active users in the last 30 days (users with login activity)
      const activeUsersResult = await client.query(
        'SELECT COUNT(DISTINCT user_id) as active_users FROM user_activity WHERE created_at > NOW() - INTERVAL \'30 days\' AND user_id IN (SELECT id FROM users WHERE is_beta = true)'
      );
      
      return {
        totalUsers: parseInt(usersResult.rows[0].total_users, 10),
        totalCompanies: parseInt(companiesResult.rows[0].total_companies, 10),
        newUsers: parseInt(newUsersResult.rows[0].new_users, 10),
        activeUsers: parseInt(activeUsersResult.rows[0].active_users, 10) || 0
      };
    });
    
    // Add calculated metrics
    stats.activationRate = stats.totalUsers > 0 ? 
      (stats.activeUsers / stats.totalUsers * 100).toFixed(2) + '%' : '0%';
    
    // Log stats access
    logger.info('Beta statistics accessed', { 
      userId: req.session.user.id,
      stats: stats
    });
    
    // Return statistics
    return res.status(200).json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logger.error('Error fetching beta statistics:', { error });
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred while fetching beta statistics' 
    });
  }
};

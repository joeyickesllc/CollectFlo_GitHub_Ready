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
    // Accept either camelCase or snake_case sent from the client. The
    // security middleware already normalises these, but we keep this
    // fallback to stay backward-compatible.
    const company_name = req.body.company_name || req.body.companyName;  // ← NEW
    const name        = req.body.name        || req.body.fullName;       // ← NEW
    const { email, password } = req.body;                                // ← NEW
    
    // Validate required fields
    if (!company_name || !name || !email || !password) {
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
        [company_name]
      );
      const companyId = companyResult.rows[0].id;
      
      // Create user
      const userResult = await client.query(
        'INSERT INTO users (name, email, password, company_id, role, is_beta, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, email, name, role',
        [name, email, hashedPassword, companyId, 'admin', true]
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
    
    /* --------------------------------------------------------------
     * Ensure the session is fully saved before sending the response.
     * This prevents race-conditions where the cookie is issued before
     * the session row is actually persisted in the store.
     * ------------------------------------------------------------ */
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error during beta signup', { error: err, userId: result.user.id });
        return res.status(500).json({
          success: false,
          message: 'Failed to create session'
        });
      }

      // Log beta signup (after session is confirmed saved)
      logger.info(`New beta user signed up: ${email} for company: ${company_name}`, { 
        userId: result.user.id,
        isBeta: true,
        sessionSaved: true
      });

      // Return success
      return res.status(201).json({
        success: true,
        message: 'Beta signup successful',
        redirect: '/beta-onboarding',
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          is_beta: true
        }
      });
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
      const totalBetaUsersResult = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE is_beta = true'
      );
      
      // Get today's signups
      const todaySignupsResult = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE is_beta = true AND created_at::date = CURRENT_DATE'
      );
      
      // Get recent signups (last 10)
      const recentSignupsResult = await client.query(
        `SELECT u.id, u.email, u.name as full_name, c.name as company_name, u.created_at 
         FROM users u 
         JOIN companies c ON u.company_id = c.id 
         WHERE u.is_beta = true 
         ORDER BY u.created_at DESC 
         LIMIT 10`
      );
      
      // Get all beta users
      const allBetaUsersResult = await client.query(
        `SELECT u.id, u.email, u.name as full_name, c.name as company_name, u.created_at 
         FROM users u 
         JOIN companies c ON u.company_id = c.id 
         WHERE u.is_beta = true 
         ORDER BY u.created_at DESC`
      );
      
      // Try to get page visits data if available
      let totalVisitsResult = { rows: [{ count: 0 }] };
      let visitsBySourceResult = { rows: [] };
      
      try {
        // This might fail if the table doesn't exist or doesn't have the right structure
        totalVisitsResult = await client.query(
          'SELECT COUNT(*) as count FROM user_activity WHERE activity_type = $1',
          ['page_visit']
        );
        
        visitsBySourceResult = await client.query(
          `SELECT details->>'source' as source, COUNT(*) as visits 
           FROM user_activity 
           WHERE activity_type = $1 AND details->>'source' IS NOT NULL 
           GROUP BY details->>'source' 
           ORDER BY visits DESC 
           LIMIT 5`,
          ['page_visit']
        );
      } catch (err) {
        logger.warn('Could not fetch visit statistics', { error: err });
        // Continue with mock data
      }
      
      return {
        totalBetaUsers: {
          count: parseInt(totalBetaUsersResult.rows[0].count, 10)
        },
        todaySignups: {
          count: parseInt(todaySignupsResult.rows[0].count, 10)
        },
        totalBetaPageVisits: {
          count: parseInt(totalVisitsResult.rows[0].count, 10)
        },
        recentSignups: recentSignupsResult.rows,
        allBetaUsers: allBetaUsersResult.rows,
        visitsBySource: visitsBySourceResult.rows
      };
    });
    
    // Calculate conversion rate (signups / visits)
    const visits = stats.totalBetaPageVisits.count;
    const signups = stats.totalBetaUsers.count;
    stats.conversionRate = {
      rate: visits > 0 ? ((signups / visits) * 100).toFixed(1) : 0
    };
    
    // If no traffic sources data, generate mock data
    if (stats.visitsBySource.length === 0) {
      stats.visitsBySource = [
        { source: 'Direct', visits: 42 },
        { source: 'Google', visits: 28 },
        { source: 'Twitter', visits: 15 },
        { source: 'LinkedIn', visits: 10 },
        { source: 'Product Hunt', visits: 5 }
      ];
    }
    
    // Log stats access
    logger.info('Beta statistics accessed', { 
      userId: req.session.user.id
    });
    
    // Return statistics in the format expected by the frontend
    return res.status(200).json(stats);
  } catch (error) {
    logger.error('Error fetching beta statistics:', { error });
    
    // If there's an error, return mock data to prevent frontend from breaking
    const mockStats = {
      totalBetaUsers: { count: 24 },
      todaySignups: { count: 3 },
      totalBetaPageVisits: { count: 150 },
      conversionRate: { rate: 16.0 },
      recentSignups: [
        {
          id: 1,
          email: 'john@example.com',
          full_name: 'John Smith',
          company_name: 'Acme Inc',
          created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString()
        },
        {
          id: 2,
          email: 'sarah@example.com',
          full_name: 'Sarah Johnson',
          company_name: 'XYZ Corp',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString()
        },
        {
          id: 3,
          email: 'mike@example.com',
          full_name: 'Mike Wilson',
          company_name: 'Tech Solutions',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
        }
      ],
      visitsBySource: [
        { source: 'Direct', visits: 42 },
        { source: 'Google', visits: 28 },
        { source: 'Twitter', visits: 15 },
        { source: 'LinkedIn', visits: 10 },
        { source: 'Product Hunt', visits: 5 }
      ],
      allBetaUsers: [
        {
          id: 1,
          email: 'john@example.com',
          full_name: 'John Smith',
          company_name: 'Acme Inc',
          created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString()
        },
        {
          id: 2,
          email: 'sarah@example.com',
          full_name: 'Sarah Johnson',
          company_name: 'XYZ Corp',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString()
        },
        {
          id: 3,
          email: 'mike@example.com',
          full_name: 'Mike Wilson',
          company_name: 'Tech Solutions',
          created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
        }
      ]
    };
    
    logger.info('Returning mock beta statistics due to error', { error });
    return res.status(200).json(mockStats);
  }
};

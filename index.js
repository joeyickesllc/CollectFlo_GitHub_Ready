
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database-postgres');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

// Track page visits
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return next();
  }
  
  try {
    await db.trackVisit(req.path, req.get('User-Agent'), req.get('Referer'));
  } catch (error) {
    console.error('Error tracking visit:', error);
  }
  
  next();
});

// API Routes
app.get('/api/user-info', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      const user = await db.getUserById(req.session.userId);
      if (user) {
        res.json({
          authenticated: true,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            company_name: user.company_name
          }
        });
      } else {
        res.status(401).json({ authenticated: false });
      }
    } catch (error) {
      console.error('Error getting user info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.status(401).json({ authenticated: false });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = await db.getUserByEmail(email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    req.session.userId = user.id;
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        company_name: user.company_name
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ success: true });
  });
});

app.post('/api/beta-signup', async (req, res) => {
  try {
    const { companyName, fullName, email, password } = req.body;
    
    if (!companyName || !fullName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if user already exists
    const existingUser = await db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const userId = await db.createUser({
      email,
      password: hashedPassword,
      full_name: fullName,
      company_name: companyName,
      is_beta: true
    });
    
    // Auto-login after signup
    req.session.userId = userId;
    
    res.json({ 
      success: true, 
      message: 'Beta signup successful!',
      user: {
        id: userId,
        email,
        full_name: fullName,
        company_name: companyName
      }
    });
    
  } catch (error) {
    console.error('Beta signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Beta stats API
app.get('/api/beta-stats', async (req, res) => {
  try {
    console.log('Beta stats API called');
    const stats = await db.getBetaStats();
    console.log('Beta stats retrieved:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Error getting beta stats:', error);
    // Ensure we always return JSON, never HTML
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Static page routes

// ✅ Redirect root to /landing
app.get('/', (req, res) => {
  res.redirect('/landing');
});

// Public-facing pages
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); // Login page
});

app.get('/beta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beta.html'));
});

app.get('/beta-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beta-signup.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/help', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'help.html'));
});

// Protected/authenticated pages
app.get('/beta-onboarding', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beta-onboarding.html'));
});

app.get('/beta-stats', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beta-stats.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.use(express.static('public'));
// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CollectFlo server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Access your app at: http://localhost:${PORT}`);
});

module.exports = app;

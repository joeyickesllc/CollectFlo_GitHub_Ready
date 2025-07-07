/**
 * CollectFlo API Routes
 * 
 * This file organizes all API routes for the CollectFlo application.
 * Routes are grouped by functionality for better maintainability.
 */

const express = require('express');
const router = express.Router();

// Import controllers (to be implemented)
// const authController = require('../controllers/authController');
// const dashboardController = require('../controllers/dashboardController');
// const settingsController = require('../controllers/settingsController');
// const invoiceController = require('../controllers/invoiceController');
// const betaController = require('../controllers/betaController');

// Import middleware (to be implemented)
// const { requireAuth } = require('../middleware/authMiddleware');

/**
 * Authentication Routes
 */
router.post('/login', (req, res) => {
  // Will be replaced with authController.login
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/signup', (req, res) => {
  // Will be replaced with authController.signup
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/logout', (req, res) => {
  // Will be replaced with authController.logout
  res.status(501).json({ message: 'Not implemented yet' });
});

router.get('/check-auth', (req, res) => {
  // Will be replaced with authController.checkAuth
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * Dashboard Routes
 * All dashboard routes require authentication
 */
router.get('/dashboard/stats', (req, res) => {
  // Will be replaced with dashboardController.getStats
  res.status(501).json({ message: 'Not implemented yet' });
});

router.get('/invoices', (req, res) => {
  // Will be replaced with dashboardController.getInvoices
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/invoices/:id/exclude', (req, res) => {
  // Will be replaced with dashboardController.excludeInvoice
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * Settings Routes
 * All settings routes require authentication
 */
router.get('/settings', (req, res) => {
  // Will be replaced with settingsController.getSettings
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/settings', (req, res) => {
  // Will be replaced with settingsController.updateSettings
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/settings/logo', (req, res) => {
  // Will be replaced with settingsController.uploadLogo
  res.status(501).json({ message: 'Not implemented yet' });
});

router.get('/templates', (req, res) => {
  // Will be replaced with settingsController.getTemplates
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/templates/:id', (req, res) => {
  // Will be replaced with settingsController.updateTemplate
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * Invoice & Payment Routes
 */
router.get('/create-payment-link/:invoiceId', (req, res) => {
  // Will be replaced with invoiceController.createPaymentLink
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/check-payments', (req, res) => {
  // Will be replaced with invoiceController.checkPayments
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/sync-invoices', (req, res) => {
  // Will be replaced with invoiceController.syncInvoices
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * Beta Program Routes
 */
router.post('/beta-signup', (req, res) => {
  // Will be replaced with betaController.signup
  res.status(501).json({ message: 'Not implemented yet' });
});

router.get('/beta-stats', (req, res) => {
  // Will be replaced with betaController.getStats
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * QuickBooks Integration Routes
 */
router.get('/qbo/status', (req, res) => {
  // Will be replaced with qboController.getStatus
  res.status(501).json({ message: 'Not implemented yet' });
});

router.post('/qbo/disconnect', (req, res) => {
  // Will be replaced with qboController.disconnect
  res.status(501).json({ message: 'Not implemented yet' });
});

/**
 * Test Routes (for development only)
 */
router.post('/test-email', (req, res) => {
  // Will be replaced with testController.sendTestEmail
  res.status(501).json({ message: 'Not implemented yet' });
});

module.exports = router;

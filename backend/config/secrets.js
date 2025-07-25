/**
 * Secrets Management Module
 * 
 * This module centralizes access to sensitive credentials and API keys,
 * validates their presence, and provides a clear structure for managing
 * different types of secrets across various environments.
 */

require('dotenv').config(); // Load environment variables from .env file

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Retrieves an environment variable and validates its presence.
 * Throws an error if the secret is required but not found.
 * 
 * @param {string} key The environment variable key (e.g., 'QBO_CLIENT_ID').
 * @param {boolean} required Whether the secret is mandatory (default: true).
 * @returns {string} The value of the environment variable.
 * @throws {Error} If a required secret is missing.
 */
function getSecret(key, required = true) {
  const value = process.env[key];
  if (required && (!value || value.trim() === '')) {
    throw new Error(`Missing required environment variable: ${key}. Please set it in your .env file or environment.`);
  }
  return value;
}

const secrets = {
  // Application Settings
  app: {
    port: getSecret('PORT', false) || 3000,
    sessionSecret: getSecret('SESSION_SECRET'),
    appUrl: getSecret('APP_URL', false) || `http://localhost:${process.env.PORT || 3000}`,
  },

  // Database Configuration
  database: {
    // CollectFlo now uses PostgreSQL exclusively in every environment.
    // `DATABASE_URL` **must** be supplied (Render provides this automatically).
    url: getSecret('DATABASE_URL'),          // e.g. postgres://user:pass@host:5432/dbname
    ssl: getSecret('DATABASE_SSL', false),   // 'true' or 'false' – optional
  },

  // Redis Configuration (for job queue and session store)
  redis: {
    url: getSecret('REDIS_URL', false) || 'redis://localhost:6379',
    prefix: getSecret('REDIS_PREFIX', false) || 'collectflo',
  },

  // QuickBooks Online Integration
  qbo: {
    clientId: getSecret('QBO_CLIENT_ID'),
    clientSecret: getSecret('QBO_CLIENT_SECRET'),
    redirectUri: getSecret('QBO_REDIRECT_URI'),
    environment: getSecret('QBO_ENVIRONMENT', false) || 'sandbox',
    // Derived QBO API URL based on environment
    get apiUrl() {
      if (this.environment === 'production') {
        return 'https://quickbooks.api.intuit.com/v3/company/';
      }
      return 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
    },
  },

  // Email Service (SendGrid)
  sendgrid: {
    apiKey: getSecret('SENDGRID_API_KEY'),
    fromEmail: getSecret('EMAIL_FROM', false) || 'noreply@collectflo.com',
    fromName: getSecret('EMAIL_FROM_NAME', false) || 'CollectFlo',
  },

  // SMS Service (Twilio)
  twilio: {
    accountSid: getSecret('TWILIO_ACCOUNT_SID'),
    authToken: getSecret('TWILIO_AUTH_TOKEN'),
    phoneNumber: getSecret('TWILIO_PHONE_NUMBER'),
  },

  // Payment Processing (Stripe)
  stripe: {
    secretKey: getSecret('STRIPE_SECRET_KEY'),
    publishableKey: getSecret('STRIPE_PUBLISHABLE_KEY', false), // Often public, but good to manage
    webhookSecret: getSecret('STRIPE_WEBHOOK_SECRET', false), // Only required if using webhooks
  },

  // Security Settings
  security: {
    passwordSaltRounds: parseInt(getSecret('PASSWORD_SALT_ROUNDS', false) || '10', 10),
    corsAllowedOrigins: getSecret('CORS_ALLOWED_ORIGINS', false) ? 
                        getSecret('CORS_ALLOWED_ORIGINS').split(',').map(s => s.trim()) : 
                        ['http://localhost:3000', 'http://localhost:5173'],
  },

  // -----------------------------------------------------------------
  // JWT Authentication
  // -----------------------------------------------------------------
  // NOTE:
  //   • In production these **must** be set to strong, random strings.
  //   • The defaults below are safe ONLY for local development/testing.
  //
  jwt: {
    accessSecret       : getSecret('JWT_ACCESS_SECRET',  false) || 'collectflo-access-dev-secret',
    refreshSecret      : getSecret('JWT_REFRESH_SECRET', false) || 'collectflo-refresh-dev-secret',
    issuer             : getSecret('JWT_ISSUER',         false) || 'collectflo-api',
    accessTokenExpiry  : getSecret('ACCESS_TOKEN_EXPIRY',  false) || '30m',
    refreshTokenExpiry : getSecret('REFRESH_TOKEN_EXPIRY', false) || '7d',
  },
};

// Export the centralized secrets object
module.exports = secrets;

// ---------------------------------------------------------------------------
// Warn when insecure defaults are used in production
// ---------------------------------------------------------------------------
if (NODE_ENV === 'production') {
  const { accessSecret, refreshSecret } = secrets.jwt;
  if (accessSecret === 'collectflo-access-dev-secret' ||
      refreshSecret === 'collectflo-refresh-dev-secret') {
    /* eslint-disable no-console */
    console.warn(
      '[SECURITY] JWT secrets are using development defaults in PRODUCTION!\\n' +
      '          Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to strong, random strings.'
    );
    /* eslint-enable no-console */
  }
}

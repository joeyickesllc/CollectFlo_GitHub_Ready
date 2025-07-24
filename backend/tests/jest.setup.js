/**
 * Jest Setup File
 * 
 * This file contains global configurations for the Jest test environment.
 * It's automatically loaded before tests run via the setupFilesAfterEnv option
 * in the Jest configuration.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/collectflo_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';

// Mock console methods to reduce noise in test output
// Original implementations are saved and can be restored if needed
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info
};

// Silent console in tests unless explicitly enabled
if (!process.env.DEBUG_TESTS) {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
}

// Add a global helper to restore console methods if needed
global.restoreConsole = () => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
};

// Add a global helper to clear all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Mock the express-session middleware
jest.mock('express-session', () => {
  return () => (req, res, next) => {
    req.session = req.session || {};
    req.session.destroy = callback => {
      req.session = {};
      callback && callback();
    };
    next();
  };
});

// Add custom Jest matchers if needed
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});

// Set default timeout for all tests
jest.setTimeout(10000);

// Global teardown after all tests
afterAll(async () => {
  // Close any open handles or connections
  // This helps prevent Jest from hanging after tests complete
  await new Promise(resolve => setTimeout(resolve, 500));
});

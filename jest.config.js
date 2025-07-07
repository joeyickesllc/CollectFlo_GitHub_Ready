/**
 * Jest Configuration for CollectFlo
 * 
 * This configuration file controls how Jest runs tests for the CollectFlo project.
 * It specifies test patterns, coverage settings, and environment configuration.
 */

module.exports = {
  // Specify the test environment
  testEnvironment: 'node',
  
  // The root directory where Jest should scan for tests
  rootDir: '.',
  
  // The directories where Jest should look for tests
  roots: ['<rootDir>/backend/tests'],
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  
  // Files to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // Setup files to run before tests
  setupFilesAfterEnv: ['<rootDir>/backend/tests/jest.setup.js'],
  
  // Code coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'backend/**/*.js',
    '!backend/tests/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Display settings
  verbose: true,
  
  // Timeouts
  testTimeout: 10000,
  
  // Mock settings
  clearMocks: true,
  resetMocks: false,
  restoreMocks: true,
  
  // Transform files
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Module resolution
  moduleDirectories: ['node_modules', 'backend'],
  
  // Cache settings
  cache: true,
  
  // Error handling
  bail: 0,
  
  // Notification settings
  notify: false,
  
  // Watch settings
  watchPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // Global variables available in tests
  globals: {
    NODE_ENV: 'test'
  }
};

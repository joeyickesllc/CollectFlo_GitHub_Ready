/**
 * Unit Tests for Authentication Controller
 * 
 * Tests the login functionality of the auth controller, including:
 * - Successful login
 * - Missing credentials
 * - Invalid credentials
 * - User not found
 * - Database errors
 */

const bcrypt = require('bcryptjs');
const { login } = require('../../../controllers/authController');

// Mock dependencies
jest.mock('bcryptjs');
jest.mock('../../../db/connection', () => ({
  queryOne: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn()
}));
jest.mock('../../../services/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Import mocked dependencies
const db = require('../../../db/connection');
const logger = require('../../../services/logger');

describe('Auth Controller - Login', () => {
  // Setup and teardown
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock implementations
    bcrypt.compare.mockResolvedValue(true); // Default to successful password comparison
  });

  // Mock Express request and response objects
  const mockRequest = (data = {}) => ({
    body: data,
    session: {}
  });

  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  test('should login successfully with valid credentials', async () => {
    // Mock user data from database
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashedPassword',
      company_id: 1,
      role: 'admin'
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(mockUser);
    bcrypt.compare.mockResolvedValueOnce(true);
    
    // Setup request and response
    const req = mockRequest({
      email: 'test@example.com',
      password: 'correctPassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['test@example.com']
    );
    expect(bcrypt.compare).toHaveBeenCalledWith('correctPassword', 'hashedPassword');
    expect(req.session.user).toEqual({
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      company_id: 1,
      role: 'admin'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Login successful',
      user: {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin'
      }
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('User logged in'),
      expect.objectContaining({ userId: 1 })
    );
  });

  test('should return 400 if email is missing', async () => {
    // Setup request and response
    const req = mockRequest({
      password: 'somePassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Email and password are required'
    });
  });

  test('should return 400 if password is missing', async () => {
    // Setup request and response
    const req = mockRequest({
      email: 'test@example.com'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Email and password are required'
    });
  });

  test('should return 401 if user is not found', async () => {
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(null);
    
    // Setup request and response
    const req = mockRequest({
      email: 'nonexistent@example.com',
      password: 'somePassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['nonexistent@example.com']
    );
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Invalid credentials'
    });
  });

  test('should return 401 if password is incorrect', async () => {
    // Mock user data from database
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashedPassword',
      company_id: 1,
      role: 'admin'
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(mockUser);
    bcrypt.compare.mockResolvedValueOnce(false);
    
    // Setup request and response
    const req = mockRequest({
      email: 'test@example.com',
      password: 'wrongPassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['test@example.com']
    );
    expect(bcrypt.compare).toHaveBeenCalledWith('wrongPassword', 'hashedPassword');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Invalid credentials'
    });
  });

  test('should return 500 if database query fails', async () => {
    // Setup mocks
    const dbError = new Error('Database connection error');
    db.queryOne.mockRejectedValueOnce(dbError);
    
    // Setup request and response
    const req = mockRequest({
      email: 'test@example.com',
      password: 'somePassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['test@example.com']
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'An error occurred during login'
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Login error:',
      expect.objectContaining({ error: dbError })
    );
  });

  test('should return 500 if bcrypt comparison fails', async () => {
    // Mock user data from database
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashedPassword',
      company_id: 1,
      role: 'admin'
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(mockUser);
    const bcryptError = new Error('Bcrypt comparison error');
    bcrypt.compare.mockRejectedValueOnce(bcryptError);
    
    // Setup request and response
    const req = mockRequest({
      email: 'test@example.com',
      password: 'somePassword'
    });
    const res = mockResponse();
    
    // Call the function
    await login(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['test@example.com']
    );
    expect(bcrypt.compare).toHaveBeenCalledWith('somePassword', 'hashedPassword');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'An error occurred during login'
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Login error:',
      expect.objectContaining({ error: bcryptError })
    );
  });
});

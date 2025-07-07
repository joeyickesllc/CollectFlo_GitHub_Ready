/**
 * Unit Tests for Beta Controller
 * 
 * Tests the beta signup functionality, including:
 * - Successful signup
 * - Missing fields validation
 * - Email format validation
 * - Password strength validation
 * - Existing user check
 * - Database error handling
 * - Session creation
 */

const bcrypt = require('bcryptjs');
const { signup } = require('../../../controllers/betaController');

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

describe('Beta Controller - Signup', () => {
  // Setup and teardown
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock implementations
    bcrypt.hash.mockResolvedValue('hashedPassword');
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

  test('should successfully sign up a new beta user', async () => {
    // Setup mock transaction result
    const mockTransactionResult = {
      user: {
        id: 1,
        email: 'beta@example.com',
        name: 'Beta User',
        role: 'admin'
      },
      companyId: 2
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(null); // User doesn't exist yet
    db.transaction.mockResolvedValueOnce(mockTransactionResult);
    
    // Setup request with valid data
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'beta@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['beta@example.com']
    );
    expect(bcrypt.hash).toHaveBeenCalledWith('securepassword', 10);
    expect(db.transaction).toHaveBeenCalled();
    
    // Check session creation
    expect(req.session.user).toEqual({
      id: 1,
      email: 'beta@example.com',
      name: 'Beta User',
      company_id: 2,
      role: 'admin',
      is_beta: true
    });
    
    // Check response
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Beta signup successful',
      user: {
        id: 1,
        email: 'beta@example.com',
        name: 'Beta User',
        role: 'admin',
        is_beta: true
      }
    });
    
    // Check logging
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('New beta user signed up'),
      expect.objectContaining({
        userId: 1,
        isBeta: true
      })
    );
  });

  test('should return 400 if company name is missing', async () => {
    // Setup request with missing company name
    const req = mockRequest({
      fullName: 'Beta User',
      email: 'beta@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'All fields are required'
    });
  });

  test('should return 400 if full name is missing', async () => {
    // Setup request with missing full name
    const req = mockRequest({
      companyName: 'Beta Company',
      email: 'beta@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'All fields are required'
    });
  });

  test('should return 400 if email is missing', async () => {
    // Setup request with missing email
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'All fields are required'
    });
  });

  test('should return 400 if password is missing', async () => {
    // Setup request with missing password
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'beta@example.com'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'All fields are required'
    });
  });

  test('should return 400 if email format is invalid', async () => {
    // Setup request with invalid email
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'invalid-email',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Invalid email format'
    });
  });

  test('should return 400 if password is too short', async () => {
    // Setup request with short password
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'beta@example.com',
      password: 'short'  // Less than 8 characters
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Password must be at least 8 characters long'
    });
  });

  test('should return 409 if user already exists', async () => {
    // Mock existing user
    const existingUser = {
      id: 99,
      email: 'existing@example.com'
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(existingUser);
    
    // Setup request
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'existing@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = $1',
      ['existing@example.com']
    );
    expect(db.transaction).not.toHaveBeenCalled();
    
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User with this email already exists'
    });
  });

  test('should return 500 if database transaction fails', async () => {
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(null); // User doesn't exist
    const dbError = new Error('Database transaction error');
    db.transaction.mockRejectedValueOnce(dbError);
    
    // Setup request
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'beta@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(db.queryOne).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
    
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'An error occurred during beta signup'
    });
    
    expect(logger.error).toHaveBeenCalledWith(
      'Beta signup error:',
      expect.objectContaining({ error: dbError })
    );
  });

  test('should return 500 if password hashing fails', async () => {
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(null); // User doesn't exist
    const hashError = new Error('Hashing error');
    bcrypt.hash.mockRejectedValueOnce(hashError);
    
    // Setup request
    const req = mockRequest({
      companyName: 'Beta Company',
      fullName: 'Beta User',
      email: 'beta@example.com',
      password: 'securepassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions
    expect(bcrypt.hash).toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'An error occurred during beta signup'
    });
    
    expect(logger.error).toHaveBeenCalledWith(
      'Beta signup error:',
      expect.objectContaining({ error: hashError })
    );
  });

  test('should create session with correct user data after successful signup', async () => {
    // Setup mock transaction result
    const mockTransactionResult = {
      user: {
        id: 5,
        email: 'session@example.com',
        name: 'Session Test',
        role: 'admin'
      },
      companyId: 10
    };
    
    // Setup mocks
    db.queryOne.mockResolvedValueOnce(null); // User doesn't exist yet
    db.transaction.mockResolvedValueOnce(mockTransactionResult);
    
    // Setup request
    const req = mockRequest({
      companyName: 'Session Company',
      fullName: 'Session Test',
      email: 'session@example.com',
      password: 'sessionpassword'
    });
    const res = mockResponse();
    
    // Call the function
    await signup(req, res);
    
    // Assertions specifically for session creation
    expect(req.session.user).toBeDefined();
    expect(req.session.user).toEqual({
      id: 5,
      email: 'session@example.com',
      name: 'Session Test',
      company_id: 10,
      role: 'admin',
      is_beta: true
    });
  });
});

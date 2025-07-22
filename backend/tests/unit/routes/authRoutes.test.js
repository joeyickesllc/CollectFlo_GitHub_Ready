const express = require('express');
const request = require('supertest');

const authRoutes = require('../../../routes/authRoutes');

jest.mock('../../../controllers/authController', () => ({
  login: jest.fn((req, res) => res.status(200).json({ success: true })),
  signup: jest.fn((req, res) => res.status(201).json({ success: true })),
  logout: jest.fn(),
  checkAuth: jest.fn(),
  changePassword: jest.fn()
}));

const authController = require('../../../controllers/authController');

describe('Auth Routes - Middleware', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/auth/login validates input', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass' });

    expect(res.status).toBe(400);
    expect(authController.login).not.toHaveBeenCalled();
  });

  test('POST /api/auth/signup validates input', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        companyName: 'TestCo',
        fullName: 'T',
        password: 'password'
      });

    expect(res.status).toBe(400);
    expect(authController.signup).not.toHaveBeenCalled();
  });

  test('valid login passes to controller', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'user@example.com',
        password: 'password123'
      });

    expect(res.status).toBe(200);
    expect(authController.login).toHaveBeenCalled();
  });
});

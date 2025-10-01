const request = require('supertest');
const apiServer = require('../src/api/server');

describe('API Endpoints', () => {
  let server;

  beforeAll(async () => {
    // Start test server
    await apiServer.start();
    server = apiServer.app;
  });

  afterAll(async () => {
    // Stop test server
    await apiServer.stop();
  });

  describe('GET /health', () => {
    test('should return health status', async () => {
      const response = await request(server)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api', () => {
    test('should return API information', async () => {
      const response = await request(server)
        .get('/api')
        .expect(200);

      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('GET /api/health/system', () => {
    test('should return system health', async () => {
      const response = await request(server)
        .get('/api/health/system')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('checks');
      expect(Array.isArray(response.body.checks)).toBe(true);
    });
  });

  describe('GET /api/opportunities', () => {
    test('should return opportunities list', async () => {
      const response = await request(server)
        .get('/api/opportunities')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('pagination');
    });

    test('should accept query parameters', async () => {
      const response = await request(server)
        .get('/api/opportunities?limit=10&offset=0')
        .expect(200);

      expect(response.body.pagination.limit).toBe(10);
      expect(response.body.pagination.offset).toBe(0);
    });
  });

  describe('GET /api/stats/overview', () => {
    test('should return system statistics', async () => {
      const response = await request(server)
        .get('/api/stats/overview')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('system');
      expect(response.body.data).toHaveProperty('opportunities');
      expect(response.body.data).toHaveProperty('services');
    });
  });

  describe('POST /api/simulate/opportunity', () => {
    test('should validate request body', async () => {
      const response = await request(server)
        .post('/api/simulate/opportunity')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Validation error');
    });

    test('should return 404 for non-existent opportunity', async () => {
      const response = await request(server)
        .post('/api/simulate/opportunity')
        .send({
          opportunityId: 'non-existent-id',
          tradeAmount: 1000,
          slippage: 0.5
        })
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Opportunity not found');
    });
  });

  describe('404 Handler', () => {
    test('should return 404 for non-existent endpoints', async () => {
      const response = await request(server)
        .get('/api/non-existent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Endpoint not found');
    });
  });
});
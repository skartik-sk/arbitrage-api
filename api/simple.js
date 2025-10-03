import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

const app = express();

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use(limiter);

// Import services with error handling
let dbConnection, logger, healthRoutes, opportunitiesRoutes, simulateRoutes, statsRoutes;

try {
  ({ logger } = await import('../src/utils/logger.js'));
  dbConnection = (await import('../src/config/database.js')).default;
  healthRoutes = (await import('../src/api/routes/health.js')).default;
  opportunitiesRoutes = (await import('../src/api/routes/opportunities.js')).default;
  simulateRoutes = (await import('../src/api/routes/simulate.js')).default;
  statsRoutes = (await import('../src/api/routes/stats.js')).default;
} catch (error) {
  console.error('Import error:', error.message);
}

// Initialize database
async function initializeDatabase() {
  try {
    if (dbConnection) {
      await dbConnection.connect();
      if (logger) {
        logger.info('✅ Database connected successfully');
      } else {
        console.log('✅ Database connected successfully');
      }
    }
  } catch (error) {
    console.warn('⚠️ Database connection failed:', error.message);
  }
}

// Initialize on startup
initializeDatabase();

// Routes
if (healthRoutes) app.use('/api/health', healthRoutes);
if (opportunitiesRoutes) app.use('/api/opportunities', opportunitiesRoutes);
if (simulateRoutes) app.use('/api/simulate', simulateRoutes);
if (statsRoutes) app.use('/api/stats', statsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'DeFi Arbitrage Bot API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      opportunities: '/api/opportunities',
      simulate: '/api/simulate',
      stats: '/api/stats'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// Catch 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.originalUrl} does not exist`,
    availableEndpoints: {
      root: '/',
      health: '/health',
      apiHealth: '/api/health',
      opportunities: '/api/opportunities',
      simulate: '/api/simulate',
      stats: '/api/stats'
    }
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  res.status(error.status || 500).json({
    error: error.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// Start server for local development
const PORT = process.env.API_PORT || process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`🔍 API: http://localhost:${PORT}/api/health`);
  });
}

export default app;
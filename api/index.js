import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import { logger } from '../src/utils/logger.js';
import dbConnection from '../src/config/database.js';

// Import API routes
import healthRoutes from '../src/api/routes/health.js';
import opportunitiesRoutes from '../src/api/routes/opportunities.js';
import simulateRoutes from '../src/api/routes/simulate.js';
import statsRoutes from '../src/api/routes/stats.js';

const app = express();

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://vercel.app', process.env.FRONTEND_URL].filter(Boolean)
    : true,
  credentials: true
}));
app.use(compression());
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize bot instance
let botInstance = null;

// Initialize database and bot
async function initializeServices() {
  try {
    // Connect to database
    await dbConnection.connect();
    if (dbConnection.isConnected) {
      logger.info('✅ Database connected successfully');
    } else {
      logger.warn('⚠️ Running without database - continuing in API-only mode');
    }

    // Initialize bot in background (for Vercel, just ensure DB and API work)
    logger.info('✅ API services initialized');
  } catch (error) {
    logger.error('Service initialization error:', error);
  }
}

// Initialize services on startup
initializeServices();

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/simulate', simulateRoutes);
app.use('/api/stats', statsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'DeFi Arbitrage Bot API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      opportunities: '/api/opportunities',
      simulate: '/api/simulate',
      stats: '/api/stats'
    },
    documentation: '/api/health'
  });
});

// Catch 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.originalUrl} does not exist`,
    availableEndpoints: {
      health: '/api/health',
      opportunities: '/api/opportunities',
      simulate: '/api/simulate', 
      stats: '/api/stats'
    }
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('API Error:', error);
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    error: error.message || 'Internal Server Error',
    ...(isDevelopment && { stack: error.stack }),
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

// Start server locally (not needed for Vercel)
const PORT = process.env.API_PORT || process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    logger.info(`🚀 API Server running on http://localhost:${PORT}`);
    logger.info(`📊 Health Check: http://localhost:${PORT}/api/health`);
    logger.info(`🔍 Opportunities: http://localhost:${PORT}/api/opportunities`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;
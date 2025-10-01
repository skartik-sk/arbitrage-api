import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';

import { logger, logError } from '../utils/logger.js';
import dbConnection from '../config/database.js';

// Import routes
import opportunitiesRoutes from './routes/opportunities.js';
import statsRoutes from './routes/stats.js';
import healthRoutes from './routes/health.js';
import simulateRoutes from './routes/simulate.js';

class APIServer {
  constructor() {
    this.app = express();
    this.port = process.env.API_PORT || 3000;
    this.isStarted = false;
  }

  // Initialize middleware
  initializeMiddleware() {
    // Security middleware
    this.app.use(helmet());

    // CORS configuration
    if (process.env.ENABLE_CORS === 'true') {
      this.app.use(cors({
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
      }));
    }

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    if (process.env.ENABLE_RATE_LIMITING === 'true') {
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.API_RATE_LIMIT) || 100,
        message: {
          error: 'Too many requests from this IP, please try again later.',
          retryAfter: '15 minutes'
        },
        standardHeaders: true,
        legacyHeaders: false
      });
      this.app.use('/api', limiter);
    }

    // Request logging
    this.app.use((req, res, next) => {
      logger.info('API Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      next();
    });
  }

  // Initialize routes
  initializeRoutes() {
    // Health check endpoint (no rate limiting)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // API routes
    this.app.use('/api/opportunities', opportunitiesRoutes);
    this.app.use('/api/stats', statsRoutes);
    this.app.use('/api/health', healthRoutes);
    this.app.use('/api/simulate', simulateRoutes);

    // API documentation endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'DeFi Arbitrage Bot API',
        version: '1.0.0',
        description: 'REST API for DeFi arbitrage trading bot',
        endpoints: {
          opportunities: '/api/opportunities',
          stats: '/api/stats',
          health: '/api/health',
          simulate: '/api/simulate'
        },
        documentation: 'https://github.com/your-repo/defi-arbitrage-bot'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        availableEndpoints: ['/api', '/api/opportunities', '/api/stats', '/api/health', '/api/simulate']
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logError(error, {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      // Don't leak error details in production
      const isDevelopment = process.env.NODE_ENV !== 'production';

      res.status(error.status || 500).json({
        error: 'Internal server error',
        message: isDevelopment ? error.message : 'Something went wrong',
        ...(isDevelopment && { stack: error.stack })
      });
    });
  }

  // Start the server
  async start() {
    try {
      if (this.isStarted) {
        logger.warn('API server is already running');
        return;
      }

      // Initialize middleware
      this.initializeMiddleware();

      // Initialize routes
      this.initializeRoutes();

      // Start listening
      this.server = this.app.listen(this.port, () => {
        this.isStarted = true;
        logger.info(`API server started on port ${this.port}`, {
          port: this.port,
          environment: process.env.NODE_ENV || 'development',
          nodeVersion: process.version
        });
      });

      // Handle server errors
      this.server.on('error', (error) => {
        logError(error, { context: 'APIServer.start' });
        throw error;
      });

    } catch (error) {
      logError(error, { context: 'APIServer.start' });
      throw error;
    }
  }

  // Stop the server
  async stop() {
    if (!this.isStarted || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.isStarted = false;
        logger.info('API server stopped');
        resolve();
      });
    });
  }

  // Get server status
  getStatus() {
    return {
      isStarted: this.isStarted,
      port: this.port,
      uptime: this.isStarted ? process.uptime() : 0,
      environment: process.env.NODE_ENV || 'development'
    };
  }

  // Graceful shutdown
  async gracefulShutdown() {
    logger.info('Starting graceful shutdown of API server...');

    try {
      // Stop accepting new connections
      await this.stop();

      // Close database connection
      await dbConnection.disconnect();

      logger.info('API server gracefully shut down');
      process.exit(0);
    } catch (error) {
      logError(error, { context: 'APIServer.gracefulShutdown' });
      process.exit(1);
    }
  }
}

// Create singleton instance
const apiServer = new APIServer();

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  apiServer.gracefulShutdown();
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  apiServer.gracefulShutdown();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError(error, { context: 'UncaughtException' });
  apiServer.gracefulShutdown();
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logError(new Error(reason), { context: 'UnhandledRejection', promise });
  apiServer.gracefulShutdown();
});

export default apiServer;
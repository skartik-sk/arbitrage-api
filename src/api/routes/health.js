import express from 'express';
import dbConnection from '../../config/database.js';
import arbitrageDetector from '../../services/arbitrage-detector/index.js';
import priceFetcher from '../../services/price-fetcher/index.js';
import poolDiscovery from '../../services/pool-discovery.js';
import rpcManager from '../../services/rpc-manager.js';
import profitCalculator from '../../services/profit-calculator/index.js';
import tradeSimulator from '../../services/trade-simulator/index.js';
import { logError } from '../../utils/logger.js';

const router = express.Router();

// Overall system health check
router.get('/system', async (req, res) => {
  try {
    const checks = [];

    // Database health
    try {
      const dbHealth = await dbConnection.healthCheck();
      checks.push({
        name: 'database',
        status: dbHealth.status === 'connected' ? 'healthy' : 'unhealthy',
        details: dbHealth,
        responseTime: Date.now() // Would need to measure actual response time
      });
    } catch (error) {
      checks.push({
        name: 'database',
        status: 'unhealthy',
        error: error.message
      });
    }

    // RPC Manager health
    try {
      const rpcStats = rpcManager.getStats();
      checks.push({
        name: 'rpc-manager',
        status: rpcStats.isHealthy ? 'healthy' : 'unhealthy',
        details: rpcStats
      });
    } catch (error) {
      checks.push({
        name: 'rpc-manager',
        status: 'unhealthy',
        error: error.message
      });
    }

    // Arbitrage detector health
    try {
      const detectorStats = arbitrageDetector.getStats();
      checks.push({
        name: 'arbitrage-detector',
        status: detectorStats.isRunning ? 'healthy' : 'unhealthy',
        details: detectorStats
      });
    } catch (error) {
      checks.push({
        name: 'arbitrage-detector',
        status: 'unhealthy',
        error: error.message
      });
    }

    // Price fetcher health
    try {
      const priceStats = priceFetcher.getStats();
      const isHealthy = priceStats.isRunning &&
                      (Date.now() - priceStats.lastUpdate) < 60000; // Updated within last minute

      checks.push({
        name: 'price-fetcher',
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: priceStats
      });
    } catch (error) {
      checks.push({
        name: 'price-fetcher',
        status: 'unhealthy',
        error: error.message
      });
    }

    // Pool discovery health
    try {
      const poolStats = poolDiscovery.getStats();
      checks.push({
        name: 'pool-discovery',
        status: poolStats.totalPools > 0 ? 'healthy' : 'unhealthy',
        details: poolStats
      });
    } catch (error) {
      checks.push({
        name: 'pool-discovery',
        status: 'unhealthy',
        error: error.message
      });
    }

    // Calculate overall health
    const healthyChecks = checks.filter(check => check.status === 'healthy');
    const isHealthy = healthyChecks.length === checks.length;

    const response = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
      summary: {
        total: checks.length,
        healthy: healthyChecks.length,
        unhealthy: checks.length - healthyChecks.length
      }
    };

    res.status(isHealthy ? 200 : 503).json(response);

  } catch (error) {
    logError(error, { context: 'HealthRouter.system' });
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error.message
    });
  }
});

// Service-specific health checks
router.get('/services', async (req, res) => {
  try {
    const services = {};

    // Arbitrage Detector
    try {
      services.arbitrageDetector = {
        status: 'healthy',
        isRunning: arbitrageDetector.isRunning,
        stats: arbitrageDetector.getStats()
      };
    } catch (error) {
      services.arbitrageDetector = {
        status: 'unhealthy',
        error: error.message
      };
    }

    // Price Fetcher
    try {
      const priceStats = priceFetcher.getStats();
      services.priceFetcher = {
        status: priceStats.isRunning ? 'healthy' : 'unhealthy',
        ...priceStats
      };
    } catch (error) {
      services.priceFetcher = {
        status: 'unhealthy',
        error: error.message
      };
    }

    // Pool Discovery
    try {
      services.poolDiscovery = {
        status: 'healthy',
        isInitialized: poolDiscovery.isInitialized,
        stats: poolDiscovery.getStats()
      };
    } catch (error) {
      services.poolDiscovery = {
        status: 'unhealthy',
        error: error.message
      };
    }

    // RPC Manager
    try {
      services.rpcManager = {
        status: rpcManager.isHealthy ? 'healthy' : 'unhealthy',
        stats: rpcManager.getStats()
      };
    } catch (error) {
      services.rpcManager = {
        status: 'unhealthy',
        error: error.message
      };
    }

    // Profit Calculator
    try {
      services.profitCalculator = {
        status: 'healthy',
        stats: profitCalculator.getStats()
      };
    } catch (error) {
      services.profitCalculator = {
        status: 'unhealthy',
        error: error.message
      };
    }

    // Trade Simulator
    try {
      services.tradeSimulator = {
        status: tradeSimulator.isInitialized ? 'healthy' : 'unhealthy',
        stats: tradeSimulator.getStats()
      };
    } catch (error) {
      services.tradeSimulator = {
        status: 'unhealthy',
        error: error.message
      };
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services
    });

  } catch (error) {
    logError(error, { context: 'HealthRouter.services' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch service health',
      message: error.message
    });
  }
});

// Database health check
router.get('/database', async (req, res) => {
  try {
    const health = await dbConnection.healthCheck();
    const status = health.status === 'connected' ? 'healthy' : 'unhealthy';

    res.status(status === 'healthy' ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      ...health
    });

  } catch (error) {
    logError(error, { context: 'HealthRouter.database' });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database health check failed',
      message: error.message
    });
  }
});

// Readiness check (for Kubernetes/containers)
router.get('/ready', async (req, res) => {
  try {
    // Check if all critical services are ready
    const isDatabaseReady = (await dbConnection.healthCheck()).status === 'connected';
    const isRpcReady = rpcManager.isHealthy;
    const isPoolDiscoveryReady = poolDiscovery.isInitialized;
    const isPriceFetcherReady = priceFetcher.isRunning && priceFetcher.prices.size > 0;

    const isReady = isDatabaseReady && isRpcReady && isPoolDiscoveryReady && isPriceFetcherReady;

    res.status(isReady ? 200 : 503).json({
      ready: isReady,
      timestamp: new Date().toISOString(),
      checks: {
        database: isDatabaseReady,
        rpc: isRpcReady,
        poolDiscovery: isPoolDiscoveryReady,
        priceFetcher: isPriceFetcherReady
      }
    });

  } catch (error) {
    logError(error, { context: 'HealthRouter.ready' });
    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Liveness check (for Kubernetes/containers)
router.get('/live', (req, res) => {
  // Simple liveness check - if the server is responding, it's alive
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid
  });
});

// Detailed health metrics
router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform
      },
      services: {
        arbitrageDetector: arbitrageDetector.getStats(),
        priceFetcher: priceFetcher.getStats(),
        poolDiscovery: poolDiscovery.getStats(),
        rpcManager: rpcManager.getStats(),
        profitCalculator: profitCalculator.getStats(),
        tradeSimulator: tradeSimulator.getStats()
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: metrics
    });

  } catch (error) {
    logError(error, { context: 'HealthRouter.metrics' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch health metrics',
      message: error.message
    });
  }
});

export default router;
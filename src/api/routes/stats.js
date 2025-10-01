import express from 'express';
import Opportunity from '../../models/opportunity.js';
import arbitrageDetector from '../../services/arbitrage-detector/index.js';
import priceFetcher from '../../services/price-fetcher/index.js';
import poolDiscovery from '../../services/pool-discovery.js';
import rpcManager from '../../services/rpc-manager.js';
import profitCalculator from '../../services/profit-calculator/index.js';
import tradeSimulator from '../../services/trade-simulator/index.js';
import { logError } from '../../utils/logger.js';

const router = express.Router();

// Get comprehensive system statistics
router.get('/overview', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query; // hours
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    // Get opportunity statistics
    const opportunityStats = await Opportunity.getStats(timeRangeMs);

    // Get service statistics
    const arbitrageStats = arbitrageDetector.getStats();
    const priceFetcherStats = priceFetcher.getStats();
    const poolDiscoveryStats = poolDiscovery.getStats();
    const rpcStats = rpcManager.getStats();
    const profitCalculatorStats = profitCalculator.getStats();
    const tradeSimulatorStats = tradeSimulator.getStats();

    // Calculate system health
    const systemHealth = {
      arbitrageDetector: arbitrageStats.isRunning,
      priceFetcher: priceFetcherStats.isRunning,
      rpcManager: rpcStats.isHealthy,
      database: true // Would need to implement DB health check
    };

    const isHealthy = Object.values(systemHealth).every(status => status === true);

    res.json({
      success: true,
      data: {
        system: {
          isHealthy,
          uptime: process.uptime(),
          environment: process.env.NODE_ENV || 'development',
          nodeVersion: process.version,
          timestamp: new Date().toISOString(),
          timeRange: `${timeRange} hours`
        },
        opportunities: opportunityStats[0] || {
          totalOpportunities: 0,
          profitableOpportunities: 0,
          executedTrades: 0,
          avgProfitPercentage: 0,
          maxProfitPercentage: 0,
          totalExpectedProfit: 0
        },
        services: {
          arbitrageDetector: arbitrageStats,
          priceFetcher: priceFetcherStats,
          poolDiscovery: poolDiscoveryStats,
          rpcManager: rpcStats,
          profitCalculator: profitCalculatorStats,
          tradeSimulator: tradeSimulatorStats
        },
        health: systemHealth
      }
    });

  } catch (error) {
    logError(error, { context: 'StatsRouter.getOverview' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system statistics',
      message: error.message
    });
  }
});

// Get opportunity statistics
router.get('/opportunities', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query;
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    const stats = await Opportunity.getStats(timeRangeMs);

    // Get additional statistics
    const totalOpportunities = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) }
    });

    const profitableOpportunities = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
      status: 'profitable'
    });

    const executedTrades = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
      status: 'executed'
    });

    const avgProfitPercentage = await Opportunity.aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - timeRangeMs) } } },
      { $group: { _id: null, avgProfit: { $avg: '$profitPercentage' } } }
    ]);

    const opportunitiesByType = await Opportunity.aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - timeRangeMs) } } },
      {
        $group: {
          _id: {
            $cond: [
              { $ifNull: ['$triangularPath', false] },
              'triangular',
              'simple'
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const opportunitiesByStatus = await Opportunity.aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - timeRangeMs) } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        summary: stats[0] || {},
        detailed: {
          totalOpportunities,
          profitableOpportunities,
          executedTrades,
          avgProfitPercentage: avgProfitPercentage[0]?.avgProfit || 0,
          opportunitiesByType: opportunitiesByType.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
          opportunitiesByStatus: opportunitiesByStatus.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {})
        },
        timeRange: `${timeRange} hours`
      }
    });

  } catch (error) {
    logError(error, { context: 'StatsRouter.getOpportunities' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunity statistics',
      message: error.message
    });
  }
});

// Get profit statistics
router.get('/profits', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query;
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    const profitStats = await Opportunity.aggregate([
      { $match: {
        timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
        expectedProfit: { $exists: true, $ne: null }
      }},
      {
        $group: {
          _id: null,
          totalExpectedProfit: { $sum: { $toDouble: '$expectedProfit' } },
          avgProfit: { $avg: { $toDouble: '$expectedProfit' } },
          maxProfit: { $max: { $toDouble: '$expectedProfit' } },
          minProfit: { $min: { $toDouble: '$expectedProfit' } },
          count: { $sum: 1 }
        }
      }
    ]);

    const executedProfits = await Opportunity.aggregate([
      { $match: {
        timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
        status: 'executed',
        'executionResult.actualProfit': { $exists: true }
      }},
      {
        $group: {
          _id: null,
          totalActualProfit: { $sum: { $toDouble: '$executionResult.actualProfit' } },
          avgActualProfit: { $avg: { $toDouble: '$executionResult.actualProfit' } },
          maxActualProfit: { $max: { $toDouble: '$executionResult.actualProfit' } },
          executedTrades: { $sum: 1 }
        }
      }
    ]);

    const profitByHour = await Opportunity.aggregate([
      { $match: {
        timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
        expectedProfit: { $exists: true }
      }},
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d %H:00:00',
              date: '$timestamp'
            }
          },
          totalProfit: { $sum: { $toDouble: '$expectedProfit' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        expected: profitStats[0] || {
          totalExpectedProfit: 0,
          avgProfit: 0,
          maxProfit: 0,
          minProfit: 0,
          count: 0
        },
        actual: executedProfits[0] || {
          totalActualProfit: 0,
          avgActualProfit: 0,
          maxActualProfit: 0,
          executedTrades: 0
        },
        profitByHour,
        timeRange: `${timeRange} hours`
      }
    });

  } catch (error) {
    logError(error, { context: 'StatsRouter.getProfits' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profit statistics',
      message: error.message
    });
  }
});

// Get performance statistics
router.get('/performance', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query;
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    // Get detection performance
    const detectionStats = arbitrageDetector.getStats();

    // Get RPC performance
    const rpcStats = rpcManager.getStats();

    // Get price fetcher performance
    const priceStats = priceFetcher.getStats();

    // Calculate success rates
    const totalOpportunities = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) }
    });

    const profitableOpportunities = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
      status: 'profitable'
    });

    const executedTrades = await Opportunity.countDocuments({
      timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
      status: 'executed'
    });

    const successRate = totalOpportunities > 0 ? (executedTrades / totalOpportunities) * 100 : 0;
    const profitabilityRate = totalOpportunities > 0 ? (profitableOpportunities / totalOpportunities) * 100 : 0;

    res.json({
      success: true,
      data: {
        detection: {
          totalScans: detectionStats.totalScans,
          opportunitiesFound: detectionStats.opportunitiesFound,
          profitableOpportunities: detectionStats.profitableOpportunities,
          currentOpportunities: detectionStats.currentOpportunities,
          isRunning: detectionStats.isRunning,
          lastScan: detectionStats.lastScan
        },
        rpc: {
          isHealthy: rpcStats.isHealthy,
          totalProviders: rpcStats.totalProviders,
          healthyProviders: rpcStats.healthyProviders,
          currentProvider: rpcStats.currentProvider,
          chainId: rpcStats.chainId,
          lastHealthCheck: rpcStats.lastHealthCheck
        },
        prices: {
          totalPrices: priceStats.totalPrices,
          lastUpdate: priceStats.lastUpdate,
          isRunning: priceStats.isRunning,
          pricesByDex: priceStats.pricesByDex,
          pricesByPair: priceStats.pricesByPair
        },
        success: {
          totalOpportunities,
          profitableOpportunities,
          executedTrades,
          successRate: Math.round(successRate * 100) / 100,
          profitabilityRate: Math.round(profitabilityRate * 100) / 100
        },
        system: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          timestamp: new Date().toISOString()
        },
        timeRange: `${timeRange} hours`
      }
    });

  } catch (error) {
    logError(error, { context: 'StatsRouter.getPerformance' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance statistics',
      message: error.message
    });
  }
});

// Get real-time metrics
router.get('/realtime', async (req, res) => {
  try {
    const currentOpportunities = arbitrageDetector.getAllOpportunities();
    const bestOpportunity = arbitrageDetector.getBestOpportunity();
    const currentPrices = priceFetcher.prices;
    const systemStats = {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      timestamp: Date.now()
    };

    res.json({
      success: true,
      data: {
        opportunities: {
          current: currentOpportunities.length,
          best: bestOpportunity || null,
          recent: currentOpportunities.slice(0, 5)
        },
        prices: {
          totalPrices: currentPrices.size,
          lastUpdate: priceFetcher.lastUpdate
        },
        system: systemStats,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logError(error, { context: 'StatsRouter.getRealtime' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch real-time metrics',
      message: error.message
    });
  }
});

export default router;
import 'dotenv/config';

import { logger, logError, logArbitrageOpportunity, logTradeExecution } from './utils/logger.js';
import dbConnection from './config/database.js';
import rpcManager from './services/rpc-manager.js';
import poolDiscovery from './services/pool-discovery.js';
import priceFetcher from './services/price-fetcher/index.js';
import arbitrageDetector from './services/arbitrage-detector/index.js';
import profitCalculator from './services/profit-calculator/index.js';
import tradeSimulator from './services/trade-simulator/index.js';
import opportunityGenerator from './services/opportunity-generator.js';
import apiServer from './api/server.js';
import Opportunity from './models/opportunity.js';
import { INTERVALS, ARBITRAGE_CONFIG, SUPPORTED_TOKENS } from './config/constants.js';

class ArbitrageBot {
  constructor() {
    this.isRunning = false;
    this.isShuttingDown = false;
    this.services = {};
    this.intervals = {};
    this.stats = {
      startTime: null,
      totalOpportunities: 0,
      profitableOpportunities: 0,
      simulatedTrades: 0,
      executedTrades: 0,
      totalProfit: 0,
      errors: 0
    };
  }

  // Initialize all services
  async initialize() {
    try {
      logger.info('🚀 Initializing DeFi Arbitrage Bot...');

      // 1. Connect to database (optional)
      logger.info('📊 Connecting to database...');
      try {
        await dbConnection.connect();
        if (dbConnection.isConnected) {
          logger.info('✅ Database connected successfully');
        } else {
          logger.warn('⚠️ Running without database - opportunities will not be persisted');
        }
      } catch (error) {
        logger.warn('⚠️ Database connection failed, continuing without persistence:', error.message);
      }

      // 2. Initialize RPC manager
      logger.info('🌐 Initializing RPC manager...');
      await rpcManager.initialize();

      // 3. Initialize pool discovery
      logger.info('🏊 Discovering liquidity pools...');
      await poolDiscovery.initialize();

      // 4. Initialize price fetcher
      logger.info('💰 Initializing price fetcher...');
      await priceFetcher.initialize();

      // 5. Initialize arbitrage detector
      logger.info('🔍 Initializing arbitrage detector...');
      await arbitrageDetector.initialize();

      // 6. Initialize profit calculator
      logger.info('🧮 Initializing profit calculator...');
      await profitCalculator.initialize();

      // 7. Initialize trade simulator
      logger.info('🎮 Initializing trade simulator...');
      await tradeSimulator.initialize();

      // Store service references
      this.services = {
        db: dbConnection,
        rpc: rpcManager,
        poolDiscovery,
        priceFetcher,
        arbitrageDetector,
        profitCalculator,
        tradeSimulator,
        opportunityGenerator
      };

      // Generate initial opportunities from discovered pools
      await this.generateInitialOpportunities();

      logger.info('✅ All services initialized successfully');
      this.logSystemInfo();

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.initialize' });
      throw error;
    }
  }

  // Start the bot
  async start() {
    try {
      if (this.isRunning) {
        logger.warn('⚠️ Bot is already running');
        return;
      }

      logger.info('🎯 Starting DeFi Arbitrage Bot...');

      // Initialize services if not already done
      if (Object.keys(this.services).length === 0) {
        await this.initialize();
      }

      this.isRunning = true;
      this.stats.startTime = Date.now();

      // Start core services
      await this.startCoreServices();

      // Start monitoring intervals
      this.startMonitoring();

      // Start API server
      if (process.env.ENABLE_API !== 'false') {
        await apiServer.start();
      }

      // Subscribe to events
      this.setupEventSubscriptions();

      logger.info('🎉 DeFi Arbitrage Bot started successfully!');
      this.logStartupInfo();

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.start' });
      await this.stop();
      throw error;
    }
  }

  // Start core services
  async startCoreServices() {
    // Start price fetching
    this.services.priceFetcher.start(INTERVALS.PRICE_UPDATE);

    // Start arbitrage detection
    this.services.arbitrageDetector.start(INTERVALS.SCAN_OPPORTUNITIES);

    logger.info('🔄 Core services started');
  }

  // Setup monitoring intervals
  startMonitoring() {
    // Health check interval
    this.intervals.healthCheck = setInterval(async () => {
      await this.performHealthCheck();
    }, INTERVALS.HEALTH_CHECK);

    // Cleanup interval
    this.intervals.cleanup = setInterval(async () => {
      await this.performCleanup();
    }, INTERVALS.CLEANUP_DB);

    // Statistics logging interval
    this.intervals.stats = setInterval(async () => {
      await this.logStatistics();
    }, 5 * 60 * 1000); // Every 5 minutes

    logger.info('📊 Monitoring intervals started');
  }

  // Generate initial opportunities from discovered pools  
  async generateInitialOpportunities() {
    try {
      logger.info('🎯 Generating initial arbitrage opportunities from discovered pools...');
      
      const opportunities = await this.services.opportunityGenerator.generateOpportunities();
      
      if (opportunities.length > 0) {
        logger.info(`✨ Generated ${opportunities.length} initial opportunities`);
        
        // Save each opportunity to database
        for (const opportunity of opportunities) {
          await this.handleNewOpportunity(opportunity);
        }
        
        logger.info(`💾 Saved ${opportunities.length} opportunities to database`);
      } else {
        logger.info('📝 No initial opportunities generated (need more pools from different DEXs)');
      }

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.generateInitialOpportunities' });
    }
  }

  // Setup event subscriptions
  setupEventSubscriptions() {
    // Subscribe to new opportunities
    this.services.arbitrageDetector.subscribe(async (opportunity) => {
      await this.handleNewOpportunity(opportunity);
    });

    // Subscribe to price updates
    this.services.priceFetcher.subscribe(async (priceData) => {
      await this.handlePriceUpdate(priceData);
    });

    logger.info('📡 Event subscriptions setup completed');
  }

  // Handle new arbitrage opportunity
  async handleNewOpportunity(opportunity) {
    try {
      this.stats.totalOpportunities++;

      // Save opportunity to database
      const opportunityDoc = await this.saveOpportunityToDatabase(opportunity);

      // Check if it meets minimum profit threshold
      if (opportunity.expectedProfit &&
          parseFloat(opportunity.expectedProfit) >= ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD) {

        this.stats.profitableOpportunities++;

        // Simulate the trade
        await this.simulateOpportunity(opportunityDoc);
      }

    } catch (error) {
      logError(error, {
        context: 'ArbitrageBot.handleNewOpportunity',
        opportunityId: opportunity.id
      });
      this.stats.errors++;
    }
  }

  // Save opportunity to database (if available)
  async saveOpportunityToDatabase(opportunity) {
    try {
      // Skip database operations if not connected
      if (!dbConnection.isConnected) {
        logger.warn('Database not connected - attempting to reconnect...');
        try {
          await dbConnection.connect();
        } catch (reconnectError) {
          logger.debug('Failed to reconnect to database, continuing without persistence');
          return { id: opportunity.id };
        }
      }

      // Get token addresses from constants
      const getTokenAddress = (symbol) => {
        const token = SUPPORTED_TOKENS[symbol];
        return token ? token.address : symbol;
      };

      const opportunityData = {
        id: opportunity.id,
        timestamp: new Date(opportunity.timestamp),
        dexA: opportunity.buyDex || opportunity.dexA || 'UNISWAP_V3',
        dexB: opportunity.sellDex || opportunity.dexB || 'SUSHISWAP_V3',
        tokenIn: getTokenAddress(opportunity.tokenA || opportunity.tokenIn),
        tokenOut: getTokenAddress(opportunity.tokenB || opportunity.tokenOut),
        amountIn: opportunity.tradeAmount?.toString() || '1000',
        amountOutExpected: opportunity.expectedOutput?.toString() || '0',
        expectedProfit: opportunity.expectedProfit?.toString() || '0',
        profitPercentage: parseFloat(opportunity.priceDifferencePercent?.toString() || '0'),
        priceA: opportunity.buyPrice?.toString() || '0',
        priceB: opportunity.sellPrice?.toString() || '0',
        priceDifference: parseFloat(opportunity.priceDifference?.toString() || '0'),
        gasEstimate: opportunity.gasCost?.toString() || '0',
        gasPrice: '20000000000', // 20 gwei default
        swapFees: opportunity.swapFees?.toString() || '0',
        totalFees: opportunity.totalFees?.toString() || '0',
        poolA: opportunity.poolA?.address || 'mock_pool_a',
        poolB: opportunity.poolB?.address || 'mock_pool_b',
        liquidityA: '1000000000000000000000', // Mock liquidity
        liquidityB: '1000000000000000000000', // Mock liquidity
        status: 'detected',
        metadata: {
          chainId: 1,
          feeTier: 3000,
          slippageTolerance: 0.5,
          priceImpact: 0.1,
          blockNumber: await rpcManager.getBlockNumber().catch(() => 0)
        }
      };

      // Add triangular path if present
      if (opportunity.triangularPath && Array.isArray(opportunity.triangularPath)) {
        opportunityData.triangularPath = opportunity.triangularPath.map(step => ({
          dex: step.dex || 'UNISWAP_V3',
          tokenIn: getTokenAddress(step.tokenIn || step.token),
          tokenOut: getTokenAddress(step.tokenOut || step.toToken),
          pool: step.pool || 'mock_pool',
          amount: step.amount?.toString() || '0'
        }));
      }

      const opportunityDoc = new Opportunity(opportunityData);
      await opportunityDoc.save();

      logger.info(`💾 Opportunity saved to database: ${opportunity.id}`, {
        profit: opportunityData.expectedProfit,
        percentage: opportunityData.profitPercentage
      });

      return opportunityDoc;

    } catch (error) {
      logError(error, {
        context: 'ArbitrageBot.saveOpportunityToDatabase',
        opportunityId: opportunity.id,
        error: error.message
      });
      // Don't throw error - allow bot to continue without database
      return { id: opportunity.id };
    }
  }

  // Simulate opportunity
  async simulateOpportunity(opportunityDoc) {
    try {
      this.stats.simulatedTrades++;

      const tradeAmount = ARBITRAGE_CONFIG.MIN_TRADE_SIZE_USD; // Start with minimum

      let simulationResult;
      if (opportunityDoc.triangularPath && opportunityDoc.triangularPath.length > 0) {
        // Triangular arbitrage
        const triangularOpp = {
          id: opportunityDoc.id,
          type: 'triangular',
          path: opportunityDoc.triangularPath.map(p => [p.tokenIn, p.tokenOut]).flat()
            .filter((token, index, arr) => arr.indexOf(token) === index),
          trades: opportunityDoc.triangularPath
        };
        simulationResult = await this.services.tradeSimulator.simulateTriangularArbitrage(
          triangularOpp, tradeAmount
        );
      } else {
        // Simple arbitrage
        const simpleOpp = {
          id: opportunityDoc.id,
          type: 'simple',
          tokenA: opportunityDoc.tokenIn,
          tokenB: opportunityDoc.tokenOut,
          buyDex: opportunityDoc.dexA,
          sellDex: opportunityDoc.dexB
        };
        simulationResult = await this.services.tradeSimulator.simulateSimpleArbitrage(
          simpleOpp, tradeAmount
        );
      }

      // Update opportunity with simulation result
      await opportunityDoc.markAsSimulated({
        success: simulationResult.success,
        actualOutput: simulationResult.finalAmount || simulationResult.profit,
        gasUsed: simulationResult.totalGasUsed,
        errorMessage: simulationResult.error,
        simulationTimestamp: new Date()
      });

      // If simulation is successful and profitable, execute trade (if enabled)
      if (simulationResult.success &&
          simulationResult.netProfit &&
          parseFloat(simulationResult.netProfit) > 0 &&
          process.env.ENABLE_TRADE_EXECUTION === 'true') {

        await this.executeOpportunity(opportunityDoc, simulationResult);
      }

    } catch (error) {
      logError(error, {
        context: 'ArbitrageBot.simulateOpportunity',
        opportunityId: opportunityDoc.id
      });
      this.stats.errors++;
    }
  }

  // Execute opportunity (for future implementation)
  async executeOpportunity(opportunityDoc, simulationResult) {
    try {
      // This would implement actual trade execution
      // For now, we'll just log it
      logger.info('🎯 Opportunity ready for execution', {
        opportunityId: opportunityDoc.id,
        expectedProfit: opportunityDoc.expectedProfit,
        simulationProfit: simulationResult.netProfit
      });

      // Update status to indicate it's ready for execution
      await opportunityDoc.updateOne({
        status: 'profitable',
        'executionResult': {
          ready: true,
          simulationProfit: simulationResult.netProfit,
          gasEstimate: simulationResult.totalGasUsed
        }
      });

    } catch (error) {
      logError(error, {
        context: 'ArbitrageBot.executeOpportunity',
        opportunityId: opportunityDoc.id
      });
      this.stats.errors++;
    }
  }

  // Handle price updates
  async handlePriceUpdate(priceData) {
    // Price updates are handled by the price fetcher service
    // This is a placeholder for any additional logic needed
  }

  // Perform health check
  async performHealthCheck() {
    try {
      const health = {
        rpc: this.services.rpc.isHealthy,
        priceFetcher: this.services.priceFetcher.isRunning,
        arbitrageDetector: this.services.arbitrageDetector.isRunning,
        database: (await dbConnection.healthCheck()).status === 'connected'
      };

      const isHealthy = Object.values(health).every(status => status === true);

      if (!isHealthy) {
        logger.warn('⚠️ System health check failed', health);
      } else {
        logger.debug('✅ System health check passed');
      }

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.performHealthCheck' });
      this.stats.errors++;
    }
  }

  // Perform cleanup
  async performCleanup() {
    try {
      // Clean up old opportunities (if database is available)
      if (dbConnection.isConnected) {
        const deletedCount = await Opportunity.deleteMany({
          timestamp: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Older than 24 hours
          status: { $in: ['expired', 'executed', 'failed'] }
        });

        if (deletedCount.deletedCount > 0) {
          logger.info(`🧹 Cleaned up ${deletedCount.deletedCount} old opportunities`);
        }
      }

      // Clean up service caches
      this.services.priceFetcher.cleanup();
      this.services.tradeSimulator.cleanupCache();
      this.services.poolDiscovery.cleanup();

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.performCleanup' });
      this.stats.errors++;
    }
  }

  // Log statistics
  async logStatistics() {
    try {
      const uptime = Date.now() - this.stats.startTime;
      const uptimeHours = uptime / (1000 * 60 * 60);

      let dbStats = {};
      
      // Get database stats if available
      if (dbConnection.isConnected) {
        try {
          const dbStatsResult = await Opportunity.getStats(uptime);
          dbStats = dbStatsResult[0] || {};
        } catch (error) {
          logger.debug('Could not fetch database stats:', error.message);
        }
      }

      logger.info('📊 Bot Statistics', {
        uptime: `${uptimeHours.toFixed(2)} hours`,
        opportunities: {
          total: this.stats.totalOpportunities,
          profitable: this.stats.profitableOpportunities,
          simulated: this.stats.simulatedTrades,
          executed: this.stats.executedTrades,
          database: dbStats
        },
        errors: this.stats.errors,
        services: {
          rpc: this.services.rpc.getStats(),
          priceFetcher: this.services.priceFetcher.getStats(),
          arbitrageDetector: this.services.arbitrageDetector.getStats(),
          poolDiscovery: this.services.poolDiscovery.getStats()
        }
      });

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.logStatistics' });
    }
  }

  // Stop the bot
  async stop() {
    if (this.isShuttingDown) {
      logger.warn('⚠️ Bot is already shutting down');
      return;
    }

    this.isShuttingDown = true;
    logger.info('🛑 Shutting down DeFi Arbitrage Bot...');

    try {
      // Clear intervals
      Object.values(this.intervals).forEach(interval => {
        if (interval) clearInterval(interval);
      });

      // Stop services
      if (this.services.priceFetcher) {
        this.services.priceFetcher.stop();
      }
      if (this.services.arbitrageDetector) {
        this.services.arbitrageDetector.stop();
      }

      // Stop API server
      if (apiServer.isStarted) {
        await apiServer.stop();
      }

      // Disconnect from database
      if (dbConnection.isConnected) {
        await dbConnection.disconnect();
      }

      // Clean up RPC manager
      if (this.services.rpc) {
        this.services.rpc.destroy();
      }

      this.isRunning = false;
      logger.info('✅ DeFi Arbitrage Bot shut down successfully');

    } catch (error) {
      logError(error, { context: 'ArbitrageBot.stop' });
      throw error;
    }
  }

  // Log system information
  logSystemInfo() {
    logger.info('🖥️ System Information', {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      pid: process.pid
    });
  }

  // Log startup information
  logStartupInfo() {
    logger.info('🚀 Bot Startup Information', {
      startTime: new Date().toISOString(),
      configuration: {
        minProfitThreshold: ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD,
        minTradeSize: process.env.MIN_TRADE_SIZE_USD,
        maxTradeSize: process.env.MAX_TRADE_SIZE_USD,
        priceUpdateInterval: INTERVALS.PRICE_UPDATE,
        scanInterval: INTERVALS.SCAN_OPPORTUNITIES,
        enableAPI: process.env.ENABLE_API !== 'false',
        enableTradeExecution: process.env.ENABLE_TRADE_EXECUTION === 'true',
        simulationMode: process.env.SIMULATION_ONLY !== 'false'
      },
      services: {
        database: 'connected',
        rpc: `${this.services.rpc.getStats().totalProviders} providers`,
        pools: this.services.poolDiscovery.getTotalPools(),
        pricePoints: this.services.priceFetcher.prices.size
      }
    });
  }

  // Get current bot status
  getStatus() {
    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      stats: this.stats,
      services: Object.keys(this.services).reduce((acc, key) => {
        acc[key] = this.services[key] ? 'initialized' : 'not initialized';
        return acc;
      }, {})
    };
  }
}

// Create and start the bot
const bot = new ArbitrageBot();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('📡 Received SIGTERM signal');
  await bot.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('📡 Received SIGINT signal');
  await bot.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  logError(error, { context: 'UncaughtException' });
  await bot.stop();
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', async (reason, promise) => {
  logError(new Error(reason), { context: 'UnhandledRejection', promise });
  await bot.stop();
  process.exit(1);
});

// Start the bot
async function main() {
  try {
    await bot.start();
  } catch (error) {
    logger.error('💥 Failed to start bot:', error);
    process.exit(1);
  }
}

// Only start bot if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default bot;
#!/usr/bin/env node

/**
 * Simple test script to verify basic setup without blockchain connection
 * Run with: node test-basic.js
 */

import 'dotenv/config';
import { logger } from './src/utils/logger.js';
import { SUPPORTED_TOKENS, ARBITRAGE_CONFIG } from './src/config/constants.js';

async function testBasicSetup() {
  try {
    logger.info('🚀 Testing Basic DeFi Arbitrage Bot Setup...');

    // Test 1: Environment and Configuration
    logger.info('📋 Checking configuration...');
    logger.info(`💰 Minimum profit threshold: $${ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD}`);
    logger.info(`⛽ Gas buffer: ${ARBITRAGE_CONFIG.GAS_BUFFER_PERCENTAGE}%`);
    logger.info(`🔍 Supported tokens: ${Object.keys(SUPPORTED_TOKENS).join(', ')}`);
    logger.info('✅ Configuration loaded successfully');

    // Test 2: Module imports
    logger.info('📦 Testing ES6 module imports...');
    
    try {
      const { BigNumber } = await import('./src/config/constants.js');
      const testNum = new BigNumber('100.5');
      logger.info(`✅ BigNumber working: ${testNum.toString()}`);
    } catch (error) {
      logger.error('❌ BigNumber import failed:', error.message);
      throw error;
    }

    try {
      const HelperUtils = (await import('./src/utils/helpers.js')).default;
      const testAmount = HelperUtils.formatUSD('1234.567');
      logger.info(`✅ Helper utils working: $${testAmount}`);
    } catch (error) {
      logger.error('❌ Helper utils import failed:', error.message);
      throw error;
    }

    // Test 3: Database configuration (without connecting)
    logger.info('📊 Testing database configuration...');
    try {
      const dbConnection = (await import('./src/config/database.js')).default;
      logger.info(`✅ Database config loaded. Connection string configured: ${!!dbConnection.connectionString}`);
    } catch (error) {
      logger.error('❌ Database config failed:', error.message);
      throw error;
    }

    // Test 4: Service imports
    logger.info('🔧 Testing service imports...');
    
    const services = [
      './src/services/rpc-manager.js',
      './src/services/pool-discovery.js',
      './src/services/price-fetcher/index.js',
      './src/services/arbitrage-detector/index.js',
      './src/services/profit-calculator/index.js',
      './src/services/trade-simulator/index.js'
    ];

    for (const servicePath of services) {
      try {
        await import(servicePath);
        const serviceName = servicePath.split('/').pop().replace('.js', '').replace('/index', '');
        logger.info(`✅ ${serviceName} service imported successfully`);
      } catch (error) {
        logger.error(`❌ Failed to import ${servicePath}:`, error.message);
        throw error;
      }
    }

    // Test 5: API server import
    logger.info('🌐 Testing API server import...');
    try {
      await import('./src/api/server.js');
      logger.info('✅ API server imported successfully');
    } catch (error) {
      logger.error('❌ API server import failed:', error.message);
      throw error;
    }

    logger.info('');
    logger.info('🎉 Basic setup test completed successfully!');
    logger.info('');
    logger.info('✅ All ES6 modules are working correctly');
    logger.info('✅ Configuration is properly loaded');
    logger.info('✅ All services can be imported');
    logger.info('✅ Ready to test with blockchain connection');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Test RPC connection: node test-rpc.js');
    logger.info('2. Start the full bot: npm start');
    logger.info('3. Access API at: http://localhost:3000/api');
    
    process.exit(0);

  } catch (error) {
    logger.error('❌ Basic setup test failed:', error);
    logger.error('');
    logger.error('This indicates a fundamental issue with the code structure.');
    logger.error('Please check the error above and fix any import or configuration issues.');
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testBasicSetup();
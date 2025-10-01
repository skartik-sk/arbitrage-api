#!/usr/bin/env node

/**
 * Simple test script to verify the DeFi Arbitrage Bot setup
 * Run with: node test-setup.js
 */

import 'dotenv/config';
import { logger } from './src/utils/logger.js';
import { SUPPORTED_TOKENS, ARBITRAGE_CONFIG } from './src/config/constants.js';
import rpcManager from './src/services/rpc-manager.js';

async function testSetup() {
  try {
    logger.info('🚀 Testing DeFi Arbitrage Bot Setup...');

    // Test 1: Environment variables
    logger.info('📋 Checking environment variables...');
    const requiredEnvVars = ['ETHEREUM_RPC'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
      logger.info('💡 Using default RPC endpoints from Ankr');
    } else {
      logger.info('✅ Environment variables configured');
    }

    // Test 2: Configuration
    logger.info('🔧 Checking configuration...');
    logger.info(`💰 Minimum profit threshold: $${ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD}`);
    logger.info(`⛽ Gas buffer: ${ARBITRAGE_CONFIG.GAS_BUFFER_PERCENTAGE}%`);
    logger.info(`🔍 Supported tokens: ${Object.keys(SUPPORTED_TOKENS).join(', ')}`);

    // Test 3: RPC Connection
    logger.info('🌐 Testing RPC connection...');
    await rpcManager.initialize();
    
    const blockNumber = await rpcManager.getBlockNumber();
    logger.info(`✅ Connected to Ethereum. Latest block: ${blockNumber}`);

    const gasPrice = await rpcManager.getGasPrice();
    logger.info(`⛽ Current gas price: ${(Number(gasPrice) / 1e9).toFixed(2)} gwei`);

    // Test 4: MongoDB (if available)
    logger.info('📊 Checking database connection...');
    try {
      const dbConnection = await import('./src/config/database.js');
      await dbConnection.default.connect();
      logger.info('✅ Database connected successfully');
      await dbConnection.default.disconnect();
    } catch (error) {
      logger.warn('⚠️  Database not available (this is okay for testing)');
      logger.warn(`Database error: ${error.message}`);
    }

    logger.info('🎉 Setup test completed successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Make sure MongoDB is running if you want to store opportunities');
    logger.info('2. Run the bot with: npm start');
    logger.info('3. Access the API at: http://localhost:3000/api');
    
    process.exit(0);

  } catch (error) {
    logger.error('❌ Setup test failed:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testSetup();
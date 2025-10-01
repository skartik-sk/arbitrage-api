#!/usr/bin/env node

/**
 * RPC Connection Test Script
 * Tests blockchain connectivity independently
 * Run with: node test-rpc.js
 */

import 'dotenv/config';
import { logger } from './src/utils/logger.js';
import rpcManager from './src/services/rpc-manager.js';

async function testRPCConnection() {
  try {
    logger.info('🔗 Testing RPC Connection...');
    
    logger.info('📡 Initializing RPC manager...');
    
    await rpcManager.initialize();
    logger.info('✅ RPC manager initialized successfully');
    
    const provider = rpcManager.getProvider();
    if (!provider) {
      throw new Error('No provider available');
    }
    
    logger.info('🌐 Testing network connection...');
    const network = await provider.getNetwork();
    logger.info(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
    
    logger.info('📊 Testing block number...');
    const blockNumber = await provider.getBlockNumber();
    logger.info(`✅ Current block number: ${blockNumber}`);
    
    logger.info('⛽ Testing gas price...');
    const gasPrice = await provider.getFeeData();
    logger.info(`✅ Gas price: ${gasPrice.gasPrice ? gasPrice.gasPrice.toString() : 'N/A'} wei`);
    
    logger.info('');
    logger.info('🎉 RPC connection test successful!');
    logger.info('✅ Blockchain connectivity is working');
    logger.info('✅ Ready to start the full arbitrage bot');
    
    process.exit(0);
    
  } catch (error) {
    logger.error('❌ RPC connection test failed:', error);
    logger.error('');
    logger.error('Possible solutions:');
    logger.error('1. Check your internet connection');
    logger.error('2. Try running the test again (RPC endpoints can be temporarily unavailable)');
    logger.error('3. Update RPC endpoints in src/services/rpc-manager.js');
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testRPCConnection();
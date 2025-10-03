#!/usr/bin/env node

import 'dotenv/config';
import { logger } from './src/utils/logger.js';
import dbConnection from './src/config/database.js';
import rpcManager from './src/services/rpc-manager.js';
import poolDiscovery from './src/services/pool-discovery.js';
import priceFetcher from './src/services/price-fetcher/index.js';
import arbitrageDetector from './src/services/arbitrage-detector/index.js';

async function findRealArbitrageOpportunities() {
  try {
    logger.info('🔍 SEARCHING FOR REAL ARBITRAGE OPPORTUNITIES...');
    
    // 1. Initialize all services
    logger.info('1️⃣ Connecting to database...');
    await dbConnection.connect();
    
    logger.info('2️⃣ Initializing RPC...');
    await rpcManager.initialize();
    
    logger.info('3️⃣ Discovering pools on ALL DEXs...');
    await poolDiscovery.initialize();
    
    // Check what pools we found
    const totalPools = poolDiscovery.getTotalPools();
    logger.info(`📊 POOL DISCOVERY RESULTS: ${totalPools} pools found`);
    
    // Show pools by DEX
    const uniswapPools = [];
    const sushiPools = [];
    
    for (const [key, pool] of poolDiscovery.discoveredPools) {
      if (pool.dex === 'UNISWAP_V3') {
        uniswapPools.push(`${pool.tokenA}/${pool.tokenB} (${pool.feeTier})`);
      } else if (pool.dex === 'SUSHISWAP_V3') {
        sushiPools.push(`${pool.tokenA}/${pool.tokenB} (${pool.feeTier})`);
      }
    }
    
    logger.info(`📈 UNISWAP V3 POOLS (${uniswapPools.length}): ${uniswapPools.join(', ')}`);
    logger.info(`🍣 SUSHISWAP V3 POOLS (${sushiPools.length}): ${sushiPools.join(', ')}`);
    
    if (sushiPools.length === 0) {
      logger.warn('⚠️ NO SUSHISWAP POOLS FOUND! Cannot find arbitrage without multiple DEXs');
      logger.info('💡 This means either:');
      logger.info('   1. SushiSwap V3 factory address is wrong');
      logger.info('   2. SushiSwap V3 pools don\'t exist for these token pairs');
      logger.info('   3. Different fee tiers are being used');
      
      // Try to manually check if a SushiSwap pool exists
      logger.info('🔍 Manually checking SushiSwap factory...');
      await checkSushiSwapFactory();
    }
    
    // 4. Initialize price fetcher
    logger.info('4️⃣ Starting price fetcher...');
    await priceFetcher.initialize();
    await priceFetcher.startPriceFetching();
    
    // Wait for prices
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    const allPrices = priceFetcher.getAllPricesMap();
    logger.info(`💰 PRICE DATA: ${allPrices.size} price points collected`);
    
    // Show all prices
    for (const [key, priceData] of allPrices) {
      logger.info(`   ${priceData.dex}: ${priceData.tokenA}/${priceData.tokenB} = $${priceData.price.toFixed(6)}`);
    }
    
    // 5. Run arbitrage detection
    logger.info('5️⃣ Running arbitrage detection...');
    await arbitrageDetector.initialize();
    
    // Run a manual scan
    await arbitrageDetector.scanForOpportunities();
    
    const opportunities = arbitrageDetector.getAllOpportunities();
    logger.info(`🎯 ARBITRAGE RESULTS: ${opportunities.length} opportunities found`);
    
    if (opportunities.length > 0) {
      logger.info('🎉 FOUND REAL ARBITRAGE OPPORTUNITIES:');
      for (const opp of opportunities) {
        logger.info(`   💰 ${opp.tokenA}→${opp.tokenB}: $${parseFloat(opp.expectedProfit.toString()).toFixed(2)} profit`);
        logger.info(`      Buy: ${opp.buyDex} | Sell: ${opp.sellDex}`);
        logger.info(`      Price Diff: ${parseFloat(opp.priceDifferencePercent.toString()).toFixed(2)}%`);
      }
      
      // Count database entries
      const { default: Opportunity } = await import('./src/models/opportunity.js');
      const dbCount = await Opportunity.countDocuments();
      logger.info(`💾 Database now has ${dbCount} opportunities total`);
      
    } else {
      logger.info('📊 NO PROFITABLE ARBITRAGE OPPORTUNITIES FOUND');
      logger.info('💡 This could be because:');
      logger.info('   1. Market is efficient (prices are too close)');
      logger.info('   2. Gas costs exceed potential profits');
      logger.info('   3. Only one DEX has pools for these pairs');
      logger.info('   4. Price differences are below minimum threshold ($1)');
    }
    
    logger.info('✅ Real arbitrage analysis complete!');
    process.exit(0);
    
  } catch (error) {
    logger.error('❌ Error finding arbitrage opportunities:', error);
    process.exit(1);
  }
}

async function checkSushiSwapFactory() {
  try {
    const sushiFactory = '0xc35DADB65012eC5796536bD9864eD8773aBc74C4';
    const provider = rpcManager.getProvider();
    
    // Check if contract exists
    const code = await provider.getCode(sushiFactory);
    if (code === '0x') {
      logger.error('❌ SushiSwap factory contract does not exist at this address!');
      return;
    }
    
    logger.info('✅ SushiSwap factory contract exists');
    
    // Try to check for a known pool
    const factoryABI = [
      "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
    ];
    
    const factory = new ethers.Contract(sushiFactory, factoryABI, provider);
    
    // Check USDT/WETH pool on SushiSwap
    const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    
    for (const fee of [500, 3000, 10000]) {
      try {
        const poolAddress = await factory.getPool(usdtAddress, wethAddress, fee);
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          logger.info(`✅ Found SushiSwap USDT/WETH pool (${fee}): ${poolAddress}`);
          return;
        }
      } catch (error) {
        logger.debug(`No SushiSwap USDT/WETH pool at fee ${fee}`);
      }
    }
    
    logger.warn('⚠️ No SushiSwap USDT/WETH pools found in any fee tier');
    
  } catch (error) {
    logger.error('Error checking SushiSwap factory:', error.message);
  }
}

// Run the search
findRealArbitrageOpportunities();
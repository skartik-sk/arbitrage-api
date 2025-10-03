import { ethers } from 'ethers';
import poolDiscovery from '../pool-discovery.js';
import sushiSwapV2Discovery from '../sushiswap-v2-discovery.js';
import rpcManager from '../rpc-manager.js';
import { SUPPORTED_TOKENS, TOKEN_PAIRS, ARBITRAGE_CONFIG, FEE_TIERS } from '../../config/constants.js';
import { logPriceUpdate, logError, logger } from '../../utils/logger.js';
import HelperUtils from '../../utils/helpers.js';

class PriceFetcher {
  constructor() {
    this.prices = new Map();
    this.priceHistory = new Map();
    this.isRunning = false;
    this.updateInterval = null;
    this.subscribers = new Set();
    this.lastUpdate = null;
  }

  // Initialize the price fetcher
  async initialize() {
    try {
      logger.info('Initializing price fetcher...');

      // Wait for pools to be discovered (be more flexible)
      let retries = 0;
      while (!poolDiscovery.isInitialized && retries < 5) {
        await HelperUtils.sleep(2000);
        retries++;
        logger.info(`Waiting for pool discovery... (attempt ${retries}/5, pools found: ${poolDiscovery.getTotalPools()})`);
      }

      // Continue even if pool discovery isn't fully complete but has some pools
      if (!poolDiscovery.isInitialized && poolDiscovery.getTotalPools() === 0) {
        throw new Error('No pools discovered - cannot proceed');
      }
      
      if (poolDiscovery.getTotalPools() > 0) {
        logger.info(`✅ Proceeding with ${poolDiscovery.getTotalPools()} discovered pools`);
      }

      // Fetch initial prices
      await this.updateAllPrices();

      logger.info(`Price fetcher initialized with ${this.prices.size} price points`);
    } catch (error) {
      logError(error, { context: 'PriceFetcher.initialize' });
      throw error;
    }
  }

  // Start continuous price updates
  start(intervalMs = 5000) {
    if (this.isRunning) {
      logger.warn('Price fetcher is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateAllPrices();
      } catch (error) {
        logError(error, { context: 'PriceFetcher.updateLoop' });
      }
    }, intervalMs);

    logger.info(`Price fetcher started with ${intervalMs}ms interval`);
  }

  // Stop price updates
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    logger.info('Price fetcher stopped');
  }

  // Update all prices for supported token pairs
  async updateAllPrices() {
    try {
      const updatePromises = [];

      // Update prices for all token pairs across both Uniswap V3 and SushiSwap V2
      for (const [tokenA, tokenB] of TOKEN_PAIRS) {
        // 1. Get prices from Uniswap V3 (multiple fee tiers)
        const v3FeeTiers = [500, 3000, 10000];
        let v3PoolsFound = 0;
        
        for (const feeTier of v3FeeTiers) {
          const poolInfo = poolDiscovery.getPool('UNISWAP_V3', tokenA, tokenB, feeTier);
          if (poolInfo) {
            updatePromises.push(
              this.updatePriceV3('UNISWAP_V3', tokenA, tokenB, feeTier)
            );
            v3PoolsFound++;
          }
        }
        
        // 2. Get prices from SushiSwap V2
        const v2Pool = sushiSwapV2Discovery.getPool(tokenA, tokenB);
        if (v2Pool) {
          updatePromises.push(
            this.updatePriceV2('SUSHISWAP_V2', tokenA, tokenB)
          );
        }
        
        logger.debug(`${tokenA}/${tokenB}: V3 pools: ${v3PoolsFound}, V2 pool: ${v2Pool ? 'found' : 'not found'}`);
      }

      const results = await Promise.allSettled(updatePromises);

      let successful = 0;
      let failed = 0;

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          successful++;
        } else {
          failed++;
        }
      });

      this.lastUpdate = Date.now();

      if (successful > 0) {
        logger.info(`📈 REAL-TIME PRICE UPDATE: ${successful} prices fetched from blockchain, ${failed} failed`);
        this.logCurrentPrices();
      }

      if (failed > 0) {
        logger.warn(`Price update completed: ${successful} successful, ${failed} failed`);
      }

    } catch (error) {
      logError(error, { context: 'PriceFetcher.updateAllPrices' });
      throw error;
    }
  }

  // Update price for Uniswap V3
  async updatePriceV3(dexName, tokenA, tokenB, feeTier = 3000) {
    try {
      const poolInfo = poolDiscovery.getPool(dexName, tokenA, tokenB, feeTier);
      if (!poolInfo) {
        logger.debug(`Pool not found for price update: ${dexName} ${tokenA}/${tokenB}`);
        return null;
      }

      // Get current pool state
      const [slot0, liquidity] = await Promise.all([
        rpcManager.execute(async (provider) => {
          return await poolInfo.contract.slot0();
        }),
        rpcManager.execute(async (provider) => {
          return await poolInfo.contract.liquidity();
        })
      ]);

      // Calculate price from sqrtPriceX96
      const price = this.calculatePriceFromSqrt(slot0.sqrtPriceX96, tokenA, tokenB);

      const priceData = {
        dex: dexName,
        tokenA,
        tokenB,
        feeTier,
        price,
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: slot0.tick,
        liquidity: liquidity.toString(),
        blockNumber: await rpcManager.getBlockNumber(),
        timestamp: Date.now()
      };

      // Store price with fee tier in key
      const priceKey = this.getPriceKey(dexName, tokenA, tokenB, feeTier);
      this.prices.set(priceKey, priceData);

      // Store in history (keep last 100 entries)
      if (!this.priceHistory.has(priceKey)) {
        this.priceHistory.set(priceKey, []);
      }
      const history = this.priceHistory.get(priceKey);
      history.push(priceData);
      if (history.length > 100) {
        history.shift();
      }

      // Log real-time price with detailed info
      logger.info(`💰 REAL PRICE UPDATE: ${dexName} ${tokenA}/${tokenB} = $${price.toFixed(6)} (Block: ${priceData.blockNumber}, Liquidity: ${liquidity.toString()})`);
      
      logPriceUpdate(dexName, `${tokenA}/${tokenB}`, price);

      // Notify subscribers
      this.notifySubscribers(priceData);

      return priceData;

    } catch (error) {
      logError(error, {
        dex: dexName,
        tokenA,
        tokenB,
        feeTier,
        context: 'PriceFetcher.updatePriceV3'
      });
      return null;
    }
  }

  // Update price for SushiSwap V2
  async updatePriceV2(dexName, tokenA, tokenB) {
    try {
      await sushiSwapV2Discovery.updatePoolReserves(tokenA, tokenB);
      const price = await sushiSwapV2Discovery.calculatePrice(tokenA, tokenB);
      
      if (!price) {
        logger.debug(`No price calculated for ${dexName} ${tokenA}/${tokenB}`);
        return null;
      }

      const priceData = {
        dex: dexName,
        tokenA,
        tokenB,
        price: new HelperUtils.BigNumber(price.toString()),
        liquidity: '1000000000', // V2 doesn't have direct liquidity measure
        blockNumber: await rpcManager.getBlockNumber(),
        timestamp: Date.now(),
        feeTier: 3000 // V2 has fixed 0.3% fee
      };

      // Store price with fee tier in key for consistency
      const priceKey = this.getPriceKey(dexName, tokenA, tokenB, 3000);
      this.prices.set(priceKey, priceData);

      // Store in history
      if (!this.priceHistory.has(priceKey)) {
        this.priceHistory.set(priceKey, []);
      }
      const history = this.priceHistory.get(priceKey);
      history.push(priceData);
      if (history.length > 100) {
        history.shift();
      }

      logger.info(`💰 REAL PRICE UPDATE: ${dexName} ${tokenA}/${tokenB} = $${price.toFixed(6)} (Block: ${priceData.blockNumber})`);
      
      logPriceUpdate(dexName, `${tokenA}/${tokenB}`, price);
      this.notifySubscribers(priceData);

      return priceData;

    } catch (error) {
      logError(error, {
        dex: dexName,
        tokenA,
        tokenB,
        context: 'PriceFetcher.updatePriceV2'
      });
      return null;
    }
  }

  // Calculate price from sqrtPriceX96
  calculatePriceFromSqrt(sqrtPriceX96, tokenA, tokenB) {
    try {
      const tokenAInfo = SUPPORTED_TOKENS[tokenA];
      const tokenBInfo = SUPPORTED_TOKENS[tokenB];

      if (!tokenAInfo || !tokenBInfo) {
        throw new Error('Token info not found');
      }

      // sqrtPriceX96 = sqrt(price) * 2^96
      // price = (sqrtPriceX96 / 2^96)^2

      const Q96 = new HelperUtils.BigNumber(2).pow(96);
      const sqrtPrice = new HelperUtils.BigNumber(sqrtPriceX96.toString()).dividedBy(Q96);
      const rawPrice = sqrtPrice.multipliedBy(sqrtPrice);

      // Adjust for token decimals
      const decimalsAdjustment = new HelperUtils.BigNumber(10).pow(
        tokenBInfo.decimals - tokenAInfo.decimals
      );

      return rawPrice.multipliedBy(decimalsAdjustment);
    } catch (error) {
      logError(error, { context: 'PriceFetcher.calculatePriceFromSqrt' });
      throw error;
    }
  }

  // Get current price
  getPrice(dexName, tokenA, tokenB, feeTier = null) {
    if (feeTier) {
      const priceKey = this.getPriceKey(dexName, tokenA, tokenB, feeTier);
      return this.prices.get(priceKey);
    }
    
    // If no fee tier specified, return the first available
    for (const tier of [500, 3000, 10000]) {
      const priceKey = this.getPriceKey(dexName, tokenA, tokenB, tier);
      const price = this.prices.get(priceKey); 
      if (price) return price;
    }
    return null;
  }

  // Get price from any DEX for token pair
  getBestPrice(tokenA, tokenB) {
    let bestPrice = null;
    let bestDex = null;

    for (const dex of ['UNISWAP_V3', 'SUSHISWAP_V3']) {
      const price = this.getPrice(dex, tokenA, tokenB);
      if (price && price.price > 0) {
        if (!bestPrice || price.price.gt(bestPrice.price)) {
          bestPrice = price;
          bestDex = dex;
        }
      }
    }

    return { price: bestPrice, dex: bestDex };
  }

  // Get all prices for a token pair
  getAllPrices(tokenA, tokenB) {
    const prices = {};

    for (const dex of ['UNISWAP_V3', 'SUSHISWAP_V3']) {
      const price = this.getPrice(dex, tokenA, tokenB);
      if (price) {
        prices[dex] = price;
      }
    }

    return prices;
  }

  // Calculate price difference between two DEXs
  calculatePriceDifference(tokenA, tokenB) {
    const prices = this.getAllPrices(tokenA, tokenB);
    const dexs = Object.keys(prices);

    if (dexs.length < 2) {
      return null;
    }

    const [dexA, dexB] = dexs;
    const priceA = prices[dexA].price;
    const priceB = prices[dexB].price;

    if (priceA.isZero() || priceB.isZero()) {
      return null;
    }

    const difference = priceA.minus(priceB);
    const percentage = difference.dividedBy(priceB).multipliedBy(100);

    return {
      tokenA,
      tokenB,
      dexA,
      dexB,
      priceA,
      priceB,
      difference,
      percentage: percentage.abs(),
      isArbitrage: percentage.abs().gte(0.5) // 0.5% threshold
    };
  }

  // Get price history
  getPriceHistory(dexName, tokenA, tokenB, limit = 50) {
    const priceKey = this.getPriceKey(dexName, tokenA, tokenB);
    const history = this.priceHistory.get(priceKey) || [];
    return history.slice(-limit);
  }

  // Subscribe to price updates
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notify subscribers of price updates
  notifySubscribers(priceData) {
    for (const callback of this.subscribers) {
      try {
        callback(priceData);
      } catch (error) {
        logError(error, { context: 'PriceFetcher.notifySubscribers' });
      }
    }
  }

  // Get price statistics
  getStats() {
    const stats = {
      totalPrices: this.prices.size,
      lastUpdate: this.lastUpdate,
      isRunning: this.isRunning,
      pricesByDex: {},
      pricesByPair: {}
    };

    for (const priceData of this.prices.values()) {
      // Count by DEX
      stats.pricesByDex[priceData.dex] = (stats.pricesByDex[priceData.dex] || 0) + 1;

      // Count by pair
      const pairKey = `${priceData.tokenA}/${priceData.tokenB}`;
      stats.pricesByPair[pairKey] = (stats.pricesByPair[pairKey] || 0) + 1;
    }

    return stats;
  }

  // Utility methods
  getPriceKey(dexName, tokenA, tokenB, feeTier = 3000) {
    return `${dexName}:${tokenA}-${tokenB}:${feeTier}`;
  }

  // Check if price is stale
  isPriceStale(priceData, maxAgeMs = 30000) {
    return !priceData || (Date.now() - priceData.timestamp) > maxAgeMs;
  }

  // Get all current prices (needed by arbitrage detector)
  getAllPricesMap() {
    return this.prices;
  }

  // Get current prices in simple format
  getCurrentPricesSimple() {
    const result = {};
    for (const [key, priceData] of this.prices) {
      result[key] = {
        price: priceData.price.toString(),
        dex: priceData.dex,
        tokenA: priceData.tokenA,
        tokenB: priceData.tokenB,
        lastUpdate: priceData.timestamp,
        blockNumber: priceData.blockNumber
      };
    }
    return result;
  }

  // Start price fetching (missing method that arbitrage detector needs)
  async startPriceFetching() {
    if (this.isRunning) {
      logger.info('Price fetcher already running');
      return;
    }

    logger.info('🔄 Starting continuous price fetching...');
    
    // Start the price fetching loop
    this.start(process.env.PRICE_UPDATE_INTERVAL_MS || 5000);
    
    logger.info('✅ Price fetching started successfully');
  }

  // Get all arbitrage opportunities
  getArbitrageOpportunities() {
    const opportunities = [];

    for (const [tokenA, tokenB] of TOKEN_PAIRS) {
      const diff = this.calculatePriceDifference(tokenA, tokenB);
      if (diff && diff.isArbitrage) {
        opportunities.push(diff);
      }
    }

    return opportunities.sort((a, b) => b.percentage.minus(a.percentage));
  }

  // Log current prices to prove real data
  logCurrentPrices() {
    if (this.prices.size === 0) {
      logger.info('📊 No prices available yet');
      return;
    }

    logger.info('📊 CURRENT REAL-TIME PRICES FROM BLOCKCHAIN:');
    logger.info('================================================');
    
    const sortedPrices = Array.from(this.prices.values())
      .sort((a, b) => a.dex.localeCompare(b.dex) || a.tokenA.localeCompare(b.tokenA));

    for (const priceData of sortedPrices) {
      const ageMinutes = Math.floor((Date.now() - priceData.timestamp) / 60000);
      logger.info(`💎 ${priceData.dex}: ${priceData.tokenA}/${priceData.tokenB} = $${priceData.price.toFixed(8)} (${ageMinutes}m ago, Block: ${priceData.blockNumber})`);
    }
    
    logger.info('================================================');
  }

  // Cleanup old price data
  cleanup(maxAgeMinutes = 60) {
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;

    let cleaned = 0;

    // Clean current prices
    for (const [key, priceData] of this.prices) {
      if (now - priceData.timestamp > maxAge) {
        this.prices.delete(key);
        cleaned++;
      }
    }

    // Clean price history
    for (const [key, history] of this.priceHistory) {
      const filtered = history.filter(item => now - item.timestamp <= maxAge);
      this.priceHistory.set(key, filtered);
      cleaned += history.length - filtered.length;
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale price entries`);
    }

    return cleaned;
  }
}

// Create singleton instance
const priceFetcher = new PriceFetcher();

export default priceFetcher;
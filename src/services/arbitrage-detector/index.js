import priceFetcher from '../price-fetcher/index.js';
import { SUPPORTED_TOKENS, TOKEN_PAIRS, ARBITRAGE_CONFIG, FEE_TIERS } from '../../config/constants.js';
import { logArbitrageOpportunity, logError, logger } from '../../utils/logger.js';
import HelperUtils from '../../utils/helpers.js';
import rpcManager from '../rpc-manager.js';

class ArbitrageDetector {
  constructor() {
    this.opportunities = new Map();
    this.isRunning = false;
    this.scanInterval = null;
    this.lastScan = null;
    this.subscribers = new Set();
    this.stats = {
      totalScans: 0,
      opportunitiesFound: 0,
      profitableOpportunities: 0
    };
  }

  // Initialize the arbitrage detector
  async initialize() {
    try {
      logger.info('Initializing arbitrage detector...');

      // Wait for price fetcher to have data
      let retries = 0;
      while (priceFetcher.prices.size === 0 && retries < 10) {
        await HelperUtils.sleep(1000);
        retries++;
      }

      if (priceFetcher.prices.size === 0) {
        throw new Error('No price data available');
      }

      logger.info('Arbitrage detector initialized');
    } catch (error) {
      logError(error, { context: 'ArbitrageDetector.initialize' });
      throw error;
    }
  }

  // Start detection (wrapper method for consistency)
  async startDetection() {
    if (this.isRunning) {
      logger.info('Arbitrage detector already running');
      return;
    }

    logger.info('🔍 Starting arbitrage detection loop...');
    
    // Run initial scan
    await this.scanForOpportunities();
    
    // Start continuous scanning
    this.start(process.env.SCAN_INTERVAL_MS || 10000);
    
    logger.info('✅ Arbitrage detection started successfully');
  }

  // Start continuous arbitrage scanning
  start(intervalMs = 10000) {
    if (this.isRunning) {
      logger.warn('Arbitrage detector is already running');
      return;
    }

    this.isRunning = true;
    this.scanInterval = setInterval(async () => {
      try {
        await this.scanForOpportunities();
      } catch (error) {
        logError(error, { context: 'ArbitrageDetector.scanLoop' });
      }
    }, intervalMs);

    logger.info(`Arbitrage detector started with ${intervalMs}ms interval`);
  }

  // Stop arbitrage scanning
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    logger.info('Arbitrage detector stopped');
  }

  // Scan for arbitrage opportunities
  async scanForOpportunities() {
    try {
      this.stats.totalScans++;
      const newOpportunities = [];

      logger.info(`🔍 Scanning for arbitrage opportunities (scan #${this.stats.totalScans})`);
      
      // Scan simple arbitrage opportunities
      for (const [tokenA, tokenB] of TOKEN_PAIRS) {
        logger.info(`🔍 Checking ${tokenA}/${tokenB} for arbitrage opportunities...`);
        const opportunity = await this.detectSimpleArbitrage(tokenA, tokenB);
        if (opportunity) {
          logger.info(`✅ Found opportunity: ${tokenA}/${tokenB} - $${parseFloat(opportunity.expectedProfit.toString()).toFixed(2)} profit`);
          newOpportunities.push(opportunity);
        } else {
          logger.info(`❌ No opportunity found for ${tokenA}/${tokenB}`);
        }
      }

      // Scan triangular arbitrage opportunities
      const triangularOpportunities = await this.detectTriangularArbitrage();
      newOpportunities.push(...triangularOpportunities);

      // Filter by minimum profit threshold
      const minProfitUSD = parseFloat(process.env.MIN_PROFIT_USD) || 1;
      const profitableOpportunities = newOpportunities.filter(opp => 
        opp.expectedProfit && parseFloat(opp.expectedProfit.toString()) >= minProfitUSD
      );

      // Update opportunities map and save to database
      for (const opp of profitableOpportunities) {
        const key = this.getOpportunityKey(opp);
        this.opportunities.set(key, opp);
        this.stats.opportunitiesFound++;
        this.stats.profitableOpportunities++;

        logger.info(`💰 ARBITRAGE OPPORTUNITY FOUND!`);
        logger.info(`   Type: ${opp.type}`);
        logger.info(`   Pair: ${opp.tokenA}/${opp.tokenB}`);
        logger.info(`   Expected Profit: $${parseFloat(opp.expectedProfit.toString()).toFixed(2)}`);
        logger.info(`   Buy DEX: ${opp.buyDex || 'N/A'}`);
        logger.info(`   Sell DEX: ${opp.sellDex || 'N/A'}`);

        // Save to database
        await this.saveOpportunityToDatabase(opp);

        logArbitrageOpportunity(opp);
        this.notifySubscribers(opp);
      }

      // Clean up old opportunities (older than 5 minutes)
      this.cleanupOpportunities();

      this.lastScan = Date.now();

      if (profitableOpportunities.length > 0) {
        logger.info(`🎉 Found ${profitableOpportunities.length} profitable arbitrage opportunities!`);
      } else {
        logger.info(`📊 Scan complete: No profitable opportunities found (${newOpportunities.length} total opportunities checked)`);
      }

    } catch (error) {
      logError(error, { context: 'ArbitrageDetector.scanForOpportunities' });
      throw error;
    }
  }

  // Detect simple arbitrage opportunities between two DEXs OR different fee tiers
  async detectSimpleArbitrage(tokenA, tokenB) {
    try {
      // Get all price data from price fetcher
      const allPrices = priceFetcher.getAllPricesMap();
      const relevantPrices = [];
      
      // Find all prices for this token pair (including different fee tiers)
      for (const [key, priceData] of allPrices) {
        if ((priceData.tokenA === tokenA && priceData.tokenB === tokenB) ||
            (priceData.tokenA === tokenB && priceData.tokenB === tokenA)) {
          relevantPrices.push(priceData);
        }
      }

      logger.info(`   📊 Found ${relevantPrices.length} price points for ${tokenA}/${tokenB}`);
      
      for (const price of relevantPrices) {
        logger.info(`   💰 ${price.dex} ${price.tokenA}/${price.tokenB} (${price.feeTier || 'N/A'}): $${price.price.toString().substring(0, 10)}`);
      }

      if (relevantPrices.length < 2) {
        logger.info(`   ❌ Not enough price points for arbitrage (need 2, found ${relevantPrices.length})`);
        return null;
      }

      // Find best buy and sell prices from all available pools
      let bestBuy = null;
      let bestSell = null;

      for (const priceData of relevantPrices) {
        if (!priceData || !priceData.price) continue;

        // Ensure price is a BigNumber
        const price = HelperUtils.BigNumber.isBigNumber(priceData.price) 
          ? priceData.price 
          : new HelperUtils.BigNumber(priceData.price.toString());

        if (price.isZero()) continue;

        // Normalize token order (A/B vs B/A)
        let normalizedPrice = price;
        let normalizedTokenA = priceData.tokenA;
        let normalizedTokenB = priceData.tokenB;
        
        if (priceData.tokenA !== tokenA) {
          // Price is inverted, flip it
          normalizedPrice = new HelperUtils.BigNumber(1).dividedBy(price);
          normalizedTokenA = priceData.tokenB;
          normalizedTokenB = priceData.tokenA;
        }

        const poolId = `${priceData.dex}_${normalizedTokenA}_${normalizedTokenB}_${priceData.feeTier || 3000}`;

        if (!bestBuy || normalizedPrice.lt(bestBuy.price)) {
          bestBuy = { 
            ...priceData, 
            price: normalizedPrice, 
            action: 'buy',
            poolId,
            tokenA: normalizedTokenA,
            tokenB: normalizedTokenB
          };
        }
        if (!bestSell || normalizedPrice.gt(bestSell.price)) {
          bestSell = { 
            ...priceData, 
            price: normalizedPrice, 
            action: 'sell',
            poolId,
            tokenA: normalizedTokenA,
            tokenB: normalizedTokenB
          };
        }
      }

      if (!bestBuy || !bestSell || bestBuy.poolId === bestSell.poolId) {
        logger.debug(`No arbitrage for ${tokenA}/${tokenB}: same pool or insufficient price points`);
        return null;
      }

      const priceDifference = bestSell.price.minus(bestBuy.price);
      const priceDifferencePercent = priceDifference.dividedBy(bestBuy.price).multipliedBy(100);

      if (priceDifferencePercent.lt(0.5)) { // Minimum 0.5% price difference
        return null;
      }

      // Calculate potential profit for a sample trade amount
      const tradeAmount = new HelperUtils.BigNumber(1000); // $1000 worth

      // Calculate fees
      const swapFees = this.calculateSwapFees(tradeAmount, bestBuy.dex, bestSell.dex);
      const estimatedGasCost = await this.estimateGasCost(bestBuy.dex, bestSell.dex);
      const totalFees = swapFees.plus(estimatedGasCost);

      // Calculate expected profit
      const grossProfit = tradeAmount.multipliedBy(priceDifferencePercent.dividedBy(100));
      const expectedOutput = tradeAmount.plus(grossProfit);
      const expectedProfit = grossProfit.minus(totalFees);

      if (!HelperUtils.meetsProfitThreshold(expectedProfit, ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD)) {
        return null;
      }

      return {
        id: HelperUtils.generateId(),
        type: 'simple',
        tokenA,
        tokenB,
        buyDex: bestBuy.poolId.split('_')[0],
        sellDex: bestSell.poolId.split('_')[0],
        buyPool: bestBuy.poolId,
        sellPool: bestSell.poolId,
        buyPrice: bestBuy.price,
        sellPrice: bestSell.price,
        priceDifference: priceDifference,
        priceDifferencePercent,
        tradeAmount,
        expectedOutput,
        expectedProfit,
        swapFees,
        gasCost: estimatedGasCost,
        totalFees,
        poolA: { 
          address: bestBuy.poolAddress || `pool_${bestBuy.dex}_${tokenA}_${tokenB}`,
          liquidity: bestBuy.liquidity || '1000000000000000000000',
          blockNumber: bestBuy.blockNumber || 0
        },
        poolB: { 
          address: bestSell.poolAddress || `pool_${bestSell.dex}_${tokenA}_${tokenB}`,
          liquidity: bestSell.liquidity || '1000000000000000000000',
          blockNumber: bestSell.blockNumber || 0
        },
        timestamp: Date.now(),
        status: 'detected',
        // Additional metadata for database
        metadata: {
          chainId: 1,
          feeTier: 3000,
          slippageTolerance: 0.5,
          priceImpact: Math.min(parseFloat(priceDifferencePercent.toString()), 2.0)
        }
      };

    } catch (error) {
      logError(error, {
        tokenA,
        tokenB,
        context: 'ArbitrageDetector.detectSimpleArbitrage'
      });
      return null;
    }
  }

  // Detect triangular arbitrage opportunities
  async detectTriangularArbitrage() {
    try {
      const opportunities = [];

      // Define triangular paths (A -> B -> C -> A)
      const triangularPaths = [
        ['USDC', 'WETH', 'WBTC'],
        ['USDC', 'USDT', 'WETH'],
        ['USDC', 'DAI', 'WETH'],
        ['USDT', 'WETH', 'WBTC'],
        ['DAI', 'WETH', 'WBTC']
      ];

      for (const path of triangularPaths) {
        const opportunity = await this.detectTriangularPath(path);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }

      return opportunities;
    } catch (error) {
      logError(error, { context: 'ArbitrageDetector.detectTriangularArbitrage' });
      return [];
    }
  }

  // Detect arbitrage opportunity for a specific triangular path
  async detectTriangularPath([tokenA, tokenB, tokenC]) {
    try {
      // Get prices for all pairs in the path
      const priceAB = priceFetcher.getBestPrice(tokenA, tokenB);
      const priceBC = priceFetcher.getBestPrice(tokenB, tokenC);
      const priceCA = priceFetcher.getBestPrice(tokenC, tokenA);

      if (!priceAB.price || !priceBC.price || !priceCA.price) {
        return null;
      }

      // Ensure all prices are BigNumbers
      const priceABValue = HelperUtils.BigNumber.isBigNumber(priceAB.price.price) 
        ? priceAB.price.price 
        : new HelperUtils.BigNumber(priceAB.price.price?.toString() || '0');
      const priceBCValue = HelperUtils.BigNumber.isBigNumber(priceBC.price.price) 
        ? priceBC.price.price 
        : new HelperUtils.BigNumber(priceBC.price.price?.toString() || '0');
      const priceCAValue = HelperUtils.BigNumber.isBigNumber(priceCA.price.price) 
        ? priceCA.price.price 
        : new HelperUtils.BigNumber(priceCA.price.price?.toString() || '0');

      // Calculate effective rate for triangular arbitrage
      const effectiveRate = priceABValue
        .multipliedBy(priceBCValue)
        .multipliedBy(priceCAValue);

      const profitRate = effectiveRate.minus(1);

      if (profitRate.lt(0.005)) { // Minimum 0.5% profit
        return null;
      }

      // Calculate profit for sample trade amount
      const tradeAmount = new HelperUtils.BigNumber(1000); // $1000 worth
      const expectedProfit = tradeAmount.multipliedBy(profitRate);

      // Calculate fees (3 swaps)
      const swapFees = this.calculateTriangularSwapFees(tradeAmount, [
        { dex: priceAB.dex, pair: [tokenA, tokenB] },
        { dex: priceBC.dex, pair: [tokenB, tokenC] },
        { dex: priceCA.dex, pair: [tokenC, tokenA] }
      ]);

      const estimatedGasCost = await this.estimateTriangularGasCost([
        priceAB.dex, priceBC.dex, priceCA.dex
      ]);

      const totalFees = swapFees.plus(estimatedGasCost);
      const netProfit = expectedProfit.minus(totalFees);

      if (!HelperUtils.meetsProfitThreshold(netProfit, ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD)) {
        return null;
      }

      return {
        id: HelperUtils.generateId(),
        type: 'triangular',
        tokenA,
        tokenB: tokenB,
        tokenC,
        path: [tokenA, tokenB, tokenC],
        effectiveRate,
        profitRate,
        tradeAmount,
        expectedProfit,
        expectedOutput: netProfit.plus(tradeAmount),
        netProfit,
        swapFees,
        gasCost: estimatedGasCost,
        totalFees,
        triangularPath: [
          { 
            dex: priceAB.dex, 
            tokenIn: tokenA, 
            tokenOut: tokenB, 
            amount: tradeAmount.toString(),
            pool: 'pool_' + priceAB.dex + '_' + tokenA + '_' + tokenB
          },
          { 
            dex: priceBC.dex, 
            tokenIn: tokenB, 
            tokenOut: tokenC, 
            amount: tradeAmount.multipliedBy(priceABValue).toString(),
            pool: 'pool_' + priceBC.dex + '_' + tokenB + '_' + tokenC
          },
          { 
            dex: priceCA.dex, 
            tokenIn: tokenC, 
            tokenOut: tokenA, 
            amount: tradeAmount.multipliedBy(priceABValue).multipliedBy(priceBCValue).toString(),
            pool: 'pool_' + priceCA.dex + '_' + tokenC + '_' + tokenA
          }
        ],
        timestamp: Date.now(),
        status: 'detected',
        metadata: {
          chainId: 1,
          feeTier: 3000,
          slippageTolerance: 0.5,
          priceImpact: Math.min(parseFloat(profitRate.toString()) * 100, 5.0)
        }
      };

    } catch (error) {
      logError(error, {
        path: [tokenA, tokenB, tokenC],
        context: 'ArbitrageDetector.detectTriangularPath'
      });
      return null;
    }
  }

  // Calculate swap fees for simple arbitrage
  calculateSwapFees(tradeAmount, dexA, dexB) {
    // Assume 0.3% fee per swap (standard for most pools)
    const feeRate = 0.003;
    return tradeAmount.multipliedBy(feeRate * 2); // Two swaps = 0.6% total
  }

  // Calculate swap fees for triangular arbitrage
  calculateTriangularSwapFees(tradeAmount, trades) {
    const feeRate = 0.003;
    return tradeAmount.multipliedBy(feeRate * trades.length); // 3 swaps = 0.9% total
  }

  // Estimate gas cost for simple arbitrage
  async estimateGasCost(dexA, dexB) {
    try {
      const feeData = await rpcManager.getGasPrice();
      const gasPrice = feeData.gasPrice || BigInt(20000000000); // 20 gwei default
      const gasLimit = BigInt(300000); // Estimated gas for 2 swaps

      const gasCostWei = gasPrice * gasLimit;
      return HelperUtils.fromWei(gasCostWei.toString());
    } catch (error) {
      logError(error, { context: 'ArbitrageDetector.estimateGasCost' });
      return new HelperUtils.BigNumber(10); // $10 default
    }
  }

  // Estimate gas cost for triangular arbitrage
  async estimateTriangularGasCost(dexs) {
    try {
      const feeData = await rpcManager.getGasPrice();
      const gasPrice = feeData.gasPrice || BigInt(20000000000); // 20 gwei default
      const gasLimit = BigInt(500000); // Estimated gas for 3 swaps

      const gasCostWei = gasPrice * gasLimit;
      return HelperUtils.fromWei(gasCostWei.toString());
    } catch (error) {
      logError(error, { context: 'ArbitrageDetector.estimateTriangularGasCost' });
      return new HelperUtils.BigNumber(15); // $15 default
    }
  }

  // Get all current opportunities
  getAllOpportunities() {
    return Array.from(this.opportunities.values());
  }

  // Get opportunities for a specific token pair
  getOpportunitiesForPair(tokenA, tokenB) {
    return this.getAllOpportunities().filter(opp =>
      (opp.tokenA === tokenA && opp.tokenB === tokenB) ||
      (opp.tokenA === tokenB && opp.tokenB === tokenA)
    );
  }

  // Get best opportunity (highest profit)
  getBestOpportunity() {
    const opportunities = this.getAllOpportunities();
    if (opportunities.length === 0) return null;

    return opportunities.reduce((best, current) =>
      current.expectedProfit.gt(best.expectedProfit) ? current : best
    );
  }

  // Subscribe to new opportunities
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notify subscribers of new opportunities
  notifySubscribers(opportunity) {
    for (const callback of this.subscribers) {
      try {
        callback(opportunity);
      } catch (error) {
        logError(error, { context: 'ArbitrageDetector.notifySubscribers' });
      }
    }
  }

  // Clean up old opportunities
  cleanupOpportunities(maxAgeMinutes = 5) {
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;

    let cleaned = 0;
    for (const [key, opportunity] of this.opportunities) {
      if (now - opportunity.timestamp > maxAge) {
        this.opportunities.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old opportunities`);
    }

    return cleaned;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      currentOpportunities: this.opportunities.size,
      lastScan: this.lastScan,
      isRunning: this.isRunning,
      opportunitiesByType: this.getOpportunitiesByType()
    };
  }

  // Get opportunities grouped by type
  getOpportunitiesByType() {
    const stats = { simple: 0, triangular: 0 };

    for (const opportunity of this.opportunities.values()) {
      stats[opportunity.type] = (stats[opportunity.type] || 0) + 1;
    }

    return stats;
  }

  // Utility methods
  getOpportunityKey(opportunity) {
    if (opportunity.type === 'simple') {
      return `simple:${opportunity.tokenA}-${opportunity.tokenB}:${opportunity.buyDex}-${opportunity.sellDex}`;
    } else {
      return `triangular:${opportunity.path.join('-')}`;
    }
  }

  // Validate opportunity
  validateOpportunity(opportunity) {
    return opportunity &&
           opportunity.expectedProfit &&
           opportunity.expectedProfit.gt(0) &&
           (Date.now() - opportunity.timestamp) < (5 * 60 * 1000); // 5 minutes
  }

  // Save opportunity to database
  async saveOpportunityToDatabase(opportunity) {
    try {
      // Import the Opportunity model dynamically to avoid circular dependencies
      const { default: Opportunity } = await import('../../models/opportunity.js');
      
      // Get token addresses from the constants
      const tokenAInfo = SUPPORTED_TOKENS[opportunity.tokenA];
      const tokenBInfo = SUPPORTED_TOKENS[opportunity.tokenB];
      
      // Convert BigNumber values to regular numbers for database storage
      const dbOpportunity = {
        id: opportunity.id,
        timestamp: new Date(opportunity.timestamp),
        tokenIn: tokenAInfo?.address || opportunity.tokenA,
        tokenOut: tokenBInfo?.address || opportunity.tokenB,
        tokenInSymbol: opportunity.tokenA,
        tokenOutSymbol: opportunity.tokenB,
        dexA: opportunity.buyDex === 'SUSHISWAP' ? 'SUSHISWAP' : 'UNISWAP',
        dexB: opportunity.sellDex === 'SUSHISWAP' ? 'SUSHISWAP' : 'UNISWAP',
        amountIn: opportunity.tradeAmount?.toString() || '1000',
        amountOutExpected: opportunity.expectedOutput?.toString() || '0',
        priceA: opportunity.buyPrice?.toString() || '0',
        priceB: opportunity.sellPrice?.toString() || '0',
        priceDifference: parseFloat(opportunity.priceDifference?.toString() || '0'),
        expectedProfit: opportunity.expectedProfit?.toString() || '0',
        expectedProfitUSD: parseFloat(opportunity.expectedProfit?.toString() || '0'),
        profitPercentage: parseFloat(opportunity.priceDifferencePercent?.toString() || '0'),
        grossProfitUSD: parseFloat(opportunity.expectedProfit?.toString() || '0') + parseFloat(opportunity.totalFees?.toString() || '0'),
        netProfitUSD: parseFloat(opportunity.expectedProfit?.toString() || '0'),
        profitAfterFeesUSD: parseFloat(opportunity.expectedProfit?.toString() || '0'),
        gasEstimate: '150000',
        gasPrice: '20000000000',
        gasCostUSD: parseFloat(opportunity.gasCost?.toString() || '0'),
        swapFees: opportunity.swapFees?.toString() || '0',
        swapFeesUSD: parseFloat(opportunity.swapFees?.toString() || '0'),
        totalFees: opportunity.totalFees?.toString() || '0',
        totalFeesUSD: parseFloat(opportunity.totalFees?.toString() || '0'),
        poolA: opportunity.poolA?.address || `pool_${opportunity.buyDex}_${opportunity.tokenA}_${opportunity.tokenB}`,
        poolB: opportunity.poolB?.address || `pool_${opportunity.sellDex}_${opportunity.tokenA}_${opportunity.tokenB}`,
        liquidityA: opportunity.poolA?.liquidity || '1000000000000000000000',
        liquidityB: opportunity.poolB?.liquidity || '1000000000000000000000',
        liquidityAUSD: parseFloat(opportunity.poolA?.liquidity || '1000000'),
        liquidityBUSD: parseFloat(opportunity.poolB?.liquidity || '1000000'),
        blockNumber: opportunity.poolA?.blockNumber || await this.getCurrentBlockNumber(),
        blockTimestamp: new Date(),
        tradeSizeUSD: parseFloat(opportunity.tradeAmount?.toString() || '1000'),
        status: opportunity.status || 'detected',
        metadata: {
          chainId: 1,
          feeTier: opportunity.metadata?.feeTier || 3000,
          slippageTolerance: opportunity.metadata?.slippageTolerance || 0.5,
          priceImpact: opportunity.metadata?.priceImpact || 1.0,
          blockNumber: opportunity.poolA?.blockNumber || 0,
          detectedAt: new Date().toISOString(),
          scanId: this.stats.totalScans,
          path: opportunity.path || [opportunity.tokenA, opportunity.tokenB]
        }
      };

      // Use upsert to avoid duplicate key errors
      const doc = await Opportunity.findOneAndUpdate(
        { id: dbOpportunity.id },
        dbOpportunity,
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );
      
      logger.info(`💾 SAVED TO DATABASE: ${opportunity.tokenA}→${opportunity.tokenB} | Profit: $${dbOpportunity.expectedProfitUSD.toFixed(2)} | ID: ${opportunity.id}`);
      
      return doc;
    } catch (error) {
      logger.error('❌ Failed to save opportunity to database:', error.message);
      logError(error, { context: 'ArbitrageDetector.saveOpportunityToDatabase', opportunity: opportunity.id });
      // Don't throw - continue even if database save fails
      return null;
    }
  }

  // Get current block number
  async getCurrentBlockNumber() {
    try {
      const { default: rpcManager } = await import('../rpc-manager.js');
      return await rpcManager.getBlockNumber();
    } catch (error) {
      logger.warn('Could not get current block number:', error.message);
      return 0;
    }
  }

  // Update opportunity status
  updateOpportunityStatus(opportunityId, status, additionalData = {}) {
    const opportunity = this.opportunities.get(opportunityId);
    if (opportunity) {
      opportunity.status = status;
      Object.assign(opportunity, additionalData);
    }
  }
}

// Create singleton instance
const arbitrageDetector = new ArbitrageDetector();

export default arbitrageDetector;
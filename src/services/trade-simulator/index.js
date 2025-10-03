import { ethers } from 'ethers';
import poolDiscovery from '../pool-discovery.js';
import rpcManager from '../rpc-manager.js';
import { SUPPORTED_TOKENS, FEE_TIERS } from '../../config/constants.js';
import { logError, logger } from '../../utils/logger.js';
import HelperUtils from '../../utils/helpers.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TradeSimulator {
  constructor() {
    this.isInitialized = false;
    this.simulationCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
  }

  // Initialize the trade simulator
  async initialize() {
    try {
      logger.info('Initializing trade simulator...');

      // Wait for pool discovery to be ready
      let retries = 0;
      while (!poolDiscovery.isInitialized && retries < 10) {
        await HelperUtils.sleep(1000);
        retries++;
      }

      if (!poolDiscovery.isInitialized) {
        throw new Error('Pool discovery not initialized');
      }

      this.isInitialized = true;
      logger.info('Trade simulator initialized');
    } catch (error) {
      logError(error, { context: 'TradeSimulator.initialize' });
      throw error;
    }
  }

  // Simulate simple arbitrage trade
  async simulateSimpleArbitrage(opportunity, tradeAmount) {
    try {
      const cacheKey = this.getCacheKey('simple', opportunity.id, tradeAmount);
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        return cached;
      }

      const { tokenA, tokenB, buyDex, sellDex } = opportunity;
      const tokenAInfo = SUPPORTED_TOKENS[tokenA];
      const tokenBInfo = SUPPORTED_TOKENS[tokenB];

      // Check if token info exists
      if (!tokenAInfo || !tokenBInfo) {
        throw new Error(`Token information not found for ${tokenA} or ${tokenB}`);
      }

      // Parse trade amount to token units
      const amountIn = HelperUtils.parseTokenAmount(tradeAmount, tokenAInfo.decimals);

      // Get pool information
      const buyPool = poolDiscovery.getPool(buyDex, tokenA, tokenB, FEE_TIERS.MEDIUM);
      const sellPool = poolDiscovery.getPool(sellDex, tokenA, tokenB, FEE_TIERS.MEDIUM);

      if (!buyPool || !sellPool) {
        throw new Error('Pool information not available');
      }

      // Simulate buy transaction
      const buyResult = await this.simulateSwap(
        buyPool,
        tokenAInfo.address,
        tokenBInfo.address,
        amountIn,
        'buy'
      );

      if (!buyResult.success) {
        throw new Error(`Buy simulation failed: ${buyResult.error}`);
      }

      // Simulate sell transaction
      const sellResult = await this.simulateSwap(
        sellPool,
        tokenBInfo.address,
        tokenAInfo.address,
        BigInt(buyResult.outputAmount),
        'sell'
      );

      if (!sellResult.success) {
        throw new Error(`Sell simulation failed: ${sellResult.error}`);
      }

      // Calculate final results
      const finalAmount = new HelperUtils.BigNumber(sellResult.outputAmount);
      const initialAmount = new HelperUtils.BigNumber(amountIn.toString());
      const profit = finalAmount.minus(initialAmount);
      const profitUSD = HelperUtils.formatTokenAmount(profit, tokenAInfo.decimals);

      // Calculate gas costs
      const buyGasCost = await this.estimateGasCost(buyResult.gasUsed);
      const sellGasCost = await this.estimateGasCost(sellResult.gasUsed);
      const totalGasCost = buyGasCost.plus(sellGasCost);

      // Calculate net profit
      const netProfit = profitUSD.minus(totalGasCost);

      const result = {
        success: true,
        type: 'simple',
        initialAmount: initialAmount.toString(),
        finalAmount: finalAmount.toString(),
        profit: profit.toString(),
        profitUSD: profitUSD.toString(),
        netProfit: netProfit.toString(),
        isProfitable: netProfit.gt(0),
        buySwap: {
          dex: buyDex,
          inputAmount: amountIn.toString(),
          outputAmount: buyResult.outputAmount,
          gasUsed: buyResult.gasUsed,
          gasCost: buyGasCost.toString(),
          success: buyResult.success
        },
        sellSwap: {
          dex: sellDex,
          inputAmount: buyResult.outputAmount,
          outputAmount: sellResult.outputAmount,
          gasUsed: sellResult.gasUsed,
          gasCost: sellGasCost.toString(),
          success: sellResult.success
        },
        totalGasUsed: (BigInt(buyResult.gasUsed) + BigInt(sellResult.gasUsed)).toString(),
        totalGasCost: totalGasCost.toString(),
        timestamp: Date.now()
      };

      // Cache result
      this.setCachedResult(cacheKey, result);

      return result;

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        tradeAmount,
        context: 'TradeSimulator.simulateSimpleArbitrage'
      });

      return {
        success: false,
        error: error.message,
        type: 'simple',
        timestamp: Date.now()
      };
    }
  }

  // Simulate triangular arbitrage trade
  async simulateTriangularArbitrage(opportunity, tradeAmount) {
    try {
      const cacheKey = this.getCacheKey('triangular', opportunity.id, tradeAmount);
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        return cached;
      }

      const { path, trades } = opportunity;
      let currentAmount = HelperUtils.parseTokenAmount(tradeAmount, SUPPORTED_TOKENS[path[0]].decimals);
      let swapResults = [];
      let totalGasUsed = BigInt(0);
      let totalGasCost = new HelperUtils.BigNumber(0);

      // Simulate each leg of the triangular path
      for (let i = 0; i < trades.length; i++) {
        const trade = trades[i];
        const fromTokenInfo = SUPPORTED_TOKENS[trade.token];
        const toTokenInfo = SUPPORTED_TOKENS[trade.toToken];

        // Get pool information
        const pool = poolDiscovery.getPool(trade.dex, trade.token, trade.toToken, FEE_TIERS.MEDIUM);
        if (!pool) {
          throw new Error(`Pool not found for ${trade.token}/${trade.toToken} on ${trade.dex}`);
        }

        // Simulate swap
        const swapResult = await this.simulateSwap(
          pool,
          fromTokenInfo.address,
          toTokenInfo.address,
          BigInt(currentAmount.toString()),
          `leg_${i + 1}`
        );

        if (!swapResult.success) {
          throw new Error(`Swap simulation failed for leg ${i + 1}: ${swapResult.error}`);
        }

        swapResults.push({
          leg: i + 1,
          dex: trade.dex,
          fromToken: trade.token,
          toToken: trade.toToken,
          inputAmount: currentAmount.toString(),
          outputAmount: swapResult.outputAmount,
          gasUsed: swapResult.gasUsed,
          gasCost: await this.estimateGasCost(swapResult.gasUsed),
          success: true
        });

        currentAmount = new HelperUtils.BigNumber(swapResult.outputAmount);
        totalGasUsed += BigInt(swapResult.gasUsed);
        totalGasCost = totalGasCost.plus(await this.estimateGasCost(swapResult.gasUsed));
      }

      // Calculate final results
      const finalAmount = currentAmount;
      const initialAmount = HelperUtils.parseTokenAmount(tradeAmount, SUPPORTED_TOKENS[path[0]].decimals);
      const profit = finalAmount.minus(initialAmount);
      const profitUSD = HelperUtils.formatTokenAmount(profit, SUPPORTED_TOKENS[path[0]].decimals);

      // Calculate net profit
      const netProfit = profitUSD.minus(totalGasCost);

      const result = {
        success: true,
        type: 'triangular',
        path,
        initialAmount: initialAmount.toString(),
        finalAmount: finalAmount.toString(),
        profit: profit.toString(),
        profitUSD: profitUSD.toString(),
        netProfit: netProfit.toString(),
        isProfitable: netProfit.gt(0),
        swaps: swapResults,
        totalGasUsed: totalGasUsed.toString(),
        totalGasCost: totalGasCost.toString(),
        timestamp: Date.now()
      };

      // Cache result
      this.setCachedResult(cacheKey, result);

      return result;

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        tradeAmount,
        context: 'TradeSimulator.simulateTriangularArbitrage'
      });

      return {
        success: false,
        error: error.message,
        type: 'triangular',
        timestamp: Date.now()
      };
    }
  }

  // Simulate a single swap
  async simulateSwap(pool, tokenIn, tokenOut, amountIn, description) {
    try {
      // Use quoter for accurate swap simulation
      const quoterAddress = this.getQuoterAddress(pool.dex);
      if (!quoterAddress) {
        throw new Error(`Quoter not available for ${pool.dex}`);
      }

      const quoterABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../../abis/QuoterV2.json'), 'utf8'));
      const quoter = new ethers.Contract(
        quoterAddress,
        quoterABI,
        rpcManager.getProvider()
      );

      // Call quoter to get expected output and gas estimate
      const quoteResult = await rpcManager.execute(async (provider) => {
        return await quoter.quoteExactInputSingle({
          tokenIn,
          tokenOut,
          fee: pool.feeTier,
          amountIn: amountIn.toString(),
          sqrtPriceLimitX96: 0
        });
      });

      return {
        success: true,
        inputAmount: amountIn.toString(),
        outputAmount: quoteResult.amountOut.toString(),
        gasUsed: quoteResult.gasEstimate?.toString() || '150000',
        description
      };

    } catch (error) {
      logError(error, {
        pool: pool.address,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        description,
        context: 'TradeSimulator.simulateSwap'
      });

      return {
        success: false,
        error: error.message,
        inputAmount: amountIn.toString(),
        outputAmount: '0',
        gasUsed: '0',
        description
      };
    }
  }

  // Get quoter address for DEX
  getQuoterAddress(dexName) {
    const quoterAddresses = {
      'UNISWAP_V3': process.env.UNISWAP_V3_QUOTER,
      'SUSHISWAP_V3': process.env.SUSHISWAP_V3_QUOTER,
      'PANCAKESWAP_V3': process.env.PANCAKESWAP_V3_QUOTER,
      'QUICKSWAP_V3': process.env.QUICKSWAP_V3_QUOTER
    };

    return quoterAddresses[dexName];
  }

  // Estimate gas cost in USD
  async estimateGasCost(gasUsed) {
    try {
      const gasPriceData = rpcManager.getGasPrice();
      const gasPrice = gasPriceData.gasPrice || BigInt(20000000000); // 20 gwei default

      const gasCostWei = BigInt(gasUsed) * gasPrice;

      // Convert to ETH and then to USD (assuming $2000 ETH price)
      const gasCostETH = Number(gasCostWei) / 1e18;
      const ethPriceUSD = 2000; // This should come from a price oracle
      const gasCostUSD = gasCostETH * ethPriceUSD;

      return new HelperUtils.BigNumber(gasCostUSD);

    } catch (error) {
      logError(error, { context: 'TradeSimulator.estimateGasCost' });
      return new HelperUtils.BigNumber(5); // $5 default
    }
  }

  // Batch simulate multiple opportunities
  async batchSimulate(opportunities, tradeAmount) {
    try {
      const results = [];

      for (const opportunity of opportunities) {
        try {
          let result;

          if (opportunity.type === 'simple') {
            result = await this.simulateSimpleArbitrage(opportunity, tradeAmount);
          } else {
            result = await this.simulateTriangularArbitrage(opportunity, tradeAmount);
          }

          results.push({
            opportunity: opportunity.id,
            ...result
          });

        } catch (error) {
          logError(error, {
            opportunity: opportunity.id,
            context: 'TradeSimulator.batchSimulate'
          });

          results.push({
            opportunity: opportunity.id,
            success: false,
            error: error.message
          });
        }
      }

      return results;

    } catch (error) {
      logError(error, { context: 'TradeSimulator.batchSimulate' });
      throw error;
    }
  }

  // Get simulation statistics
  getStats() {
    const cacheStats = {
      size: this.simulationCache.size,
      hitRate: this.cacheHits || 0,
      totalRequests: this.cacheRequests || 0
    };

    return {
      isInitialized: this.isInitialized,
      cache: cacheStats,
      cacheTimeout: this.cacheTimeout
    };
  }

  // Utility methods for caching
  getCacheKey(type, opportunityId, tradeAmount) {
    return `${type}:${opportunityId}:${tradeAmount}`;
  }

  getCachedResult(key) {
    this.cacheRequests = (this.cacheRequests || 0) + 1;
    const cached = this.simulationCache.get(key);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      this.cacheHits = (this.cacheHits || 0) + 1;
      return cached.result;
    }

    return null;
  }

  setCachedResult(key, result) {
    this.simulationCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  // Clear cache
  clearCache() {
    this.simulationCache.clear();
    this.cacheHits = 0;
    this.cacheRequests = 0;
    logger.info('Trade simulator cache cleared');
  }

  // Cleanup old cache entries
  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.simulationCache) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.simulationCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }

    return cleaned;
  }

  // Validate simulation result
  validateSimulationResult(result) {
    return result &&
           result.success &&
           result.outputAmount &&
           BigInt(result.outputAmount) > 0;
  }

  // Simulate with slippage
  async simulateWithSlippage(opportunity, tradeAmount, slippagePercent = 0.5) {
    try {
      const result = opportunity.type === 'simple'
        ? await this.simulateSimpleArbitrage(opportunity, tradeAmount)
        : await this.simulateTriangularArbitrage(opportunity, tradeAmount);

      if (!result.success) {
        return result;
      }

      // Apply slippage to output amount
      const slippageMultiplier = new HelperUtils.BigNumber(100 - slippagePercent).dividedBy(100);
      const slippageAdjustedOutput = new HelperUtils.BigNumber(result.finalAmount || result.profit).multipliedBy(slippageMultiplier);

      // Recalculate profit with slippage
      const slippageAdjustedProfit = slippageAdjustedOutput.minus(new HelperUtils.BigNumber(result.initialAmount));
      const slippageAdjustedProfitUSD = HelperUtils.formatTokenAmount(slippageAdjustedProfit, SUPPORTED_TOKENS[opportunity.tokenA || opportunity.path[0]].decimals);
      const netProfitWithSlippage = slippageAdjustedProfitUSD.minus(new HelperUtils.BigNumber(result.totalGasCost));

      return {
        ...result,
        slippageAdjustedOutput: slippageAdjustedOutput.toString(),
        slippageAdjustedProfit: slippageAdjustedProfitUSD.toString(),
        netProfitWithSlippage: netProfitWithSlippage.toString(),
        isProfitableWithSlippage: netProfitWithSlippage.gt(0),
        slippagePercent
      };

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        tradeAmount,
        slippagePercent,
        context: 'TradeSimulator.simulateWithSlippage'
      });
      throw error;
    }
  }
}

// Create singleton instance
const tradeSimulator = new TradeSimulator();

export default tradeSimulator;
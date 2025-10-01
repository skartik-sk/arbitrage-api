import { SUPPORTED_TOKENS, ARBITRAGE_CONFIG, GAS_LIMITS } from '../../config/constants.js';
import { logError, logger } from '../../utils/logger.js';
import HelperUtils from '../../utils/helpers.js';
import rpcManager from '../rpc-manager.js';

class ProfitCalculator {
  constructor() {
    this.gasPriceCache = null;
    this.lastGasUpdate = null;
    this.gasUpdateInterval = 30000; // 30 seconds
  }

  // Initialize profit calculator
  async initialize() {
    try {
      logger.info('Initializing profit calculator...');

      // Initialize gas price cache
      await this.updateGasPrice();

      // Start periodic gas price updates
      setInterval(() => {
        this.updateGasPrice().catch(error => {
          logError(error, { context: 'ProfitCalculator.gasPriceUpdate' });
        });
      }, this.gasUpdateInterval);

      logger.info('Profit calculator initialized');
    } catch (error) {
      logError(error, { context: 'ProfitCalculator.initialize' });
      throw error;
    }
  }

  // Update gas price cache
  async updateGasPrice() {
    try {
      const feeData = await rpcManager.getGasPrice();

      this.gasPriceCache = {
        gasPrice: feeData.gasPrice || BigInt(20000000000), // 20 gwei default
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        timestamp: Date.now()
      };

      this.lastGasUpdate = Date.now();

      logger.debug('Gas price updated', {
        gasPrice: this.gasPriceCache.gasPrice.toString(),
        maxFeePerGas: this.gasPriceCache.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: this.gasPriceCache.maxPriorityFeePerGas?.toString()
      });

    } catch (error) {
      logError(error, { context: 'ProfitCalculator.updateGasPrice' });

      // Use default values if update fails
      if (!this.gasPriceCache) {
        this.gasPriceCache = {
          gasPrice: BigInt(20000000000), // 20 gwei
          maxFeePerGas: BigInt(30000000000), // 30 gwei
          maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
          timestamp: Date.now()
        };
      }
    }
  }

  // Get current gas price
  getGasPrice() {
    // Return cached value if it's recent
    if (this.gasPriceCache && (Date.now() - this.lastGasUpdate) < this.gasUpdateInterval) {
      return this.gasPriceCache;
    }

    // Otherwise, trigger an update and return current cache
    this.updateGasPrice().catch(() => {}); // Fire and forget
    return this.gasPriceCache;
  }

  // Calculate profit for simple arbitrage
  async calculateSimpleArbitrageProfit(opportunity, tradeAmount) {
    try {
      const { tokenA, tokenB, buyDex, sellDex, buyPrice, sellPrice } = opportunity;

      // Calculate amounts
      const tokenAInfo = SUPPORTED_TOKENS[tokenA];
      const tokenBInfo = SUPPORTED_TOKENS[tokenB];

      // Amount of tokenA to buy
      const amountIn = this.parseTokenAmount(tradeAmount, tokenAInfo.decimals);

      // Calculate expected output amount of tokenB
      const amountOutExpected = this.calculateOutputAmount(amountIn, buyPrice);

      // Calculate swap fees (0.3% per swap typically)
      const swapFeeBuy = amountIn.multipliedBy(0.003);
      const swapFeeSell = amountOutExpected.multipliedBy(0.003);
      const totalSwapFees = swapFeeBuy.plus(swapFeeSell);

      // Calculate gas cost
      const gasCost = await this.calculateGasCost(GAS_LIMITS.SINGLE_SWAP);

      // Calculate net output after fees
      const netOutput = amountOutExpected.minus(swapFeeSell);

      // Convert both amounts to USD for profit calculation
      const inputUSD = this.formatTokenAmount(amountIn, tokenAInfo.decimals);
      const outputUSD = this.formatTokenAmount(netOutput, tokenBInfo.decimals);

      // Calculate gross profit
      const grossProfit = outputUSD.minus(inputUSD);

      // Calculate total fees in USD
      const swapFeesUSD = this.formatTokenAmount(totalSwapFees, tokenAInfo.decimals);
      const totalFeesUSD = swapFeesUSD.plus(gasCost);

      // Calculate net profit
      const netProfit = grossProfit.minus(totalFeesUSD);

      // Calculate ROI
      const roi = HelperUtils.calculateROI(netProfit, inputUSD);

      // Calculate price impact
      const priceImpact = this.calculatePriceImpact(amountIn, opportunity);

      return {
        tradeAmount: tradeAmount.toString(),
        amountIn: amountIn.toString(),
        amountOutExpected: netOutput.toString(),
        grossProfit: grossProfit.toString(),
        netProfit: netProfit.toString(),
        roi: roi.toNumber(),
        swapFees: swapFeesUSD.toString(),
        gasCost: gasCost.toString(),
        totalFees: totalFeesUSD.toString(),
        priceImpact: priceImpact.toNumber(),
        isProfitable: netProfit.gt(ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD),
        meetsThreshold: netProfit.gt(ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD),
        timestamp: Date.now()
      };

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        tradeAmount,
        context: 'ProfitCalculator.calculateSimpleArbitrageProfit'
      });
      throw error;
    }
  }

  // Calculate profit for triangular arbitrage
  async calculateTriangularArbitrageProfit(opportunity, tradeAmount) {
    try {
      const { path, trades } = opportunity;
      let currentAmount = this.parseTokenAmount(tradeAmount, SUPPORTED_TOKENS[path[0]].decimals);
      const initialAmount = currentAmount;
      let totalSwapFees = new HelperUtils.BigNumber(0);

      // Simulate the triangular path
      for (let i = 0; i < trades.length; i++) {
        const trade = trades[i];
        const fromTokenInfo = SUPPORTED_TOKENS[trade.token];
        const toTokenInfo = SUPPORTED_TOKENS[trade.toToken];

        // Calculate output for this leg
        const outputAmount = this.calculateOutputAmount(currentAmount, trade.price.price);

        // Calculate swap fee for this leg (0.3%)
        const swapFee = currentAmount.multipliedBy(0.003);
        totalSwapFees = totalSwapFees.plus(this.formatTokenAmount(swapFee, fromTokenInfo.decimals));

        // Net output after fee
        currentAmount = outputAmount.minus(swapFee);
      }

      // Convert final amount back to initial token USD value
      const finalAmountUSD = this.formatTokenAmount(currentAmount, SUPPORTED_TOKENS[path[0]].decimals);
      const initialAmountUSD = tradeAmount;

      // Calculate gross profit
      const grossProfit = finalAmountUSD.minus(initialAmountUSD);

      // Calculate gas cost (higher for triangular)
      const gasCost = await this.calculateGasCost(GAS_LIMITS.TRIANGULAR_SWAP);

      // Calculate total fees
      const totalFees = totalSwapFees.plus(gasCost);

      // Calculate net profit
      const netProfit = grossProfit.minus(totalFees);

      // Calculate ROI
      const roi = HelperUtils.calculateROI(netProfit, initialAmountUSD);

      // Calculate effective rate
      const effectiveRate = finalAmountUSD.dividedBy(initialAmountUSD);

      return {
        tradeAmount: tradeAmount.toString(),
        path,
        initialAmount: initialAmount.toString(),
        finalAmount: currentAmount.toString(),
        grossProfit: grossProfit.toString(),
        netProfit: netProfit.toString(),
        roi: roi.toNumber(),
        effectiveRate: effectiveRate.toNumber(),
        swapFees: totalSwapFees.toString(),
        gasCost: gasCost.toString(),
        totalFees: totalFees.toString(),
        isProfitable: netProfit.gt(ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD),
        meetsThreshold: netProfit.gt(ARBITRAGE_CONFIG.MIN_PROFIT_THRESHOLD_USD),
        timestamp: Date.now()
      };

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        tradeAmount,
        context: 'ProfitCalculator.calculateTriangularArbitrageProfit'
      });
      throw error;
    }
  }

  // Calculate gas cost in USD
  async calculateGasCost(gasLimit) {
    try {
      const gasPrice = this.getGasPrice();
      const gasPriceGwei = new HelperUtils.BigNumber(gasPrice.gasPrice.toString()).dividedBy(1e9);

      // Estimate ETH price (this should come from a price oracle in production)
      const ethPriceUSD = new HelperUtils.BigNumber(2000); // $2000 ETH

      // Calculate gas cost in ETH
      const gasCostETH = gasPriceGwei.multipliedBy(gasLimit).dividedBy(1e9);

      // Convert to USD
      const gasCostUSD = gasCostETH.multipliedBy(ethPriceUSD);

      // Add buffer
      const bufferedGasCost = HelperUtils.getGasPriceWithBuffer(
        gasCostUSD,
        ARBITRAGE_CONFIG.GAS_BUFFER_PERCENTAGE
      );

      return bufferedGasCost;

    } catch (error) {
      logError(error, { context: 'ProfitCalculator.calculateGasCost' });

      // Return default estimate
      return new HelperUtils.BigNumber(10); // $10 default
    }
  }

  // Calculate output amount based on price
  calculateOutputAmount(amountIn, price) {
    return amountIn.multipliedBy(price);
  }

  // Calculate price impact for a trade
  calculatePriceImpact(amountIn, opportunity) {
    try {
      // Simplified price impact calculation
      // In reality, this would use the pool's liquidity curve

      const liquidityImpact = 0.01; // 1% base impact assumption
      const sizeImpact = new HelperUtils.BigNumber(amountIn).dividedBy(100000).multipliedBy(0.1); // Scale with size

      return new HelperUtils.BigNumber(liquidityImpact).plus(sizeImpact).multipliedBy(100);

    } catch (error) {
      logError(error, { context: 'ProfitCalculator.calculatePriceImpact' });
      return new HelperUtils.BigNumber(0.5); // 0.5% default
    }
  }

  // Calculate optimal trade size
  async calculateOptimalTradeSize(opportunity) {
    try {
      const maxTradeSize = new HelperUtils.BigNumber(process.env.MAX_TRADE_SIZE_USD || 10000);
      const minTradeSize = new HelperUtils.BigNumber(process.env.MIN_TRADE_SIZE_USD || 100);

      // Test different trade sizes to find optimal profit
      const testSizes = [
        minTradeSize,
        new HelperUtils.BigNumber(500),
        new HelperUtils.BigNumber(1000),
        new HelperUtils.BigNumber(2500),
        new HelperUtils.BigNumber(5000),
        maxTradeSize
      ];

      let bestProfit = new HelperUtils.BigNumber(0);
      let bestSize = minTradeSize;

      for (const size of testSizes) {
        let profit;

        if (opportunity.type === 'simple') {
          const result = await this.calculateSimpleArbitrageProfit(opportunity, size);
          profit = new HelperUtils.BigNumber(result.netProfit);
        } else {
          const result = await this.calculateTriangularArbitrageProfit(opportunity, size);
          profit = new HelperUtils.BigNumber(result.netProfit);
        }

        if (profit.gt(bestProfit)) {
          bestProfit = profit;
          bestSize = size;
        }
      }

      return {
        optimalSize: bestSize.toString(),
        expectedProfit: bestProfit.toString(),
        roi: HelperUtils.calculateROI(bestProfit, bestSize).toNumber()
      };

    } catch (error) {
      logError(error, {
        opportunity: opportunity.id,
        context: 'ProfitCalculator.calculateOptimalTradeSize'
      });

      return {
        optimalSize: process.env.MIN_TRADE_SIZE_USD || '100',
        expectedProfit: '0',
        roi: 0
      };
    }
  }

  // Validate profit calculation
  validateProfitCalculation(calculation) {
    return calculation &&
           calculation.netProfit &&
           calculation.isProfitable &&
           calculation.meetsThreshold &&
           new HelperUtils.BigNumber(calculation.netProfit).gt(0);
  }

  // Format token amount with decimals
  formatTokenAmount(amount, decimals) {
    return HelperUtils.formatTokenAmount(amount, decimals);
  }

  // Parse token amount with decimals
  parseTokenAmount(amount, decimals) {
    return HelperUtils.parseTokenAmount(amount, decimals);
  }

  // Get profit calculator statistics
  getStats() {
    return {
      gasPrice: this.gasPriceCache?.gasPrice?.toString(),
      lastGasUpdate: this.lastGasUpdate,
      gasUpdateInterval: this.gasUpdateInterval
    };
  }

  // Batch calculate profits for multiple opportunities
  async batchCalculateProfits(opportunities, tradeAmount) {
    try {
      const results = [];

      for (const opportunity of opportunities) {
        try {
          let result;

          if (opportunity.type === 'simple') {
            result = await this.calculateSimpleArbitrageProfit(opportunity, tradeAmount);
          } else {
            result = await this.calculateTriangularArbitrageProfit(opportunity, tradeAmount);
          }

          results.push({
            opportunity: opportunity.id,
            success: true,
            ...result
          });

        } catch (error) {
          logError(error, {
            opportunity: opportunity.id,
            context: 'ProfitCalculator.batchCalculateProfits'
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
      logError(error, { context: 'ProfitCalculator.batchCalculateProfits' });
      throw error;
    }
  }

  // Calculate slippage-adjusted amount
  calculateSlippageAdjustedAmount(amount, slippagePercent = 0.5) {
    return HelperUtils.calculateMinimumAmount(amount, slippagePercent);
  }

  // Calculate break-even price
  calculateBreakEvenPrice(amountIn, totalFees) {
    return new HelperUtils.BigNumber(amountIn).plus(totalFees).dividedBy(amountIn);
  }

  // Calculate profit margin
  calculateProfitMargin(profit, revenue) {
    if (revenue.isZero()) return new HelperUtils.BigNumber(0);
    return profit.dividedBy(revenue).multipliedBy(100);
  }
}

// Create singleton instance
const profitCalculator = new ProfitCalculator();

export default profitCalculator;
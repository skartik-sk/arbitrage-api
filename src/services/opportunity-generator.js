import { SUPPORTED_TOKENS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import HelperUtils from '../utils/helpers.js';
import poolDiscovery from './pool-discovery.js';

class OpportunityGenerator {
  constructor() {
    this.generatedCount = 0;
  }

  // Generate realistic opportunities based on discovered pools
  generateOpportunityFromPools(pools) {
    try {
      if (pools.length < 2) return null;

      // Take two pools with the same token pair from different DEXs
      const pool1 = pools[0];
      const pool2 = pools.find(p => 
        p.dex !== pool1.dex && 
        p.tokenASymbol === pool1.tokenASymbol && 
        p.tokenBSymbol === pool1.tokenBSymbol
      );

      if (!pool2) return null;

      const tokenA = pool1.tokenASymbol;
      const tokenB = pool1.tokenBSymbol;

      // Generate realistic prices with small differences
      const basePrice = this.getBasePrice(tokenA, tokenB);
      const priceVariation = 0.005 + Math.random() * 0.015; // 0.5% to 2% difference
      
      const price1 = basePrice * (1 - priceVariation / 2);
      const price2 = basePrice * (1 + priceVariation / 2);

      const buyPrice = new HelperUtils.BigNumber(Math.min(price1, price2).toString());
      const sellPrice = new HelperUtils.BigNumber(Math.max(price1, price2).toString());
      
      const priceDifference = sellPrice.minus(buyPrice);
      const priceDifferencePercent = priceDifference.dividedBy(buyPrice).multipliedBy(100);

      // Calculate trade amounts and profits
      const tradeAmount = new HelperUtils.BigNumber('1000'); // $1000 trade
      const grossProfit = tradeAmount.multipliedBy(priceDifferencePercent.dividedBy(100));
      
      // Estimate fees and costs
      const swapFees = tradeAmount.multipliedBy(0.006); // 0.6% total swap fees
      const gasCost = new HelperUtils.BigNumber('15'); // $15 gas cost
      const totalFees = swapFees.plus(gasCost);
      
      const expectedOutput = tradeAmount.plus(grossProfit);
      const expectedProfit = grossProfit.minus(totalFees);

      // Only create if profitable
      if (expectedProfit.lte(5)) return null;

      this.generatedCount++;

      return {
        id: `gen_${this.generatedCount}_${Date.now()}`,
        type: 'simple',
        tokenA,
        tokenB,
        buyDex: pool1.dex,
        sellDex: pool2.dex,
        buyPrice,
        sellPrice,
        priceDifference,
        priceDifferencePercent,
        tradeAmount,
        expectedOutput,
        expectedProfit,
        swapFees,
        gasCost,
        totalFees,
        poolA: { address: pool1.address },
        poolB: { address: pool2.address },
        timestamp: Date.now(),
        status: 'detected',
        metadata: {
          chainId: 1,
          feeTier: pool1.feeTier,
          slippageTolerance: 0.5,
          priceImpact: Math.min(parseFloat(priceDifferencePercent.toString()), 2.0),
          liquidityA: pool1.liquidity,
          liquidityB: pool2.liquidity
        }
      };

    } catch (error) {
      logger.error('Error generating opportunity:', error);
      return null;
    }
  }

  // Get base price for token pair (simplified pricing)
  getBasePrice(tokenA, tokenB) {
    const prices = {
      'WETH': 2650,
      'USDC': 1,
      'USDT': 0.999,
      'WBTC': 42000,
      'DAI': 1.001
    };

    const priceA = prices[tokenA] || 1;
    const priceB = prices[tokenB] || 1;

    return priceA / priceB;
  }

  // Generate multiple opportunities from available pools
  async generateOpportunities() {
    try {
      const opportunities = [];
      const stats = poolDiscovery.getStats();
      
      if (stats.totalPools < 2) {
        logger.debug('Not enough pools discovered to generate opportunities');
        return opportunities;
      }

      // Group pools by token pair
      const poolsByPair = {};
      for (const poolInfo of poolDiscovery.discoveredPools.values()) {
        const pairKey = `${poolInfo.tokenASymbol}/${poolInfo.tokenBSymbol}`;
        if (!poolsByPair[pairKey]) {
          poolsByPair[pairKey] = [];
        }
        poolsByPair[pairKey].push(poolInfo);
      }

      // Generate opportunities for pairs with multiple DEX pools
      for (const [pairKey, pools] of Object.entries(poolsByPair)) {
        if (pools.length >= 2) {
          const opportunity = this.generateOpportunityFromPools(pools);
          if (opportunity) {
            opportunities.push(opportunity);
            logger.info(`Generated opportunity for ${pairKey}: $${opportunity.expectedProfit.toFixed(2)} profit`);
          }
        }
      }

      return opportunities;

    } catch (error) {
      logger.error('Error generating opportunities:', error);
      return [];
    }
  }
}

export default new OpportunityGenerator();
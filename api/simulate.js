import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import priceNormalizer from '../src/utils/price-normalizer.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      tokenA,
      tokenB,
      priceA,
      priceB,
      tradeAmount = 1000,
      dexA = 'UNISWAP_V3',
      dexB = 'SUSHISWAP_V2'
    } = req.body;

    // Validate required parameters
    if (!tokenA || !tokenB || !priceA || !priceB) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['tokenA', 'tokenB', 'priceA', 'priceB'],
        received: { tokenA, tokenB, priceA, priceB }
      });
    }

    // Validate prices are numbers
    const numPriceA = parseFloat(priceA);
    const numPriceB = parseFloat(priceB);
    const numTradeAmount = parseFloat(tradeAmount);

    if (isNaN(numPriceA) || isNaN(numPriceB) || isNaN(numTradeAmount)) {
      return res.status(400).json({
        error: 'Invalid price or trade amount',
        message: 'Prices and trade amount must be valid numbers'
      });
    }

    if (numTradeAmount <= 0 || numTradeAmount > 100000) {
      return res.status(400).json({
        error: 'Invalid trade amount',
        message: 'Trade amount must be between $1 and $100,000'
      });
    }

    // Simulate arbitrage opportunity
    const simulation = priceNormalizer.calculateArbitrageOpportunity(
      tokenA,
      tokenB,
      numPriceA,
      numPriceB,
      numTradeAmount
    );

    if (!simulation) {
      return res.status(400).json({
        error: 'Simulation failed',
        message: 'Unable to calculate arbitrage opportunity with provided parameters'
      });
    }

    // Format response
    const response = {
      input: {
        tokenPair: `${tokenA}/${tokenB}`,
        priceA: numPriceA,
        priceB: numPriceB,
        tradeAmount: numTradeAmount,
        dexA,
        dexB
      },
      simulation: {
        profitable: simulation.profitable,
        reason: simulation.reason || null,
        ...simulation
      },
      recommendations: [],
      timestamp: new Date().toISOString()
    };

    // Add recommendations based on simulation
    if (simulation.profitable) {
      response.recommendations.push(
        `✅ Profitable arbitrage opportunity detected!`,
        `💰 Expected net profit: $${simulation.netProfitUSD}`,
        `📊 Profit margin: ${simulation.priceDifferencePercent}%`,
        `🔄 Trade route: ${simulation.explanation.profit}`
      );
    } else {
      response.recommendations.push(
        `❌ Arbitrage not profitable: ${simulation.reason}`,
        `📊 Price difference: ${simulation.priceDifferencePercent || 'N/A'}%`,
        `💡 Try different token pairs or wait for better price differences`
      );
    }

    // Add risk warnings
    response.risks = [
      '⚠️ This is a simulation - actual trading involves additional risks',
      '💸 Gas fees may be higher during network congestion',
      '⏰ Prices change rapidly - opportunity may disappear quickly',
      '🔒 Always test with small amounts first'
    ];

    res.status(200).json(response);

  } catch (error) {
    logger.error('Simulation API error:', error);
    res.status(500).json({
      error: 'Simulation failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
import 'dotenv/config';
import dbConnection from '../src/config/database.js';
import { logger } from '../src/utils/logger.js';
import rpcManager from '../src/services/rpc-manager.js';

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

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize RPC if needed
    if (!rpcManager.isInitialized) {
      await rpcManager.initialize();
    }

    // Mock current prices (in production, these would come from price fetcher)
    const mockPrices = [
      {
        dex: 'UNISWAP_V3',
        tokenPair: 'USDT/WETH',
        price: 0.000377,
        priceUSD: 2650,
        blockNumber: await rpcManager.getBlockNumber().catch(() => 0),
        timestamp: Date.now(),
        feeTier: '3000'
      },
      {
        dex: 'SUSHISWAP_V2',
        tokenPair: 'USDT/WETH',
        price: 0.000378,
        priceUSD: 2650,
        blockNumber: await rpcManager.getBlockNumber().catch(() => 0),
        timestamp: Date.now(),
        feeTier: '3000'
      },
      {
        dex: 'UNISWAP_V3',
        tokenPair: 'WBTC/WETH',
        price: 24.52,
        priceUSD: 65000,
        blockNumber: await rpcManager.getBlockNumber().catch(() => 0),
        timestamp: Date.now(),
        feeTier: '3000'
      },
      {
        dex: 'SUSHISWAP_V2',
        tokenPair: 'WBTC/WETH',
        price: 24.58,
        priceUSD: 65000,
        blockNumber: await rpcManager.getBlockNumber().catch(() => 0),
        timestamp: Date.now(),
        feeTier: '3000'
      }
    ];

    const prices = {
      realTime: mockPrices,
      summary: {
        totalPairs: mockPrices.length,
        dexes: [...new Set(mockPrices.map(p => p.dex))],
        lastUpdated: new Date().toISOString(),
        blockNumber: await rpcManager.getBlockNumber().catch(() => 0)
      },
      pairs: {
        'USDT/WETH': mockPrices.filter(p => p.tokenPair === 'USDT/WETH'),
        'WBTC/WETH': mockPrices.filter(p => p.tokenPair === 'WBTC/WETH')
      }
    };

    res.status(200).json(prices);

  } catch (error) {
    logger.error('Prices API error:', error);
    res.status(500).json({
      error: 'Failed to fetch prices',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
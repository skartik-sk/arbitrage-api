import { ethers } from 'ethers';
import rpcManager from './rpc-manager.js';
import { SUPPORTED_TOKENS } from '../config/constants.js';
import { logger, logError } from '../utils/logger.js';

// SushiSwap V2 Factory ABI (minimal)
const SUSHISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// SushiSwap V2 Pair ABI (minimal)
const SUSHISWAP_V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

class SushiSwapV2Discovery {
  constructor() {
    this.pools = new Map();
    this.factoryContract = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      logger.info('Initializing SushiSwap V2 pool discovery...');

      const factoryAddress = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
      
      this.factoryContract = await rpcManager.execute(async (provider) => {
        return new ethers.Contract(factoryAddress, SUSHISWAP_V2_FACTORY_ABI, provider);
      });

      // Discover pools for our token pairs
      await this.discoverPools();

      this.isInitialized = true;
      logger.info(`✅ SushiSwap V2 discovery initialized with ${this.pools.size} pools`);

    } catch (error) {
      logError(error, { context: 'SushiSwapV2Discovery.initialize' });
      throw error;
    }
  }

  async discoverPools() {
    try {
      const tokenPairs = [
        ['USDT', 'WETH'],
        ['WBTC', 'WETH'],
        ['DAI', 'WETH'],
        ['USDC', 'WETH']
      ];

      for (const [tokenASymbol, tokenBSymbol] of tokenPairs) {
        try {
          const tokenA = SUPPORTED_TOKENS[tokenASymbol];
          const tokenB = SUPPORTED_TOKENS[tokenBSymbol];

          if (!tokenA || !tokenB) {
            logger.warn(`Token not found: ${tokenASymbol} or ${tokenBSymbol}`);
            continue;
          }

          const pairAddress = await rpcManager.execute(async () => {
            return await this.factoryContract.getPair(tokenA.address, tokenB.address);
          });

          if (pairAddress && pairAddress !== ethers.ZeroAddress) {
            const pairContract = await rpcManager.execute(async (provider) => {
              return new ethers.Contract(pairAddress, SUSHISWAP_V2_PAIR_ABI, provider);
            });

            // Get reserves to check if pool has liquidity
            const reserves = await rpcManager.execute(async () => {
              return await pairContract.getReserves();
            });

            if (reserves.reserve0 > 0n && reserves.reserve1 > 0n) {
              const poolKey = this.getPoolKey(tokenASymbol, tokenBSymbol);
              
              this.pools.set(poolKey, {
                address: pairAddress,
                contract: pairContract,
                tokenA: tokenASymbol,
                tokenB: tokenBSymbol,
                tokenAAddress: tokenA.address,
                tokenBAddress: tokenB.address,
                reserve0: reserves.reserve0,
                reserve1: reserves.reserve1,
                dex: 'SUSHISWAP_V2',
                version: 'V2',
                feeTier: 3000 // V2 has fixed 0.3% fee
              });

              logger.info(`📍 SushiSwap V2 pool discovered: ${tokenASymbol}/${tokenBSymbol}`, {
                address: pairAddress,
                reserve0: reserves.reserve0.toString(),
                reserve1: reserves.reserve1.toString()
              });
            }
          }
        } catch (error) {
          logError(error, { 
            context: 'SushiSwapV2Discovery.discoverPools', 
            tokenPair: `${tokenASymbol}/${tokenBSymbol}` 
          });
        }
      }

      logger.info(`SushiSwap V2 pool discovery completed: ${this.pools.size} pools found`);

    } catch (error) {
      logError(error, { context: 'SushiSwapV2Discovery.discoverPools' });
      throw error;
    }
  }

  getPool(tokenA, tokenB) {
    const poolKey = this.getPoolKey(tokenA, tokenB);
    return this.pools.get(poolKey) || this.pools.get(this.getPoolKey(tokenB, tokenA));
  }

  getAllPools() {
    return Array.from(this.pools.values());
  }

  getTotalPools() {
    return this.pools.size;
  }

  getPoolKey(tokenA, tokenB) {
    return `${tokenA}-${tokenB}`;
  }

  // Calculate price from V2 reserves
  async calculatePrice(tokenA, tokenB) {
    try {
      const tokenAInfo = SUPPORTED_TOKENS[tokenA];
      const tokenBInfo = SUPPORTED_TOKENS[tokenB];

      if (!tokenAInfo || !tokenBInfo) {
        throw new Error('Token info not found');
      }

      // Determine which reserve corresponds to which token
      const pool = this.getPool(tokenA, tokenB);
      if (!pool) return null;

      const token0Address = await rpcManager.execute(async () => {
        return await pool.contract.token0();
      });

      let reserveA, reserveB;
      
      if (token0Address.toLowerCase() === tokenAInfo.address.toLowerCase()) {
        reserveA = pool.reserve0;
        reserveB = pool.reserve1;
      } else {
        reserveA = pool.reserve1;
        reserveB = pool.reserve0;
      }

      // Price = reserveB / reserveA (adjusted for decimals)
      const reserveADecimal = Number(reserveA) / Math.pow(10, tokenAInfo.decimals);
      const reserveBDecimal = Number(reserveB) / Math.pow(10, tokenBInfo.decimals);

      return reserveBDecimal / reserveADecimal;

    } catch (error) {
      logError(error, { context: 'SushiSwapV2Discovery.calculatePrice', tokenA, tokenB });
      return null;
    }
  }

  // Update reserves for a pool
  async updatePoolReserves(tokenA, tokenB) {
    try {
      const pool = this.getPool(tokenA, tokenB);
      if (!pool) return null;

      const reserves = await rpcManager.execute(async () => {
        return await pool.contract.getReserves();
      });

      pool.reserve0 = reserves.reserve0;
      pool.reserve1 = reserves.reserve1;
      pool.lastUpdate = Date.now();

      return {
        reserve0: reserves.reserve0,
        reserve1: reserves.reserve1,
        blockTimestampLast: reserves.blockTimestampLast
      };

    } catch (error) {
      logError(error, { context: 'SushiSwapV2Discovery.updatePoolReserves', tokenA, tokenB });
      return null;
    }
  }
}

// Create singleton instance
const sushiSwapV2Discovery = new SushiSwapV2Discovery();

export default sushiSwapV2Discovery;
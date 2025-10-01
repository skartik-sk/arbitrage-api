import { ethers } from 'ethers';
import { DEX_CONFIG } from '../config/dex-config.js';
import { SUPPORTED_TOKENS, TOKEN_PAIRS, FEE_TIERS } from '../config/constants.js';
import rpcManager from './rpc-manager.js';
import { logPoolDiscovery, logError, logger } from '../utils/logger.js';
import HelperUtils from '../utils/helpers.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PoolDiscovery {
  constructor() {
    this.discoveredPools = new Map();
    this.factoryContracts = new Map();
    this.poolContracts = new Map();
    this.isInitialized = false;
  }

  // Initialize the pool discovery service
  async initialize() {
    try {
      // Initialize factory contracts for all DEXs
      for (const [dexName, config] of Object.entries(DEX_CONFIG)) {
        try {
          const factoryABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../abis/UniswapV3Factory.json'), 'utf8'));
          const factoryContract = new ethers.Contract(
            config.factory,
            factoryABI,
            rpcManager.getProvider()
          );

          this.factoryContracts.set(dexName, {
            contract: factoryContract,
            config,
            pools: new Map()
          });

          logger.info(`Factory contract initialized for ${dexName}`);
        } catch (error) {
          logError(error, { dex: dexName, context: 'PoolDiscovery.initialize' });
        }
      }

      // Discover existing pools
      await this.discoverAllPools();

      this.isInitialized = true;
      logger.info(`Pool discovery initialized with ${this.getTotalPools()} pools found`);

    } catch (error) {
      logError(error, { context: 'PoolDiscovery.initialize' });
      throw error;
    }
  }

  // Discover all pools for supported token pairs
  async discoverAllPools() {
    try {
      for (const [dexName, factoryInfo] of this.factoryContracts) {
        for (const [tokenA, tokenB] of TOKEN_PAIRS) {
          for (const feeTier of factoryInfo.config.feeTiers) {
            await this.discoverPool(dexName, tokenA, tokenB, feeTier);
          }
        }
      }

      logger.info(`Pool discovery completed. Total pools found: ${this.getTotalPools()}`);
    } catch (error) {
      logError(error, { context: 'PoolDiscovery.discoverAllPools' });
      throw error;
    }
  }

  // Discover a specific pool
  async discoverPool(dexName, tokenA, tokenB, feeTier) {
    try {
      const factoryInfo = this.factoryContracts.get(dexName);
      if (!factoryInfo) {
        throw new Error(`DEX ${dexName} not initialized`);
      }

      const tokenAAddress = SUPPORTED_TOKENS[tokenA].address;
      const tokenBAddress = SUPPORTED_TOKENS[tokenB].address;

      // Sort tokens for pool address calculation
      const [token0, token1] = HelperUtils.sortTokens(tokenAAddress, tokenBAddress);

      // Get pool address from factory
      const poolAddress = await rpcManager.execute(async (provider) => {
        return await factoryInfo.contract.getPool(token0, token1, feeTier);
      });

      if (poolAddress === ethers.ZeroAddress) {
        logger.debug(`Pool not found: ${dexName} ${tokenA}/${tokenB} ${feeTier}`);
        return null;
      }

      // Create pool contract
      const poolABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../abis/UniswapV3Pool.json'), 'utf8'));
      const poolContract = new ethers.Contract(
        poolAddress,
        poolABI,
        rpcManager.getProvider()
      );

      // Get pool data
      const poolData = await this.getPoolData(poolContract);

      const poolInfo = {
        address: poolAddress,
        dex: dexName,
        token0: token0,
        token1: token1,
        tokenASymbol: token0 === tokenAAddress ? tokenA : tokenB,
        tokenBSymbol: token1 === tokenAAddress ? tokenA : tokenB,
        feeTier,
        contract: poolContract,
        ...poolData,
        lastUpdated: Date.now()
      };

      // Store pool info
      const poolKey = this.getPoolKey(dexName, tokenA, tokenB, feeTier);
      this.discoveredPools.set(poolKey, poolInfo);
      factoryInfo.pools.set(poolKey, poolInfo);

      logPoolDiscovery(dexName, poolAddress, { tokenA, tokenB, feeTier, liquidity: poolData.liquidity });

      return poolInfo;

    } catch (error) {
      logError(error, {
        dex: dexName,
        tokenA,
        tokenB,
        feeTier,
        context: 'PoolDiscovery.discoverPool'
      });
      return null;
    }
  }

  // Get pool data (slot0, liquidity, etc.)
  async getPoolData(poolContract) {
    try {
      const [slot0, liquidity] = await Promise.all([
        rpcManager.execute(async (provider) => {
          return await poolContract.slot0();
        }),
        rpcManager.execute(async (provider) => {
          return await poolContract.liquidity();
        })
      ]);

      return {
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: slot0.tick,
        liquidity: liquidity.toString(),
        observationIndex: slot0.observationIndex,
        observationCardinality: slot0.observationCardinality,
        feeProtocol: slot0.feeProtocol,
        unlocked: slot0.unlocked
      };

    } catch (error) {
      logError(error, { context: 'PoolDiscovery.getPoolData' });
      throw error;
    }
  }

  // Get pool for a specific token pair and DEX
  getPool(dexName, tokenA, tokenB, feeTier = FEE_TIERS.MEDIUM) {
    const poolKey = this.getPoolKey(dexName, tokenA, tokenB, feeTier);
    return this.discoveredPools.get(poolKey);
  }

  // Get all pools for a token pair across all DEXs
  getPoolsForPair(tokenA, tokenB) {
    const pools = [];

    for (const [poolKey, poolInfo] of this.discoveredPools) {
      if ((poolInfo.tokenASymbol === tokenA && poolInfo.tokenBSymbol === tokenB) ||
          (poolInfo.tokenASymbol === tokenB && poolInfo.tokenBSymbol === tokenA)) {
        pools.push(poolInfo);
      }
    }

    return pools;
  }

  // Get all pools for a DEX
  getPoolsForDex(dexName) {
    const pools = [];

    for (const [poolKey, poolInfo] of this.discoveredPools) {
      if (poolInfo.dex === dexName) {
        pools.push(poolInfo);
      }
    }

    return pools;
  }

  // Check if pool has sufficient liquidity
  hasSufficientLiquidity(poolInfo, minLiquidityUSD = 10000) {
    // This is a simplified check - in reality you'd need to calculate USD value
    const liquidity = BigInt(poolInfo.liquidity || '0');
    return liquidity > BigInt(minLiquidityUSD * 1e18); // Rough estimate
  }

  // Update pool data
  async updatePoolData(poolKey) {
    try {
      const poolInfo = this.discoveredPools.get(poolKey);
      if (!poolInfo) {
        throw new Error(`Pool not found: ${poolKey}`);
      }

      const freshData = await this.getPoolData(poolInfo.contract);
      Object.assign(poolInfo, freshData, { lastUpdated: Date.now() });

      return poolInfo;

    } catch (error) {
      logError(error, { poolKey, context: 'PoolDiscovery.updatePoolData' });
      throw error;
    }
  }

  // Batch update pool data
  async updateAllPools() {
    try {
      const updatePromises = Array.from(this.discoveredPools.keys()).map(poolKey =>
        this.updatePoolData(poolKey).catch(error => {
          logError(error, { poolKey, context: 'PoolDiscovery.updateAllPools' });
          return null;
        })
      );

      const results = await Promise.allSettled(updatePromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info(`Pool data update completed: ${successful} successful, ${failed} failed`);

    } catch (error) {
      logError(error, { context: 'PoolDiscovery.updateAllPools' });
      throw error;
    }
  }

  // Get pool statistics
  getStats() {
    const stats = {
      totalPools: this.discoveredPools.size,
      poolsByDex: {},
      poolsByPair: {},
      poolsWithLiquidity: 0
    };

    for (const poolInfo of this.discoveredPools.values()) {
      // Count by DEX
      stats.poolsByDex[poolInfo.dex] = (stats.poolsByDex[poolInfo.dex] || 0) + 1;

      // Count by pair
      const pairKey = `${poolInfo.tokenASymbol}/${poolInfo.tokenBSymbol}`;
      stats.poolsByPair[pairKey] = (stats.poolsByPair[pairKey] || 0) + 1;

      // Count pools with liquidity
      if (this.hasSufficientLiquidity(poolInfo)) {
        stats.poolsWithLiquidity++;
      }
    }

    return stats;
  }

  // Utility methods
  getPoolKey(dexName, tokenA, tokenB, feeTier) {
    const [token0, token1] = HelperUtils.sortTokens(tokenA, tokenB);
    return `${dexName}:${token0}-${token1}:${feeTier}`;
  }

  getTotalPools() {
    return this.discoveredPools.size;
  }

  // Validate pool address
  isValidPoolAddress(address) {
    return HelperUtils.isValidAddress(address) && address !== ethers.ZeroAddress;
  }

  // Get pool contract
  getPoolContract(poolKey) {
    const poolInfo = this.discoveredPools.get(poolKey);
    return poolInfo?.contract;
  }

  // Refresh pool discovery
  async refresh() {
    logger.info('Refreshing pool discovery...');
    this.discoveredPools.clear();
    await this.discoverAllPools();
    logger.info('Pool discovery refreshed');
  }

  // Cleanup stale pools
  cleanup(maxAgeMinutes = 60) {
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;

    let cleaned = 0;
    for (const [poolKey, poolInfo] of this.discoveredPools) {
      if (now - poolInfo.lastUpdated > maxAge) {
        this.discoveredPools.delete(poolKey);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale pools`);
    }

    return cleaned;
  }
}

// Create singleton instance
const poolDiscovery = new PoolDiscovery();

export default poolDiscovery;
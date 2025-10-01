import { ethers } from 'ethers';
import { logError, logger } from '../utils/logger.js';
import HelperUtils from '../utils/helpers.js';

class RPCManager {
  constructor() {
    this.providers = new Map();
    this.currentProvider = null;
    this.chainId = 1; // Ethereum mainnet by default
    this.healthCheckInterval = null;
    this.isHealthy = false;
    this.lastHealthCheck = null;
    this.connectionAttempts = 0;
    this.maxRetries = 3;
  }

  // Initialize RPC providers
  async initialize() {
    try {
      const rpcUrls = [
        process.env.ETHEREUM_RPC,
        'https://ethereum.publicnode.com',
        'https://rpc.ankr.com/eth',
        'https://eth.llamarpc.com',
        'https://ethereum.blockpi.network/v1/rpc/public',
        'https://1rpc.io/eth'
      ].filter(Boolean); // Remove undefined/null values

      logger.info(`Testing ${rpcUrls.length} RPC endpoints...`);

      for (const url of rpcUrls) {
        try {
          logger.info(`Testing RPC: ${url}`);
          const provider = new ethers.JsonRpcProvider(url);
          await this.testProvider(provider);

          this.providers.set(url, {
            provider,
            url,
            isHealthy: true,
            lastCheck: Date.now(),
            errors: 0
          });

          logger.info(`✅ RPC provider initialized: ${url}`);
          
          // Break after first successful connection for faster startup
          if (this.providers.size >= 1) {
            logger.info(`Found working RPC, continuing with initialization...`);
            break;
          }
        } catch (error) {
          logger.warn(`❌ Failed to initialize RPC provider ${url}: ${error.message}`);
        }
      }

      if (this.providers.size === 0) {
        throw new Error('No RPC providers could be initialized');
      }

      // Set current provider to the first healthy one
      this.currentProvider = this.providers.values().next().value;
      this.isHealthy = true;
      this.chainId = await this.currentProvider.provider.getNetwork().then(network => Number(network.chainId));

      // Start health checks
      this.startHealthChecks();

      logger.info(`RPC Manager initialized with ${this.providers.size} providers on chain ${this.chainId}`);

    } catch (error) {
      logError(error, { context: 'RPCManager.initialize' });
      throw error;
    }
  }

  // Test provider connectivity
  async testProvider(provider) {
    try {
      const start = Date.now();
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Provider test timeout')), 3000) // 3 second timeout
      );
      
      // Race between the actual call and timeout
      await Promise.race([
        provider.getBlockNumber(),
        timeoutPromise
      ]);
      
      const latency = Date.now() - start;

      if (latency > 5000) { // 5 seconds max latency
        throw new Error(`Provider too slow: ${latency}ms`);
      }

      return true;
    } catch (error) {
      throw new Error(`Provider test failed: ${error.message}`);
    }
  }

  // Get current provider
  getProvider() {
    if (!this.currentProvider) {
      throw new Error('No provider available');
    }
    return this.currentProvider.provider;
  }

  // Switch to next available provider
  async switchProvider() {
    const availableProviders = Array.from(this.providers.values())
      .filter(p => p.isHealthy);

    if (availableProviders.length === 0) {
      throw new Error('No healthy providers available');
    }

    // Find current provider index
    const currentIndex = availableProviders.indexOf(this.currentProvider);
    const nextIndex = (currentIndex + 1) % availableProviders.length;
    const nextProvider = availableProviders[nextIndex];

    this.currentProvider = nextProvider;
    logger.info(`Switched to RPC provider: ${nextProvider.url}`);

    return this.currentProvider;
  }

  // Execute call with automatic retry and failover
  async execute(call) {
    let lastError;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        if (!this.currentProvider || !this.currentProvider.isHealthy) {
          await this.switchProvider();
        }

        const result = await call(this.currentProvider.provider);

        // Reset error count on success
        if (this.currentProvider) {
          this.currentProvider.errors = 0;
        }

        return result;

      } catch (error) {
        lastError = error;

        // Mark provider as unhealthy on certain errors
        if (this.shouldMarkUnhealthy(error)) {
          if (this.currentProvider) {
            this.currentProvider.isHealthy = false;
            this.currentProvider.errors++;
            logger.warn(`Provider marked as unhealthy: ${this.currentProvider.url}`, {
              error: error.message,
              errorCount: this.currentProvider.errors
            });
          }
        }

        // Try switching provider
        if (attempt < this.maxRetries - 1) {
          await HelperUtils.sleep(1000 * (attempt + 1)); // Exponential backoff
          await this.switchProvider();
        }
      }
    }

    throw lastError;
  }

  // Determine if error should mark provider as unhealthy
  shouldMarkUnhealthy(error) {
    const unhealthyErrors = [
      'TIMEOUT',
      'NETWORK_ERROR',
      'CONNECTION_CLOSED',
      'RATE_LIMITED',
      'INVALID_RESPONSE'
    ];

    return unhealthyErrors.some(err =>
      error.message.includes(err) ||
      error.code === err ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    );
  }

  // Start health check interval
  startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, 30000); // Check every 30 seconds
  }

  // Perform health check on all providers
  async performHealthCheck() {
    this.lastHealthCheck = Date.now();

    for (const [url, providerInfo] of this.providers) {
      try {
        const start = Date.now();
        await providerInfo.provider.getBlockNumber();
        const latency = Date.now() - start;

        providerInfo.isHealthy = true;
        providerInfo.lastCheck = Date.now();
        providerInfo.latency = latency;

        if (latency > 5000) {
          logger.warn(`Provider slow response: ${url} (${latency}ms)`);
        }

      } catch (error) {
        providerInfo.isHealthy = false;
        providerInfo.errors++;
        logger.warn(`Provider health check failed: ${url}`, {
          error: error.message,
          errorCount: providerInfo.errors
        });

        // Disable provider after too many errors
        if (providerInfo.errors > 5) {
          providerInfo.isHealthy = false;
          logger.error(`Provider disabled due to repeated errors: ${url}`);
        }
      }
    }

    // Update overall health status
    const healthyProviders = Array.from(this.providers.values())
      .filter(p => p.isHealthy);

    this.isHealthy = healthyProviders.length > 0;

    // Switch if current provider is unhealthy
    if (this.currentProvider && !this.currentProvider.isHealthy) {
      await this.switchProvider();
    }

    logger.debug(`RPC Health Check: ${healthyProviders.length}/${this.providers.size} providers healthy`);
  }

  // Get provider statistics
  getStats() {
    const providers = Array.from(this.providers.values()).map(p => ({
      url: p.url,
      isHealthy: p.isHealthy,
      lastCheck: p.lastCheck,
      errors: p.errors,
      latency: p.latency
    }));

    return {
      isHealthy: this.isHealthy,
      totalProviders: this.providers.size,
      healthyProviders: providers.filter(p => p.isHealthy).length,
      currentProvider: this.currentProvider?.url,
      chainId: this.chainId,
      lastHealthCheck: this.lastHealthCheck,
      providers
    };
  }

  // Get current gas price
  async getGasPrice() {
    return this.execute(async (provider) => {
      return await provider.getFeeData();
    });
  }

  // Get latest block
  async getLatestBlock() {
    return this.execute(async (provider) => {
      return await provider.getBlock('latest');
    });
  }

  // Get block number
  async getBlockNumber() {
    return this.execute(async (provider) => {
      return await provider.getBlockNumber();
    });
  }

  // Get transaction receipt
  async getTransactionReceipt(txHash) {
    return this.execute(async (provider) => {
      return await provider.getTransactionReceipt(txHash);
    });
  }

  // Send transaction (if needed for future use)
  async sendTransaction(transaction) {
    return this.execute(async (provider) => {
      return await provider.broadcastTransaction(transaction);
    });
  }

  // Call contract
  async call(contract, data, blockTag = 'latest') {
    return this.execute(async (provider) => {
      return await provider.call({
        to: contract.target,
        data
      }, blockTag);
    });
  }

  // Estimate gas
  async estimateGas(transaction) {
    return this.execute(async (provider) => {
      return await provider.estimateGas(transaction);
    });
  }

  // Cleanup
  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.providers.clear();
    this.currentProvider = null;
    this.isHealthy = false;

    logger.info('RPC Manager destroyed');
  }
}

// Create singleton instance
const rpcManager = new RPCManager();

export default rpcManager;
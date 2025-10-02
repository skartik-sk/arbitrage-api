import { BigNumber } from '../config/constants.js';

class HelperUtils {
  // Export BigNumber for convenience
  static BigNumber = BigNumber;
  // Format token amount with proper decimals
  static formatTokenAmount(amount, decimals) {
    return new BigNumber(amount).dividedBy(new BigNumber(10).pow(decimals));
  }

  // Parse token amount with proper decimals
  static parseTokenAmount(amount, decimals) {
    return new BigNumber(amount).multipliedBy(new BigNumber(10).pow(decimals));
  }

  // Convert to wei (18 decimals)
  static toWei(amount) {
    return new BigNumber(amount).multipliedBy(new BigNumber(10).pow(18));
  }

  // Convert from wei (18 decimals)
  static fromWei(amount) {
    return new BigNumber(amount).dividedBy(new BigNumber(10).pow(18));
  }

  // Calculate price impact
  static calculatePriceImpact(inputAmount, outputAmount, currentPrice) {
    const expectedOutput = new BigNumber(inputAmount).multipliedBy(currentPrice);
    const priceImpact = expectedOutput.minus(outputAmount).dividedBy(expectedOutput);
    return priceImpact.multipliedBy(100); // Return as percentage
  }

  // Calculate minimum amount with slippage
  static calculateMinimumAmount(amount, slippagePercent) {
    const slippageMultiplier = new BigNumber(1).minus(new BigNumber(slippagePercent).dividedBy(100));
    return new BigNumber(amount).multipliedBy(slippageMultiplier);
  }

  // Sleep function for delays
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Retry function with exponential backoff
  static async retry(fn, maxAttempts = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          throw lastError;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  // Validate address format
  static isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  // Convert address to proper EIP-55 checksum
  static async toChecksumAddress(address) {
    try {
      // Import ethers dynamically to avoid circular dependencies
      const { ethers } = await import('ethers');
      return ethers.getAddress(address.toLowerCase());
    } catch (error) {
      console.warn(`Failed to checksum address: ${address}`, error);
      return address;
    }
  }

  // Get token address with proper checksum
  static async getTokenAddress(tokenSymbol, supportedTokens) {
    const tokenInfo = supportedTokens[tokenSymbol];
    if (!tokenInfo) {
      throw new Error(`Unsupported token: ${tokenSymbol}`);
    }

    return this.toChecksumAddress(tokenInfo.address);
  }

  // Sort token addresses for pool creation
  static sortTokens(tokenA, tokenB) {
    return tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }

  // Get gas price with buffer
  static getGasPriceWithBuffer(baseGasPrice, bufferPercentage = 20) {
    const bufferMultiplier = new BigNumber(100 + bufferPercentage).dividedBy(100);
    return new BigNumber(baseGasPrice).multipliedBy(bufferMultiplier);
  }

  // Calculate gas cost in ETH
  static calculateGasCost(gasUsed, gasPrice) {
    return new BigNumber(gasUsed).multipliedBy(new BigNumber(gasPrice));
  }

  // Format USD value
  static formatUSD(amount) {
    return new BigNumber(amount).toFixed(2);
  }

  // Generate unique ID
  static generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  // Validate token pair
  static isValidTokenPair(tokenA, tokenB) {
    return tokenA !== tokenB &&
           this.isValidAddress(tokenA) &&
           this.isValidAddress(tokenB);
  }

  // Calculate ROI
  static calculateROI(profit, investment) {
    if (investment.isZero()) return new BigNumber(0);
    return profit.dividedBy(investment).multipliedBy(100);
  }

  // Clamp value between min and max
  static clamp(value, min, max) {
    return new BigNumber(value).lt(min) ? min :
           new BigNumber(value).gt(max) ? max : value;
  }

  // Format percentage
  static formatPercentage(value, decimals = 2) {
    return new BigNumber(value).toFixed(decimals) + '%';
  }

  // Check if object is empty
  static isEmpty(obj) {
    return Object.keys(obj).length === 0 && obj.constructor === Object;
  }

  // Deep clone object
  static deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Get timestamp
  static getTimestamp() {
    return Date.now();
  }

  // Format date
  static formatDate(date = new Date()) {
    return date.toISOString();
  }

  // Calculate annualized profit
  static calculateAnnualizedProfit(profit, investment, timeInMs) {
    const secondsInYear = 31536000;
    const timeInSeconds = timeInMs / 1000;
    const periodsPerYear = secondsInYear / timeInSeconds;

    return this.calculateROI(profit, investment).multipliedBy(periodsPerYear);
  }

  // Validate profit threshold
  static meetsProfitThreshold(profit, threshold) {
    return new BigNumber(profit).gte(threshold);
  }
}

export default HelperUtils;
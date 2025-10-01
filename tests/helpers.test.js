const HelperUtils = require('../src/utils/helpers');

describe('HelperUtils', () => {
  describe('formatTokenAmount', () => {
    test('should format token amount correctly', () => {
      const amount = '1000000000000000000'; // 1 ETH in wei
      const decimals = 18;
      const result = HelperUtils.formatTokenAmount(amount, decimals);

      expect(result.toString()).toBe('1');
    });

    test('should handle different decimal places', () => {
      const amount = '1000000'; // 1 USDC (6 decimals)
      const decimals = 6;
      const result = HelperUtils.formatTokenAmount(amount, decimals);

      expect(result.toString()).toBe('1');
    });
  });

  describe('parseTokenAmount', () => {
    test('should parse token amount correctly', () => {
      const amount = 1;
      const decimals = 18;
      const result = HelperUtils.parseTokenAmount(amount, decimals);

      expect(result.toString()).toBe('1000000000000000000');
    });
  });

  describe('calculatePriceImpact', () => {
    test('should calculate price impact correctly', () => {
      const inputAmount = 1000;
      const outputAmount = 990;
      const currentPrice = 1;

      const result = HelperUtils.calculatePriceImpact(inputAmount, outputAmount, currentPrice);
      expect(result.toNumber()).toBeCloseTo(1, 1); // 1% price impact
    });
  });

  describe('calculateMinimumAmount', () => {
    test('should calculate minimum amount with slippage', () => {
      const amount = 1000;
      const slippagePercent = 0.5; // 0.5%

      const result = HelperUtils.calculateMinimumAmount(amount, slippagePercent);
      expect(result.toNumber()).toBeCloseTo(995, 0);
    });
  });

  describe('isValidAddress', () => {
    test('should validate correct Ethereum address', () => {
      const address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      expect(HelperUtils.isValidAddress(address)).toBe(true);
    });

    test('should reject invalid address', () => {
      const address = 'invalid-address';
      expect(HelperUtils.isValidAddress(address)).toBe(false);
    });
  });

  describe('sortTokens', () => {
    test('should sort tokens correctly', () => {
      const tokenA = '0xB...'; // Higher address
      const tokenB = '0xA...'; // Lower address

      const [token0, token1] = HelperUtils.sortTokens(tokenA, tokenB);

      expect(token0).toBe(tokenB); // Lower address should be first
      expect(token1).toBe(tokenA);
    });
  });

  describe('meetsProfitThreshold', () => {
    test('should check profit threshold correctly', () => {
      const profit = 60;
      const threshold = 50;

      expect(HelperUtils.meetsProfitThreshold(profit, threshold)).toBe(true);

      expect(HelperUtils.meetsProfitThreshold(40, threshold)).toBe(false);
    });
  });
});
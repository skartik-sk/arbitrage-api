import BigNumber from 'bignumber.js';

// Blockchains
const SUPPORTED_CHAINS = {
  ETHEREUM: {
    chainId: 1,
    name: 'Ethereum',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    }
  },
  POLYGON: {
    chainId: 137,
    name: 'Polygon',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    }
  },
  ARBITRUM: {
    chainId: 42161,
    name: 'Arbitrum One',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    }
  }
};

// Fee Tiers for Uniswap V3
const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000     // 1%
};

// Slippage Tolerance
const SLIPPAGE_TOLERANCE = {
  MIN: 0.001,     // 0.1%
  DEFAULT: 0.005, // 0.5%
  MAX: 0.02       // 2%
};

// Gas Limits
const GAS_LIMITS = {
  SINGLE_SWAP: 150000,
  TRIANGULAR_SWAP: 450000,
  WRAP_ETH: 50000,
  APPROVE: 50000
};

// Supported Tokens
const SUPPORTED_TOKENS = {
  WETH: {
    address: process.env.WETH_ADDRESS || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18
  },
  USDC: {
    address: process.env.USDC_ADDRESS || '0xa0b86A33E542873CD17B062F78dEAd58c6B26cC8',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6
  },
  USDT: {
    address: process.env.USDT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6
  },
  WBTC: {
    address: process.env.WBTC_ADDRESS || '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8
  },
  DAI: {
    address: process.env.DAI_ADDRESS || '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18
  }
};

// Token Pairs for Arbitrage (Only pairs with confirmed liquidity)
const TOKEN_PAIRS = [
  ['USDT', 'WETH'],  // ✅ Available on both Uniswap V3 & SushiSwap V3
  ['WBTC', 'WETH'],  // ✅ Available on both Uniswap V3 & SushiSwap V3  
  ['DAI', 'WETH']    // ✅ Available on both Uniswap V3 & SushiSwap V3
];

// Arbitrage Configuration
const ARBITRAGE_CONFIG = {
  MIN_PROFIT_THRESHOLD_USD: parseFloat(process.env.MIN_PROFIT_USD) || 50,
  MIN_LIQUIDITY_USD: 10000,
  MAX_PRICE_IMPACT: 0.01, // 1%
  MAX_SLIPPAGE: 0.005,   // 0.5%
  GAS_BUFFER_PERCENTAGE: parseFloat(process.env.GAS_BUFFER_PERCENTAGE) || 20
};

// Update Intervals
const INTERVALS = {
  PRICE_UPDATE: parseInt(process.env.PRICE_UPDATE_INTERVAL_MS) || 5000,
  SCAN_OPPORTUNITIES: parseInt(process.env.SCAN_INTERVAL_MS) || 10000,
  CLEANUP_DB: 3600000, // 1 hour
  HEALTH_CHECK: 30000  // 30 seconds
};

// BigNumber Configuration
BigNumber.set({
  EXPONENTIAL_AT: 50,
  ROUNDING_MODE: BigNumber.ROUND_DOWN
});

export {
  SUPPORTED_CHAINS,
  FEE_TIERS,
  SLIPPAGE_TOLERANCE,
  GAS_LIMITS,
  SUPPORTED_TOKENS,
  TOKEN_PAIRS,
  ARBITRAGE_CONFIG,
  INTERVALS,
  BigNumber
};
// DEX Configuration for Multiple Exchanges

const DEX_CONFIG = {
  UNISWAP_V3: {
    name: 'Uniswap V3',
    factory: process.env.UNISWAP_V3_FACTORY || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    router: process.env.UNISWAP_V3_ROUTER || '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    quoter: process.env.UNISWAP_V3_QUOTER || '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    chainId: 1,
    feeTiers: [100, 500, 3000, 10000],
    pools: {},
    supportedChains: ['ETHEREUM']
  },
  SUSHISWAP_V3: {
    name: 'SushiSwap V3',
    factory: process.env.SUSHISWAP_V3_FACTORY || '0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4F',
    router: process.env.SUSHISWAP_V3_ROUTER || '0x2214A42d8e2A1d20635c2cb0664422c528B6A432',
    quoter: process.env.SUSHISWAP_V3_QUOTER || '0x64e8802FE490fa7cc61d3463958199161Bb608A7',
    chainId: 1,
    feeTiers: [100, 500, 3000, 10000],
    pools: {},
    supportedChains: ['ETHEREUM']
  }
};

// Pool Initialization Codes
const POOL_INIT_CODE_HASHES = {
  UNISWAP_V3: '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
  SUSHISWAP_V3: '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
  PANCAKESWAP_V3: '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
  QUICKSWAP_V3: '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
};

// Get DEX by name
const getDexConfig = (dexName) => {
  const dex = DEX_CONFIG[dexName.toUpperCase()];
  if (!dex) {
    throw new Error(`DEX ${dexName} not supported`);
  }
  return dex;
};

// Get all DEXs for a chain
const getDexsForChain = (chainId) => {
  return Object.values(DEX_CONFIG).filter(dex => dex.chainId === chainId);
};

// Get supported DEX names
const getSupportedDexs = () => {
  return Object.keys(DEX_CONFIG);
};

// Validate DEX configuration
const validateDexConfig = () => {
  const errors = [];

  Object.entries(DEX_CONFIG).forEach(([dexName, config]) => {
    if (!config.factory) {
      errors.push(`${dexName}: Missing factory address`);
    }
    if (!config.router) {
      errors.push(`${dexName}: Missing router address`);
    }
    if (!config.quoter) {
      errors.push(`${dexName}: Missing quoter address`);
    }
    if (!config.chainId) {
      errors.push(`${dexName}: Missing chain ID`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`DEX Configuration errors:\n${errors.join('\n')}`);
  }
};

export {
  DEX_CONFIG,
  POOL_INIT_CODE_HASHES,
  getDexConfig,
  getDexsForChain,
  getSupportedDexs,
  validateDexConfig
};
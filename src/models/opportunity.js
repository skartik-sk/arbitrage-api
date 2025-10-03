import mongoose from 'mongoose';

const opportunitySchema = new mongoose.Schema({
  // Unique identifier
  id: {
    type: String,
    required: true,
    unique: true,
    default: () => new mongoose.Types.ObjectId().toString()
  },

  // Timestamps
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },

  // DEX Information
  dexA: {
    type: String,
    required: true,
    enum: ['UNISWAP', 'SUSHISWAP', 'PANCAKESWAP', 'QUICKSWAP', 'UNISWAP_V3', 'SUSHISWAP_V2']
  },
  dexB: {
    type: String,
    required: true,
    enum: ['UNISWAP', 'SUSHISWAP', 'PANCAKESWAP', 'QUICKSWAP', 'UNISWAP_V3', 'SUSHISWAP_V2']
  },

  // Token Information
  tokenIn: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid token address format'
    }
  },
  tokenOut: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid token address format'
    }
  },

  // Trade amounts
  amountIn: {
    type: String,
    required: true
  },
  amountOutExpected: {
    type: String,
    required: true
  },

  // Price information
  priceA: {
    type: String,
    required: true
  },
  priceB: {
    type: String,
    required: true
  },
  priceDifference: {
    type: Number,
    required: true
  },

  // Detailed Profit Information
  expectedProfit: {
    type: String,
    required: true
  },
  expectedProfitUSD: {
    type: Number,
    required: true,
    default: 0
  },
  profitPercentage: {
    type: Number,
    required: true
  },
  grossProfitUSD: {
    type: Number,
    required: true,
    default: 0
  },
  netProfitUSD: {
    type: Number,
    required: true,
    default: 0
  },
  profitAfterFeesUSD: {
    type: Number,
    required: true,
    default: 0
  },

  // Fee information (detailed breakdown)
  gasEstimate: {
    type: String,
    required: true
  },
  gasPrice: {
    type: String,
    required: true
  },
  gasCostUSD: {
    type: Number,
    required: true,
    default: 0
  },
  swapFees: {
    type: String,
    required: true
  },
  swapFeesUSD: {
    type: Number,
    required: true,
    default: 0
  },
  totalFees: {
    type: String,
    required: true
  },
  totalFeesUSD: {
    type: Number,
    required: true,
    default: 0
  },

  // Pool information (real-time data)
  poolA: {
    type: String,
    required: true
  },
  poolB: {
    type: String,
    required: true
  },
  liquidityA: {
    type: String,
    required: true
  },
  liquidityB: {
    type: String,
    required: true
  },
  liquidityAUSD: {
    type: Number,
    required: false,
    default: 0
  },
  liquidityBUSD: {
    type: Number,
    required: false,
    default: 0
  },
  
  // Real-time blockchain data
  blockNumber: {
    type: Number,
    required: true
  },
  blockTimestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  // Token symbols for readability
  tokenInSymbol: {
    type: String,
    required: true
  },
  tokenOutSymbol: {
    type: String,
    required: true
  },
  
  // Trade size information
  tradeSizeUSD: {
    type: Number,
    required: true,
    default: 1000
  },

  // Status tracking
  status: {
    type: String,
    required: true,
    enum: ['detected', 'simulated', 'profitable', 'unprofitable', 'expired', 'executed', 'failed'],
    default: 'detected'
  },

  // Simulation results
  simulationResult: {
    success: { type: Boolean, required: false },
    actualOutput: { type: String, required: false },
    gasUsed: { type: String, required: false },
    errorMessage: { type: String, required: false },
    simulationTimestamp: { type: Date, required: false }
  },

  // Execution details (if trade was executed)
  executionResult: {
    transactionHash: { type: String, required: false },
    actualProfit: { type: String, required: false },
    gasUsed: { type: String, required: false },
    executionTimestamp: { type: Date, required: false },
    errorMessage: { type: String, required: false }
  },

  // Triangular arbitrage path (if applicable)
  triangularPath: [{
    dex: String,
    tokenIn: String,
    tokenOut: String,
    pool: String,
    amount: String
  }],

  // Metadata
  metadata: {
    chainId: { type: Number, required: true },
    feeTier: { type: Number, required: false },
    slippageTolerance: { type: Number, required: false },
    priceImpact: { type: Number, required: false },
    blockNumber: { type: Number, required: false }
  }
}, {
  // Add index for better query performance
  index: true,
  timestamps: true
});

// Indexes for performance
opportunitySchema.index({ timestamp: -1 });
opportunitySchema.index({ status: 1, timestamp: -1 });
opportunitySchema.index({ dexA: 1, dexB: 1, timestamp: -1 });
opportunitySchema.index({ tokenIn: 1, tokenOut: 1, timestamp: -1 });
opportunitySchema.index({ profitPercentage: -1 });
opportunitySchema.index({ 'expectedProfit': -1 });

// Static methods
opportunitySchema.statics.findProfitableOpportunities = function() {
  return this.find({
    status: 'profitable',
    timestamp: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
  }).sort({ profitPercentage: -1 });
};

opportunitySchema.statics.findByTokenPair = function(tokenIn, tokenOut) {
  return this.find({
    $or: [
      { tokenIn, tokenOut },
      { tokenIn: tokenOut, tokenOut: tokenIn }
    ]
  }).sort({ timestamp: -1 });
};

opportunitySchema.statics.getStats = function(timeRange = 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - timeRange);

  return this.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalOpportunities: { $sum: 1 },
        profitableOpportunities: {
          $sum: { $cond: [{ $eq: ['$status', 'profitable'] }, 1, 0] }
        },
        executedTrades: {
          $sum: { $cond: [{ $eq: ['$status', 'executed'] }, 1, 0] }
        },
        avgProfitPercentage: { $avg: '$profitPercentage' },
        maxProfitPercentage: { $max: '$profitPercentage' },
        totalExpectedProfit: { $sum: '$expectedProfit' }
      }
    }
  ]);
};

// Instance methods
opportunitySchema.methods.markAsSimulated = function(simulationResult) {
  this.status = simulationResult.success ? 'profitable' : 'unprofitable';
  this.simulationResult = simulationResult;
  this.simulationTimestamp = new Date();
  return this.save();
};

opportunitySchema.methods.markAsExecuted = function(executionResult) {
  this.status = executionResult.transactionHash ? 'executed' : 'failed';
  this.executionResult = executionResult;
  this.executionTimestamp = new Date();
  return this.save();
};

opportunitySchema.methods.isExpired = function(maxAgeMinutes = 5) {
  const now = new Date();
  const ageMinutes = (now - this.timestamp) / (1000 * 60);
  return ageMinutes > maxAgeMinutes;
};

// Virtual fields
opportunitySchema.virtual('isProfitable').get(function() {
  return this.status === 'profitable' && parseFloat(this.expectedProfit) > 0;
});

opportunitySchema.virtual('ageMinutes').get(function() {
  const now = new Date();
  return (now - this.timestamp) / (1000 * 60);
});

// Ensure virtuals are included in JSON output
opportunitySchema.set('toJSON', { virtuals: true });
opportunitySchema.set('toObject', { virtuals: true });

const Opportunity = mongoose.model('Opportunity', opportunitySchema);

export default Opportunity;
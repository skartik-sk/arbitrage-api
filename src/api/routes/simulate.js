import express from 'express';
import Joi from 'joi';
import tradeSimulator from '../../services/trade-simulator/index.js';
import profitCalculator from '../../services/profit-calculator/index.js';
import arbitrageDetector from '../../services/arbitrage-detector/index.js';
import Opportunity from '../../models/opportunity.js';
import { logError } from '../../utils/logger.js';

const router = express.Router();

// Validation schemas
const simulationSchema = Joi.object({
  opportunityId: Joi.string().required(),
  tradeAmount: Joi.number().positive().min(1).max(100000).required(),
  slippage: Joi.number().min(0).max(5).default(0.5) // 0-5% slippage
});

const batchSimulationSchema = Joi.object({
  opportunities: Joi.array().items(
    Joi.object({
      opportunityId: Joi.string().required(),
      tradeAmount: Joi.number().positive().min(1).max(100000).required()
    })
  ).min(1).max(10).required(), // Max 10 simulations at once
  slippage: Joi.number().min(0).max(5).default(0.5)
});

// Simulate a specific opportunity
router.post('/opportunity', async (req, res) => {
  try {
    const { error, value } = simulationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { opportunityId, tradeAmount, slippage } = value;

    // Find the opportunity
    const opportunity = await Opportunity.findOne({ id: opportunityId });
    if (!opportunity) {
      return res.status(404).json({
        success: false,
        error: 'Opportunity not found',
        message: `No opportunity found with ID: ${opportunityId}`
      });
    }

    // Check if opportunity is still valid (not too old)
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - opportunity.timestamp.getTime() > maxAge) {
      return res.status(400).json({
        success: false,
        error: 'Opportunity expired',
        message: 'This opportunity is too old to simulate'
      });
    }

    // Run simulation with slippage
    let simulationResult;
    if (opportunity.triangularPath && opportunity.triangularPath.length > 0) {
      // Triangular arbitrage
      const triangularOpp = {
        id: opportunity.id,
        type: 'triangular',
        path: opportunity.triangularPath.map(p => [p.tokenIn, p.tokenOut]).flat()
          .filter((token, index, arr) => arr.indexOf(token) === index),
        trades: opportunity.triangularPath
      };

      simulationResult = await tradeSimulator.simulateTriangularArbitrage(triangularOpp, tradeAmount);

      if (simulationResult.success && slippage > 0) {
        simulationResult = await tradeSimulator.simulateWithSlippage(
          triangularOpp, tradeAmount, slippage
        );
      }
    } else {
      // Simple arbitrage
      const simpleOpp = {
        id: opportunity.id,
        type: 'simple',
        tokenA: opportunity.tokenIn,
        tokenB: opportunity.tokenOut,
        buyDex: opportunity.dexA,
        sellDex: opportunity.dexB
      };

      simulationResult = await tradeSimulator.simulateSimpleArbitrage(simpleOpp, tradeAmount);

      if (simulationResult.success && slippage > 0) {
        simulationResult = await tradeSimulator.simulateWithSlippage(
          simpleOpp, tradeAmount, slippage
        );
      }
    }

    // Calculate detailed profit analysis
    let profitAnalysis = null;
    if (simulationResult.success) {
      try {
        if (opportunity.triangularPath && opportunity.triangularPath.length > 0) {
          const triangularOpp = {
            type: 'triangular',
            path: opportunity.triangularPath.map(p => [p.tokenIn, p.tokenOut]).flat()
              .filter((token, index, arr) => arr.indexOf(token) === index),
            trades: opportunity.triangularPath
          };
          profitAnalysis = await profitCalculator.calculateTriangularArbitrageProfit(
            triangularOpp, tradeAmount
          );
        } else {
          const simpleOpp = {
            type: 'simple',
            tokenA: opportunity.tokenIn,
            tokenB: opportunity.tokenOut,
            buyDex: opportunity.dexA,
            sellDex: opportunity.dexB
          };
          profitAnalysis = await profitCalculator.calculateSimpleArbitrageProfit(
            simpleOpp, tradeAmount
          );
        }
      } catch (error) {
        logError(error, {
          context: 'SimulationRouter.profitAnalysis',
          opportunityId
        });
      }
    }

    // Update opportunity with simulation result
    await opportunity.markAsSimulated({
      success: simulationResult.success,
      actualOutput: simulationResult.finalAmount || simulationResult.profit,
      gasUsed: simulationResult.totalGasUsed,
      errorMessage: simulationResult.error,
      simulationTimestamp: new Date()
    });

    res.json({
      success: true,
      data: {
        opportunity: {
          id: opportunity.id,
          type: opportunity.triangularPath?.length > 0 ? 'triangular' : 'simple',
          tokenPair: `${opportunity.tokenIn}/${opportunity.tokenOut}`,
          expectedProfit: opportunity.expectedProfit,
          profitPercentage: opportunity.profitPercentage
        },
        simulation: simulationResult,
        profitAnalysis,
        parameters: {
          tradeAmount,
          slippage,
          simulatedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logError(error, {
      context: 'SimulationRouter.simulateOpportunity',
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Simulation failed',
      message: error.message
    });
  }
});

// Batch simulate multiple opportunities
router.post('/batch', async (req, res) => {
  try {
    const { error, value } = batchSimulationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const { opportunities, slippage } = value;
    const results = [];

    for (const opp of opportunities) {
      try {
        // Find the opportunity
        const opportunityDoc = await Opportunity.findOne({ id: opp.opportunityId });
        if (!opportunityDoc) {
          results.push({
            opportunityId: opp.opportunityId,
            success: false,
            error: 'Opportunity not found'
          });
          continue;
        }

        // Check if opportunity is still valid
        const maxAge = 5 * 60 * 1000; // 5 minutes
        if (Date.now() - opportunityDoc.timestamp.getTime() > maxAge) {
          results.push({
            opportunityId: opp.opportunityId,
            success: false,
            error: 'Opportunity expired'
          });
          continue;
        }

        // Run simulation
        let simulationResult;
        if (opportunityDoc.triangularPath && opportunityDoc.triangularPath.length > 0) {
          const triangularOpp = {
            id: opportunityDoc.id,
            type: 'triangular',
            path: opportunityDoc.triangularPath.map(p => [p.tokenIn, p.tokenOut]).flat()
              .filter((token, index, arr) => arr.indexOf(token) === index),
            trades: opportunityDoc.triangularPath
          };
          simulationResult = await tradeSimulator.simulateTriangularArbitrage(
            triangularOpp, opp.tradeAmount
          );
        } else {
          const simpleOpp = {
            id: opportunityDoc.id,
            type: 'simple',
            tokenA: opportunityDoc.tokenIn,
            tokenB: opportunityDoc.tokenOut,
            buyDex: opportunityDoc.dexA,
            sellDex: opportunityDoc.dexB
          };
          simulationResult = await tradeSimulator.simulateSimpleArbitrage(
            simpleOpp, opp.tradeAmount
          );
        }

        // Update opportunity
        if (simulationResult.success) {
          await opportunityDoc.markAsSimulated({
            success: simulationResult.success,
            actualOutput: simulationResult.finalAmount || simulationResult.profit,
            gasUsed: simulationResult.totalGasUsed,
            errorMessage: simulationResult.error,
            simulationTimestamp: new Date()
          });
        }

        results.push({
          opportunityId: opp.opportunityId,
          tradeAmount: opp.tradeAmount,
          success: simulationResult.success,
          simulation: simulationResult,
          simulatedAt: new Date().toISOString()
        });

      } catch (error) {
        logError(error, {
          context: 'SimulationRouter.batchSimulation',
          opportunityId: opp.opportunityId
        });
        results.push({
          opportunityId: opp.opportunityId,
          success: false,
          error: error.message
        });
      }
    }

    // Calculate summary statistics
    const successful = results.filter(r => r.success);
    const profitable = successful.filter(r =>
      r.simulation && (r.simulation.netProfit || r.simulation.profit) > 0
    );

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          successful: successful.length,
          profitable: profitable.length,
          successRate: Math.round((successful.length / results.length) * 100 * 100) / 100,
          profitabilityRate: Math.round((profitable.length / results.length) * 100 * 100) / 100
        },
        parameters: {
          slippage,
          simulatedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logError(error, {
      context: 'SimulationRouter.batchSimulation',
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Batch simulation failed',
      message: error.message
    });
  }
});

// Simulate current live opportunities
router.post('/live', async (req, res) => {
  try {
    const { tradeAmount, slippage = 0.5, maxCount = 5 } = req.body;

    if (!tradeAmount || tradeAmount < 1 || tradeAmount > 100000) {
      return res.status(400).json({
        success: false,
        error: 'Invalid trade amount. Must be between 1 and 100000 USD.'
      });
    }

    // Get current live opportunities
    const liveOpportunities = arbitrageDetector.getAllOpportunities()
      .slice(0, maxCount);

    if (liveOpportunities.length === 0) {
      return res.json({
        success: true,
        data: {
          opportunities: [],
          summary: {
            total: 0,
            successful: 0,
            profitable: 0
          },
          message: 'No live opportunities to simulate'
        }
      });
    }

    const results = [];

    for (const opportunity of liveOpportunities) {
      try {
        let simulationResult;
        if (opportunity.type === 'triangular') {
          simulationResult = await tradeSimulator.simulateTriangularArbitrage(
            opportunity, tradeAmount
          );
        } else {
          simulationResult = await tradeSimulator.simulateSimpleArbitrage(
            opportunity, tradeAmount
          );
        }

        // Apply slippage if specified
        if (simulationResult.success && slippage > 0) {
          simulationResult = await tradeSimulator.simulateWithSlippage(
            opportunity, tradeAmount, slippage
          );
        }

        results.push({
          opportunityId: opportunity.id,
          type: opportunity.type,
          tokenPair: opportunity.tokenA && opportunity.tokenB ?
            `${opportunity.tokenA}/${opportunity.tokenB}` :
            opportunity.path?.join(' -> '),
          success: simulationResult.success,
          simulation: simulationResult
        });

      } catch (error) {
        logError(error, {
          context: 'SimulationRouter.liveSimulation',
          opportunityId: opportunity.id
        });
        results.push({
          opportunityId: opportunity.id,
          success: false,
          error: error.message
        });
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success);
    const profitable = successful.filter(r =>
      r.simulation &&
      (parseFloat(r.simulation.netProfit || r.simulation.profit || 0) > 0)
    );

    res.json({
      success: true,
      data: {
        opportunities: results,
        summary: {
          total: results.length,
          successful: successful.length,
          profitable: profitable.length,
          successRate: Math.round((successful.length / results.length) * 100 * 100) / 100,
          profitabilityRate: Math.round((profitable.length / results.length) * 100 * 100) / 100
        },
        parameters: {
          tradeAmount,
          slippage,
          simulatedAt: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    logError(error, {
      context: 'SimulationRouter.liveSimulation',
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Live simulation failed',
      message: error.message
    });
  }
});

// Get optimal trade size for opportunities
router.post('/optimal-size', async (req, res) => {
  try {
    const { opportunityIds } = req.body;

    if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid opportunity IDs array'
      });
    }

    const results = [];

    for (const opportunityId of opportunityIds) {
      try {
        const opportunity = await Opportunity.findOne({ id: opportunityId });
        if (!opportunity) {
          results.push({
            opportunityId,
            success: false,
            error: 'Opportunity not found'
          });
          continue;
        }

        // Create opportunity object for profit calculator
        let oppForCalc;
        if (opportunity.triangularPath && opportunity.triangularPath.length > 0) {
          oppForCalc = {
            type: 'triangular',
            path: opportunity.triangularPath.map(p => [p.tokenIn, p.tokenOut]).flat()
              .filter((token, index, arr) => arr.indexOf(token) === index),
            trades: opportunity.triangularPath
          };
        } else {
          oppForCalc = {
            type: 'simple',
            tokenA: opportunity.tokenIn,
            tokenB: opportunity.tokenOut,
            buyDex: opportunity.dexA,
            sellDex: opportunity.dexB
          };
        }

        const optimalSize = await profitCalculator.calculateOptimalTradeSize(oppForCalc);
        results.push({
          opportunityId,
          success: true,
          optimalSize
        });

      } catch (error) {
        logError(error, {
          context: 'SimulationRouter.optimalSize',
          opportunityId
        });
        results.push({
          opportunityId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        results,
        calculatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logError(error, {
      context: 'SimulationRouter.optimalSize',
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Optimal size calculation failed',
      message: error.message
    });
  }
});

// Get simulation history/statistics
router.get('/stats', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query; // hours
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    // Get simulation statistics from database
    const simulationStats = await Opportunity.aggregate([
      { $match: {
        timestamp: { $gte: new Date(Date.now() - timeRangeMs) },
        'simulationResult.simulationTimestamp': { $exists: true }
      }},
      {
        $group: {
          _id: null,
          totalSimulations: { $sum: 1 },
          successfulSimulations: {
            $sum: { $cond: ['$simulationResult.success', 1, 0] }
          },
          avgGasUsed: { $avg: { $toDouble: '$simulationResult.gasUsed' } },
          maxGasUsed: { $max: { $toDouble: '$simulationResult.gasUsed' } },
          minGasUsed: { $min: { $toDouble: '$simulationResult.gasUsed' } }
        }
      }
    ]);

    // Get trade simulator cache stats
    const simulatorStats = tradeSimulator.getStats();

    res.json({
      success: true,
      data: {
        database: simulationStats[0] || {
          totalSimulations: 0,
          successfulSimulations: 0,
          avgGasUsed: 0,
          maxGasUsed: 0,
          minGasUsed: 0
        },
        cache: simulatorStats.cache,
        timeRange: `${timeRange} hours`,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logError(error, { context: 'SimulationRouter.stats' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch simulation statistics',
      message: error.message
    });
  }
});

export default router;
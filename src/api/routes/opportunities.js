import express from 'express';
import Opportunity from '../../models/opportunity.js';
import arbitrageDetector from '../../services/arbitrage-detector/index.js';
import { logger, logError } from '../../utils/logger.js';

const router = express.Router();

// Get all opportunities with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      minProfit,
      maxProfit,
      status,
      token,
      type,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    // Filter by minimum profit
    if (minProfit) {
      query.profitPercentage = { $gte: parseFloat(minProfit) };
    }

    // Filter by maximum profit
    if (maxProfit) {
      query.profitPercentage = { ...query.profitPercentage, $lte: parseFloat(maxProfit) };
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by token
    if (token) {
      query.$or = [
        { tokenIn: token },
        { tokenOut: token }
      ];
    }

    // Filter by type
    if (type) {
      if (type === 'simple') {
        query.triangularPath = { $exists: false };
      } else if (type === 'triangular') {
        query.triangularPath = { $exists: true };
      }
    }

    // Only return recent opportunities (last 24 hours)
    query.timestamp = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };

    // Build sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const opportunities = await Opportunity.find(query)
      .sort(sort)
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    // Get total count for pagination
    const total = await Opportunity.countDocuments(query);

    res.json({
      success: true,
      data: opportunities,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total,
        hasMore: parseInt(offset) + parseInt(limit) < total
      },
      filters: {
        minProfit,
        maxProfit,
        status,
        token,
        type
      }
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.getAll' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunities',
      message: error.message
    });
  }
});

// Get specific opportunity by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const opportunity = await Opportunity.findOne({ id });

    if (!opportunity) {
      return res.status(404).json({
        success: false,
        error: 'Opportunity not found',
        message: `No opportunity found with ID: ${id}`
      });
    }

    res.json({
      success: true,
      data: opportunity
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.getById', id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunity',
      message: error.message
    });
  }
});

// Get current opportunities (detected by the running bot)
router.get('/current/live', async (req, res) => {
  try {
    const opportunities = arbitrageDetector.getAllOpportunities();

    res.json({
      success: true,
      data: opportunities,
      count: opportunities.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.getLive' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch live opportunities',
      message: error.message
    });
  }
});

// Get best opportunity
router.get('/current/best', async (req, res) => {
  try {
    const bestOpportunity = arbitrageDetector.getBestOpportunity();

    if (!bestOpportunity) {
      return res.json({
        success: true,
        data: null,
        message: 'No profitable opportunities found'
      });
    }

    res.json({
      success: true,
      data: bestOpportunity
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.getBest' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch best opportunity',
      message: error.message
    });
  }
});

// Get opportunities for specific token pair
router.get('/pair/:tokenA/:tokenB', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const { limit = 20 } = req.query;

    const opportunities = await Opportunity.find({
      $or: [
        { tokenIn: tokenA, tokenOut: tokenB },
        { tokenIn: tokenB, tokenOut: tokenA }
      ],
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
    .sort({ timestamp: -1 })
    .limit(parseInt(limit))
    .lean();

    res.json({
      success: true,
      data: opportunities,
      pair: `${tokenA}/${tokenB}`,
      count: opportunities.length
    });

  } catch (error) {
    logError(error, {
      context: 'OpportunitiesRouter.getByPair',
      tokenA: req.params.tokenA,
      tokenB: req.params.tokenB
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunities for token pair',
      message: error.message
    });
  }
});

// Update opportunity status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, additionalData = {} } = req.body;

    if (!['detected', 'simulated', 'profitable', 'unprofitable', 'expired', 'executed', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
        message: 'Status must be one of: detected, simulated, profitable, unprofitable, expired, executed, failed'
      });
    }

    const opportunity = await Opportunity.findOneAndUpdate(
      { id },
      {
        status,
        ...additionalData,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!opportunity) {
      return res.status(404).json({
        success: false,
        error: 'Opportunity not found',
        message: `No opportunity found with ID: ${id}`
      });
    }

    res.json({
      success: true,
      data: opportunity,
      message: `Opportunity status updated to: ${status}`
    });

  } catch (error) {
    logError(error, {
      context: 'OpportunitiesRouter.updateStatus',
      id: req.params.id,
      body: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update opportunity status',
      message: error.message
    });
  }
});

// Delete old opportunities
router.delete('/cleanup', async (req, res) => {
  try {
    const { maxAgeHours = 24 } = req.query;
    const cutoffDate = new Date(Date.now() - parseInt(maxAgeHours) * 60 * 60 * 1000);

    const result = await Opportunity.deleteMany({
      timestamp: { $lt: cutoffDate },
      status: { $in: ['expired', 'executed', 'failed'] }
    });

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate,
      message: `Cleaned up ${result.deletedCount} old opportunities`
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.cleanup' });
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup opportunities',
      message: error.message
    });
  }
});

// Get opportunity statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const { timeRange = 24 } = req.query; // hours
    const timeRangeMs = parseInt(timeRange) * 60 * 60 * 1000;

    const stats = await Opportunity.getStats(timeRangeMs);

    res.json({
      success: true,
      data: stats,
      timeRange: `${timeRange} hours`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logError(error, { context: 'OpportunitiesRouter.getStats' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunity statistics',
      message: error.message
    });
  }
});

export default router;
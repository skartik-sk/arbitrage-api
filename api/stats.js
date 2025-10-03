import 'dotenv/config';
import dbConnection from '../src/config/database.js';
import { logger } from '../src/utils/logger.js';
import Opportunity from '../src/models/opportunity.js';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Connect to database if not connected
    if (!dbConnection.isConnected) {
      await dbConnection.connect();
    }

    if (!dbConnection.isConnected) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Unable to fetch stats - database connection failed'
      });
    }

    // Get current time windows
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate stats
    const [
      totalOpportunities,
      hourlyStats,
      dailyStats,
      weeklyStats,
      statusStats,
      topPairs,
      dexStats,
      profitStats
    ] = await Promise.all([
      // Total opportunities
      Opportunity.countDocuments(),
      
      // Hourly stats
      Opportunity.aggregate([
        { $match: { timestamp: { $gte: oneHourAgo } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' },
            totalProfit: { $sum: '$expectedProfitUSD' },
            maxProfit: { $max: '$expectedProfitUSD' }
          }
        }
      ]),
      
      // Daily stats
      Opportunity.aggregate([
        { $match: { timestamp: { $gte: oneDayAgo } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' },
            totalProfit: { $sum: '$expectedProfitUSD' },
            maxProfit: { $max: '$expectedProfitUSD' }
          }
        }
      ]),
      
      // Weekly stats
      Opportunity.aggregate([
        { $match: { timestamp: { $gte: oneWeekAgo } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' },
            totalProfit: { $sum: '$expectedProfitUSD' },
            maxProfit: { $max: '$expectedProfitUSD' }
          }
        }
      ]),
      
      // Status breakdown
      Opportunity.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // Top token pairs
      Opportunity.aggregate([
        {
          $group: {
            _id: { tokenIn: '$tokenInSymbol', tokenOut: '$tokenOutSymbol' },
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' },
            totalProfit: { $sum: '$expectedProfitUSD' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // DEX statistics
      Opportunity.aggregate([
        {
          $group: {
            _id: { dexA: '$dexA', dexB: '$dexB' },
            count: { $sum: 1 },
            avgProfit: { $avg: '$expectedProfitUSD' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // Profit distribution
      Opportunity.aggregate([
        {
          $bucket: {
            groupBy: '$expectedProfitUSD',
            boundaries: [0, 1, 5, 10, 25, 50, 100, 500, 1000, 10000],
            default: '10000+',
            output: {
              count: { $sum: 1 },
              avgProfit: { $avg: '$expectedProfitUSD' }
            }
          }
        }
      ])
    ]);

    // Format response
    const stats = {
      overview: {
        totalOpportunities,
        lastUpdated: now.toISOString(),
        uptime: process.uptime()
      },
      timeWindows: {
        lastHour: hourlyStats[0] || { count: 0, avgProfit: 0, totalProfit: 0, maxProfit: 0 },
        last24Hours: dailyStats[0] || { count: 0, avgProfit: 0, totalProfit: 0, maxProfit: 0 },
        lastWeek: weeklyStats[0] || { count: 0, avgProfit: 0, totalProfit: 0, maxProfit: 0 }
      },
      breakdown: {
        byStatus: statusStats.map(stat => ({
          status: stat._id,
          count: stat.count,
          avgProfit: parseFloat(stat.avgProfit?.toFixed(2) || 0)
        })),
        byTokenPair: topPairs.map(pair => ({
          pair: `${pair._id.tokenIn}/${pair._id.tokenOut}`,
          count: pair.count,
          avgProfit: parseFloat(pair.avgProfit?.toFixed(2) || 0),
          totalProfit: parseFloat(pair.totalProfit?.toFixed(2) || 0)
        })),
        byDexRoute: dexStats.map(route => ({
          route: `${route._id.dexA} → ${route._id.dexB}`,
          count: route.count,
          avgProfit: parseFloat(route.avgProfit?.toFixed(2) || 0)
        }))
      },
      profitDistribution: profitStats.map(bucket => ({
        range: bucket._id === '10000+' ? '$10,000+' : `$${bucket._id}-$${bucket._id + (bucket._id < 100 ? 5 : bucket._id < 1000 ? 500 : 5000)}`,
        count: bucket.count,
        avgProfit: parseFloat(bucket.avgProfit?.toFixed(2) || 0)
      })),
      performance: {
        opportunitiesPerHour: hourlyStats[0]?.count || 0,
        opportunitiesPerDay: dailyStats[0]?.count || 0,
        avgProfitPerOpportunity: dailyStats[0]?.avgProfit || 0,
        maxProfitLast24h: dailyStats[0]?.maxProfit || 0
      }
    };

    res.status(200).json(stats);

  } catch (error) {
    logger.error('Stats API error:', error);
    res.status(500).json({
      error: 'Failed to fetch statistics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
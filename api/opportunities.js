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
        message: 'Unable to fetch opportunities - database connection failed'
      });
    }

    // Parse query parameters
    const {
      limit = 50,
      page = 1,
      status,
      tokenPair,
      minProfit,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (tokenPair) {
      const [tokenA, tokenB] = tokenPair.split('/');
      if (tokenA && tokenB) {
        query.$or = [
          { tokenInSymbol: tokenA, tokenOutSymbol: tokenB },
          { tokenInSymbol: tokenB, tokenOutSymbol: tokenA }
        ];
      }
    }
    
    if (minProfit) {
      query.expectedProfitUSD = { $gte: parseFloat(minProfit) };
    }

    // Calculate pagination
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 per page
    const skip = (parseInt(page) - 1) * limitNum;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const [opportunities, total] = await Promise.all([
      Opportunity.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Opportunity.countDocuments(query)
    ]);

    // Add computed fields
    const formattedOpportunities = opportunities.map(opp => ({
      ...opp,
      age: Date.now() - new Date(opp.timestamp).getTime(),
      ageFormatted: formatAge(Date.now() - new Date(opp.timestamp).getTime()),
      profitFormatted: `$${parseFloat(opp.expectedProfitUSD || 0).toFixed(2)}`,
      pairFormatted: `${opp.tokenInSymbol}/${opp.tokenOutSymbol}`,
      dexRoute: `${opp.dexA} → ${opp.dexB}`
    }));

    // Response
    const response = {
      opportunities: formattedOpportunities,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: skip + limitNum < total,
        hasPrev: parseInt(page) > 1
      },
      filters: {
        status,
        tokenPair,
        minProfit,
        sortBy,
        sortOrder
      },
      meta: {
        timestamp: new Date().toISOString(),
        query: req.url,
        totalFound: formattedOpportunities.length
      }
    };

    res.status(200).json(response);

  } catch (error) {
    logger.error('Opportunities API error:', error);
    res.status(500).json({
      error: 'Failed to fetch opportunities',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

function formatAge(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  return `${seconds}s ago`;
}
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

  try {
    // Connect to database if not connected
    if (!dbConnection.isConnected) {
      await dbConnection.connect();
    }

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: dbConnection.isConnected ? 'connected' : 'disconnected',
        api: 'operational'
      },
      endpoints: {
        opportunities: '/api/opportunities',
        stats: '/api/stats', 
        simulate: '/api/simulate',
        health: '/api/health'
      }
    };

    // Add database stats if connected
    if (dbConnection.isConnected) {
      try {
        const totalOpportunities = await Opportunity.countDocuments();
        const recentOpportunities = await Opportunity.countDocuments({
          timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });

        healthData.database = {
          status: 'connected',
          totalOpportunities,
          recentOpportunities,
          collections: ['opportunities']
        };
      } catch (dbError) {
        healthData.database = {
          status: 'error',
          error: dbError.message
        };
      }
    }

    res.status(200).json(healthData);

  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
      services: {
        database: 'error',
        api: 'operational'
      }
    });
  }
}
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Create Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'arbitrage-bot' },
  transports: [
    // Write all logs with importance level of 'error' or less to 'error.log'
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),

    // Write all logs with importance level of 'info' or less to 'combined.log'
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),

    // Write arbitrage-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'arbitrage.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// If we're not in production, log to the console with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
          msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
      })
    )
  }));
}

// Helper functions for structured logging
const logArbitrageOpportunity = (opportunity) => {
  logger.info('Arbitrage opportunity detected', {
    type: 'ARBITRAGE_OPPORTUNITY',
    data: opportunity
  });
};

const logTradeExecution = (trade) => {
  logger.info('Trade executed', {
    type: 'TRADE_EXECUTION',
    data: trade
  });
};

const logError = (error, context = {}) => {
  logger.error('Error occurred', {
    type: 'ERROR',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    context
  });
};

const logPriceUpdate = (dex, tokenPair, price) => {
  logger.debug('Price updated', {
    type: 'PRICE_UPDATE',
    dex,
    tokenPair,
    price: price.toString()
  });
};

const logPoolDiscovery = (dex, poolAddress, tokens) => {
  logger.info('Pool discovered', {
    type: 'POOL_DISCOVERY',
    dex,
    poolAddress,
    tokens
  });
};

const logGasUpdate = (gasPrice) => {
  logger.info('Gas price updated', {
    type: 'GAS_UPDATE',
    gasPrice: gasPrice.toString()
  });
};

export {
  logger,
  logArbitrageOpportunity,
  logTradeExecution,
  logError,
  logPriceUpdate,
  logPoolDiscovery,
  logGasUpdate
};
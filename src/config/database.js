import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

class DatabaseConnection {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.connectionString = process.env.DATABASE_URL || 'mongodb://localhost:27017/arbitrage';
    this.dbName = process.env.DATABASE_NAME || 'arbitrage';
  }

  async connect() {
    try {
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        family: 4, // Use IPv4, skip trying IPv6
      };

      this.connection = await mongoose.connect(this.connectionString, options);
      this.isConnected = true;

      logger.info(`Connected to MongoDB: ${this.dbName}`);

      // Set up connection event handlers
      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
        this.isConnected = true;
      });

      return this.connection;
    } catch (error) {
      logger.warn('MongoDB connection failed, continuing without database:', error.message);
      this.isConnected = false;
      // Don't throw error - allow bot to run without database
      return null;
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close();
        this.connection = null;
        this.isConnected = false;
        logger.info('Disconnected from MongoDB');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      if (!this.connection) {
        return { status: 'disconnected', message: 'No connection established' };
      }

      await mongoose.connection.db.admin().ping();
      return {
        status: 'connected',
        database: this.dbName,
        readyState: mongoose.connection.readyState
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      dbName: this.dbName,
      host: mongoose.connection.host,
      port: mongoose.connection.port
    };
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

export default dbConnection;
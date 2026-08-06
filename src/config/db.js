const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Prefer 127.0.0.1 over localhost so Node does not try ::1 (IPv6) first
 * when MongoDB is only bound to IPv4 on Windows.
 */
const normalizeMongoUri = (uri) => {
  if (!uri || typeof uri !== 'string') return uri;
  return uri
    .replace('mongodb://localhost', 'mongodb://127.0.0.1')
    .replace('mongodb+srv://localhost', 'mongodb+srv://127.0.0.1');
};

const connectWithUri = async (uri) => {
  const conn = await mongoose.connect(uri, {
    maxPoolSize: 20,
    minPoolSize: 1,
    // family 4 = IPv4 TCP only (avoids ECONNREFUSED on ::1)
    family: 4,
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 4000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 10000,
  });
  return conn;
};

/**
 * Local-dev fallback when Docker / system MongoDB is not running.
 * Uses a single-node replica set so multi-document wallet transactions work.
 */
const startMemoryMongo = async () => {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await replSet.waitUntilRunning();
  const uri = `${replSet.getUri()}astroverse`;
  global.__ASTROVERSE_MEMORY_MONGO__ = replSet;
  logger.warn(`Using in-memory MongoDB replica set (dev only): ${uri}`);
  return uri;
};

const attachConnectionListeners = () => {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB error: ${err.message}`);
  });
};

const connectDB = async (retries = 2, delayMs = 800) => {
  mongoose.set('strictQuery', true);
  mongoose.set('bufferCommands', false);

  let uri = normalizeMongoUri(config.mongodb.uri);
  const allowMemoryFallback =
    config.env !== 'production' && process.env.USE_MEMORY_MONGO !== 'false';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const conn = await connectWithUri(uri);
      logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      attachConnectionListeners();
      return conn;
    } catch (error) {
      logger.error(
        `MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}`
      );
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  if (allowMemoryFallback) {
    try {
      uri = await startMemoryMongo();
      const conn = await connectWithUri(uri);
      logger.info(`MongoDB (memory) ready: ${conn.connection.host}/${conn.connection.name}`);
      attachConnectionListeners();
      return conn;
    } catch (memErr) {
      logger.error(`In-memory MongoDB failed: ${memErr.message}`);
    }
  }

  logger.error(
    'Could not connect to MongoDB.\n' +
      '  Option A: Start Docker Desktop, then:\n' +
      '    docker run -d --name astroverse-mongo -p 27017:27017 mongo:7\n' +
      '  Option B: Install MongoDB Community and start the service\n' +
      `  Configured URI: ${normalizeMongoUri(config.mongodb.uri)}`
  );
  process.exit(1);
  return null;
};

module.exports = connectDB;

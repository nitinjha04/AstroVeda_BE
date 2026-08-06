const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

let redisClient = null;
let usingMemory = false;

const createMemoryRedis = () => {
  // Needed on Render free when no Redis is attached
  // eslint-disable-next-line global-require
  const RedisMock = require('ioredis-mock');
  const mock = new RedisMock();
  usingMemory = true;
  logger.warn('Redis: using in-memory mock (set REDIS_URL for real Redis / Upstash)');
  return mock;
};

const getRedis = () => {
  if (redisClient) return redisClient;

  // Prefer REDIS_URL (Upstash, Redis Cloud, Render Redis)
  if (config.redis.url) {
    try {
      redisClient = new Redis(config.redis.url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
        connectTimeout: 5000,
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
      });
      redisClient.on('connect', () => logger.info('Redis connected (URL)'));
      redisClient.on('error', (err) => logger.warn(`Redis: ${err.message}`));
      return redisClient;
    } catch (err) {
      logger.warn(`Redis URL connect failed: ${err.message}`);
      if (config.redis.allowInMemory) {
        redisClient = createMemoryRedis();
        return redisClient;
      }
      throw err;
    }
  }

  try {
    redisClient = new Redis({
      host: config.redis.host === 'localhost' ? '127.0.0.1' : config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 2000,
      retryStrategy: (times) => {
        if (times > 2) {
          if (config.redis.allowInMemory && !usingMemory) {
            logger.warn('Redis unreachable – using in-memory mock');
            try {
              redisClient.disconnect();
            } catch {
              /* ignore */
            }
            redisClient = createMemoryRedis();
          }
          return null;
        }
        return Math.min(times * 200, 1000);
      },
    });

    redisClient.on('connect', () => {
      if (!usingMemory) logger.info('Redis connected');
    });
    redisClient.on('error', (err) => {
      if (!usingMemory) logger.warn(`Redis: ${err.message}`);
    });

    redisClient.connect().catch(() => {
      if (config.redis.allowInMemory) {
        redisClient = createMemoryRedis();
      }
    });
  } catch (err) {
    if (config.redis.allowInMemory) {
      redisClient = createMemoryRedis();
    } else {
      throw err;
    }
  }

  return redisClient;
};

const cacheGet = async (key) => {
  try {
    const data = await getRedis().get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const cacheSet = async (key, value, ttlSeconds = 300) => {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn(`Cache set failed: ${err.message}`);
  }
};

const cacheDel = async (key) => {
  try {
    await getRedis().del(key);
  } catch (err) {
    logger.warn(`Cache del failed: ${err.message}`);
  }
};

const cacheDelPattern = async (pattern) => {
  try {
    const redis = getRedis();
    if (typeof redis.scanStream !== 'function') return;
    const stream = redis.scanStream({ match: pattern, count: 100 });
    const pipeline = redis.pipeline();
    stream.on('data', (keys) => {
      keys.forEach((k) => pipeline.del(k));
    });
    await new Promise((resolve, reject) => {
      stream.on('end', async () => {
        try {
          await pipeline.exec();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      stream.on('error', reject);
    });
  } catch (err) {
    logger.warn(`Cache pattern del failed: ${err.message}`);
  }
};

module.exports = { getRedis, cacheGet, cacheSet, cacheDel, cacheDelPattern };

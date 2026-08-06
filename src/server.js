const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const config = require('./config');
const connectDB = require('./config/db');
const { getRedis } = require('./config/redis');
const { initSockets } = require('./sockets');
const { startWorkers } = require('./jobs/workers');
const { startCronJobs } = require('./cron');
const { seedDatabase } = require('./utils/seed');
const logger = require('./utils/logger');

const start = async () => {
  await connectDB();

  try {
    getRedis();
  } catch (err) {
    logger.warn(`Redis init warning: ${err.message}`);
  }

  await seedDatabase();

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    // Render free / proxies
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    // path default /socket.io – matches FE socket client
  });

  app.set('io', io);
  initSockets(io);
  startCronJobs(io);

  try {
    startWorkers();
  } catch (err) {
    logger.warn(`Workers skipped: ${err.message}`);
  }

  // Render requires binding to 0.0.0.0 and process.env.PORT
  server.listen(config.port, config.host, () => {
    logger.info(
      `${config.appName} API listening on ${config.host}:${config.port} [${config.env}]`
    );
    logger.info(`CORS origins: ${config.corsOrigins.join(', ')}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received – shutting down gracefully`);
    server.close(() => {
      process.exit(0);
    });
    // Force exit if Render kills slowly
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  logger.error(`Failed to start: ${err.message}`);
  process.exit(1);
});

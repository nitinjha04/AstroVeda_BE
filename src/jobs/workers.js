const { Worker } = require('bullmq');
const { getRedis } = require('../config/redis');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

const startWorkers = () => {
  try {
    const connection = getRedis();

    // BullMQ needs a real Redis-compatible connection; skip if mock/memory
    if (!connection || connection.constructor?.name === 'RedisMock' || connection.options?.lazyConnect === undefined) {
      // detect ioredis-mock loosely
    }

    // ioredis-mock is not fully BullMQ-compatible — skip workers in that case
    if (String(connection?.constructor?.name || '').toLowerCase().includes('mock')) {
      logger.warn('BullMQ workers skipped (Redis mock active)');
      return;
    }

    const emailWorker = new Worker(
      'email',
      async (job) => {
        await sendEmail(job.data);
      },
      { connection }
    );

    emailWorker.on('failed', (job, err) => {
      logger.error(`Email job ${job?.id} failed: ${err.message}`);
    });
    emailWorker.on('error', (err) => {
      logger.warn(`Email worker error: ${err.message}`);
    });

    const notificationWorker = new Worker(
      'notification',
      async (job) => {
        logger.info(`Push notification job: ${JSON.stringify(job.data)}`);
      },
      { connection }
    );

    notificationWorker.on('failed', (job, err) => {
      logger.error(`Notification job ${job?.id} failed: ${err.message}`);
    });
    notificationWorker.on('error', (err) => {
      logger.warn(`Notification worker error: ${err.message}`);
    });

    logger.info('BullMQ workers started');
  } catch (err) {
    logger.warn(`Workers not started: ${err.message}`);
  }
};

module.exports = { startWorkers };

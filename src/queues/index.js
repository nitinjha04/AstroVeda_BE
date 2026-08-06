const { Queue } = require('bullmq');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

let emailQueue = null;
let notificationQueue = null;
let queuesDisabled = false;

const canUseBullMq = (redis) => {
  if (!redis) return false;
  const name = String(redis.constructor?.name || '');
  if (name.toLowerCase().includes('mock')) return false;
  return true;
};

const getEmailQueue = () => {
  if (queuesDisabled) return null;
  if (!emailQueue) {
    const connection = getRedis();
    if (!canUseBullMq(connection)) {
      queuesDisabled = true;
      return null;
    }
    emailQueue = new Queue('email', { connection });
  }
  return emailQueue;
};

const getNotificationQueue = () => {
  if (queuesDisabled) return null;
  if (!notificationQueue) {
    const connection = getRedis();
    if (!canUseBullMq(connection)) {
      queuesDisabled = true;
      return null;
    }
    notificationQueue = new Queue('notification', { connection });
  }
  return notificationQueue;
};

const enqueueEmail = async (payload) => {
  try {
    const queue = getEmailQueue();
    if (!queue) {
      const { sendEmail } = require('../utils/email');
      await sendEmail(payload);
      return;
    }
    await queue.add('send-email', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  } catch (err) {
    logger.warn(`Email queue unavailable: ${err.message}`);
  }
};

const enqueueNotification = async (payload) => {
  try {
    const queue = getNotificationQueue();
    if (!queue) return;
    await queue.add('push-notification', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  } catch (err) {
    logger.warn(`Notification queue unavailable: ${err.message}`);
  }
};

module.exports = { getEmailQueue, getNotificationQueue, enqueueEmail, enqueueNotification };

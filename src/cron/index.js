const { ChatRoom } = require('../models');
const chatService = require('../services/chat.service');
const { CHAT_STATUS } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Expire pending chat requests older than timeout.
 * Safety-net billing for active chats if socket timer missed.
 */
const startCronJobs = (io) => {
  // Every 60s
  setInterval(async () => {
    try {
      const timeoutMs = 2 * 60 * 1000;
      const cutoff = new Date(Date.now() - timeoutMs);
      const expired = await ChatRoom.find({
        status: CHAT_STATUS.PENDING,
        createdAt: { $lt: cutoff },
      });

      for (const room of expired) {
        room.status = CHAT_STATUS.EXPIRED;
        room.endedAt = new Date();
        room.endedBy = 'system';
        room.endReason = 'Request timed out';
        await room.save();
        if (io) {
          io.to(`user:${room.customer}`).emit('chat:expired', { chatRoomId: room._id });
        }
      }

      // Safety billing: active rooms without recent deduction
      const stale = await ChatRoom.find({
        status: CHAT_STATUS.ACTIVE,
        lastDeductionAt: { $lt: new Date(Date.now() - 65 * 1000) },
      });
      for (const room of stale) {
        await chatService.deductMinute(room._id, io);
      }
    } catch (err) {
      logger.error(`Cron error: ${err.message}`);
    }
  }, 60 * 1000);

  logger.info('Cron jobs started');
};

module.exports = { startCronJobs };

const { verifyAccessToken } = require('../utils/tokens');
const { User, ChatRoom } = require('../models');
const chatService = require('../services/chat.service');
const logger = require('../utils/logger');
const { CHAT_STATUS } = require('../utils/constants');

/** Active chat billing timers: chatRoomId -> interval */
const billingTimers = new Map();

const startBillingTimer = (io, chatRoomId) => {
  if (billingTimers.has(chatRoomId)) return;

  // Emit second-level timer ticks; debit every 60s
  let seconds = 0;
  const interval = setInterval(async () => {
    seconds += 1;
    try {
      const room = await ChatRoom.findById(chatRoomId);
      if (!room || room.status !== CHAT_STATUS.ACTIVE) {
        stopBillingTimer(chatRoomId);
        return;
      }

      const durationSeconds = room.startedAt
        ? Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000)
        : seconds;

      io.to(`chat:${chatRoomId}`).emit('timer:tick', {
        chatRoomId,
        durationSeconds,
        billedMinutes: room.billedMinutes,
        pricePerMinute: room.pricePerMinute,
      });

      if (seconds % 60 === 0) {
        await chatService.deductMinute(chatRoomId, io);
      }
    } catch (err) {
      logger.error(`Billing timer error ${chatRoomId}: ${err.message}`);
    }
  }, 1000);

  billingTimers.set(chatRoomId, interval);
};

const stopBillingTimer = (chatRoomId) => {
  const t = billingTimers.get(chatRoomId);
  if (t) {
    clearInterval(t);
    billingTimers.delete(chatRoomId);
  }
};

const initSockets = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.id);
      if (!user || !user.isActive || user.isBlocked) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    socket.join(`user:${userId}`);
    logger.debug(`Socket connected: ${userId}`);

    socket.on('chat:join', async ({ chatRoomId }) => {
      try {
        const room = await ChatRoom.findById(chatRoomId);
        if (!room) return;
        const allowed =
          room.customer.toString() === userId ||
          room.astrologerUser?.toString() === userId;
        if (!allowed) return;

        socket.join(`chat:${chatRoomId}`);
        socket.emit('chat:joined', { chatRoomId });

        if (room.status === CHAT_STATUS.ACTIVE) {
          startBillingTimer(io, chatRoomId);
        }
      } catch (err) {
        logger.error(`chat:join error: ${err.message}`);
      }
    });

    socket.on('chat:leave', ({ chatRoomId }) => {
      socket.leave(`chat:${chatRoomId}`);
    });

    socket.on('message:send', async ({ chatRoomId, content, contentType }) => {
      try {
        const role = socket.user.role === 'astrologer' ? 'astrologer' : 'customer';
        const result = await chatService.sendMessage({
          chatRoomId,
          senderId: socket.user._id,
          senderRole: role,
          content,
          contentType,
          onCustomerMessage: (message) => {
            io.to(`chat:${chatRoomId}`).emit('message:new', message);
          },
          onAiThinking: () => {
            io.to(`chat:${chatRoomId}`).emit('ai:thinking', { chatRoomId });
          },
        });

        // Customer message already emitted in onCustomerMessage when callbacks used
        if (result.aiReply) {
          io.to(`chat:${chatRoomId}`).emit('message:new', result.aiReply);
          io.to(`chat:${chatRoomId}`).emit('ai:done', { chatRoomId });
        } else if (role === 'astrologer') {
          io.to(`chat:${chatRoomId}`).emit('message:new', result.message);
        }
      } catch (err) {
        socket.emit('error:message', { message: err.message });
        socket.emit('ai:done', {});
      }
    });

    socket.on('typing:start', ({ chatRoomId }) => {
      socket.to(`chat:${chatRoomId}`).emit('typing:start', { userId, chatRoomId });
    });

    socket.on('typing:stop', ({ chatRoomId }) => {
      socket.to(`chat:${chatRoomId}`).emit('typing:stop', { userId, chatRoomId });
    });

    socket.on('message:seen', async ({ chatRoomId, messageId }) => {
      const { Message } = require('../models');
      await Message.findByIdAndUpdate(messageId, { status: 'seen', seenAt: new Date() });
      socket.to(`chat:${chatRoomId}`).emit('message:seen', { messageId, chatRoomId });
    });

    socket.on('message:delivered', async ({ chatRoomId, messageId }) => {
      const { Message } = require('../models');
      await Message.findByIdAndUpdate(messageId, { status: 'delivered', deliveredAt: new Date() });
      socket.to(`chat:${chatRoomId}`).emit('message:delivered', { messageId, chatRoomId });
    });

    socket.on('chat:end', async ({ chatRoomId, reason }) => {
      try {
        const endedBy = socket.user.role === 'astrologer' ? 'astrologer' : 'customer';
        await chatService.endChat(chatRoomId, { endedBy, endReason: reason || 'Ended via socket', io });
        stopBillingTimer(chatRoomId);
      } catch (err) {
        socket.emit('error:message', { message: err.message });
      }
    });

    socket.on('chat:request:notify', ({ astrologerUserId, chatRoomId }) => {
      io.to(`user:${astrologerUserId}`).emit('chat:request', { chatRoomId });
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${userId}`);
    });
  });

  // Expose helpers for HTTP controllers
  io.startBillingTimer = (chatRoomId) => startBillingTimer(io, chatRoomId);
  io.stopBillingTimer = stopBillingTimer;
};

module.exports = { initSockets, startBillingTimer, stopBillingTimer };

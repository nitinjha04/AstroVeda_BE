const { verifyAccessToken } = require('../utils/tokens');
const { User, ChatRoom } = require('../models');
const chatService = require('../services/chat.service');
const logger = require('../utils/logger');
const { CHAT_STATUS, CHAT_TYPE } = require('../utils/constants');

/** Active chat billing timers: chatRoomId -> interval */
const billingTimers = new Map();

/** userId -> timeout handle after disconnect (grace before ending sessions) */
const disconnectGraceTimers = new Map();

/** Grace so brief reconnect flickers do not end paid sessions instantly */
const DISCONNECT_GRACE_MS = 8_000;

const startBillingTimer = (io, chatRoomId) => {
  if (billingTimers.has(chatRoomId)) return;

  const interval = setInterval(async () => {
    try {
      const room = await ChatRoom.findById(chatRoomId);
      if (!room || room.status !== CHAT_STATUS.ACTIVE) {
        stopBillingTimer(chatRoomId);
        return;
      }

      const durationSeconds = room.startedAt
        ? Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000)
        : 0;

      io.to(`chat:${chatRoomId}`).emit('timer:tick', {
        chatRoomId,
        durationSeconds,
        billedMinutes: room.billedMinutes,
        pricePerMinute: room.pricePerMinute,
      });
      io.to(`user:${room.customer}`).emit('timer:tick', {
        chatRoomId,
        durationSeconds,
        billedMinutes: room.billedMinutes,
        pricePerMinute: room.pricePerMinute,
      });

      const last = room.lastDeductionAt ? new Date(room.lastDeductionAt).getTime() : 0;
      if (Date.now() - last >= 60_000) {
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

const clearDisconnectGrace = (userId) => {
  const t = disconnectGraceTimers.get(userId);
  if (t) {
    clearTimeout(t);
    disconnectGraceTimers.delete(userId);
  }
};

const scheduleEndOnDisconnect = (io, userId, reason) => {
  clearDisconnectGrace(userId);
  const timer = setTimeout(async () => {
    disconnectGraceTimers.delete(userId);
    try {
      const remaining = await io.in(`user:${userId}`).fetchSockets();
      if (remaining.length > 0) {
        logger.debug(`Skip auto-end for ${userId}: socket reconnected`);
        return;
      }

      const ended = await chatService.endActiveChatsForUser(userId, {
        io,
        endReason: reason || 'Socket disconnected — session ended automatically',
        types: [CHAT_TYPE.AI],
      });
      if (ended?.length) {
        logger.info(`Auto-ended ${ended.length} AI chat(s) after socket disconnect user=${userId}`);
        for (const room of ended) {
          stopBillingTimer(String(room._id));
          io.to(`user:${userId}`).emit('chat:auto-ended', {
            chatRoomId: room._id,
            reason: room.endReason,
          });
        }
      }
    } catch (err) {
      logger.error(`Disconnect auto-end failed for ${userId}: ${err.message}`);
    }
  }, DISCONNECT_GRACE_MS);
  disconnectGraceTimers.set(userId, timer);
};

const initSockets = (io) => {
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
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
    socket.data.activeChatRoomId = null;
    clearDisconnectGrace(userId);
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
        socket.data.activeChatRoomId = String(chatRoomId);
        socket.emit('chat:joined', { chatRoomId });

        if (room.status === CHAT_STATUS.ACTIVE) {
          startBillingTimer(io, chatRoomId);
        }
      } catch (err) {
        logger.error(`chat:join error: ${err.message}`);
      }
    });

    socket.on('presence:active', async ({ chatRoomId }) => {
      try {
        const room = await ChatRoom.findById(chatRoomId);
        if (!room || room.customer.toString() !== userId) return;
        if (room.status !== CHAT_STATUS.ACTIVE) return;
        socket.data.activeChatRoomId = String(chatRoomId);
        socket.join(`chat:${chatRoomId}`);
        startBillingTimer(io, chatRoomId);
      } catch (err) {
        logger.error(`presence:active error: ${err.message}`);
      }
    });

    socket.on('presence:idle', ({ chatRoomId }) => {
      if (chatRoomId && String(socket.data.activeChatRoomId) === String(chatRoomId)) {
        socket.data.activeChatRoomId = null;
      }
    });

    socket.on('chat:leave', ({ chatRoomId }) => {
      socket.leave(`chat:${chatRoomId}`);
      if (String(socket.data.activeChatRoomId) === String(chatRoomId)) {
        socket.data.activeChatRoomId = null;
      }
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
        await chatService.endChat(chatRoomId, {
          endedBy: socket.user.role === 'astrologer' ? 'astrologer' : 'customer',
          endReason: reason || 'Ended by user',
          io,
        });
        stopBillingTimer(chatRoomId);
        socket.data.activeChatRoomId = null;
      } catch (err) {
        socket.emit('error:message', { message: err.message });
      }
    });

    socket.on('chat:request:notify', ({ astrologerUserId, chatRoomId }) => {
      io.to(`user:${astrologerUserId}`).emit('chat:request', { chatRoomId });
    });

    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${userId} (${reason})`);
      // Only auto-end for customers (AI billing sessions)
      if (socket.user.role === 'customer' || socket.user.role === 'admin') {
        scheduleEndOnDisconnect(
          io,
          userId,
          `Network/socket disconnected (${reason}) — chat ended automatically`
        );
      }
    });
  });

  io.startBillingTimer = (chatRoomId) => startBillingTimer(io, chatRoomId);
  io.stopBillingTimer = stopBillingTimer;
};

module.exports = { initSockets, startBillingTimer, stopBillingTimer };

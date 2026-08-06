const mongoose = require('mongoose');
const {
  ChatRoom,
  Message,
  AIChat,
  Astrologer,
  Notification,
} = require('../models');
const AppError = require('../utils/AppError');
const { CHAT_TYPE, CHAT_STATUS, WALLET_TX_TYPE, ASTROLOGER_STATUS } = require('../utils/constants');
const config = require('../config');
const walletService = require('./wallet.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger');

const startAiChat = async (customerId) => {
  const settings = await aiService.getAiSettings();
  if (!settings.enabled) throw new AppError('AI chat is disabled', 503);

  const price = settings.pricePerMinute || config.wallet.defaultAiPricePerMinute;
  const wallet = await walletService.getBalance(customerId);
  if (!wallet.canAfford(price)) {
    throw new AppError(`Insufficient balance. Need at least ₹${price} for 1 minute`, 402);
  }

  const active = await ChatRoom.findOne({
    customer: customerId,
    type: CHAT_TYPE.AI,
    status: CHAT_STATUS.ACTIVE,
  });
  if (active) throw new AppError('You already have an active AI chat', 409);

  const room = await ChatRoom.create({
    type: CHAT_TYPE.AI,
    customer: customerId,
    status: CHAT_STATUS.ACTIVE,
    pricePerMinute: price,
    startedAt: new Date(),
    lastDeductionAt: new Date(),
    aiConfig: {
      model: settings.model,
      temperature: settings.temperature,
      systemPrompt: settings.systemPrompt,
    },
  });

  await AIChat.create({
    chatRoom: room._id,
    customer: customerId,
    model: settings.model,
    temperature: settings.temperature,
    systemPrompt: settings.systemPrompt,
  });

  // First minute charged upfront
  await walletService.debit({
    userId: customerId,
    amount: price,
    type: WALLET_TX_TYPE.CHAT_DEDUCTION,
    description: 'AI chat – minute 1',
    referenceModel: 'ChatRoom',
    referenceId: room._id,
  });
  room.billedMinutes = 1;
  room.totalCharged = price;
  await room.save();

  await Message.create({
    chatRoom: room._id,
    senderRole: 'ai',
    content:
      'Namaste! I am your AstroVerse AI guide. Share your birth details or ask anything about your stars, career, love, or life path.',
    contentType: 'text',
    status: 'delivered',
  });

  return room;
};

const requestHumanChat = async (customerId, astrologerId) => {
  const astrologer = await Astrologer.findById(astrologerId);
  if (!astrologer || astrologer.status !== ASTROLOGER_STATUS.APPROVED) {
    throw new AppError('Astrologer not available', 404);
  }
  if (!astrologer.isOnline || !astrologer.isAvailableForChat) {
    throw new AppError('Astrologer is offline or unavailable', 409);
  }

  const price = astrologer.pricing.chatPerMinute;
  const wallet = await walletService.getBalance(customerId);
  if (!wallet.canAfford(price)) {
    throw new AppError(`Insufficient balance. Need at least ₹${price}`, 402);
  }

  const existing = await ChatRoom.findOne({
    customer: customerId,
    status: { $in: [CHAT_STATUS.PENDING, CHAT_STATUS.ACTIVE] },
  });
  if (existing) throw new AppError('You already have a pending/active chat', 409);

  const room = await ChatRoom.create({
    type: CHAT_TYPE.HUMAN,
    customer: customerId,
    astrologer: astrologer._id,
    astrologerUser: astrologer.user,
    status: CHAT_STATUS.PENDING,
    pricePerMinute: price,
  });

  await Notification.create({
    user: astrologer.user,
    title: 'New Chat Request',
    body: 'A customer wants to chat with you',
    type: 'chat',
    data: { chatRoomId: room._id },
  });

  return room;
};

const acceptChat = async (astrologerUserId, chatRoomId) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room || room.type !== CHAT_TYPE.HUMAN) throw new AppError('Chat not found', 404);
  if (room.astrologerUser.toString() !== astrologerUserId.toString()) {
    throw new AppError('Not your chat request', 403);
  }
  if (room.status !== CHAT_STATUS.PENDING) throw new AppError('Chat is not pending', 409);

  const wallet = await walletService.getBalance(room.customer);
  if (!wallet.canAfford(room.pricePerMinute)) {
    room.status = CHAT_STATUS.EXPIRED;
    room.endReason = 'Customer insufficient balance';
    room.endedBy = 'system';
    room.endedAt = new Date();
    await room.save();
    throw new AppError('Customer has insufficient balance', 402);
  }

  await walletService.debit({
    userId: room.customer,
    amount: room.pricePerMinute,
    type: WALLET_TX_TYPE.CHAT_DEDUCTION,
    description: 'Astrologer chat – minute 1',
    referenceModel: 'ChatRoom',
    referenceId: room._id,
  });

  room.status = CHAT_STATUS.ACTIVE;
  room.startedAt = new Date();
  room.lastDeductionAt = new Date();
  room.billedMinutes = 1;
  room.totalCharged = room.pricePerMinute;
  await room.save();

  await Message.create({
    chatRoom: room._id,
    senderRole: 'system',
    content: 'Chat started. Enjoy your consultation!',
    contentType: 'system',
  });

  await Notification.create({
    user: room.customer,
    title: 'Chat Accepted',
    body: 'Your chat request was accepted',
    type: 'chat',
    data: { chatRoomId: room._id },
  });

  return room;
};

const rejectChat = async (astrologerUserId, chatRoomId, reason = '') => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) throw new AppError('Chat not found', 404);
  if (room.astrologerUser.toString() !== astrologerUserId.toString()) {
    throw new AppError('Not your chat request', 403);
  }
  if (room.status !== CHAT_STATUS.PENDING) throw new AppError('Chat is not pending', 409);

  room.status = CHAT_STATUS.REJECTED;
  room.endedAt = new Date();
  room.endedBy = 'astrologer';
  room.endReason = reason || 'Rejected by astrologer';
  await room.save();

  await Notification.create({
    user: room.customer,
    title: 'Chat Declined',
    body: reason || 'Astrologer declined your chat request',
    type: 'chat',
    data: { chatRoomId: room._id },
  });

  return room;
};

const sendMessage = async ({
  chatRoomId,
  senderId,
  senderRole,
  content,
  contentType = 'text',
  mediaUrl,
  onCustomerMessage,
  onAiThinking,
}) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) throw new AppError('Chat not found', 404);
  if (room.status !== CHAT_STATUS.ACTIVE) throw new AppError('Chat is not active', 409);

  if (senderRole === 'customer' && room.customer.toString() !== senderId.toString()) {
    throw new AppError('Unauthorized', 403);
  }
  if (senderRole === 'astrologer' && room.astrologerUser?.toString() !== senderId.toString()) {
    throw new AppError('Unauthorized', 403);
  }

  const message = await Message.create({
    chatRoom: chatRoomId,
    sender: senderRole === 'ai' ? undefined : senderId,
    senderRole,
    content,
    contentType,
    mediaUrl,
    status: 'sent',
  });

  // Emit user bubble immediately (socket path) before AI latency
  if (typeof onCustomerMessage === 'function') {
    onCustomerMessage(message);
  }

  let aiReply = null;
  if (room.type === CHAT_TYPE.AI && senderRole === 'customer') {
    if (typeof onAiThinking === 'function') onAiThinking();

    const result = await aiService.generateAiReply(chatRoomId, content);
    aiReply = await Message.create({
      chatRoom: chatRoomId,
      senderRole: 'ai',
      content: result.content,
      contentType: 'text',
      status: 'delivered',
      deliveredAt: new Date(),
    });
  }

  return { message, aiReply };
};

const deductMinute = async (chatRoomId, io = null) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room || room.status !== CHAT_STATUS.ACTIVE) return null;

  const wallet = await walletService.getBalance(room.customer);
  if (!wallet.canAfford(room.pricePerMinute)) {
    return endChat(chatRoomId, {
      endedBy: 'wallet',
      endReason: 'Insufficient wallet balance',
      io,
    });
  }

  const { wallet: updatedWallet } = await walletService.debit({
    userId: room.customer,
    amount: room.pricePerMinute,
    type: WALLET_TX_TYPE.CHAT_DEDUCTION,
    description: `${room.type} chat – minute ${room.billedMinutes + 1}`,
    referenceModel: 'ChatRoom',
    referenceId: room._id,
  });

  room.billedMinutes += 1;
  room.totalCharged = Number((room.totalCharged + room.pricePerMinute).toFixed(2));
  room.lastDeductionAt = new Date();
  room.durationSeconds = Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000);
  await room.save();

  if (io) {
    io.to(`chat:${room._id}`).emit('wallet:update', {
      balance: updatedWallet.balance,
      chatRoomId: room._id,
      billedMinutes: room.billedMinutes,
      totalCharged: room.totalCharged,
    });
    io.to(`chat:${room._id}`).emit('timer:tick', {
      chatRoomId: room._id,
      durationSeconds: room.durationSeconds,
      billedMinutes: room.billedMinutes,
      pricePerMinute: room.pricePerMinute,
    });
  }

  return room;
};

const endChat = async (chatRoomId, { endedBy = 'system', endReason = '', io = null } = {}) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) throw new AppError('Chat not found', 404);
  if (room.status === CHAT_STATUS.ENDED) return room;

  room.status = CHAT_STATUS.ENDED;
  room.endedAt = new Date();
  room.endedBy = endedBy;
  room.endReason = endReason;
  if (room.startedAt) {
    room.durationSeconds = Math.floor((room.endedAt - room.startedAt) / 1000);
  }

  if (room.type === CHAT_TYPE.HUMAN && room.astrologer) {
    const commissionPercent = config.wallet.platformCommissionPercent;
    room.platformCommission = Number(((room.totalCharged * commissionPercent) / 100).toFixed(2));
    room.astrologerEarning = Number((room.totalCharged - room.platformCommission).toFixed(2));

    await Astrologer.findByIdAndUpdate(room.astrologer, {
      $inc: {
        'stats.totalChats': 1,
        'stats.totalMinutes': room.billedMinutes,
        'stats.totalEarnings': room.astrologerEarning,
      },
    });

    if (room.astrologerEarning > 0) {
      await walletService.credit({
        userId: room.astrologerUser,
        amount: room.astrologerEarning,
        type: WALLET_TX_TYPE.EARNING,
        description: `Chat earning – room ${room._id}`,
        referenceModel: 'ChatRoom',
        referenceId: room._id,
      });
    }
  }

  await room.save();

  await Message.create({
    chatRoom: room._id,
    senderRole: 'system',
    content: `Chat ended. Duration: ${room.billedMinutes} min. Charged: ₹${room.totalCharged}`,
    contentType: 'system',
  });

  if (io) {
    io.to(`chat:${room._id}`).emit('chat:end', {
      chatRoomId: room._id,
      endedBy,
      endReason,
      billedMinutes: room.billedMinutes,
      totalCharged: room.totalCharged,
    });
  }

  logger.info(`Chat ended ${room._id} by ${endedBy}: ${endReason}`);
  return room;
};

const getMessages = async (chatRoomId, userId, { page = 1, limit = 50 } = {}) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) throw new AppError('Chat not found', 404);

  const isParticipant =
    room.customer.toString() === userId.toString() ||
    room.astrologerUser?.toString() === userId.toString();
  if (!isParticipant) throw new AppError('Unauthorized', 403);

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Message.find({ chatRoom: chatRoomId }).sort({ createdAt: 1 }).skip(skip).limit(limit),
    Message.countDocuments({ chatRoom: chatRoomId }),
  ]);
  return { room, items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getChatHistory = async (userId, { page = 1, limit = 20, type } = {}) => {
  const filter = {
    $or: [{ customer: userId }, { astrologerUser: userId }],
  };
  if (type) filter.type = type;

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ChatRoom.find(filter)
      .populate('customer', 'name avatar')
      .populate({ path: 'astrologer', populate: { path: 'user', select: 'name avatar' } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ChatRoom.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};

module.exports = {
  startAiChat,
  requestHumanChat,
  acceptChat,
  rejectChat,
  sendMessage,
  deductMinute,
  endChat,
  getMessages,
  getChatHistory,
};

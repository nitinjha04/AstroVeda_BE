const mongoose = require('mongoose');
const {
  ChatRoom,
  Message,
  AIChat,
  Astrologer,
  Notification,
  User,
  AIAstrologer,
} = require('../models');
const AppError = require('../utils/AppError');
const { CHAT_TYPE, CHAT_STATUS, WALLET_TX_TYPE, ASTROLOGER_STATUS } = require('../utils/constants');
const config = require('../config');
const walletService = require('./wallet.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger');
const AI_GREETINGS = require('../data/aiGreetings');

const pickGreeting = (custom) =>
  custom || AI_GREETINGS[Math.floor(Math.random() * AI_GREETINGS.length)];

/**
 * Start a new AI chat with a specific AI Astrologer persona.
 * Ends any other live AI session first (one live billable session at a time).
 */
const startAiChat = async (customerId, aiAstrologerId) => {
  if (!aiAstrologerId) throw new AppError('Select an AI Astrologer to start chat', 400);

  const [settings, wallet, persona, otherActive] = await Promise.all([
    aiService.getAiSettings(),
    walletService.getBalance(customerId),
    AIAstrologer.findOne({ _id: aiAstrologerId, isActive: true }),
    ChatRoom.find({
      customer: customerId,
      type: CHAT_TYPE.AI,
      status: CHAT_STATUS.ACTIVE,
    }).select('_id'),
  ]);

  if (!settings.enabled) throw new AppError('AI chat is disabled', 503);
  if (!persona) throw new AppError('AI Astrologer not found', 404);

  const price = persona.pricePerMinute || settings.pricePerMinute || config.wallet.defaultAiPricePerMinute;
  if (!wallet.canAfford(price)) {
    throw new AppError(`Insufficient balance. Need at least ₹${price} for 1 minute`, 402);
  }

  // Close other live sessions so billing is clean
  for (const prev of otherActive) {
    await endChat(prev._id, {
      endedBy: 'system',
      endReason: 'Started a new AI session',
    });
  }

  const systemPrompt = persona.systemPrompt || settings.systemPrompt;

  const room = await ChatRoom.create({
    type: CHAT_TYPE.AI,
    customer: customerId,
    aiAstrologer: persona._id,
    status: CHAT_STATUS.ACTIVE,
    pricePerMinute: price,
    startedAt: new Date(),
    lastDeductionAt: new Date(),
    billedMinutes: 1,
    totalCharged: price,
    title: `Chat with ${persona.displayName}`,
    aiConfig: {
      model: settings.model,
      temperature: settings.temperature,
      systemPrompt,
    },
    metadata: {
      aiAstrologerSlug: persona.slug,
      aiAstrologerName: persona.displayName,
    },
  });

  const greetingText = pickGreeting(persona.greeting);

  const [, { wallet: updatedWallet }, greetingMsg] = await Promise.all([
    AIChat.create({
      chatRoom: room._id,
      customer: customerId,
      model: settings.model,
      temperature: settings.temperature,
      systemPrompt,
    }),
    walletService.debit({
      userId: customerId,
      amount: price,
      type: WALLET_TX_TYPE.CHAT_DEDUCTION,
      description: `AI chat with ${persona.displayName} – minute 1`,
      referenceModel: 'ChatRoom',
      referenceId: room._id,
    }),
    Message.create({
      chatRoom: room._id,
      senderRole: 'ai',
      content: greetingText,
      contentType: 'text',
      status: 'delivered',
      deliveredAt: new Date(),
      metadata: { kind: 'static_greeting', aiAstrologer: persona._id },
    }),
  ]);

  const roomPopulated = await ChatRoom.findById(room._id)
    .populate('aiAstrologer', 'displayName slug avatarEmoji tagline pricePerMinute ratingAverage languages specialties')
    .lean();

  return {
    room: roomPopulated,
    messages: [greetingMsg],
    wallet: updatedWallet,
    aiAstrologer: persona.toObject ? { ...persona.toObject(), systemPrompt: undefined } : persona,
  };
};

const requestHumanChat = async () => {
  throw new AppError(
    'Human astrologers are temporarily unavailable. Please choose an AI Astrologer.',
    503
  );
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
  skipAi = false,
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

  // Name the thread from the first customer message (ChatGPT-style history)
  if (senderRole === 'customer' && content?.trim() && !room.title) {
    const t = content.trim().replace(/\s+/g, ' ');
    room.title = t.length > 80 ? `${t.slice(0, 77)}…` : t;
    await room.save();
  }

  if (typeof onCustomerMessage === 'function') {
    onCustomerMessage(message);
  }

  let aiReply = null;
  if (!skipAi && room.type === CHAT_TYPE.AI && senderRole === 'customer') {
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

/** Generate AI reply for an AI room after customer message was saved */
const generateAiReplyForRoom = async (chatRoomId, userId, content) => {
  const room = await ChatRoom.findById(chatRoomId);
  if (!room) throw new AppError('Chat not found', 404);
  if (room.type !== CHAT_TYPE.AI) throw new AppError('Not an AI chat', 400);
  if (room.status !== CHAT_STATUS.ACTIVE) throw new AppError('Chat is not active', 409);
  if (room.customer.toString() !== userId.toString()) throw new AppError('Unauthorized', 403);

  const result = await aiService.generateAiReply(chatRoomId, content);
  const aiReply = await Message.create({
    chatRoom: chatRoomId,
    senderRole: 'ai',
    content: result.content,
    contentType: 'text',
    status: 'delivered',
    deliveredAt: new Date(),
  });
  return aiReply;
};

/** End every active / pending chat for a customer (page leave / refresh / disconnect) */
const endActiveChatsForUser = async (
  userId,
  {
    io = null,
    endReason = 'Session ended (page closed or refreshed)',
    types = null,
  } = {}
) => {
  const filter = {
    customer: userId,
    status: { $in: [CHAT_STATUS.ACTIVE, CHAT_STATUS.PENDING] },
  };
  if (types && Array.isArray(types) && types.length) {
    filter.type = { $in: types };
  }

  const rooms = await ChatRoom.find(filter);

  const ended = [];
  for (const room of rooms) {
    const result = await endChat(room._id, {
      endedBy: 'system',
      endReason,
      io,
    });
    ended.push(result);
  }
  return ended;
};

const getActiveChatForUser = async (userId, type = null) => {
  const filter = {
    customer: userId,
    status: CHAT_STATUS.ACTIVE,
  };
  if (type) filter.type = type;
  return ChatRoom.findOne(filter).sort({ startedAt: -1 });
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
  const existing = await ChatRoom.findById(chatRoomId);
  if (!existing) throw new AppError('Chat not found', 404);
  if (existing.status === CHAT_STATUS.ENDED) return existing;

  const endedAt = new Date();
  const durationSeconds = existing.startedAt
    ? Math.floor((endedAt - existing.startedAt) / 1000)
    : existing.durationSeconds || 0;

  let platformCommission = existing.platformCommission || 0;
  let astrologerEarning = existing.astrologerEarning || 0;

  if (existing.type === CHAT_TYPE.HUMAN && existing.astrologer) {
    const commissionPercent = config.wallet.platformCommissionPercent;
    platformCommission = Number(((existing.totalCharged * commissionPercent) / 100).toFixed(2));
    astrologerEarning = Number((existing.totalCharged - platformCommission).toFixed(2));
  }

  // Atomic: only one concurrent ender wins — prevents duplicate system messages
  const room = await ChatRoom.findOneAndUpdate(
    { _id: chatRoomId, status: { $ne: CHAT_STATUS.ENDED } },
    {
      $set: {
        status: CHAT_STATUS.ENDED,
        endedAt,
        endedBy,
        endReason,
        durationSeconds,
        platformCommission,
        astrologerEarning,
      },
    },
    { new: true }
  );

  if (!room) {
    return ChatRoom.findById(chatRoomId);
  }

  // Side-effects only for the winner request
  if (room.type === CHAT_TYPE.HUMAN && room.astrologer) {
    await Astrologer.findByIdAndUpdate(room.astrologer, {
      $inc: {
        'stats.totalChats': 1,
        'stats.totalMinutes': room.billedMinutes,
        'stats.totalEarnings': astrologerEarning,
      },
    });

    if (astrologerEarning > 0) {
      await walletService.credit({
        userId: room.astrologerUser,
        amount: astrologerEarning,
        type: WALLET_TX_TYPE.EARNING,
        description: `Chat earning – room ${room._id}`,
        referenceModel: 'ChatRoom',
        referenceId: room._id,
      });
    }
  }

  const alreadySummary = await Message.exists({
    chatRoom: room._id,
    senderRole: 'system',
    'metadata.kind': 'chat_ended',
  });

  if (!alreadySummary) {
    await Message.create({
      chatRoom: room._id,
      senderRole: 'system',
      content: `Chat ended. Duration: ${room.billedMinutes} min. Charged: ₹${room.totalCharged}`,
      contentType: 'system',
      metadata: { kind: 'chat_ended' },
    });
  }

  if (io) {
    io.to(`chat:${room._id}`).emit('chat:end', {
      chatRoomId: room._id,
      endedBy,
      endReason: endReason || '',
      billedMinutes: room.billedMinutes,
      totalCharged: room.totalCharged,
      silent: endedBy === 'customer' || endedBy === 'system',
    });
  }

  logger.info(`Chat ended ${room._id} by ${endedBy}: ${endReason}`);
  return room;
};

/** Latest-first page of messages (fast). Pass `before` = oldest loaded msg id for scroll-up. */
const getMessages = async (chatRoomId, userId, { limit = 40, before = null } = {}) => {
  const room = await ChatRoom.findById(chatRoomId).lean();
  if (!room) throw new AppError('Chat not found', 404);

  const isCustomer = room.customer.toString() === userId.toString();
  const isAstrologer = room.astrologerUser?.toString() === userId.toString();
  if (!isCustomer && !isAstrologer) throw new AppError('Unauthorized', 403);

  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 50);
  const filter = { chatRoom: chatRoomId };

  if (before) {
    const anchor = await Message.findById(before).select('createdAt').lean();
    if (anchor?.createdAt) {
      filter.createdAt = { $lt: anchor.createdAt };
    }
  }

  // Fetch limit+1 to know if older pages exist; skip countDocuments (slow on large rooms)
  const batch = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit + 1)
    .select('-__v')
    .lean();

  const hasMore = batch.length > safeLimit;
  let items = (hasMore ? batch.slice(0, safeLimit) : batch).reverse();

  // Hide accidental duplicate system “chat ended” lines (legacy race data)
  items = items.filter((m, i, arr) => {
    if (m.senderRole !== 'system') return true;
    const prev = arr[i - 1];
    return !(prev && prev.senderRole === 'system' && prev.content === m.content);
  });

  // For astrologers: only expose birth details when the customer opted in
  let customerPublic = null;
  if (isAstrologer && room.type === CHAT_TYPE.HUMAN) {
    const c = await User.findById(room.customer)
      .select('name avatar gender dateOfBirth birthTime birthPlace privacy')
      .lean();
    if (c) {
      customerPublic = {
        _id: c._id,
        name: c.name,
        avatar: c.avatar,
      };
      if (c.privacy?.shareBirthDetailsWithAstrologers) {
        customerPublic.gender = c.gender || '';
        customerPublic.dateOfBirth = c.dateOfBirth || null;
        customerPublic.birthTime = c.birthTime || '';
        customerPublic.birthPlace = c.birthPlace || '';
        customerPublic.sharedBirthDetails = true;
      } else {
        customerPublic.sharedBirthDetails = false;
      }
    }
  }

  return {
    room,
    items,
    customer: customerPublic,
    meta: {
      hasMore,
      limit: safeLimit,
      before: items.length ? items[0]._id : null,
    },
  };
};

const getChatHistory = async (userId, { page = 1, limit = 20, type, aiAstrologerId } = {}) => {
  const filter = {
    $or: [{ customer: userId }, { astrologerUser: userId }],
  };
  if (type) filter.type = type;
  if (aiAstrologerId) filter.aiAstrologer = aiAstrologerId;

  const skip = (page - 1) * limit;
  const [rooms, total] = await Promise.all([
    ChatRoom.find(filter)
      .populate('customer', 'name avatar')
      .populate({ path: 'astrologer', populate: { path: 'user', select: 'name avatar' } })
      .populate('aiAstrologer', 'displayName slug avatarEmoji tagline pricePerMinute')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ChatRoom.countDocuments(filter),
  ]);

  const roomIds = rooms.map((r) => r._id);
  const lastMessages = await Message.aggregate([
    {
      $match: {
        chatRoom: { $in: roomIds },
        senderRole: { $in: ['customer', 'ai', 'astrologer'] },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$chatRoom',
        content: { $first: '$content' },
        senderRole: { $first: '$senderRole' },
        createdAt: { $first: '$createdAt' },
      },
    },
  ]);
  const lastByRoom = Object.fromEntries(lastMessages.map((m) => [String(m._id), m]));

  const items = rooms.map((room) => {
    const last = lastByRoom[String(room._id)];
    const preview = last?.content
      ? last.content.length > 100
        ? `${last.content.slice(0, 97)}…`
        : last.content
      : 'No messages yet';
    return {
      ...room,
      title: room.title || (room.type === CHAT_TYPE.AI ? 'New AI chat' : 'Chat'),
      lastMessagePreview: preview,
      lastMessageAt: last?.createdAt || room.updatedAt,
    };
  });

  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};

/** Open a past AI thread (view messages; does not start billing) */
const openAiChat = async (customerId, chatRoomId) => {
  const room = await ChatRoom.findOne({
    _id: chatRoomId,
    customer: customerId,
    type: CHAT_TYPE.AI,
  });
  if (!room) throw new AppError('Chat not found', 404);
  return room;
};

/** Resume an ended AI thread for more messages (bills next minute) */
const resumeAiChat = async (customerId, chatRoomId) => {
  const settings = await aiService.getAiSettings();
  if (!settings.enabled) throw new AppError('AI chat is disabled', 503);

  const room = await ChatRoom.findOne({
    _id: chatRoomId,
    customer: customerId,
    type: CHAT_TYPE.AI,
  });
  if (!room) throw new AppError('Chat not found', 404);

  if (room.status === CHAT_STATUS.ACTIVE) return room;

  if (room.status !== CHAT_STATUS.ENDED) {
    throw new AppError('This chat cannot be continued', 409);
  }

  // Close any other active AI sessions first
  const others = await ChatRoom.find({
    customer: customerId,
    type: CHAT_TYPE.AI,
    status: CHAT_STATUS.ACTIVE,
    _id: { $ne: room._id },
  });
  for (const other of others) {
    await endChat(other._id, {
      endedBy: 'system',
      endReason: 'Switched to another chat',
    });
  }

  const price = room.pricePerMinute || settings.pricePerMinute || config.wallet.defaultAiPricePerMinute;
  const wallet = await walletService.getBalance(customerId);
  if (!wallet.canAfford(price)) {
    throw new AppError(`Insufficient balance. Need at least ₹${price} to continue`, 402);
  }

  await walletService.debit({
    userId: customerId,
    amount: price,
    type: WALLET_TX_TYPE.CHAT_DEDUCTION,
    description: 'AI chat – continue session',
    referenceModel: 'ChatRoom',
    referenceId: room._id,
  });

  room.status = CHAT_STATUS.ACTIVE;
  room.endedAt = undefined;
  room.endedBy = null;
  room.endReason = undefined;
  room.lastDeductionAt = new Date();
  room.billedMinutes += 1;
  room.totalCharged = Number((room.totalCharged + price).toFixed(2));
  if (!room.startedAt) room.startedAt = new Date();
  await room.save();

  await Message.create({
    chatRoom: room._id,
    senderRole: 'system',
    content: 'Session continued — you can keep chatting.',
    contentType: 'system',
  });

  return room;
};

module.exports = {
  startAiChat,
  requestHumanChat,
  acceptChat,
  rejectChat,
  sendMessage,
  generateAiReplyForRoom,
  endActiveChatsForUser,
  getActiveChatForUser,
  openAiChat,
  resumeAiChat,
  deductMinute,
  endChat,
  getMessages,
  getChatHistory,
};

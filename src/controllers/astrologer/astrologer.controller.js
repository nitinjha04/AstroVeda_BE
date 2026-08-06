const chatService = require('../../services/chat.service');
const walletService = require('../../services/wallet.service');
const uploadService = require('../../services/upload.service');
const { Astrologer, Withdrawal, Review, ChatRoom } = require('../../models');
const { ASTROLOGER_STATUS, KYC_STATUS } = require('../../utils/constants');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

const registerAstrologer = asyncHandler(async (req, res) => {
  const existing = await Astrologer.findOne({ user: req.user._id });
  if (existing) throw new AppError('Astrologer profile already exists', 409);

  const profile = await Astrologer.create({
    user: req.user._id,
    displayName: req.body.displayName || req.user.name,
    bio: req.body.bio || '',
    specialties: req.body.specialties || [],
    languages: req.body.languages || ['Hindi', 'English'],
    experienceYears: req.body.experienceYears || 0,
    pricing: {
      chatPerMinute: req.body.chatPerMinute || 10,
      voicePerMinute: req.body.voicePerMinute || 20,
      videoPerMinute: req.body.videoPerMinute || 30,
    },
  });

  if (req.user.role !== 'astrologer') {
    req.user.role = 'astrologer';
    await req.user.save();
  }

  return created(res, { message: 'Astrologer registration submitted', data: profile });
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id }).populate('user', 'name email phone avatar');
  if (!profile) throw new AppError('Astrologer profile not found', 404);
  return success(res, { data: profile });
});

const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  if (!profile) throw new AppError('Profile not found', 404);

  const fields = ['displayName', 'bio', 'specialties', 'languages', 'experienceYears', 'schedule', 'bankDetails'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) profile[f] = req.body[f];
  });
  if (req.body.pricing) profile.pricing = { ...profile.pricing.toObject?.() || profile.pricing, ...req.body.pricing };
  await profile.save();
  return success(res, { message: 'Profile updated', data: profile });
});

const toggleOnline = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  if (!profile) throw new AppError('Profile not found', 404);
  if (profile.status !== ASTROLOGER_STATUS.APPROVED) throw new AppError('Not approved yet', 403);

  if (typeof req.body.isOnline === 'boolean') profile.isOnline = req.body.isOnline;
  if (typeof req.body.isAvailableForChat === 'boolean') profile.isAvailableForChat = req.body.isAvailableForChat;
  if (typeof req.body.isAvailableForVoice === 'boolean') profile.isAvailableForVoice = req.body.isAvailableForVoice;
  if (typeof req.body.isAvailableForVideo === 'boolean') profile.isAvailableForVideo = req.body.isAvailableForVideo;
  await profile.save();
  return success(res, { data: profile });
});

const submitKyc = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  if (!profile) throw new AppError('Profile not found', 404);

  const files = req.files || {};
  const uploads = {};
  for (const [key, arr] of Object.entries(files)) {
    if (arr?.[0]) {
      const result = await uploadService.uploadBuffer(arr[0].buffer, 'astroverse/kyc');
      uploads[key] = result.secure_url;
    }
  }

  profile.kyc = {
    ...profile.kyc?.toObject?.() || profile.kyc || {},
    status: KYC_STATUS.SUBMITTED,
    documentType: req.body.documentType,
    documentNumber: req.body.documentNumber,
    documentFront: uploads.documentFront || profile.kyc?.documentFront,
    documentBack: uploads.documentBack || profile.kyc?.documentBack,
    selfie: uploads.selfie || profile.kyc?.selfie,
    submittedAt: new Date(),
  };
  await profile.save();
  return success(res, { message: 'KYC submitted', data: profile.kyc });
});

const uploadCertificate = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  if (!profile) throw new AppError('Profile not found', 404);
  if (!req.file) throw new AppError('File required', 400);

  const result = await uploadService.uploadBuffer(req.file.buffer, 'astroverse/certificates');
  profile.certificates.push({
    title: req.body.title || 'Certificate',
    url: result.secure_url,
    publicId: result.public_id,
  });
  await profile.save();
  return success(res, { data: profile.certificates });
});

const acceptChat = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const room = await chatService.acceptChat(req.user._id, req.params.id);
  if (io) {
    io.to(`user:${room.customer}`).emit('chat:accepted', { chatRoomId: room._id });
    io.to(`chat:${room._id}`).emit('chat:started', { chatRoomId: room._id });
  }
  return success(res, { message: 'Chat accepted', data: room });
});

const rejectChat = asyncHandler(async (req, res) => {
  const room = await chatService.rejectChat(req.user._id, req.params.id, req.body.reason);
  const io = req.app.get('io');
  if (io) io.to(`user:${room.customer}`).emit('chat:rejected', { chatRoomId: room._id });
  return success(res, { message: 'Chat rejected', data: room });
});

const pendingChats = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  const items = await ChatRoom.find({ astrologer: profile._id, status: 'pending' })
    .populate('customer', 'name avatar gender dateOfBirth birthTime birthPlace privacy')
    .sort({ createdAt: -1 })
    .lean();

  const data = items.map((room) => {
    const c = room.customer;
    if (!c) return room;
    const customer = {
      _id: c._id,
      name: c.name,
      avatar: c.avatar,
      sharedBirthDetails: !!c.privacy?.shareBirthDetailsWithAstrologers,
    };
    if (c.privacy?.shareBirthDetailsWithAstrologers) {
      customer.gender = c.gender || '';
      customer.dateOfBirth = c.dateOfBirth || null;
      customer.birthTime = c.birthTime || '';
      customer.birthPlace = c.birthPlace || '';
    }
    return { ...room, customer };
  });

  return success(res, { data });
});

const sendMessage = asyncHandler(async (req, res) => {
  const data = await chatService.sendMessage({
    chatRoomId: req.params.id,
    senderId: req.user._id,
    senderRole: 'astrologer',
    content: req.body.content,
  });
  return success(res, { data });
});

const endChat = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const room = await chatService.endChat(req.params.id, {
    endedBy: 'astrologer',
    endReason: req.body.reason || 'Ended by astrologer',
    io,
  });
  return success(res, { data: room });
});

const earnings = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  const wallet = await walletService.getBalance(req.user._id);
  const txs = await walletService.getTransactions(req.user._id, { page: 1, limit: 20, type: 'earning' });
  return success(res, {
    data: {
      stats: profile?.stats,
      wallet,
      recentEarnings: txs.items,
    },
  });
});

const requestWithdrawal = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  if (!profile) throw new AppError('Profile not found', 404);

  const amount = Number(req.body.amount);
  const wallet = await walletService.getBalance(req.user._id);
  if (!wallet.canAfford(amount)) throw new AppError('Insufficient balance', 402);

  await walletService.debit({
    userId: req.user._id,
    amount,
    type: 'withdrawal',
    description: 'Withdrawal request',
  });

  const withdrawal = await Withdrawal.create({
    astrologer: profile._id,
    user: req.user._id,
    amount,
    bankDetails: req.body.bankDetails || profile.bankDetails,
    status: 'pending',
  });

  return created(res, { message: 'Withdrawal requested', data: withdrawal });
});

const analytics = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findOne({ user: req.user._id });
  const ratings = await Review.find({ astrologer: profile._id, type: 'astrologer' })
    .populate('user', 'name avatar')
    .sort({ createdAt: -1 })
    .limit(10);

  return success(res, {
    data: {
      profile: {
        ratings: profile.ratings,
        stats: profile.stats,
        isOnline: profile.isOnline,
      },
      recentReviews: ratings,
    },
  });
});

module.exports = {
  registerAstrologer,
  getProfile,
  updateProfile,
  toggleOnline,
  submitKyc,
  uploadCertificate,
  acceptChat,
  rejectChat,
  pendingChats,
  sendMessage,
  endChat,
  earnings,
  requestWithdrawal,
  analytics,
};

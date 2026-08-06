const { User, AIAstrologer, Product } = require('../../models');
const aiAstrologerService = require('../../services/aiAstrologer.service');
const astrologyService = require('../../services/astrology.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const uploadService = require('../../services/upload.service');

const listAstrologers = asyncHandler(async (req, res) => {
  const result = await aiAstrologerService.listAiAstrologers(req.query);
  return success(res, { data: result.items, meta: result.meta });
});

const getAstrologer = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (/^[0-9a-fA-F]{24}$/.test(id)) {
    const doc = await AIAstrologer.findOne({ _id: id, isActive: true }).lean();
    if (!doc) throw new AppError('AI Astrologer not found', 404);
    delete doc.systemPrompt;
    const suggestedProducts = await Product.find({
      slug: { $in: doc.suggestedProductSlugs || [] },
      isActive: true,
    })
      .select('name slug price images shortDescription')
      .lean();
    return success(res, { data: { ...doc, suggestedProducts } });
  }
  const data = await aiAstrologerService.getBySlug(id);
  return success(res, { data });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found', 404);
  return success(res, { data: user.toSafeObject() });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found', 404);

  const allowed = ['name', 'gender', 'dateOfBirth', 'birthTime', 'birthPlace', 'avatar', 'phone'];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) user[key] = req.body[key];
  });

  if (req.body.preferences && typeof req.body.preferences === 'object') {
    user.preferences = {
      ...(user.preferences?.toObject?.() || user.preferences || {}),
      ...req.body.preferences,
      notifications: {
        ...(user.preferences?.notifications?.toObject?.() || user.preferences?.notifications || {}),
        ...(req.body.preferences.notifications || {}),
      },
    };
  }

  if (req.body.privacy && typeof req.body.privacy === 'object') {
    user.privacy = {
      ...(user.privacy?.toObject?.() || user.privacy || {}),
      ...req.body.privacy,
    };
  }

  // Replace primary / home address
  if (req.body.address && typeof req.body.address === 'object') {
    const addr = {
      label: req.body.address.label || 'Home',
      name: req.body.address.name || user.name,
      phone: req.body.address.phone || user.phone,
      line1: req.body.address.line1 || '',
      line2: req.body.address.line2 || '',
      city: req.body.address.city || '',
      state: req.body.address.state || '',
      pincode: req.body.address.pincode || '',
      country: req.body.address.country || 'India',
      isDefault: true,
    };
    const existing = (user.addresses || []).find((a) => a.isDefault) || user.addresses?.[0];
    if (existing) {
      Object.assign(existing, addr);
    } else {
      user.addresses = [addr];
    }
  }

  await user.save();
  return success(res, { message: 'Profile updated', data: user.toSafeObject() });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password are required', 400);
  }
  if (String(newPassword).length < 6) {
    throw new AppError('New password must be at least 6 characters', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new AppError('User not found', 404);
  if (!user.password) {
    throw new AppError('Password login is not set for this account (use OTP / Google)', 400);
  }

  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw new AppError('Current password is incorrect', 401);

  user.password = newPassword;
  await user.save();
  return success(res, { message: 'Password updated' });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) throw new AppError('Image file required', 400);
  const result = await uploadService.uploadBuffer(req.file.buffer, 'astroverse/avatars');
  const user = await User.findById(req.user._id);
  user.avatar = result.secure_url || result.url || '';
  await user.save();
  return success(res, { message: 'Avatar updated', data: user.toSafeObject() });
});

const dailyHoroscope = asyncHandler(async (req, res) => {
  const sign = req.query.sign || astrologyService.getZodiacFromDate(req.user.dateOfBirth || new Date());
  const data = astrologyService.dailyHoroscope(sign);
  return success(res, { data });
});

const allHoroscopes = asyncHandler(async (req, res) => {
  return success(res, { data: astrologyService.getAllDaily() });
});

const generateKundli = asyncHandler(async (req, res) => {
  const payload = {
    name: req.body.name || req.user.name,
    dateOfBirth: req.body.dateOfBirth || req.user.dateOfBirth,
    birthTime: req.body.birthTime || req.user.birthTime,
    birthPlace: req.body.birthPlace || req.user.birthPlace,
    gender: req.body.gender || req.user.gender,
  };
  if (!payload.dateOfBirth) throw new AppError('Date of birth required', 400);
  const data = astrologyService.generateKundli(payload);
  return success(res, { data });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  dailyHoroscope,
  allHoroscopes,
  generateKundli,
  listAstrologers,
  getAstrologer,
};

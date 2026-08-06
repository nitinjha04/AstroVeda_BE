const astrologyService = require('../../services/astrology.service');
const { User, Astrologer } = require('../../models');
const { ASTROLOGER_STATUS } = require('../../utils/constants');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'gender', 'dateOfBirth', 'birthTime', 'birthPlace', 'avatar', 'preferences', 'phone'];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) req.user[key] = req.body[key];
  });
  if (req.body.address) {
    req.user.addresses.push(req.body.address);
  }
  await req.user.save();
  return success(res, { message: 'Profile updated', data: req.user.toSafeObject() });
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

const listAstrologers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, specialty, language, online, search } = req.query;
  const filter = { status: ASTROLOGER_STATUS.APPROVED };
  if (specialty) filter.specialties = specialty;
  if (language) filter.languages = language;
  if (online === 'true') filter.isOnline = true;
  if (search) filter.$text = { $search: search };

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Astrologer.find(filter)
      .populate('user', 'name avatar')
      .sort({ 'ratings.average': -1, isOnline: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Astrologer.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } });
});

const getAstrologer = asyncHandler(async (req, res) => {
  const astrologer = await Astrologer.findById(req.params.id).populate('user', 'name avatar');
  if (!astrologer || astrologer.status !== ASTROLOGER_STATUS.APPROVED) {
    throw new AppError('Astrologer not found', 404);
  }
  return success(res, { data: astrologer });
});

module.exports = {
  updateProfile,
  dailyHoroscope,
  allHoroscopes,
  generateKundli,
  listAstrologers,
  getAstrologer,
};

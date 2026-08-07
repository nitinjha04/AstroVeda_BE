const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { User, Wallet, Referral, Settings } = require('../models');
const AppError = require('../utils/AppError');
const { ROLES } = require('../utils/constants');
const { generateTokenPair, hashToken, generateOtp } = require('../utils/tokens');
const { sendOtpEmail } = require('../utils/email');
const config = require('../config');
const walletService = require('./wallet.service');
const { WALLET_TX_TYPE } = require('../utils/constants');

const googleClient = config.google.clientId ? new OAuth2Client(config.google.clientId) : null;

const makeReferralCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const attachTokens = async (user) => {
  const tokens = generateTokenPair(user);
  const hashed = hashToken(tokens.refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  user.refreshTokens = (user.refreshTokens || [])
    .filter((t) => t.expiresAt > new Date())
    .slice(-4);
  user.refreshTokens.push({ token: hashed, expiresAt });
  user.lastLoginAt = new Date();
  await user.save();
  return tokens;
};

const register = async ({ name, email, phone, password, role = ROLES.CUSTOMER, referralCode }) => {
  if (role === ROLES.ADMIN) throw new AppError('Cannot self-register as admin', 403);

  const existing = await User.findOne({
    $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
  });
  if (existing) throw new AppError('User already exists with this email/phone', 409);

  let referredBy = null;
  if (referralCode) {
    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (referrer) referredBy = referrer._id;
  }

  const user = await User.create({
    name,
    email,
    phone,
    password,
    role,
    referralCode: makeReferralCode(),
    referredBy,
  });

  await walletService.getOrCreateWallet(user._id);

  if (referredBy) {
    const settings = await Settings.findOne({ key: 'referral' });
    const referrerBonus = settings?.value?.referrerBonus ?? 50;
    const referredBonus = settings?.value?.referredBonus ?? 25;

    await Referral.create({
      referrer: referredBy,
      referred: user._id,
      code: referralCode.toUpperCase(),
      referrerBonus,
      referredBonus,
      status: 'pending',
    });

    await walletService.credit({
      userId: user._id,
      amount: referredBonus,
      type: WALLET_TX_TYPE.REFERRAL_BONUS,
      description: 'Welcome referral bonus',
    });
    await walletService.credit({
      userId: referredBy,
      amount: referrerBonus,
      type: WALLET_TX_TYPE.REFERRAL_BONUS,
      description: 'Referral reward',
    });
    await Referral.updateOne({ referred: user._id }, { status: 'credited', creditedAt: new Date() });
  }

  const tokens = await attachTokens(user);
  return { user: user.toSafeObject(), ...tokens };
};

const login = async ({ email, phone, password }) => {
  const query = email ? { email: email.toLowerCase() } : { phone };
  const user = await User.findOne(query).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid credentials', 401);
  }
  if (user.isBlocked) throw new AppError('Account blocked', 403);

  const tokens = await attachTokens(user);
  return { user: user.toSafeObject(), ...tokens };
};

const sendOtp = async ({ email, phone }) => {
  if (!email && !phone) throw new AppError('Email or phone required', 400);

  let user = await User.findOne(email ? { email: email.toLowerCase() } : { phone });
  if (!user) {
    user = await User.create({
      name: email ? email.split('@')[0] : `User${phone.slice(-4)}`,
      email: email?.toLowerCase(),
      phone,
      role: ROLES.CUSTOMER,
      referralCode: makeReferralCode(),
    });
    await walletService.getOrCreateWallet(user._id);
  }

  const otp = generateOtp();
  user.otp = {
    code: hashToken(otp),
    expiresAt: new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000),
  };
  await user.save();

  if (email) await sendOtpEmail(email, otp);
  // SMS ready: integrate SMS gateway with phone + otp

  return {
    message: 'OTP sent successfully',
    ...(config.env !== 'production' && { debugOtp: otp }),
  };
};

const verifyOtp = async ({ email, phone, otp }) => {
  const user = await User.findOne(email ? { email: email.toLowerCase() } : { phone });
  if (!user || !user.otp?.code) throw new AppError('OTP not found', 400);
  if (user.otp.expiresAt < new Date()) throw new AppError('OTP expired', 400);
  if (user.otp.code !== hashToken(otp)) throw new AppError('Invalid OTP', 400);

  user.otp = undefined;
  if (email) user.isEmailVerified = true;
  if (phone) user.isPhoneVerified = true;
  await user.save();

  const tokens = await attachTokens(user);
  return { user: user.toSafeObject(), ...tokens };
};

const googleLogin = async (idToken) => {
  if (!googleClient) throw new AppError('Google login not configured', 503);

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.google.clientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new AppError('Invalid Google token', 401);

  let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: payload.email }] });
  if (!user) {
    user = await User.create({
      name: payload.name || payload.email.split('@')[0],
      email: payload.email,
      googleId: payload.sub,
      avatar: payload.picture || '',
      isEmailVerified: true,
      role: ROLES.CUSTOMER,
      referralCode: makeReferralCode(),
    });
    await walletService.getOrCreateWallet(user._id);
  } else if (!user.googleId) {
    user.googleId = payload.sub;
    user.isEmailVerified = true;
    if (!user.avatar && payload.picture) user.avatar = payload.picture;
    await user.save();
  }

  const tokens = await attachTokens(user);
  return { user: user.toSafeObject(), ...tokens };
};

const refreshTokens = async (refreshToken) => {
  if (!refreshToken) {
    throw new AppError('Refresh token required (body.refreshToken or refreshToken cookie)', 400);
  }

  const { verifyRefreshToken } = require('../utils/tokens');
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const user = await User.findById(decoded.id);
  if (!user) throw new AppError('User not found', 401);

  const hashed = hashToken(refreshToken);
  const stored = (user.refreshTokens || []).find(
    (t) => t.token === hashed && t.expiresAt > new Date()
  );
  if (!stored) throw new AppError('Refresh token revoked', 401);

  user.refreshTokens = user.refreshTokens.filter((t) => t.token !== hashed);
  const tokens = await attachTokens(user);
  return { user: user.toSafeObject(), ...tokens };
};

const logout = async (userId, refreshToken) => {
  const user = await User.findById(userId);
  if (!user) return;
  if (refreshToken) {
    const hashed = hashToken(refreshToken);
    user.refreshTokens = (user.refreshTokens || []).filter((t) => t.token !== hashed);
  } else {
    user.refreshTokens = [];
  }
  await user.save();
};

const forgotPassword = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return { message: 'If account exists, reset instructions sent' };

  const otp = generateOtp();
  user.otp = {
    code: hashToken(otp),
    expiresAt: new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000),
  };
  await user.save();
  await sendOtpEmail(email, otp);
  return {
    message: 'If account exists, reset instructions sent',
    ...(config.env !== 'production' && { debugOtp: otp }),
  };
};

const resetPassword = async ({ email, otp, newPassword }) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user?.otp?.code) throw new AppError('Invalid reset request', 400);
  if (user.otp.expiresAt < new Date()) throw new AppError('OTP expired', 400);
  if (user.otp.code !== hashToken(otp)) throw new AppError('Invalid OTP', 400);

  user.password = newPassword;
  user.otp = undefined;
  user.refreshTokens = [];
  await user.save();
  return { message: 'Password reset successful' };
};

module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  googleLogin,
  refreshTokens,
  logout,
  forgotPassword,
  resetPassword,
};

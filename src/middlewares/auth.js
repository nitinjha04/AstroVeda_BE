const { verifyAccessToken } = require('../utils/tokens');
const { extractAccessToken } = require('../utils/authCookies');
const AppError = require('../utils/AppError');
const { User } = require('../models');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Dual authentication:
 * - Authorization: Bearer <accessToken>  (from FE localStorage)
 * - accessToken httpOnly cookie            (same or cross-site with credentials)
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractAccessToken(req);
  if (!token) {
    throw new AppError('Authentication required. Send Authorization: Bearer <token> or accessToken cookie.', 401);
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  const user = await User.findById(decoded.id);
  if (!user || !user.isActive || user.isBlocked) {
    throw new AppError('Account inactive or blocked', 401);
  }

  req.user = user;
  req.tokenPayload = decoded;
  req.accessToken = token;
  next();
});

const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractAccessToken(req);
  if (!token) return next();

  try {
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (user && user.isActive && !user.isBlocked) {
      req.user = user;
      req.tokenPayload = decoded;
      req.accessToken = token;
    }
  } catch {
    // ignore invalid token for optional auth
  }
  next();
});

module.exports = { authenticate, optionalAuth };

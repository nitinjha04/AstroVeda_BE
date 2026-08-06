const { verifyAccessToken } = require('../utils/tokens');
const AppError = require('../utils/AppError');
const { User } = require('../models');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Authentication required', 401);
  }

  const token = header.split(' ')[1];
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
  next();
});

const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  try {
    const token = header.split(' ')[1];
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (user && user.isActive && !user.isBlocked) {
      req.user = user;
      req.tokenPayload = decoded;
    }
  } catch {
    // ignore invalid token for optional auth
  }
  next();
});

module.exports = { authenticate, optionalAuth };

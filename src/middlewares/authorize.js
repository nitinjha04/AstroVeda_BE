const AppError = require('../utils/AppError');

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action', 403));
  }
  return next();
};

const requirePermissions = (...permissions) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }
  if (req.user.role === 'admin') return next();

  const userPerms = req.user.permissions || [];
  const missing = permissions.filter((p) => !userPerms.includes(p));
  if (missing.length) {
    return next(new AppError('Insufficient permissions', 403));
  }
  return next();
};

module.exports = { authorize, requirePermissions };

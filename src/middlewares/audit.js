const { AuditLog } = require('../models');

const audit = (action, resource) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400 && req.user) {
      AuditLog.create({
        actor: req.user._id,
        action,
        resource,
        resourceId: req.params.id || body?.data?._id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        meta: { method: req.method, path: req.originalUrl },
      }).catch(() => {});
    }
    return originalJson(body);
  };
  next();
};

module.exports = audit;

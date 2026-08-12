const { Notification } = require('../models');
const EmailService = require('../email/EmailService');
const logger = require('../utils/logger');

const create = async ({ userId, title, body, type = 'system', data = {}, channel = 'in_app' }) => {
  const notification = await Notification.create({
    user: userId,
    title,
    body,
    type,
    data,
    channel,
  });
  return notification;
};

const notifyMany = async (userIds, payload) => {
  const docs = userIds.map((userId) => ({
    user: userId,
    title: payload.title,
    body: payload.body,
    type: payload.type || 'system',
    data: payload.data || {},
    channel: payload.channel || 'in_app',
  }));
  return Notification.insertMany(docs);
};

const listForUser = async (userId, { page = 1, limit = 20, unreadOnly = false } = {}) => {
  const filter = { user: userId };
  if (unreadOnly) filter.isRead = false;
  const skip = (page - 1) * limit;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: userId, isRead: false }),
  ]);
  return { items, unreadCount, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const markRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
};

const markAllRead = async (userId) => {
  await Notification.updateMany({ user: userId, isRead: false }, { isRead: true, readAt: new Date() });
};

const sendEmailNotification = async ({ to, title, body }) => {
  try {
    await EmailService.sendGeneric({
      to,
      subject: title,
      html: `<p>${body}</p>`,
      mustDeliver: false,
    });
  } catch (err) {
    logger.warn(`Email notification failed: ${err.message}`);
  }
};

module.exports = {
  create,
  notifyMany,
  listForUser,
  markRead,
  markAllRead,
  sendEmailNotification,
};

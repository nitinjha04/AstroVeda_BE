const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'system',
        'chat',
        'wallet',
        'order',
        'promo',
        'kyc',
        'withdrawal',
        'referral',
        'ai',
      ],
      default: 'system',
      index: true,
    },
    channel: {
      type: String,
      enum: ['in_app', 'email', 'push', 'sms'],
      default: 'in_app',
    },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

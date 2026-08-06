const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chatRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    senderRole: {
      type: String,
      enum: ['customer', 'astrologer', 'ai', 'system'],
      required: true,
    },
    content: { type: String, required: true, maxlength: 5000 },
    contentType: {
      type: String,
      enum: ['text', 'image', 'audio', 'file', 'system'],
      default: 'text',
    },
    mediaUrl: String,
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen'],
      default: 'sent',
    },
    seenAt: Date,
    deliveredAt: Date,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

messageSchema.index({ chatRoom: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);

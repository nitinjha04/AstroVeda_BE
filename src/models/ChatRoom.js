const mongoose = require('mongoose');
const { CHAT_TYPE, CHAT_STATUS } = require('../utils/constants');

const chatRoomSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(CHAT_TYPE),
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    astrologer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Astrologer',
      index: true,
    },
    /** AI persona (when type is ai) */
    aiAstrologer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AIAstrologer',
      index: true,
    },
    astrologerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CHAT_STATUS),
      default: CHAT_STATUS.PENDING,
      index: true,
    },
    pricePerMinute: { type: Number, required: true, min: 0 },
    startedAt: Date,
    endedAt: Date,
    endedBy: { type: String, enum: ['customer', 'astrologer', 'system', 'wallet', null], default: null },
    endReason: String,
    /** Short label shown in chat history (from first user message) */
    title: { type: String, trim: true, maxlength: 120 },
    durationSeconds: { type: Number, default: 0 },
    billedMinutes: { type: Number, default: 0 },
    totalCharged: { type: Number, default: 0 },
    astrologerEarning: { type: Number, default: 0 },
    platformCommission: { type: Number, default: 0 },
    lastDeductionAt: Date,
    aiConfig: {
      model: String,
      temperature: Number,
      systemPrompt: String,
    },
    rating: {
      score: { type: Number, min: 1, max: 5 },
      review: String,
      ratedAt: Date,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

chatRoomSchema.index({ customer: 1, status: 1 });
chatRoomSchema.index({ customer: 1, aiAstrologer: 1, updatedAt: -1 });
chatRoomSchema.index({ astrologer: 1, status: 1 });
chatRoomSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ChatRoom', chatRoomSchema);

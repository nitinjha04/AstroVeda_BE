const mongoose = require('mongoose');

const aiChatSchema = new mongoose.Schema(
  {
    chatRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true,
      unique: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    model: { type: String, required: true },
    temperature: { type: Number, default: 0.7 },
    systemPrompt: { type: String, required: true },
    totalTokens: { type: Number, default: 0 },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    conversationSummary: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AIChat', aiChatSchema);

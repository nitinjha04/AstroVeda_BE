const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true },
    astrologer: { type: mongoose.Schema.Types.ObjectId, ref: 'Astrologer', index: true },
    chatRoom: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    type: { type: String, enum: ['product', 'astrologer'], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, maxlength: 120 },
    comment: { type: String, maxlength: 2000 },
    images: [String],
    isApproved: { type: Boolean, default: true },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, isApproved: 1 });
reviewSchema.index({ astrologer: 1, isApproved: 1 });

module.exports = mongoose.model('Review', reviewSchema);

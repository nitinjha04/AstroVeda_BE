const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    purpose: {
      type: String,
      enum: ['wallet_recharge', 'order', 'subscription'],
      required: true,
    },
    gateway: { type: String, enum: ['razorpay', 'stripe'], required: true },
    status: {
      type: String,
      enum: ['created', 'pending', 'authorized', 'captured', 'failed', 'refunded'],
      default: 'created',
      index: true,
    },
    gatewayOrderId: { type: String, index: true },
    gatewayPaymentId: { type: String, index: true },
    gatewaySignature: String,
    receipt: String,
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    walletCredited: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    failureReason: String,
    paidAt: Date,
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);

const mongoose = require('mongoose');
const { ORDER_STATUS } = require('../utils/constants');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: mongoose.Schema.Types.ObjectId,
    name: String,
    sku: String,
    image: String,
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    total: { type: Number, required: true },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [orderItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
    couponCode: String,
    paymentMethod: {
      type: String,
      enum: ['wallet', 'razorpay', 'cod'],
      default: 'wallet',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    shippingAddress: {
      name: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      country: String,
    },
    tracking: {
      carrier: String,
      trackingNumber: String,
      trackingUrl: String,
      updates: [
        {
          status: String,
          message: String,
          at: { type: Date, default: Date.now },
        },
      ],
    },
    returnRequest: {
      reason: String,
      status: { type: String, enum: ['none', 'requested', 'approved', 'rejected', 'completed'], default: 'none' },
      requestedAt: Date,
      resolvedAt: Date,
    },
    refundAmount: { type: Number, default: 0 },
    notes: String,
    paidAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);

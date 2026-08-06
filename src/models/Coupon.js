const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['percentage', 'fixed', 'wallet_bonus'], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    usageLimit: { type: Number },
    usageCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },
    usedBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, usedAt: Date }],
    applicableTo: { type: String, enum: ['all', 'products', 'wallet', 'chat'], default: 'all' },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

couponSchema.methods.isValid = function isValid(orderAmount = 0) {
  const now = new Date();
  if (!this.isActive) return { valid: false, reason: 'Coupon inactive' };
  if (now < this.startsAt || now > this.expiresAt) return { valid: false, reason: 'Coupon expired or not started' };
  if (this.usageLimit && this.usageCount >= this.usageLimit) return { valid: false, reason: 'Usage limit reached' };
  if (orderAmount < this.minOrderAmount) return { valid: false, reason: `Minimum order ₹${this.minOrderAmount}` };
  return { valid: true };
};

module.exports = mongoose.model('Coupon', couponSchema);

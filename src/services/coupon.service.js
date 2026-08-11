const { Coupon } = require('../models');
const AppError = require('../utils/AppError');

/** Always-available 100% wallet off — works without seed/env flags (prod + local). */
const BUILTIN_WALLET_COUPONS = {
  FREE100: {
    code: 'FREE100',
    description: '100% off wallet recharge (free credit)',
    type: 'percentage',
    value: 100,
    minOrderAmount: 0,
    applicableTo: 'wallet',
  },
};

const calculateDiscount = (couponLike, amount) => {
  const amt = Number(amount) || 0;
  let discount = 0;
  if (couponLike.type === 'percentage') {
    discount = (amt * Number(couponLike.value || 0)) / 100;
    if (couponLike.maxDiscount != null) {
      discount = Math.min(discount, Number(couponLike.maxDiscount));
    }
  } else if (couponLike.type === 'fixed') {
    discount = Math.min(Number(couponLike.value || 0), amt);
  } else if (couponLike.type === 'wallet_bonus') {
    // Bonus adds extra credit rather than reducing payable — handled separately
    discount = 0;
  }
  discount = Math.min(Math.max(0, Number(discount.toFixed(2))), amt);
  const payable = Number(Math.max(0, amt - discount).toFixed(2));
  const bonus =
    couponLike.type === 'wallet_bonus' ? Number(couponLike.value || 0) : 0;
  const creditAmount = Number((amt + bonus).toFixed(2));
  return { discount, payable, bonus, creditAmount };
};

const isApplicableToWallet = (couponLike) => {
  const a = couponLike.applicableTo || 'all';
  return a === 'all' || a === 'wallet';
};

/**
 * Resolve + validate a wallet coupon. FREE100 is always honoured.
 */
const resolveWalletCoupon = async (code, userId, amount) => {
  if (!code || !String(code).trim()) return null;

  const normalized = String(code).trim().toUpperCase();
  const amt = Number(amount) || 0;

  const builtin = BUILTIN_WALLET_COUPONS[normalized];
  if (builtin) {
    if (!isApplicableToWallet(builtin)) {
      throw new AppError('Coupon not valid for wallet', 400);
    }
    const calc = calculateDiscount(builtin, amt);
    let couponDoc = await Coupon.findOne({ code: normalized });
    if (!couponDoc) {
      const now = new Date();
      couponDoc = await Coupon.create({
        code: normalized,
        description: builtin.description,
        type: builtin.type,
        value: builtin.value,
        minOrderAmount: 0,
        applicableTo: 'wallet',
        startsAt: now,
        expiresAt: new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000),
        usageLimit: 100000,
        perUserLimit: 1000,
        isActive: true,
      });
    }
    return {
      code: normalized,
      coupon: couponDoc,
      builtin: true,
      ...calc,
    };
  }

  const coupon = await Coupon.findOne({ code: normalized, isActive: true });
  if (!coupon) throw new AppError('Invalid coupon code', 400);
  if (!isApplicableToWallet(coupon)) {
    throw new AppError('Coupon not valid for wallet recharges', 400);
  }

  const validity = coupon.isValid(amt);
  if (!validity.valid) throw new AppError(validity.reason || 'Coupon not valid', 400);

  const userUses = (coupon.usedBy || []).filter(
    (u) => u.user && u.user.toString() === userId.toString()
  ).length;
  if (coupon.perUserLimit && userUses >= coupon.perUserLimit) {
    throw new AppError('You have already used this coupon the maximum times', 400);
  }

  const calc = calculateDiscount(coupon, amt);
  return {
    code: coupon.code,
    coupon,
    builtin: false,
    ...calc,
  };
};

const markCouponUsed = async (couponDoc, userId) => {
  if (!couponDoc) return;
  couponDoc.usageCount = (couponDoc.usageCount || 0) + 1;
  couponDoc.usedBy = couponDoc.usedBy || [];
  couponDoc.usedBy.push({ user: userId, usedAt: new Date() });
  await couponDoc.save();
};

const previewWalletCoupon = async (code, userId, amount) => {
  const resolved = await resolveWalletCoupon(code, userId, amount);
  if (!resolved) {
    return {
      valid: false,
      amount: Number(amount) || 0,
      discount: 0,
      payable: Number(amount) || 0,
      creditAmount: Number(amount) || 0,
    };
  }
  return {
    valid: true,
    code: resolved.code,
    amount: Number(amount) || 0,
    discount: resolved.discount,
    payable: resolved.payable,
    bonus: resolved.bonus,
    creditAmount: resolved.creditAmount,
    description:
      resolved.coupon?.description ||
      BUILTIN_WALLET_COUPONS[resolved.code]?.description ||
      '',
  };
};

module.exports = {
  BUILTIN_WALLET_COUPONS,
  calculateDiscount,
  resolveWalletCoupon,
  markCouponUsed,
  previewWalletCoupon,
};

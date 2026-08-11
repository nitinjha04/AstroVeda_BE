const walletService = require('../../services/wallet.service');
const paymentService = require('../../services/payment.service');
const couponService = require('../../services/coupon.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../utils/apiResponse');

const getWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.getBalance(req.user._id);
  return success(res, { data: wallet });
});

const getTransactions = asyncHandler(async (req, res) => {
  const result = await walletService.getTransactions(req.user._id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
    type: req.query.type,
  });
  return success(res, { data: result.items, meta: result.meta });
});

const createRecharge = asyncHandler(async (req, res) => {
  const data = await paymentService.createWalletRecharge(req.user._id, Number(req.body.amount), {
    couponCode: req.body.couponCode || req.body.coupon || undefined,
  });
  return success(res, {
    message: data.free ? 'Wallet recharged with coupon' : 'Recharge order created',
    data,
  });
});

const verifyRecharge = asyncHandler(async (req, res) => {
  const data = await paymentService.verifyRazorpayPayment({
    userId: req.user._id,
    paymentId: req.body.paymentId,
    razorpayOrderId: req.body.razorpayOrderId || req.body.razorpay_order_id,
    razorpayPaymentId: req.body.razorpayPaymentId || req.body.razorpay_payment_id,
    razorpaySignature: req.body.razorpaySignature || req.body.razorpay_signature,
  });
  return success(res, { message: 'Wallet recharged', data });
});

const paymentStatus = asyncHandler(async (req, res) => {
  const data = await paymentService.getPaymentStatus(req.user._id, req.params.paymentId);
  return success(res, { data });
});

const confirmStubRecharge = asyncHandler(async (req, res) => {
  const data = await paymentService.confirmStubPayment(req.user._id, req.body.paymentId);
  return success(res, { message: 'Wallet recharged (test)', data });
});

const validateCoupon = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const code = req.body.couponCode || req.body.code;
  if (!code) {
    return success(res, {
      data: { valid: false, message: 'Enter a coupon code' },
    });
  }
  try {
    const data = await couponService.previewWalletCoupon(code, req.user._id, amount);
    return success(res, {
      message: data.valid ? 'Coupon applied' : 'Coupon not applied',
      data: {
        ...data,
        message: data.valid ? 'Coupon applied' : 'Invalid coupon',
      },
    });
  } catch (err) {
    return success(res, {
      data: {
        valid: false,
        message: err.message || 'Invalid coupon',
        amount,
        discount: 0,
        payable: amount,
        creditAmount: amount,
      },
    });
  }
});

module.exports = {
  getWallet,
  getTransactions,
  createRecharge,
  verifyRecharge,
  paymentStatus,
  confirmStubRecharge,
  validateCoupon,
};

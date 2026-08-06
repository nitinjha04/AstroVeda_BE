const walletService = require('../../services/wallet.service');
const paymentService = require('../../services/payment.service');
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
  const data = await paymentService.createWalletRecharge(req.user._id, Number(req.body.amount));
  return success(res, { message: 'Recharge order created', data });
});

const verifyRecharge = asyncHandler(async (req, res) => {
  const data = await paymentService.verifyRazorpayPayment({
    userId: req.user._id,
    ...req.body,
  });
  return success(res, { message: 'Wallet recharged', data });
});

const confirmStubRecharge = asyncHandler(async (req, res) => {
  const data = await paymentService.confirmStubPayment(req.user._id, req.body.paymentId);
  return success(res, { message: 'Wallet recharged (test)', data });
});

module.exports = {
  getWallet,
  getTransactions,
  createRecharge,
  verifyRecharge,
  confirmStubRecharge,
};

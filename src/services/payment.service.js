const Razorpay = require('razorpay');
const crypto = require('crypto');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { Payment } = require('../models');
const AppError = require('../utils/AppError');
const walletService = require('./wallet.service');
const { WALLET_TX_TYPE } = require('../utils/constants');

let razorpay = null;
let stripe = null;

const getRazorpay = () => {
  if (!config.payment.razorpay.keyId || !config.payment.razorpay.keySecret) return null;
  if (!razorpay) {
    razorpay = new Razorpay({
      key_id: config.payment.razorpay.keyId,
      key_secret: config.payment.razorpay.keySecret,
    });
  }
  return razorpay;
};

const getStripe = () => {
  if (!config.payment.stripe.secretKey) return null;
  if (!stripe) stripe = new Stripe(config.payment.stripe.secretKey);
  return stripe;
};

const createWalletRecharge = async (userId, amount) => {
  if (amount < config.wallet.minRecharge || amount > config.wallet.maxRecharge) {
    throw new AppError(
      `Amount must be between ₹${config.wallet.minRecharge} and ₹${config.wallet.maxRecharge}`,
      400
    );
  }

  const gateway = config.payment.gateway;
  const receipt = `wr_${uuidv4().slice(0, 8)}`;

  if (gateway === 'stripe') {
    const stripeClient = getStripe();
    if (!stripeClient) throw new AppError('Stripe not configured', 503);

    const intent = await stripeClient.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'inr',
      metadata: { userId: userId.toString(), purpose: 'wallet_recharge' },
    });

    const payment = await Payment.create({
      user: userId,
      amount,
      purpose: 'wallet_recharge',
      gateway: 'stripe',
      status: 'created',
      gatewayOrderId: intent.id,
      receipt,
      metadata: { clientSecret: intent.client_secret },
    });

    return {
      paymentId: payment._id,
      gateway: 'stripe',
      clientSecret: intent.client_secret,
      amount,
    };
  }

  // Default Razorpay
  const rp = getRazorpay();
  if (!rp) {
    // Dev stub – create payment record for manual/test flow
    const payment = await Payment.create({
      user: userId,
      amount,
      purpose: 'wallet_recharge',
      gateway: 'razorpay',
      status: 'created',
      gatewayOrderId: `order_stub_${Date.now()}`,
      receipt,
      metadata: { stub: true },
    });
    return {
      paymentId: payment._id,
      gateway: 'razorpay',
      orderId: payment.gatewayOrderId,
      amount,
      currency: 'INR',
      keyId: 'stub_key',
      stub: true,
    };
  }

  const order = await rp.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt,
    notes: { userId: userId.toString(), purpose: 'wallet_recharge' },
  });

  const payment = await Payment.create({
    user: userId,
    amount,
    purpose: 'wallet_recharge',
    gateway: 'razorpay',
    status: 'created',
    gatewayOrderId: order.id,
    receipt,
  });

  return {
    paymentId: payment._id,
    gateway: 'razorpay',
    orderId: order.id,
    amount,
    currency: 'INR',
    keyId: config.payment.razorpay.keyId,
  };
};

const verifyRazorpayPayment = async ({
  userId,
  paymentId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const payment = await Payment.findOne({ _id: paymentId, user: userId });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.walletCredited) throw new AppError('Payment already processed', 409);

  const secret = config.payment.razorpay.keySecret;
  if (secret) {
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (expected !== razorpaySignature) throw new AppError('Invalid payment signature', 400);
  }

  payment.gatewayPaymentId = razorpayPaymentId;
  payment.gatewaySignature = razorpaySignature;
  payment.status = 'captured';
  payment.paidAt = new Date();
  payment.walletCredited = true;
  await payment.save();

  const result = await walletService.credit({
    userId,
    amount: payment.amount,
    type: WALLET_TX_TYPE.RECHARGE,
    description: 'Wallet recharge via Razorpay',
    referenceModel: 'Payment',
    referenceId: payment._id,
    reference: razorpayPaymentId,
  });

  return { payment, wallet: result.wallet };
};

/** Dev/test helper when gateway is stubbed */
const confirmStubPayment = async (userId, paymentId) => {
  const payment = await Payment.findOne({ _id: paymentId, user: userId });
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.walletCredited) throw new AppError('Already credited', 409);
  if (!payment.metadata?.stub && config.env === 'production') {
    throw new AppError('Not allowed', 403);
  }

  payment.status = 'captured';
  payment.paidAt = new Date();
  payment.walletCredited = true;
  payment.gatewayPaymentId = `pay_stub_${Date.now()}`;
  await payment.save();

  const result = await walletService.credit({
    userId,
    amount: payment.amount,
    type: WALLET_TX_TYPE.RECHARGE,
    description: 'Wallet recharge (test)',
    referenceModel: 'Payment',
    referenceId: payment._id,
  });

  return { payment, wallet: result.wallet };
};

module.exports = {
  createWalletRecharge,
  verifyRazorpayPayment,
  confirmStubPayment,
  getRazorpay,
  getStripe,
};

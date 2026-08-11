const crypto = require('crypto');
const config = require('../config');
const { Payment, Coupon } = require('../models');
const AppError = require('../utils/AppError');
const walletService = require('./wallet.service');
const couponService = require('./coupon.service');
const { WALLET_TX_TYPE } = require('../utils/constants');
const logger = require('../utils/logger');
const Razorpay = require('razorpay');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');

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

/**
 * Idempotent credit for a captured wallet recharge Payment document.
 */
const finalizeWalletPayment = async (
  payment,
  { gatewayPaymentId, gatewaySignature, source = 'unknown' } = {}
) => {
  if (!payment) throw new AppError('Payment not found', 404);

  if (payment.walletCredited) {
    return { payment, alreadyCredited: true };
  }

  // Atomic claim so webhook + client verify don't double-credit
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, walletCredited: { $ne: true } },
    {
      $set: {
        walletCredited: true,
        status: 'captured',
        paidAt: new Date(),
        ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
        ...(gatewaySignature ? { gatewaySignature } : {}),
        'metadata.creditSource': source,
      },
    },
    { new: true }
  );

  if (!claimed) {
    const current = await Payment.findById(payment._id);
    return { payment: current, alreadyCredited: true };
  }

  if (claimed.metadata?.couponId) {
    const coupon = await Coupon.findById(claimed.metadata.couponId);
    if (coupon) await couponService.markCouponUsed(coupon, claimed.user);
  } else if (claimed.metadata?.couponCode) {
    const coupon = await Coupon.findOne({
      code: String(claimed.metadata.couponCode).toUpperCase(),
    });
    if (coupon) await couponService.markCouponUsed(coupon, claimed.user);
  }

  const couponNote = claimed.metadata?.couponCode
    ? ` · coupon ${claimed.metadata.couponCode}`
    : '';

  const result = await walletService.credit({
    userId: claimed.user,
    amount: claimed.amount,
    type: WALLET_TX_TYPE.RECHARGE,
    description: `Wallet recharge via Razorpay${couponNote}`,
    referenceModel: 'Payment',
    referenceId: claimed._id,
    reference: gatewayPaymentId || claimed.gatewayPaymentId || claimed.gatewayOrderId,
  });

  logger.info(
    `Wallet credited payment=${claimed._id} amount=${claimed.amount} source=${source} user=${claimed.user}`
  );

  return { payment: claimed, wallet: result.wallet, alreadyCredited: false };
};

const createWalletRecharge = async (userId, amount, opts = {}) => {
  const gross = Number(amount);
  if (Number.isNaN(gross) || gross < config.wallet.minRecharge || gross > config.wallet.maxRecharge) {
    throw new AppError(
      `Amount must be between ₹${config.wallet.minRecharge} and ₹${config.wallet.maxRecharge}`,
      400
    );
  }

  let couponApply = null;
  if (opts.couponCode) {
    couponApply = await couponService.resolveWalletCoupon(opts.couponCode, userId, gross);
  }

  const creditAmount = couponApply ? couponApply.creditAmount : gross;
  const payable = couponApply ? couponApply.payable : gross;
  const discount = couponApply ? couponApply.discount : 0;
  const receipt = `wr_${uuidv4().slice(0, 8)}`;

  if (payable <= 0) {
    if (!couponApply) throw new AppError('Invalid free recharge', 400);

    const payment = await Payment.create({
      user: userId,
      amount: creditAmount,
      purpose: 'wallet_recharge',
      gateway: 'razorpay',
      status: 'captured',
      gatewayOrderId: `order_free_${Date.now()}`,
      gatewayPaymentId: `pay_free_${Date.now()}`,
      receipt,
      walletCredited: true,
      paidAt: new Date(),
      metadata: {
        free: true,
        couponCode: couponApply.code,
        discount,
        payable: 0,
        requestedAmount: gross,
        creditSource: 'coupon',
      },
    });

    await couponService.markCouponUsed(couponApply.coupon, userId);

    const result = await walletService.credit({
      userId,
      amount: creditAmount,
      type: WALLET_TX_TYPE.RECHARGE,
      description: `Wallet recharge · coupon ${couponApply.code}`,
      referenceModel: 'Payment',
      referenceId: payment._id,
      reference: payment.gatewayPaymentId,
    });

    return {
      paymentId: payment._id,
      gateway: 'razorpay',
      free: true,
      amount: creditAmount,
      payable: 0,
      discount,
      couponCode: couponApply.code,
      currency: 'INR',
      wallet: result.wallet,
      message: `₹${creditAmount} added with coupon`,
    };
  }

  if ((config.payment.gateway || 'razorpay') === 'stripe') {
    const stripeClient = getStripe();
    if (!stripeClient) throw new AppError('Stripe not configured', 503);

    const intent = await stripeClient.paymentIntents.create({
      amount: Math.round(payable * 100),
      currency: 'inr',
      metadata: {
        userId: userId.toString(),
        purpose: 'wallet_recharge',
        creditAmount: String(creditAmount),
        couponCode: couponApply?.code || '',
      },
    });

    const payment = await Payment.create({
      user: userId,
      amount: creditAmount,
      purpose: 'wallet_recharge',
      gateway: 'stripe',
      status: 'created',
      gatewayOrderId: intent.id,
      receipt,
      metadata: {
        clientSecret: intent.client_secret,
        couponCode: couponApply?.code,
        discount,
        payable,
        requestedAmount: gross,
      },
    });

    if (couponApply?.coupon) {
      payment.metadata.couponId = couponApply.coupon._id.toString();
      await payment.save();
    }

    return {
      paymentId: payment._id,
      gateway: 'stripe',
      clientSecret: intent.client_secret,
      amount: creditAmount,
      payable,
      discount,
      couponCode: couponApply?.code || null,
    };
  }

  const rp = getRazorpay();
  if (!rp) {
    throw new AppError(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.',
      503
    );
  }

  const order = await rp.orders.create({
    amount: Math.round(payable * 100),
    currency: 'INR',
    receipt,
    notes: {
      userId: userId.toString(),
      purpose: 'wallet_recharge',
      creditAmount: String(creditAmount),
      couponCode: couponApply?.code || '',
      internalPaymentId: '', // filled after create
    },
  });

  const payment = await Payment.create({
    user: userId,
    amount: creditAmount,
    purpose: 'wallet_recharge',
    gateway: 'razorpay',
    status: 'created',
    gatewayOrderId: order.id,
    receipt,
    metadata: {
      couponCode: couponApply?.code || null,
      couponId: couponApply?.coupon?._id?.toString() || null,
      discount,
      payable,
      requestedAmount: gross,
    },
  });

  // Attach internal id on order notes is optional — gatewayOrderId lookup is enough
  try {
    await rp.orders.edit?.(order.id, {
      notes: {
        userId: userId.toString(),
        purpose: 'wallet_recharge',
        creditAmount: String(creditAmount),
        couponCode: couponApply?.code || '',
        internalPaymentId: payment._id.toString(),
      },
    });
  } catch {
    /* order.edit may not exist on all SDK versions — ignore */
  }

  return {
    paymentId: payment._id,
    gateway: 'razorpay',
    orderId: order.id,
    amount: creditAmount,
    payable,
    discount,
    couponCode: couponApply?.code || null,
    currency: 'INR',
    keyId: config.payment.razorpay.keyId,
    free: false,
  };
};

/** Client-side Checkout success (secondary to webhook; same finalize). */
const verifyRazorpayPayment = async ({
  userId,
  paymentId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  const payment = await Payment.findOne({ _id: paymentId, user: userId });
  if (!payment) throw new AppError('Payment not found', 404);

  if (payment.gatewayOrderId && razorpayOrderId && payment.gatewayOrderId !== razorpayOrderId) {
    throw new AppError('Order id mismatch', 400);
  }

  const secret = config.payment.razorpay.keySecret;
  if (!secret) throw new AppError('Razorpay secret not configured', 503);

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== razorpaySignature) throw new AppError('Invalid payment signature', 400);

  return finalizeWalletPayment(payment, {
    gatewayPaymentId: razorpayPaymentId,
    gatewaySignature: razorpaySignature,
    source: 'client_verify',
  });
};

/**
 * Razorpay webhook — primary credit path.
 * Signature: HMAC-SHA256(rawBody, webhook_secret)
 */
const handleRazorpayWebhook = async (rawBody, signatureHeader) => {
  const secret = config.payment.razorpay.webhookSecret || config.payment.razorpay.keySecret;
  if (!secret) {
    throw new AppError('Razorpay webhook secret not configured', 503);
  }

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!signatureHeader || expected !== signatureHeader) {
    logger.warn('Razorpay webhook signature mismatch');
    throw new AppError('Invalid webhook signature', 400);
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError('Invalid webhook body', 400);
  }

  const eventName = event.event || '';
  logger.info(`Razorpay webhook event=${eventName}`);

  // payment.captured | payment.authorized | order.paid
  let orderId = null;
  let paymentId = null;

  if (eventName.startsWith('payment.')) {
    const entity = event.payload?.payment?.entity;
    if (entity) {
      orderId = entity.order_id;
      paymentId = entity.id;
      // Only credit on successful money capture / authorized (auto-capture)
      if (!['captured', 'authorized'].includes(entity.status) && eventName !== 'payment.captured') {
        return { handled: false, event: eventName, reason: `status ${entity.status}` };
      }
    }
  } else if (eventName === 'order.paid') {
    const entity = event.payload?.order?.entity;
    orderId = entity?.id;
    paymentId = entity?.payments?.[0] || null;
  } else {
    return { handled: false, event: eventName, reason: 'ignored event' };
  }

  if (!orderId) {
    return { handled: false, event: eventName, reason: 'no order id' };
  }

  const payment = await Payment.findOne({
    gatewayOrderId: orderId,
    purpose: 'wallet_recharge',
  });

  if (!payment) {
    logger.warn(`Razorpay webhook: no Payment for order ${orderId}`);
    return { handled: false, event: eventName, reason: 'payment not found' };
  }

  const result = await finalizeWalletPayment(payment, {
    gatewayPaymentId: paymentId || payment.gatewayPaymentId,
    source: `webhook:${eventName}`,
  });

  return {
    handled: true,
    event: eventName,
    paymentId: payment._id,
    alreadyCredited: result.alreadyCredited,
  };
};

const confirmStubPayment = async () => {
  throw new AppError('Stub recharge is disabled. Use Razorpay Checkout or a free coupon.', 403);
};

const getPaymentStatus = async (userId, paymentId) => {
  const payment = await Payment.findOne({ _id: paymentId, user: userId }).lean();
  if (!payment) throw new AppError('Payment not found', 404);
  let wallet = null;
  if (payment.walletCredited) {
    wallet = await walletService.getBalance(userId);
  }
  return {
    paymentId: payment._id,
    status: payment.status,
    walletCredited: payment.walletCredited,
    amount: payment.amount,
    balance: wallet?.balance,
  };
};

module.exports = {
  createWalletRecharge,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  finalizeWalletPayment,
  confirmStubPayment,
  getPaymentStatus,
  getRazorpay,
  getStripe,
};

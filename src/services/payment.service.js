const crypto = require('crypto');
const config = require('../config');
const { Payment, Coupon, Order, PoojaBooking, Product, Cart } = require('../models');
const AppError = require('../utils/AppError');
const walletService = require('./wallet.service');
const couponService = require('./coupon.service');
const { WALLET_TX_TYPE, ORDER_STATUS } = require('../utils/constants');
const logger = require('../utils/logger');
const Razorpay = require('razorpay');
const { v4: uuidv4 } = require('uuid');

let razorpay = null;

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

const requireRazorpay = () => {
  const rp = getRazorpay();
  if (!rp) {
    throw new AppError(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.',
      503
    );
  }
  return rp;
};

/** Create a Razorpay order + Payment document for any purpose. */
const createGatewayOrder = async ({
  userId,
  amount,
  purpose,
  receipt,
  notes = {},
  orderId = null,
  poojaBookingId = null,
  metadata = {},
}) => {
  const rp = requireRazorpay();
  const payable = Number(amount);
  if (!(payable > 0)) throw new AppError('Payable amount must be greater than zero', 400);

  const order = await rp.orders.create({
    amount: Math.round(payable * 100),
    currency: 'INR',
    receipt: receipt || `pay_${uuidv4().slice(0, 10)}`,
    notes: {
      userId: userId.toString(),
      purpose,
      ...notes,
    },
  });

  const payment = await Payment.create({
    user: userId,
    amount: payable,
    purpose,
    gateway: 'razorpay',
    status: 'created',
    gatewayOrderId: order.id,
    receipt: receipt || order.receipt,
    order: orderId || undefined,
    poojaBooking: poojaBookingId || undefined,
    metadata,
  });

  return {
    payment,
    gatewayOrderId: order.id,
    keyId: config.payment.razorpay.keyId,
    amount: payable,
    currency: 'INR',
  };
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
    return { payment, alreadyCredited: true, purpose: 'wallet_recharge' };
  }

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
    return { payment: current, alreadyCredited: true, purpose: 'wallet_recharge' };
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

  return {
    payment: claimed,
    wallet: result.wallet,
    alreadyCredited: false,
    purpose: 'wallet_recharge',
  };
};

const reserveOrderStock = async (order) => {
  if (!order || order.stockReserved) return;
  for (const item of order.items) {
    if (item.variantId) {
      await Product.updateOne(
        { _id: item.product, 'variants._id': item.variantId },
        { $inc: { 'variants.$.stock': -item.quantity, soldCount: item.quantity } }
      );
    } else {
      await Product.updateOne(
        { _id: item.product },
        { $inc: { stock: -item.quantity, soldCount: item.quantity } }
      );
    }
  }
  order.stockReserved = true;
  await order.save();
};

const finalizeOrderPayment = async (
  payment,
  { gatewayPaymentId, gatewaySignature, source = 'unknown' } = {}
) => {
  if (!payment) throw new AppError('Payment not found', 404);

  if (payment.status === 'captured') {
    const order = payment.order ? await Order.findById(payment.order) : null;
    return { payment, order, alreadyPaid: true, purpose: 'order' };
  }

  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: 'captured' } },
    {
      $set: {
        status: 'captured',
        paidAt: new Date(),
        ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
        ...(gatewaySignature ? { gatewaySignature } : {}),
        'metadata.paidSource': source,
      },
    },
    { new: true }
  );

  if (!claimed) {
    const current = await Payment.findById(payment._id);
    const order = current?.order ? await Order.findById(current.order) : null;
    return { payment: current, order, alreadyPaid: true, purpose: 'order' };
  }

  const order = await Order.findById(claimed.order);
  if (!order) {
    logger.warn(`Order payment ${claimed._id}: order missing`);
    return { payment: claimed, order: null, alreadyPaid: false, purpose: 'order' };
  }

  if (order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    order.paymentMethod = 'razorpay';
    order.status = ORDER_STATUS.CONFIRMED;
    order.paidAt = new Date();
    order.payment = claimed._id;
    if (!order.tracking?.updates?.length) {
      order.tracking = {
        updates: [{ status: ORDER_STATUS.CONFIRMED, message: 'Order confirmed' }],
      };
    } else {
      order.tracking.updates.push({
        status: ORDER_STATUS.CONFIRMED,
        message: 'Payment received',
      });
    }
    await order.save();
    await reserveOrderStock(order);
  }

  // Ensure cart is clear for this user
  await Cart.findOneAndUpdate({ user: claimed.user }, { items: [], couponCode: null });

  logger.info(`Order paid payment=${claimed._id} order=${order._id} source=${source}`);
  return { payment: claimed, order, alreadyPaid: false, purpose: 'order' };
};

const finalizePoojaPayment = async (
  payment,
  { gatewayPaymentId, gatewaySignature, source = 'unknown' } = {}
) => {
  if (!payment) throw new AppError('Payment not found', 404);

  if (payment.status === 'captured') {
    const booking = payment.poojaBooking
      ? await PoojaBooking.findById(payment.poojaBooking).populate(
          'pooja',
          'name slug glyph duration price category'
        )
      : null;
    return { payment, booking, alreadyPaid: true, purpose: 'pooja_booking' };
  }

  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: 'captured' } },
    {
      $set: {
        status: 'captured',
        paidAt: new Date(),
        ...(gatewayPaymentId ? { gatewayPaymentId } : {}),
        ...(gatewaySignature ? { gatewaySignature } : {}),
        'metadata.paidSource': source,
      },
    },
    { new: true }
  );

  if (!claimed) {
    const current = await Payment.findById(payment._id);
    const booking = current?.poojaBooking
      ? await PoojaBooking.findById(current.poojaBooking)
      : null;
    return { payment: current, booking, alreadyPaid: true, purpose: 'pooja_booking' };
  }

  const booking = await PoojaBooking.findById(claimed.poojaBooking);
  if (booking && booking.paymentStatus !== 'paid') {
    booking.paymentStatus = 'paid';
    booking.paymentMethod = 'razorpay';
    booking.status = 'confirmed';
    booking.paidAt = new Date();
    booking.payment = claimed._id;
    await booking.save();
  }

  if (booking) {
    await booking.populate('pooja', 'name slug glyph duration price category');
  }

  logger.info(`Pooja paid payment=${claimed._id} booking=${booking?._id} source=${source}`);
  return { payment: claimed, booking, alreadyPaid: false, purpose: 'pooja_booking' };
};

/** Route finalize by Payment.purpose */
const finalizePayment = async (payment, opts = {}) => {
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.purpose === 'wallet_recharge') return finalizeWalletPayment(payment, opts);
  if (payment.purpose === 'order') return finalizeOrderPayment(payment, opts);
  if (payment.purpose === 'pooja_booking') return finalizePoojaPayment(payment, opts);
  throw new AppError(`Unsupported payment purpose: ${payment.purpose}`, 400);
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

  const created = await createGatewayOrder({
    userId,
    amount: payable,
    purpose: 'wallet_recharge',
    receipt,
    notes: {
      creditAmount: String(creditAmount),
      couponCode: couponApply?.code || '',
    },
    metadata: {
      couponCode: couponApply?.code || null,
      couponId: couponApply?.coupon?._id?.toString() || null,
      discount,
      payable,
      requestedAmount: gross,
      creditAmount,
    },
  });

  // Store credit amount on payment (wallet gets creditAmount, not payable)
  if (creditAmount !== payable) {
    created.payment.amount = creditAmount;
    created.payment.metadata = {
      ...created.payment.metadata,
      payable,
      creditAmount,
    };
    await created.payment.save();
  }

  return {
    paymentId: created.payment._id,
    gateway: 'razorpay',
    orderId: created.gatewayOrderId,
    amount: creditAmount,
    payable,
    discount,
    couponCode: couponApply?.code || null,
    currency: 'INR',
    keyId: created.keyId,
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

  return finalizePayment(payment, {
    gatewayPaymentId: razorpayPaymentId,
    gatewaySignature: razorpaySignature,
    source: 'client_verify',
  });
};

/**
 * Razorpay webhook — primary settle path for wallet / order / pooja.
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

  let orderId = null;
  let paymentId = null;

  if (eventName.startsWith('payment.')) {
    const entity = event.payload?.payment?.entity;
    if (entity) {
      orderId = entity.order_id;
      paymentId = entity.id;
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

  const payment = await Payment.findOne({ gatewayOrderId: orderId });

  if (!payment) {
    logger.warn(`Razorpay webhook: no Payment for order ${orderId}`);
    return { handled: false, event: eventName, reason: 'payment not found' };
  }

  const result = await finalizePayment(payment, {
    gatewayPaymentId: paymentId || payment.gatewayPaymentId,
    source: `webhook:${eventName}`,
  });

  return {
    handled: true,
    event: eventName,
    purpose: payment.purpose,
    paymentId: payment._id,
    alreadyCredited: result.alreadyCredited,
    alreadyPaid: result.alreadyPaid,
  };
};

const confirmStubPayment = async () => {
  throw new AppError('Stub recharge is disabled. Use Razorpay Checkout or a free coupon.', 403);
};

const getPaymentStatus = async (userId, paymentId) => {
  const payment = await Payment.findOne({ _id: paymentId, user: userId }).lean();
  if (!payment) throw new AppError('Payment not found', 404);

  let wallet = null;
  if (payment.purpose === 'wallet_recharge' && payment.walletCredited) {
    wallet = await walletService.getBalance(userId);
  }

  const paid =
    payment.status === 'captured' ||
    payment.walletCredited === true ||
    Boolean(payment.paidAt);

  return {
    paymentId: payment._id,
    purpose: payment.purpose,
    status: payment.status,
    paid,
    walletCredited: payment.walletCredited,
    amount: payment.amount,
    balance: wallet?.balance,
    orderId: payment.order,
    poojaBookingId: payment.poojaBooking,
  };
};

module.exports = {
  createWalletRecharge,
  createGatewayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  finalizePayment,
  finalizeWalletPayment,
  finalizeOrderPayment,
  finalizePoojaPayment,
  confirmStubPayment,
  getPaymentStatus,
  getRazorpay,
  requireRazorpay,
};

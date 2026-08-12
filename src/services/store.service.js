const { Product, Category, Cart, Order, Coupon, Review } = require('../models');
const AppError = require('../utils/AppError');
const { ORDER_STATUS, WALLET_TX_TYPE } = require('../utils/constants');
const paymentService = require('./payment.service');
const walletService = require('./wallet.service');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const listProducts = async ({ page = 1, limit = 20, category, search, featured, sort = '-createdAt' } = {}) => {
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (featured === 'true') filter.isFeatured = true;
  if (search) filter.$text = { $search: search };

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name slug')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit)),
    Product.countDocuments(filter),
  ]);
  return { items, meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } };
};

const getProductBySlug = async (slug) => {
  const product = await Product.findOne({ slug, isActive: true })
    .populate('category', 'name slug')
    .populate('subCategory', 'name slug');
  if (!product) throw new AppError('Product not found', 404);
  return product;
};

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
};

const addToCart = async (userId, { productId, variantId, quantity = 1 }) => {
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new AppError('Product not found', 404);

  let price = product.price;
  let stock = product.stock;
  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant || !variant.isActive) throw new AppError('Variant not found', 404);
    price = variant.price;
    stock = variant.stock;
  }
  if (stock < quantity) throw new AppError('Insufficient stock', 400);

  const cart = await getOrCreateCart(userId);
  const idx = cart.items.findIndex((i) => {
    const pid = i.product._id ? i.product._id.toString() : i.product.toString();
    return pid === productId && String(i.variantId || '') === String(variantId || '');
  });

  if (idx >= 0) {
    cart.items[idx].quantity += quantity;
    cart.items[idx].price = price;
  } else {
    cart.items.push({ product: productId, variantId, quantity, price });
  }
  await cart.save();
  return getOrCreateCart(userId);
};

const updateCartItem = async (userId, itemId, quantity) => {
  const cart = await Cart.findOne({ user: userId });
  if (!cart) throw new AppError('Cart not found', 404);
  const item = cart.items.id(itemId);
  if (!item) throw new AppError('Cart item not found', 404);
  if (quantity <= 0) item.deleteOne();
  else item.quantity = quantity;
  await cart.save();
  return getOrCreateCart(userId);
};

const clearCart = async (userId) => {
  await Cart.findOneAndUpdate({ user: userId }, { items: [], couponCode: null });
};

const buildCheckoutTotals = async (userId, cart, couponCode) => {
  let subtotal = 0;
  const orderItems = [];

  for (const item of cart.items) {
    const product = item.product;
    if (!product || !product.isActive) throw new AppError(`Product unavailable: ${item.product}`, 400);

    let price = product.price;
    let stock = product.stock;
    let sku = product.sku;
    let name = product.name;
    let image = product.images?.[0]?.url || '';

    if (item.variantId) {
      const variant = product.variants.id(item.variantId);
      if (!variant) throw new AppError('Variant missing', 400);
      price = variant.price;
      stock = variant.stock;
      sku = variant.sku;
      name = `${product.name} - ${variant.name}`;
    }

    if (stock < item.quantity) throw new AppError(`Insufficient stock for ${name}`, 400);

    const lineTotal = price * item.quantity;
    subtotal += lineTotal;
    orderItems.push({
      product: product._id,
      variantId: item.variantId,
      name,
      sku,
      image,
      price,
      quantity: item.quantity,
      total: lineTotal,
    });
  }

  let discount = 0;
  let coupon = null;
  const code = couponCode || cart.couponCode;
  if (code) {
    coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
    if (!coupon) throw new AppError('Invalid coupon', 400);
    const validity = coupon.isValid(subtotal);
    if (!validity.valid) throw new AppError(validity.reason, 400);
    const userUses = (coupon.usedBy || []).filter((u) => u.user.toString() === userId.toString()).length;
    if (userUses >= coupon.perUserLimit) throw new AppError('Coupon already used', 400);

    if (coupon.type === 'percentage') {
      discount = (subtotal * coupon.value) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    } else if (coupon.type === 'fixed') {
      discount = Math.min(coupon.value, subtotal);
    }
  }

  const shippingFee = subtotal - discount >= 999 ? 0 : 49;
  const total = Number((subtotal - discount + shippingFee).toFixed(2));
  if (!(total > 0)) throw new AppError('Order total must be greater than zero', 400);

  return { subtotal, discount, shippingFee, total, orderItems, coupon };
};

const reserveStockForItems = async (orderItems) => {
  for (const item of orderItems) {
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
};

/**
 * Checkout via Razorpay or wallet.
 */
const checkout = async (userId, { address, couponCode, paymentMethod = 'razorpay' } = {}) => {
  const method = paymentMethod === 'wallet' ? 'wallet' : 'razorpay';

  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || !cart.items.length) throw new AppError('Cart is empty', 400);
  if (!address) throw new AppError('Shipping address required', 400);

  const { subtotal, discount, shippingFee, total, orderItems, coupon } = await buildCheckoutTotals(
    userId,
    cart,
    couponCode
  );

  if (method === 'wallet') {
    const bal = await walletService.getBalance(userId);
    if (!bal || Number(bal.balance) < total) {
      throw new AppError('Insufficient wallet balance', 402);
    }

    await walletService.debit({
      userId,
      amount: total,
      type: WALLET_TX_TYPE.ORDER_PAYMENT,
      description: 'Store order payment',
    });

    if (coupon) {
      coupon.usageCount += 1;
      coupon.usedBy.push({ user: userId, usedAt: new Date() });
      await coupon.save();
    }

    await reserveStockForItems(orderItems);

    const order = await Order.create({
      orderNumber: `AV${Date.now().toString(36).toUpperCase()}${uuidv4().slice(0, 4).toUpperCase()}`,
      user: userId,
      items: orderItems,
      subtotal,
      discount,
      shippingFee,
      total,
      coupon: coupon?._id,
      couponCode: coupon?.code,
      paymentMethod: 'wallet',
      paymentStatus: 'paid',
      status: ORDER_STATUS.CONFIRMED,
      shippingAddress: address,
      stockReserved: true,
      paidAt: new Date(),
      tracking: {
        updates: [{ status: ORDER_STATUS.CONFIRMED, message: 'Paid from wallet' }],
      },
    });

    cart.items = [];
    cart.couponCode = undefined;
    await cart.save();

    const wallet = await walletService.getBalance(userId);
    return {
      order,
      paid: true,
      paymentMethod: 'wallet',
      amount: total,
      wallet,
    };
  }

  const order = await Order.create({
    orderNumber: `AV${Date.now().toString(36).toUpperCase()}${uuidv4().slice(0, 4).toUpperCase()}`,
    user: userId,
    items: orderItems,
    subtotal,
    discount,
    shippingFee,
    total,
    coupon: coupon?._id,
    couponCode: coupon?.code,
    paymentMethod: 'razorpay',
    paymentStatus: 'pending',
    status: ORDER_STATUS.PENDING,
    shippingAddress: address,
    stockReserved: false,
    tracking: {
      updates: [{ status: ORDER_STATUS.PENDING, message: 'Awaiting payment' }],
    },
  });

  if (coupon) {
    coupon.usageCount += 1;
    coupon.usedBy.push({ user: userId, usedAt: new Date() });
    await coupon.save();
  }

  const gateway = await paymentService.createGatewayOrder({
    userId,
    amount: total,
    purpose: 'order',
    receipt: `ord_${uuidv4().slice(0, 8)}`,
    orderId: order._id,
    notes: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
    },
    metadata: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
    },
  });

  order.payment = gateway.payment._id;
  await order.save();

  return {
    order,
    paymentId: gateway.payment._id,
    orderId: gateway.gatewayOrderId,
    keyId: gateway.keyId || config.payment.razorpay.keyId,
    amount: gateway.amount,
    payable: gateway.amount,
    currency: gateway.currency,
    gateway: 'razorpay',
    paid: false,
    paymentMethod: 'razorpay',
  };
};

const listOrders = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const filter = { user: userId };
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
};

module.exports = {
  slugify,
  listProducts,
  getProductBySlug,
  getOrCreateCart,
  addToCart,
  updateCartItem,
  clearCart,
  checkout,
  listOrders,
  Category,
  Product,
  Review,
};

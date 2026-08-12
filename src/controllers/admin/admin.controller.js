const {
  User,
  Astrologer,
  Product,
  Category,
  Order,
  Coupon,
  Banner,
  Blog,
  Review,
  Payment,
  Withdrawal,
  Wallet,
  ChatRoom,
  Notification,
  Pooja,
  ContactMessage,
  WalletTransaction,
  PoojaBooking,
} = require('../../models');
const aiService = require('../../services/ai.service');
const walletService = require('../../services/wallet.service');
const settingsService = require('../../services/settings.service');
const storeService = require('../../services/store.service');
const uploadService = require('../../services/upload.service');
const { ASTROLOGER_STATUS, KYC_STATUS, ORDER_STATUS } = require('../../utils/constants');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

const parseListField = (val) => {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const dashboard = asyncHandler(async (req, res) => {
  const [
    customers,
    astrologers,
    pendingAstrologers,
    products,
    orders,
    paymentsSum,
    activeChats,
    revenue,
    poojas,
    poojaBookings,
    newContacts,
    walletTxCount,
  ] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    Astrologer.countDocuments({ status: ASTROLOGER_STATUS.APPROVED }),
    Astrologer.countDocuments({ status: ASTROLOGER_STATUS.PENDING }),
    Product.countDocuments(),
    Order.countDocuments(),
    Payment.aggregate([
      { $match: { status: 'captured' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ChatRoom.countDocuments({ status: 'active' }),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Pooja.countDocuments(),
    PoojaBooking.countDocuments(),
    ContactMessage.countDocuments({ status: 'new' }),
    WalletTransaction.countDocuments(),
  ]);

  return success(res, {
    data: {
      customers,
      astrologers,
      pendingAstrologers,
      products,
      orders,
      activeChats,
      walletRechargeTotal: paymentsSum[0]?.total || 0,
      storeRevenue: revenue[0]?.total || 0,
      poojas,
      poojaBookings,
      newContacts,
      walletTxCount,
    },
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, search } = req.query;
  const filter = { role: { $ne: 'admin' } };
  if (role && role !== 'admin') filter.role = role;
  if (search) {
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
    ];
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);
  const wallets = await Wallet.find({ user: { $in: items.map((u) => u._id) } }).select('user balance');
  const balanceByUser = Object.fromEntries(wallets.map((w) => [String(w.user), w.balance]));
  return success(res, {
    data: items.map((u) => ({
      ...u.toSafeObject(),
      walletBalance: balanceByUser[String(u._id)] ?? 0,
    })),
    meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
  });
});

const blockUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  user.isBlocked = req.body.isBlocked !== false;
  user.blockReason = req.body.reason || '';
  await user.save();
  return success(res, { message: user.isBlocked ? 'User blocked' : 'User unblocked', data: user.toSafeObject() });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  const wallet = await walletService.getOrCreateWallet(user._id);
  const tx = await walletService.getTransactions(user._id, { page: 1, limit: 20 });
  const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
  const bookings = await PoojaBooking.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
  return success(res, {
    data: {
      user: user.toSafeObject(),
      wallet,
      recentTransactions: tx.items,
      recentOrders: orders,
      recentPoojaBookings: bookings,
    },
  });
});

const listAstrologers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Astrologer.find(filter)
      .populate('user', 'name email phone avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Astrologer.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } });
});

const approveAstrologer = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findById(req.params.id);
  if (!profile) throw new AppError('Not found', 404);
  profile.status = ASTROLOGER_STATUS.APPROVED;
  profile.approvedAt = new Date();
  profile.approvedBy = req.user._id;
  profile.rejectionReason = undefined;
  if (profile.kyc) {
    profile.kyc.status = KYC_STATUS.APPROVED;
    profile.kyc.reviewedAt = new Date();
    profile.kyc.reviewedBy = req.user._id;
  }
  await profile.save();
  await Notification.create({
    user: profile.user,
    title: 'Profile Approved',
    body: 'Your astrologer profile has been approved. You can go online now.',
    type: 'kyc',
  });
  return success(res, { message: 'Astrologer approved', data: profile });
});

const rejectAstrologer = asyncHandler(async (req, res) => {
  const profile = await Astrologer.findById(req.params.id);
  if (!profile) throw new AppError('Not found', 404);
  profile.status = ASTROLOGER_STATUS.REJECTED;
  profile.rejectionReason = req.body.reason || 'Rejected by admin';
  if (profile.kyc) {
    profile.kyc.status = KYC_STATUS.REJECTED;
    profile.kyc.notes = req.body.reason;
    profile.kyc.reviewedAt = new Date();
    profile.kyc.reviewedBy = req.user._id;
  }
  await profile.save();
  return success(res, { message: 'Astrologer rejected', data: profile });
});

const getAiSettings = asyncHandler(async (req, res) => {
  const data = await aiService.getAiSettings();
  return success(res, { data });
});

const updateAiSettings = asyncHandler(async (req, res) => {
  const data = await aiService.updateAiSettings(req.body, req.user._id);
  return success(res, { message: 'AI settings updated', data });
});

const createCategory = asyncHandler(async (req, res) => {
  const slug = storeService.slugify(req.body.name);
  const category = await Category.create({ ...req.body, slug });
  return created(res, { data: category });
});

const listCategories = asyncHandler(async (req, res) => {
  const items = await Category.find().sort({ sortOrder: 1, name: 1 });
  return success(res, { data: items });
});

const createProduct = asyncHandler(async (req, res) => {
  if (!req.body.name) throw new AppError('Name is required', 400);
  if (!req.body.category) throw new AppError('Category is required', 400);
  const slug = req.body.slug || storeService.slugify(req.body.name);
  const images = [];
  if (req.files?.length) {
    for (const file of req.files) {
      const up = await uploadService.uploadBuffer(file.buffer, 'astroverse/products');
      images.push({ url: up.secure_url, publicId: up.public_id, isPrimary: images.length === 0 });
    }
  } else if (req.body.imageUrl) {
    images.push({ url: String(req.body.imageUrl), isPrimary: true });
  } else if (Array.isArray(req.body.images) && req.body.images.length) {
    req.body.images.forEach((img, i) => {
      const url = typeof img === 'string' ? img : img?.url;
      if (url) images.push({ url, publicId: img?.publicId, isPrimary: i === 0 });
    });
  }
  const product = await Product.create({
    name: req.body.name,
    slug,
    description: req.body.description || '',
    shortDescription: req.body.shortDescription || '',
    category: req.body.category,
    images,
    price: Number(req.body.price),
    compareAtPrice: req.body.compareAtPrice != null ? Number(req.body.compareAtPrice) : undefined,
    stock: Number(req.body.stock || 0),
    sku: req.body.sku || undefined,
    tags: parseListField(req.body.tags),
    isActive: req.body.isActive !== false && req.body.isActive !== 'false',
    isFeatured: req.body.isFeatured === true || req.body.isFeatured === 'true',
  });
  return created(res, { data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const allowed = { ...req.body };
  if (allowed.price != null) allowed.price = Number(allowed.price);
  if (allowed.stock != null) allowed.stock = Number(allowed.stock);
  if (allowed.name && !allowed.slug) allowed.slug = storeService.slugify(allowed.name);
  if (allowed.isActive === 'true') allowed.isActive = true;
  if (allowed.isActive === 'false') allowed.isActive = false;
  if (allowed.imageUrl) {
    allowed.images = [{ url: String(allowed.imageUrl), isPrimary: true }];
    delete allowed.imageUrl;
  }
  delete allowed.files;
  const product = await Product.findByIdAndUpdate(req.params.id, allowed, { new: true });
  if (!product) throw new AppError('Product not found', 404);
  return success(res, { data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);
  if (req.query.hard === 'true') {
    await product.deleteOne();
    return success(res, { message: 'Product deleted' });
  }
  product.isActive = false;
  await product.save();
  return success(res, { message: 'Product deactivated', data: product });
});

const listProducts = asyncHandler(async (req, res) => {
  const result = await storeService.listProducts({ ...req.query, /* admin sees all via override */ });
  // Admin list including inactive
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const [items, total] = await Promise.all([
    Product.find(filter).populate('category', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const listOrders = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email phone').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email phone');
  if (!order) throw new AppError('Order not found', 404);
  return success(res, { data: order });
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  if (req.body.status) {
    order.status = req.body.status;
    order.tracking = order.tracking || {};
    order.tracking.updates = order.tracking.updates || [];
    order.tracking.updates.push({
      status: req.body.status,
      message: req.body.message || req.body.status,
    });
    if (req.body.status === ORDER_STATUS.DELIVERED) order.deliveredAt = new Date();
    if (req.body.status === ORDER_STATUS.CANCELLED) {
      order.cancelledAt = new Date();
      order.cancelReason = req.body.message || req.body.cancelReason || 'Cancelled by admin';
    }
  }

  if (req.body.paymentStatus) order.paymentStatus = req.body.paymentStatus;
  if (req.body.notes !== undefined) order.notes = req.body.notes;
  if (req.body.shippingAddress && typeof req.body.shippingAddress === 'object') {
    order.shippingAddress = { ...(order.shippingAddress?.toObject?.() || order.shippingAddress || {}), ...req.body.shippingAddress };
  }
  if (req.body.trackingNumber) {
    order.tracking = order.tracking || {};
    order.tracking.trackingNumber = req.body.trackingNumber;
    order.tracking.carrier = req.body.carrier || order.tracking.carrier;
    if (req.body.trackingUrl) order.tracking.trackingUrl = req.body.trackingUrl;
  }

  await order.save();
  return success(res, { data: order });
});

const createCoupon = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.type === 'percent') body.type = 'percentage';
  if (body.type === 'flat') body.type = 'fixed';
  if (body.minSpend != null && body.minOrderAmount == null) body.minOrderAmount = Number(body.minSpend);
  if (body.cap != null && body.usageLimit == null) body.usageLimit = Number(body.cap);
  if (body.expires && !body.expiresAt) body.expiresAt = new Date(body.expires);
  if (!body.startsAt) body.startsAt = new Date();
  if (!body.expiresAt) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    body.expiresAt = d;
  }
  body.value = Number(body.value);
  if (body.minOrderAmount != null) body.minOrderAmount = Number(body.minOrderAmount);
  if (body.usageLimit != null) body.usageLimit = Number(body.usageLimit);
  const coupon = await Coupon.create(body);
  return created(res, { data: coupon });
});

const listCoupons = asyncHandler(async (req, res) => {
  const items = await Coupon.find().sort({ createdAt: -1 });
  return success(res, { data: items });
});

const updateCoupon = asyncHandler(async (req, res) => {
  const patch = { ...req.body };
  if (patch.type === 'percent') patch.type = 'percentage';
  if (patch.type === 'flat') patch.type = 'fixed';
  if (patch.minSpend != null && patch.minOrderAmount == null) patch.minOrderAmount = Number(patch.minSpend);
  if (patch.cap != null && patch.usageLimit == null) patch.usageLimit = Number(patch.cap);
  if (patch.expires && !patch.expiresAt) patch.expiresAt = new Date(patch.expires);
  if (patch.value != null) patch.value = Number(patch.value);
  if (patch.minOrderAmount != null) patch.minOrderAmount = Number(patch.minOrderAmount);
  if (patch.usageLimit != null) patch.usageLimit = Number(patch.usageLimit);
  if (patch.isActive === 'true') patch.isActive = true;
  if (patch.isActive === 'false') patch.isActive = false;
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!coupon) throw new AppError('Coupon not found', 404);
  return success(res, { data: coupon });
});

const createBanner = asyncHandler(async (req, res) => {
  let image = req.body.image;
  if (req.file) {
    const up = await uploadService.uploadBuffer(req.file.buffer, 'astroverse/banners');
    image = up.secure_url;
  }
  const banner = await Banner.create({ ...req.body, image });
  return created(res, { data: banner });
});

const listBanners = asyncHandler(async (req, res) => {
  const items = await Banner.find().sort({ sortOrder: 1 });
  return success(res, { data: items });
});

const createBlog = asyncHandler(async (req, res) => {
  const slug = storeService.slugify(req.body.title);
  const blog = await Blog.create({ ...req.body, slug, author: req.user._id });
  return created(res, { data: blog });
});

const listBlogs = asyncHandler(async (req, res) => {
  const items = await Blog.find().sort({ createdAt: -1 });
  return success(res, { data: items });
});

const adjustWallet = asyncHandler(async (req, res) => {
  let userId = req.body.userId;
  const email = (req.body.email || '').trim().toLowerCase();
  if (!userId && email) {
    const user = await User.findOne({ email });
    if (!user) throw new AppError('No user found with that email', 404);
    if (user.role === 'admin') throw new AppError('Cannot adjust admin wallet here', 400);
    userId = user._id;
  }
  if (!userId) throw new AppError('Email or userId is required', 400);
  if (!req.body.amount || Number(req.body.amount) <= 0) throw new AppError('Amount must be greater than 0', 400);
  if (!['credit', 'debit'].includes(req.body.direction)) throw new AppError('Direction must be credit or debit', 400);

  const data = await walletService.adminAdjust({
    userId,
    amount: Number(req.body.amount),
    direction: req.body.direction,
    reason: req.body.reason,
    adminId: req.user._id,
  });
  return success(res, { message: 'Wallet adjusted', data });
});

const listWithdrawals = asyncHandler(async (req, res) => {
  const items = await Withdrawal.find()
    .populate('user', 'name email')
    .populate('astrologer', 'displayName')
    .sort({ createdAt: -1 });
  return success(res, { data: items });
});

const processWithdrawal = asyncHandler(async (req, res) => {
  const w = await Withdrawal.findById(req.params.id);
  if (!w) throw new AppError('Not found', 404);
  w.status = req.body.status;
  w.adminNote = req.body.note;
  w.processedBy = req.user._id;
  w.processedAt = new Date();
  w.transactionRef = req.body.transactionRef;
  if (req.body.status === 'rejected') {
    await walletService.credit({
      userId: w.user,
      amount: w.amount,
      type: 'refund',
      description: 'Withdrawal rejected – refund',
      performedBy: req.user._id,
    });
    w.rejectionReason = req.body.note;
  }
  if (req.body.status === 'paid') {
    await Astrologer.findByIdAndUpdate(w.astrologer, { $inc: { 'stats.totalWithdrawn': w.amount } });
  }
  await w.save();
  return success(res, { data: w });
});

const listReviews = asyncHandler(async (req, res) => {
  const items = await Review.find().populate('user', 'name').sort({ createdAt: -1 }).limit(100);
  return success(res, { data: items });
});

const moderateReview = asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { isApproved: req.body.isApproved, isVisible: req.body.isVisible },
    { new: true }
  );
  return success(res, { data: review });
});

const getSettings = asyncHandler(async (req, res) => {
  const key = req.params.key;
  const data = await settingsService.getSetting(key);
  return success(res, { data });
});

const updateSettings = asyncHandler(async (req, res) => {
  const data = await settingsService.setSetting(req.params.key, req.body.value, req.body.group, req.user._id);
  return success(res, { data });
});

const listPayments = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.purpose) filter.purpose = req.query.purpose;
  const [items, total] = await Promise.all([
    Payment.find(filter)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

const listWalletTransactions = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.userId) filter.user = req.query.userId;
  if (req.query.direction) filter.direction = req.query.direction;
  const [items, total] = await Promise.all([
    WalletTransaction.find(filter)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    WalletTransaction.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

const listPoojasAdmin = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;
  const [items, total] = await Promise.all([
    Pooja.find(filter).sort({ sortOrder: 1, name: 1 }).skip((page - 1) * limit).limit(limit),
    Pooja.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

const createPooja = asyncHandler(async (req, res) => {
  const name = req.body.name;
  if (!name) throw new AppError('Name is required', 400);
  const slug = req.body.slug || storeService.slugify(name);
  const exists = await Pooja.findOne({ slug });
  if (exists) throw new AppError('Slug already exists', 409);
  const pooja = await Pooja.create({
    name,
    slug,
    shortDescription: req.body.shortDescription || '',
    description: req.body.description || '',
    benefits: parseListField(req.body.benefits),
    duration: req.body.duration || '1–2 hours',
    category: req.body.category || 'deity',
    price: Number(req.body.price || 0),
    glyph: req.body.glyph || '🕯',
    image: req.body.image || '',
    languages: parseListField(req.body.languages),
    includes: parseListField(req.body.includes),
    isActive: req.body.isActive !== false && req.body.isActive !== 'false',
    sortOrder: Number(req.body.sortOrder || 0),
  });
  return created(res, { data: pooja });
});

const updatePooja = asyncHandler(async (req, res) => {
  const patch = { ...req.body };
  if (patch.price != null) patch.price = Number(patch.price);
  if (patch.sortOrder != null) patch.sortOrder = Number(patch.sortOrder);
  if (patch.benefits != null) patch.benefits = parseListField(patch.benefits);
  if (patch.languages != null) patch.languages = parseListField(patch.languages);
  if (patch.includes != null) patch.includes = parseListField(patch.includes);
  if (patch.isActive === 'true') patch.isActive = true;
  if (patch.isActive === 'false') patch.isActive = false;
  if (patch.name && !patch.slug) patch.slug = storeService.slugify(patch.name);
  const pooja = await Pooja.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (!pooja) throw new AppError('Pooja not found', 404);
  return success(res, { data: pooja });
});

const deletePooja = asyncHandler(async (req, res) => {
  const pooja = await Pooja.findById(req.params.id);
  if (!pooja) throw new AppError('Pooja not found', 404);
  if (req.query.hard === 'true') {
    await pooja.deleteOne();
    return success(res, { message: 'Pooja deleted' });
  }
  pooja.isActive = false;
  await pooja.save();
  return success(res, { message: 'Pooja deactivated', data: pooja });
});

const listContacts = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    ContactMessage.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ContactMessage.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

const updateContact = asyncHandler(async (req, res) => {
  const msg = await ContactMessage.findById(req.params.id);
  if (!msg) throw new AppError('Message not found', 404);
  if (req.body.status) msg.status = req.body.status;
  await msg.save();
  return success(res, { data: msg });
});

const listPoojaBookingsAdmin = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    PoojaBooking.find(filter)
      .populate('user', 'name email phone')
      .populate('pooja', 'name slug glyph')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PoojaBooking.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

const broadcastNotification = asyncHandler(async (req, res) => {
  const { title, body, role } = req.body;
  const filter = role ? { role } : {};
  const users = await User.find(filter).select('_id');
  const docs = users.map((u) => ({
    user: u._id,
    title,
    body,
    type: 'promo',
  }));
  await Notification.insertMany(docs);
  return success(res, { message: `Sent to ${docs.length} users` });
});

const aiAnalytics = asyncHandler(async (req, res) => {
  const stats = await ChatRoom.aggregate([
    { $match: { type: 'ai' } },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        totalMinutes: { $sum: '$billedMinutes' },
        totalRevenue: { $sum: '$totalCharged' },
        active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
      },
    },
  ]);
  return success(res, { data: stats[0] || { totalSessions: 0, totalMinutes: 0, totalRevenue: 0, active: 0 } });
});

module.exports = {
  dashboard,
  listUsers,
  getUser,
  blockUser,
  listAstrologers,
  approveAstrologer,
  rejectAstrologer,
  getAiSettings,
  updateAiSettings,
  createCategory,
  listCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  listProducts,
  listOrders,
  getOrder,
  updateOrderStatus,
  createCoupon,
  listCoupons,
  updateCoupon,
  createBanner,
  listBanners,
  createBlog,
  listBlogs,
  adjustWallet,
  listWithdrawals,
  processWithdrawal,
  listReviews,
  moderateReview,
  getSettings,
  updateSettings,
  listPayments,
  listWalletTransactions,
  listPoojasAdmin,
  createPooja,
  updatePooja,
  deletePooja,
  listContacts,
  updateContact,
  listPoojaBookingsAdmin,
  broadcastNotification,
  aiAnalytics,
};

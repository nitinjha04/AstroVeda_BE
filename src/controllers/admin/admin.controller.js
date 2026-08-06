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
    },
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, search } = req.query;
  const filter = {};
  if (role) filter.role = role;
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
  return success(res, {
    data: items.map((u) => u.toSafeObject()),
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
  const slug = storeService.slugify(req.body.name);
  const images = [];
  if (req.files?.length) {
    for (const file of req.files) {
      const up = await uploadService.uploadBuffer(file.buffer, 'astroverse/products');
      images.push({ url: up.secure_url, publicId: up.public_id, isPrimary: images.length === 0 });
    }
  }
  const product = await Product.create({ ...req.body, slug, images, price: Number(req.body.price), stock: Number(req.body.stock || 0) });
  return created(res, { data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!product) throw new AppError('Product not found', 404);
  return success(res, { data: product });
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
  const [items, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);
  order.status = req.body.status;
  order.tracking = order.tracking || {};
  order.tracking.updates = order.tracking.updates || [];
  order.tracking.updates.push({ status: req.body.status, message: req.body.message || req.body.status });
  if (req.body.trackingNumber) {
    order.tracking.trackingNumber = req.body.trackingNumber;
    order.tracking.carrier = req.body.carrier;
  }
  if (req.body.status === ORDER_STATUS.DELIVERED) order.deliveredAt = new Date();
  await order.save();
  return success(res, { data: order });
});

const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  return created(res, { data: coupon });
});

const listCoupons = asyncHandler(async (req, res) => {
  const items = await Coupon.find().sort({ createdAt: -1 });
  return success(res, { data: items });
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
  const data = await walletService.adminAdjust({
    userId: req.body.userId,
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
  const items = await Payment.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(100);
  return success(res, { data: items });
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
  listProducts,
  listOrders,
  updateOrderStatus,
  createCoupon,
  listCoupons,
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
  broadcastNotification,
  aiAnalytics,
};

const express = require('express');
const path = require('path');
const fs = require('fs');
const authRoutes = require('./common/auth.routes');
const customerRoutes = require('./customer/customer.routes');
const astrologerRoutes = require('./astrologer/astrologer.routes');
const adminRoutes = require('./admin/admin.routes');
const { Banner, Blog, Category, Product, Astrologer, AIAstrologer } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');
const { optionalAuth } = require('../middlewares/auth');
const { ASTROLOGER_STATUS } = require('../utils/constants');
const astrologyService = require('../services/astrology.service');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'AstroVerse API healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/** Dedicated keep-alive for external cron (cron-job.org, EasyCron, GitHub Actions) */
router.get('/ping', (req, res) => {
  res.status(200).type('text/plain').send('pong');
});

router.get(
  '/public/banners',
  asyncHandler(async (req, res) => {
    const items = await Banner.find({ isActive: true }).sort({ sortOrder: 1 });
    return success(res, { data: items });
  })
);

router.get(
  '/public/blogs',
  asyncHandler(async (req, res) => {
    const items = await Blog.find({ status: 'published' }).sort({ publishedAt: -1 }).limit(20);
    return success(res, { data: items });
  })
);

router.get(
  '/public/categories',
  asyncHandler(async (req, res) => {
    const items = await Category.find({ isActive: true }).sort({ sortOrder: 1 });
    return success(res, { data: items });
  })
);

router.get(
  '/public/products',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const filter = { isActive: true };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.featured === 'true') filter.isFeatured = true;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name slug')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ isFeatured: -1, createdAt: -1 }),
      Product.countDocuments(filter),
    ]);
    return success(res, { data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  })
);

router.get(
  '/public/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true }).populate(
      'category',
      'name slug'
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return success(res, { data: product });
  })
);

router.get(
  '/public/astrologers',
  asyncHandler(async (req, res) => {
    const aiAstrologerService = require('../services/aiAstrologer.service');
    const result = await aiAstrologerService.listAiAstrologers({
      search: req.query.search,
      expertise: req.query.expertise,
      language: req.query.language,
      minRating: req.query.minRating,
      maxPrice: req.query.maxPrice,
      page: req.query.page || 1,
      limit: Math.min(Number(req.query.limit) || 24, 40),
    });
    return success(res, { data: result.items, meta: result.meta });
  })
);

router.get(
  '/public/astrologers/:slug',
  asyncHandler(async (req, res) => {
    const aiAstrologerService = require('../services/aiAstrologer.service');
    const data = await aiAstrologerService.getBySlug(req.params.slug);
    return success(res, { data });
  })
);

router.get(
  '/public/horoscope',
  asyncHandler(async (req, res) => {
    if (req.query.sign) {
      return success(res, { data: astrologyService.dailyHoroscope(String(req.query.sign).toLowerCase()) });
    }
    return success(res, { data: astrologyService.getAllDaily() });
  })
);

router.get(
  '/public/demo',
  asyncHandler(async (req, res) => {
    const demoPath = path.join(__dirname, '../data/demo-data.json');
    const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));
    return success(res, {
      data: {
        version: demo.version,
        meta: demo.meta,
        accounts: (demo.demoAccounts || []).map((a) => ({
          role: a.role,
          name: a.displayName || a.name,
          email: a.email,
          password: a.password,
          note: a.note,
          walletBalance: a.walletBalance,
          isOnline: a.isOnline,
        })),
        coupons: (demo.coupons || []).map((c) => ({ code: c.code, description: c.description })),
        chatWalkthrough: demo.chatWalkthrough,
        productCount: (demo.products || []).length,
      },
    });
  })
);

router.use('/auth', authRoutes);
router.use('/customer', customerRoutes);
router.use('/astrologer', astrologerRoutes);
router.use('/admin', adminRoutes);

module.exports = router;

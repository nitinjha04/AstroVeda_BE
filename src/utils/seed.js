const path = require('path');
const fs = require('fs');
const {
  User,
  Category,
  Product,
  Settings,
  Banner,
  Blog,
  Coupon,
  Astrologer,
} = require('../models');
const config = require('../config');
const { ROLES, ASTROLOGER_STATUS, KYC_STATUS } = require('./constants');
const settingsService = require('../services/settings.service');
const aiService = require('../services/ai.service');
const walletService = require('../services/wallet.service');
const { WALLET_TX_TYPE } = require('./constants');
const logger = require('./logger');

const DEMO_PATH = path.join(__dirname, '../data/demo-data.json');

const loadDemoJson = () => {
  const raw = fs.readFileSync(DEMO_PATH, 'utf8');
  return JSON.parse(raw);
};

const ensureWalletBalance = async (userId, targetBalance) => {
  const wallet = await walletService.getOrCreateWallet(userId);
  const current = Number(wallet.balance || 0);
  const target = Number(targetBalance || 0);
  if (target > current) {
    await walletService.credit({
      userId,
      amount: Number((target - current).toFixed(2)),
      type: WALLET_TX_TYPE.ADMIN_ADJUSTMENT,
      description: 'Demo seed wallet top-up',
    });
  }
};

const seedDemoAccounts = async (demo) => {
  for (const acc of demo.demoAccounts || []) {
    if (acc.role === 'admin') continue;

    let user = await User.findOne({ email: acc.email.toLowerCase() });
    if (!user) {
      user = await User.create({
        name: acc.name,
        email: acc.email.toLowerCase(),
        phone: acc.phone,
        password: acc.password,
        role: acc.role === 'astrologer' ? ROLES.ASTROLOGER : ROLES.CUSTOMER,
        isEmailVerified: true,
        isPhoneVerified: true,
        referralCode: acc.referralCode || undefined,
        dateOfBirth: acc.dateOfBirth ? new Date(acc.dateOfBirth) : undefined,
        birthTime: acc.birthTime,
        birthPlace: acc.birthPlace,
        gender: acc.gender || '',
      });
      logger.info(`Demo user seeded: ${acc.email}`);
    } else {
      let dirty = false;
      if (acc.role === 'astrologer' && user.role !== ROLES.ASTROLOGER) {
        user.role = ROLES.ASTROLOGER;
        dirty = true;
      }
      if (acc.dateOfBirth && !user.dateOfBirth) {
        user.dateOfBirth = new Date(acc.dateOfBirth);
        dirty = true;
      }
      if (dirty) await user.save();
    }

    await ensureWalletBalance(user._id, acc.walletBalance ?? 500);

    if (acc.role === 'astrologer') {
      let profile = await Astrologer.findOne({ user: user._id });
      if (!profile) {
        profile = await Astrologer.create({
          user: user._id,
          displayName: acc.displayName || acc.name,
          bio: acc.bio || '',
          specialties: acc.specialties || ['Vedic'],
          languages: acc.languages || ['Hindi', 'English'],
          experienceYears: acc.experienceYears || 5,
          status: ASTROLOGER_STATUS.APPROVED,
          isOnline: !!acc.isOnline,
          isAvailableForChat: true,
          pricing: acc.pricing || { chatPerMinute: 10, voicePerMinute: 20, videoPerMinute: 30 },
          ratings: acc.ratings || { average: 4.5, count: 10 },
          approvedAt: new Date(),
          kyc: { status: KYC_STATUS.APPROVED, submittedAt: new Date(), reviewedAt: new Date() },
        });
        logger.info(`Demo astrologer seeded: ${acc.displayName || acc.name}`);
      } else {
        profile.displayName = acc.displayName || profile.displayName;
        profile.bio = acc.bio || profile.bio;
        profile.specialties = acc.specialties || profile.specialties;
        profile.languages = acc.languages || profile.languages;
        profile.experienceYears = acc.experienceYears ?? profile.experienceYears;
        profile.status = ASTROLOGER_STATUS.APPROVED;
        profile.isOnline = !!acc.isOnline;
        profile.isAvailableForChat = true;
        if (acc.pricing) profile.pricing = { ...profile.pricing.toObject?.() || profile.pricing, ...acc.pricing };
        if (acc.ratings) profile.ratings = acc.ratings;
        profile.kyc = {
          ...(profile.kyc?.toObject?.() || profile.kyc || {}),
          status: KYC_STATUS.APPROVED,
        };
        await profile.save();
      }
    }
  }
};

const seedStoreFromJson = async (demo) => {
  const catMap = {};
  for (const c of demo.categories || []) {
    const cat = await Category.findOneAndUpdate(
      { slug: c.slug },
      {
        name: c.name,
        slug: c.slug,
        description: c.description || '',
        image: c.image || '',
        sortOrder: c.sortOrder || 0,
        isActive: true,
      },
      { upsert: true, new: true }
    );
    catMap[c.slug] = cat._id;
  }

  for (const p of demo.products || []) {
    const category = catMap[p.categorySlug];
    if (!category) {
      logger.warn(`Product skip (unknown category): ${p.slug}`);
      continue;
    }
    await Product.findOneAndUpdate(
      { slug: p.slug },
      {
        name: p.name,
        slug: p.slug,
        description: p.description || '',
        shortDescription: p.shortDescription || '',
        category,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        stock: p.stock ?? 0,
        sku: p.sku,
        isFeatured: !!p.isFeatured,
        isActive: true,
        tags: p.tags || [],
        images: (p.images || []).map((img, i) => ({
          url: img.url,
          publicId: img.publicId,
          isPrimary: img.isPrimary ?? i === 0,
        })),
      },
      { upsert: true, new: true }
    );
  }
  logger.info(`Store seeded: ${(demo.categories || []).length} categories, ${(demo.products || []).length} products`);
};

const seedCoupons = async (demo) => {
  const now = new Date();
  for (const c of demo.coupons || []) {
    const days = c.daysValid || 60;
    await Coupon.findOneAndUpdate(
      { code: c.code.toUpperCase() },
      {
        code: c.code.toUpperCase(),
        description: c.description || '',
        type: c.type,
        value: c.value,
        minOrderAmount: c.minOrderAmount || 0,
        maxDiscount: c.maxDiscount,
        usageLimit: c.usageLimit,
        perUserLimit: c.perUserLimit || 1,
        applicableTo: c.applicableTo || 'all',
        startsAt: now,
        expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      { upsert: true, new: true }
    );
  }
};

const seedBannersAndBlogs = async (demo, adminId) => {
  for (const b of demo.banners || []) {
    await Banner.findOneAndUpdate(
      { title: b.title, placement: b.placement },
      {
        title: b.title,
        subtitle: b.subtitle,
        image: b.image,
        link: b.link,
        placement: b.placement,
        sortOrder: b.sortOrder || 0,
        isActive: true,
      },
      { upsert: true, new: true }
    );
  }

  for (const blog of demo.blogs || []) {
    await Blog.findOneAndUpdate(
      { slug: blog.slug },
      {
        title: blog.title,
        slug: blog.slug,
        excerpt: blog.excerpt,
        content: blog.content,
        coverImage: blog.coverImage,
        tags: blog.tags || [],
        category: blog.category,
        status: blog.status || 'published',
        publishedAt: new Date(),
        author: adminId,
      },
      { upsert: true, new: true }
    );
  }
};

const seedDatabase = async () => {
  try {
    await settingsService.seedDefaults();

    const ai = await aiService.getAiSettings();
    await Settings.findOneAndUpdate(
      { key: 'ai' },
      { key: 'ai', value: ai, group: 'ai' },
      { upsert: true }
    );

    let admin = await User.findOne({ email: config.admin.email });
    if (!admin) {
      admin = await User.create({
        name: config.admin.name,
        email: config.admin.email,
        password: config.admin.password,
        role: ROLES.ADMIN,
        isEmailVerified: true,
        referralCode: 'ADMIN001',
      });
      await walletService.getOrCreateWallet(admin._id);
      logger.info(`Admin seeded: ${config.admin.email}`);
    }

    let demo;
    try {
      demo = loadDemoJson();
    } catch (err) {
      logger.error(`Failed to load demo-data.json: ${err.message}`);
      return;
    }

    const versionKey = 'demoSeedVersion';
    const existing = await Settings.findOne({ key: versionKey });
    const currentVersion = existing?.value?.version || 0;
    const targetVersion = demo.version || 1;

    // Always ensure store + accounts are present (upsert). Re-run full content when version advances.
    await seedStoreFromJson(demo);
    await seedDemoAccounts(demo);

    if (currentVersion < targetVersion) {
      await seedCoupons(demo);
      await seedBannersAndBlogs(demo, admin._id);
      await Settings.findOneAndUpdate(
        { key: versionKey },
        {
          key: versionKey,
          value: { version: targetVersion, loadedAt: new Date().toISOString() },
          group: 'general',
          description: 'Demo data pack version',
        },
        { upsert: true }
      );
      logger.info(`Demo pack v${targetVersion} applied (coupons, banners, blogs)`);
    } else {
      // Keep banners/coupons refreshed on every boot for easy local demos
      await seedCoupons(demo);
      await seedBannersAndBlogs(demo, admin._id);
    }

    logger.info('Database seed complete — demo JSON loaded');
  } catch (err) {
    logger.error(`Seed error: ${err.message}`);
    logger.error(err.stack);
  }
};

if (require.main === module) {
  require('dotenv').config();
  const connectDB = require('../config/db');
  connectDB()
    .then(() => seedDatabase())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { seedDatabase, loadDemoJson };

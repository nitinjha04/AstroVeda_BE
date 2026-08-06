const { AIAstrologer, Product } = require('../models');
const AppError = require('../utils/AppError');
const seedData = require('../data/aiAstrologers');

const toPublic = (doc) => {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  // Don't expose full systemPrompt on list; detail can include it only for admin — hide from public
  delete o.systemPrompt;
  return o;
};

const listAiAstrologers = async (query = {}) => {
  const {
    search,
    expertise,
    language,
    minRating,
    maxPrice,
    page = 1,
    limit = 24,
  } = query;

  const filter = { isActive: true };

  if (expertise) {
    const tags = String(expertise)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tags.length) filter.expertise = { $in: tags };
  }

  if (language) {
    filter.languages = new RegExp(`^${String(language).trim()}$`, 'i');
  }

  if (minRating != null && minRating !== '') {
    filter.ratingAverage = { $gte: Number(minRating) };
  }

  if (maxPrice != null && maxPrice !== '') {
    filter.pricePerMinute = { $lte: Number(maxPrice) };
  }

  if (search && String(search).trim()) {
    const q = String(search).trim();
    filter.$or = [
      { displayName: new RegExp(q, 'i') },
      { tagline: new RegExp(q, 'i') },
      { about: new RegExp(q, 'i') },
      { specialties: new RegExp(q, 'i') },
      { expertise: new RegExp(q, 'i') },
      { knowledgeAreas: new RegExp(q, 'i') },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    AIAstrologer.find(filter)
      .select('-systemPrompt')
      .sort({ sortOrder: 1, ratingAverage: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    AIAstrologer.countDocuments(filter),
  ]);

  return {
    items,
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / limit) || 1,
    },
  };
};

const getBySlug = async (slug) => {
  const doc = await AIAstrologer.findOne({ slug, isActive: true }).lean();
  if (!doc) throw new AppError('AI Astrologer not found', 404);

  delete doc.systemPrompt;

  const productSlugs = doc.suggestedProductSlugs || [];
  let suggestedProducts = [];
  if (productSlugs.length) {
    suggestedProducts = await Product.find({
      slug: { $in: productSlugs },
      isActive: true,
    })
      .select('name slug price images shortDescription')
      .lean();
    // keep seed order
    const order = Object.fromEntries(productSlugs.map((s, i) => [s, i]));
    suggestedProducts.sort((a, b) => (order[a.slug] ?? 99) - (order[b.slug] ?? 99));
  }

  return { ...doc, suggestedProducts };
};

const getByIdInternal = async (id) => {
  const doc = await AIAstrologer.findOne({ _id: id, isActive: true });
  if (!doc) throw new AppError('AI Astrologer not found', 404);
  return doc;
};

/** Upsert all seed personas (idempotent) */
const seedAiAstrologers = async () => {
  let n = 0;
  for (let i = 0; i < seedData.length; i += 1) {
    const row = seedData[i];
    await AIAstrologer.findOneAndUpdate(
      { slug: row.slug },
      {
        $set: {
          ...row,
          sortOrder: i,
          isActive: true,
          isOnline: true,
        },
      },
      { upsert: true, new: true }
    );
    n += 1;
  }
  return n;
};

module.exports = {
  listAiAstrologers,
  getBySlug,
  getByIdInternal,
  seedAiAstrologers,
  toPublic,
};

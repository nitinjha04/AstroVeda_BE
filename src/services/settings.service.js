const { Settings } = require('../models');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');

const DEFAULTS = {
  general: {
    siteName: 'AstroVerse',
    supportEmail: 'support@astroverse.com',
    supportPhone: '+91-0000000000',
    maintenanceMode: false,
  },
  wallet: {
    minRecharge: 50,
    maxRecharge: 50000,
    currency: 'INR',
  },
  referral: {
    enabled: true,
    referrerBonus: 50,
    referredBonus: 25,
  },
  chat: {
    requestTimeoutSeconds: 120,
    maxActiveChatsPerCustomer: 1,
  },
  seo: {
    metaTitle: 'AstroVerse – AI Astrology & Consultations',
    metaDescription: 'Talk to AI and expert astrologers. Shop spiritual products.',
  },
};

const getSetting = async (key) => {
  const cacheKey = `settings:${key}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const doc = await Settings.findOne({ key });
  const value = doc?.value ?? DEFAULTS[key] ?? null;
  if (value) await cacheSet(cacheKey, value, 300);
  return value;
};

const setSetting = async (key, value, group = 'general', adminId) => {
  const doc = await Settings.findOneAndUpdate(
    { key },
    { key, value, group, updatedBy: adminId },
    { upsert: true, new: true }
  );
  await cacheDel(`settings:${key}`);
  return doc;
};

const seedDefaults = async () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const exists = await Settings.findOne({ key });
    if (!exists) {
      await Settings.create({ key, value, group: key === 'seo' ? 'seo' : key });
    }
  }
};

module.exports = { getSetting, setSetting, seedDefaults, DEFAULTS };

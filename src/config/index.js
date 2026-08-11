require('dotenv').config();

/** Comma-separated env list → unique origin URLs (no trailing slash) */
const parseList = (value, fallback = []) => {
  if (!value || !String(value).trim()) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
};

const localDevOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

/**
 * CLIENT_URL may be one URL or many, comma-separated, e.g.
 * https://astrovedaverse.vercel.app,https://www.astrovedaverse.vercel.app
 */
const clientOrigins = parseList(process.env.CLIENT_URL, ['http://localhost:5173']);

const config = {
  env: process.env.NODE_ENV || 'development',
  /** Render sets PORT automatically */
  port: parseInt(process.env.PORT, 10) || 5000,
  /** Bind 0.0.0.0 for Render / cloud containers */
  host: process.env.HOST || '0.0.0.0',
  appName: process.env.APP_NAME || 'AstroVerse',
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  /** Primary frontend URL (first entry in CLIENT_URL) */
  clientUrl: clientOrigins[0],
  /**
   * Allowed browser origins for CORS + Socket.io.
   * Sources: CLIENT_URL, CORS_ORIGINS, plus local dev defaults.
   */
  corsOrigins: [
    ...new Set([...clientOrigins, ...localDevOrigins, ...parseList(process.env.CORS_ORIGINS)]),
  ],

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/astroverse',
  },

  redis: {
    /** Optional Upstash / Redis Cloud URL (preferred on Render free) */
    url: process.env.REDIS_URL || '',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    /**
     * Free Render: no managed Redis — allow in-memory fallback in production.
     * Set ALLOW_INMEMORY_REDIS=false when you attach a real Redis.
     */
    allowInMemory:
      process.env.ALLOW_INMEMORY_REDIS !== 'false' &&
      process.env.ALLOW_INMEMORY_REDIS !== '0',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me_32chars',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me_32chars',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@astroverse.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@AstroVerse2026',
    name: process.env.ADMIN_NAME || 'Super Admin',
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  openai: {
    /**
     * OpenRouter (preferred) or OpenAI-compatible providers.
     * Free models end with `:free` — zero token cost on OpenRouter free tier.
     */
    provider: process.env.AI_PROVIDER || 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    // Cheapest free OpenRouter model (no bill). Change only if model is offline.
    defaultModel:
      process.env.OPENROUTER_MODEL ||
      process.env.OPENAI_DEFAULT_MODEL ||
      'google/gemma-4-26b-a4b-it:free',
    forceCheapModel: process.env.FORCE_CHEAP_AI_MODEL !== 'false',
    maxTokens: parseInt(process.env.OPENROUTER_MAX_TOKENS || process.env.AI_MAX_TOKENS || '256', 10),
  },

  payment: {
    gateway: process.env.PAYMENT_GATEWAY || 'razorpay',
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      /** Dashboard → Webhooks → Secret (falls back to key secret if unset) */
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET,
    },
  },

  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'AstroVerse <noreply@astroverse.com>',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
    length: parseInt(process.env.OTP_LENGTH, 10) || 6,
  },

  wallet: {
    defaultAiPricePerMinute: parseFloat(process.env.DEFAULT_AI_PRICE_PER_MINUTE) || 5,
    minRecharge: parseFloat(process.env.MIN_WALLET_RECHARGE) || 1,
    maxRecharge: parseFloat(process.env.MAX_WALLET_RECHARGE) || 50000,
    platformCommissionPercent: parseFloat(process.env.PLATFORM_COMMISSION_PERCENT) || 20,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  },
};

module.exports = config;

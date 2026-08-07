const config = require('../config');

const ACCESS_COOKIE = 'accessToken';
const REFRESH_COOKIE = 'refreshToken';

/** Parse jwt-style durations like 15m, 7d into milliseconds */
function durationToMs(value, fallbackMs) {
  if (!value) return fallbackMs;
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] || 1);
}

/**
 * Cookie flags for cross-origin FE/BE (Hostinger UI + Render API, or Vite :5173 + API :5000).
 * Browsers only send cross-site cookies with SameSite=None; Secure.
 * In local HTTP, Secure cookies still work for localhost in modern Chrome; Bearer remains primary.
 */
function baseCookieOptions(maxAgeMs) {
  const isProd = config.env === 'production';
  return {
    httpOnly: true,
    secure: isProd || process.env.AUTH_COOKIE_SECURE === 'true',
    sameSite: isProd || process.env.AUTH_COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
    ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
  };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  if (!res || !accessToken) return;

  const accessMs = durationToMs(config.jwt.accessExpires, 15 * 60 * 1000);
  const refreshMs = durationToMs(config.jwt.refreshExpires, 7 * 24 * 60 * 60 * 1000);

  res.cookie(ACCESS_COOKIE, accessToken, baseCookieOptions(accessMs));
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, baseCookieOptions(refreshMs));
  }
}

function clearAuthCookies(res) {
  if (!res) return;
  const opts = {
    httpOnly: true,
    secure: config.env === 'production' || process.env.AUTH_COOKIE_SECURE === 'true',
    sameSite: config.env === 'production' || process.env.AUTH_COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    path: '/',
    ...(process.env.AUTH_COOKIE_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
  };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
}

/**
 * Resolve access JWT from request, in priority order:
 * 1. Authorization: Bearer <token>  (localStorage / mobile / cross-origin SPA)
 * 2. accessToken cookie
 * 3. x-access-token header (optional clients)
 */
function extractAccessToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (header && typeof header === 'string') {
    const parts = header.trim().split(/\s+/);
    if (parts.length === 2 && /^Bearer$/i.test(parts[0]) && parts[1]) {
      return parts[1].trim();
    }
  }

  if (req.cookies?.[ACCESS_COOKIE]) {
    return String(req.cookies[ACCESS_COOKIE]).trim();
  }

  const xToken = req.headers?.['x-access-token'];
  if (xToken) return String(xToken).trim();

  return null;
}

function extractRefreshToken(req) {
  if (req.body?.refreshToken) return String(req.body.refreshToken).trim();
  if (req.cookies?.[REFRESH_COOKIE]) return String(req.cookies[REFRESH_COOKIE]).trim();
  if (req.headers?.['x-refresh-token']) return String(req.headers['x-refresh-token']).trim();
  return null;
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  setAuthCookies,
  clearAuthCookies,
  extractAccessToken,
  extractRefreshToken,
};

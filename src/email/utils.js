const parseSender = (from, fallbackName = 'AstroVerse', fallbackEmail = 'noreply@astroverse.com') => {
  const raw = String(from || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, '').trim() || fallbackName,
      email: match[2].trim(),
    };
  }
  if (raw.includes('@')) {
    return { name: fallbackName, email: raw };
  }
  return { name: fallbackName, email: fallbackEmail };
};

/** Parse STORE_ORDER_ADMIN_EMAILS JSON map: { "domain.com": "admin@..." } */
const parseStoreAdminMap = (raw) => {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return {};
};

module.exports = { parseSender, parseStoreAdminMap };

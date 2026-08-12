const config = require('../../config');
const logger = require('../../utils/logger');
const { sendViaBrevo } = require('./brevo');

/**
 * Swappable transport: `brevo` | `none`
 * - brevo when EMAIL_ENABLED and API key present
 * - none otherwise (logs skip)
 */
const getEmailTransport = () => {
  if (config.email.enabled && config.email.apiKey) {
    return {
      name: 'brevo',
      send: sendViaBrevo,
    };
  }
  return {
    name: 'none',
    send: async ({ to, subject }) => {
      logger.info(`[email:none] skip → ${to} | ${subject}`);
      return { provider: 'none', skipped: true };
    },
  };
};

module.exports = { getEmailTransport };

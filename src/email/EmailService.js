const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { getEmailTransport } = require('./transport');
const { parseSender } = require('./utils');
const { signupOtpTemplate } = require('./templates/signupOtp');
const { loginOtpTemplate } = require('./templates/loginOtp');
const { forgotPasswordOtpTemplate } = require('./templates/forgotPasswordOtp');
const {
  orderPlacedCustomerTemplate,
  orderPlacedAdminTemplate,
} = require('./templates/orderPlaced');

const isConfigured = () => Boolean(config.email.enabled && config.email.apiKey);

const resolveFrom = ({ storeDomain } = {}) => {
  if (storeDomain && config.email.fromByDomain?.[storeDomain]) {
    return config.email.fromByDomain[storeDomain];
  }
  return config.email.from;
};

const resolveAdminEmail = ({ storeDomain } = {}) => {
  if (storeDomain && config.email.storeOrderAdminEmails?.[storeDomain]) {
    return config.email.storeOrderAdminEmails[storeDomain];
  }
  return config.email.adminEmail || config.admin.email;
};

/**
 * Core send: checks EMAIL_ENABLED + API key, then delegates to transport.
 * @param {object} opts
 * @param {boolean} [opts.mustDeliver] hard-fail when email not ready or Brevo errors (OTP / critical)
 */
const send = async (to, subject, html, { from, storeDomain, mustDeliver = false } = {}) => {
  if (!to) {
    if (mustDeliver) throw new AppError('Email recipient is required', 400);
    logger.warn('[email] skip — missing recipient');
    return { skipped: true, reason: 'no_recipient' };
  }

  if (!isConfigured()) {
    const reason = !config.email.enabled ? 'EMAIL_ENABLED=false' : 'API key missing';
    logger.warn(`[email] skip — ${reason} | to=${to} | ${subject}`);
    if (mustDeliver) {
      throw new AppError(`Email service not ready (${reason}). Set EMAIL_ENABLED and SENDINBLUE_API_KEY / BREVO_API_KEY.`, 500);
    }
    return { skipped: true, reason };
  }

  const transport = getEmailTransport();
  const resolvedFrom = from || resolveFrom({ storeDomain });

  try {
    return await transport.send({ to, subject, html, from: resolvedFrom });
  } catch (err) {
    if (mustDeliver) throw err;
    logger.warn(`[email] soft-fail to ${to}: ${err.message}`);
    return { skipped: true, error: err.message };
  }
};

const sendSignupOtp = async ({ to, otp }) => {
  const { subject, html } = signupOtpTemplate({ otp });
  return send(to, subject, html, { mustDeliver: true });
};

const sendLoginOtp = async ({ to, otp }) => {
  const { subject, html } = loginOtpTemplate({ otp });
  return send(to, subject, html, { mustDeliver: true });
};

const sendPasswordResetOtp = async ({ to, otp }) => {
  const { subject, html } = forgotPasswordOtpTemplate({ otp });
  return send(to, subject, html, { mustDeliver: true });
};

/** Soft-fail: customer + admin notify when an order is placed/paid */
const sendOrderPlacedEmails = async ({ order, customer, storeDomain } = {}) => {
  const results = [];
  if (customer?.email) {
    const tpl = orderPlacedCustomerTemplate({
      order,
      customerName: customer.name,
    });
    results.push(await send(customer.email, tpl.subject, tpl.html, { storeDomain, mustDeliver: false }));
  }

  const adminTo = resolveAdminEmail({ storeDomain });
  if (adminTo) {
    const tpl = orderPlacedAdminTemplate({ order, customer });
    results.push(await send(adminTo, tpl.subject, tpl.html, { storeDomain, mustDeliver: false }));
  }

  return results;
};

/** Generic optional notification (soft-fail) */
const sendGeneric = async ({ to, subject, html, mustDeliver = false, storeDomain } = {}) =>
  send(to, subject, html, { mustDeliver, storeDomain });

const EmailService = {
  isConfigured,
  getEmailTransport,
  parseSender,
  resolveFrom,
  resolveAdminEmail,
  send,
  sendSignupOtp,
  sendLoginOtp,
  sendPasswordResetOtp,
  sendOrderPlacedEmails,
  sendGeneric,
};

module.exports = EmailService;

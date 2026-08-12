const SibApiV3Sdk = require('@sendinblue/client');
const config = require('../../config');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const { parseSender } = require('../utils');

/**
 * Send one transactional email via Brevo HTTPS API (@sendinblue/client).
 * Never uses SMTP — safe on Render free hosts that block SMTP ports.
 */
const sendViaBrevo = async ({ to, subject, html, from } = {}) => {
  const apiKey = config.email.apiKey;
  if (!apiKey) {
    throw new AppError('SENDINBLUE_API_KEY / BREVO_API_KEY is not configured', 500);
  }
  if (!to) throw new AppError('Email recipient is required', 400);
  if (!subject || !html) throw new AppError('Email subject and html are required', 400);

  const sender = parseSender(
    from || config.email.from,
    config.email.senderName || config.appName,
    config.email.senderEmail || 'noreply@astroverse.com'
  );

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  apiInstance.setApiKey(SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  const payload = new SibApiV3Sdk.SendSmtpEmail();
  payload.sender = { name: sender.name, email: sender.email };
  payload.to = [{ email: String(to).trim().toLowerCase() }];
  payload.subject = subject;
  payload.htmlContent = html;

  try {
    const result = await apiInstance.sendTransacEmail(payload);
    const messageId = result?.messageId || result?.body?.messageId || null;
    logger.info(`Brevo email sent to ${to}: ${messageId || 'ok'}`);
    return { provider: 'brevo', messageId, result };
  } catch (err) {
    const status = err?.response?.statusCode || err?.status || 502;
    const body = err?.response?.body || err?.body || {};
    const msg = body?.message || body?.error || err?.message || 'Brevo send failed';
    logger.error(`Brevo email failed (${status}): ${msg}`);
    throw new AppError(`Failed to send email: ${msg}`, 502);
  }
};

module.exports = { sendViaBrevo };

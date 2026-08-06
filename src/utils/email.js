const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('./logger');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!config.email.user || !config.email.pass) {
    logger.warn('SMTP credentials missing – emails will be logged only');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: { user: config.email.user, pass: config.email.pass },
  });
  return transporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  const transport = getTransporter();
  const mail = { from: config.email.from, to, subject, html, text };

  if (!transport) {
    logger.info(`[Email stub] To: ${to} | Subject: ${subject}`);
    return { accepted: [to], stub: true };
  }

  try {
    const info = await transport.sendMail(mail);
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error(`Email failed: ${err.message}`);
    throw err;
  }
};

const sendOtpEmail = async (to, otp) =>
  sendEmail({
    to,
    subject: `${config.appName} – Your OTP Code`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>${config.appName}</h2>
      <p>Your one-time password is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold">${otp}</p>
      <p>Valid for ${config.otp.expiryMinutes} minutes. Do not share this code.</p>
    </div>`,
    text: `Your OTP is ${otp}. Valid for ${config.otp.expiryMinutes} minutes.`,
  });

module.exports = { sendEmail, sendOtpEmail };

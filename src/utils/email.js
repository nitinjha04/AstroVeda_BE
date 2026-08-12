/** @deprecated Prefer `require('../email/EmailService')`. Kept for queues/workers. */
const EmailService = require('../email/EmailService');

const sendEmail = async ({ to, subject, html, text, mustDeliver = false } = {}) => {
  const body = html || (text ? `<p>${text}</p>` : '');
  return EmailService.send(to, subject, body, { mustDeliver });
};

/** @deprecated Use EmailService.sendSignupOtp / sendLoginOtp / sendPasswordResetOtp */
const sendOtpEmail = async (to, otp) => EmailService.sendSignupOtp({ to, otp });

module.exports = { sendEmail, sendOtpEmail, EmailService };

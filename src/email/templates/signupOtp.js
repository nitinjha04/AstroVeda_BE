const config = require('../../config');
const { shell } = require('./_layout');

/** @returns {{ subject: string, html: string }} */
const signupOtpTemplate = ({ otp, minutes } = {}) => {
  const mins = minutes || config.otp.expiryMinutes;
  return {
    subject: `${config.appName} – Verify your email`,
    html: shell(
      'Verify your email',
      `<p>Use this one-time code to finish creating your account:</p>
       <p style="font-size:32px;letter-spacing:10px;font-weight:bold;margin:20px 0;color:#5A4BFF;">${otp}</p>
       <p>Valid for ${mins} minutes. Do not share this code.</p>`
    ),
  };
};

module.exports = { signupOtpTemplate };

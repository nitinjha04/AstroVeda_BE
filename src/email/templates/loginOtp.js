const config = require('../../config');
const { shell } = require('./_layout');

const loginOtpTemplate = ({ otp, minutes } = {}) => {
  const mins = minutes || config.otp.expiryMinutes;
  return {
    subject: `${config.appName} – Your login code`,
    html: shell(
      'Sign-in code',
      `<p>Your one-time password is:</p>
       <p style="font-size:32px;letter-spacing:10px;font-weight:bold;margin:20px 0;color:#5A4BFF;">${otp}</p>
       <p>Valid for ${mins} minutes. If you did not request this, ignore this email.</p>`
    ),
  };
};

module.exports = { loginOtpTemplate };

const config = require('../../config');
const { shell } = require('./_layout');

const forgotPasswordOtpTemplate = ({ otp, minutes } = {}) => {
  const mins = minutes || config.otp.expiryMinutes;
  return {
    subject: `${config.appName} – Password reset code`,
    html: shell(
      'Reset your password',
      `<p>Use this code to reset your password:</p>
       <p style="font-size:32px;letter-spacing:10px;font-weight:bold;margin:20px 0;color:#5A4BFF;">${otp}</p>
       <p>Valid for ${mins} minutes. If you did not request a reset, you can ignore this email.</p>`
    ),
  };
};

module.exports = { forgotPasswordOtpTemplate };

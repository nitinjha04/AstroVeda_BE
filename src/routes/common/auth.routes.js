const express = require('express');
const authController = require('../../controllers/common/auth.controller');
const { authenticate, optionalAuth } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { authLimiter, otpLimiter } = require('../../middlewares/rateLimiter');
const {
  registerRules,
  loginRules,
  otpSendRules,
  otpVerifyRules,
} = require('../../validators/auth.validator');

const router = express.Router();

router.post('/register', authLimiter, registerRules, validate, authController.register);
router.post('/login', authLimiter, loginRules, validate, authController.login);
router.post('/otp/send', otpLimiter, otpSendRules, validate, authController.sendOtp);
router.post('/otp/verify', authLimiter, otpVerifyRules, validate, authController.verifyOtp);
router.post('/google', authLimiter, authController.googleLogin);
router.post('/refresh', authController.refresh);
router.post('/forgot-password', otpLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);
// optionalAuth so cookie-only sessions can still clear tokens even if access JWT briefly fails
router.post('/logout', optionalAuth, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;

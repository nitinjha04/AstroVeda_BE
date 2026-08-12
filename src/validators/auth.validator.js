const { body } = require('express-validator');

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('any').withMessage('Valid phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
  body('otp').isLength({ min: 4, max: 8 }).withMessage('OTP required'),
  body('role').optional().isIn(['customer', 'astrologer']),
];

const registerOtpRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('any').withMessage('Valid phone required'),
];

const loginRules = [
  body('password').notEmpty(),
  body().custom((_, { req }) => {
    if (!req.body.email && !req.body.phone) throw new Error('Email or phone required');
    return true;
  }),
];

const otpSendRules = [
  body().custom((_, { req }) => {
    if (!req.body.email && !req.body.phone) throw new Error('Email or phone required');
    return true;
  }),
];

const otpVerifyRules = [
  body('otp').isLength({ min: 4, max: 8 }).withMessage('OTP required'),
];

const rechargeRules = [
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount required'),
];

const chatMessageRules = [
  body('content').trim().notEmpty().withMessage('Message required').isLength({ max: 5000 }),
];

const productRules = [
  body('name').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('category').notEmpty(),
];

module.exports = {
  registerRules,
  registerOtpRules,
  loginRules,
  otpSendRules,
  otpVerifyRules,
  rechargeRules,
  chatMessageRules,
  productRules,
};

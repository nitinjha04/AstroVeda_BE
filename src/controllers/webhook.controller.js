const paymentService = require('../services/payment.service');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * POST /api/v1/webhooks/razorpay
 * Body must be raw Buffer (see app.js) for signature verification.
 */
const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const result = await paymentService.handleRazorpayWebhook(req.body, signature);
  // Always 200 after valid signature so Razorpay doesn't retry forever on business no-ops
  logger.info(`Razorpay webhook result ${JSON.stringify(result)}`);
  res.status(200).json({ success: true, ...result });
});

module.exports = { razorpayWebhook };

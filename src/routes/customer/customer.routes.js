const express = require('express');
const walletController = require('../../controllers/customer/wallet.controller');
const chatController = require('../../controllers/customer/chat.controller');
const storeController = require('../../controllers/customer/store.controller');
const profileController = require('../../controllers/customer/profile.controller');
const poojaController = require('../../controllers/customer/pooja.controller');
const notificationService = require('../../services/notification.service');
const { authenticate } = require('../../middlewares/auth');
const { authorize } = require('../../middlewares/authorize');
const validate = require('../../middlewares/validate');
const { rechargeRules, chatMessageRules } = require('../../validators/auth.validator');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../utils/apiResponse');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

router.use(authenticate, authorize(ROLES.CUSTOMER, ROLES.ADMIN));

// Profile & astrology
router.get('/profile', profileController.getProfile);
router.patch('/profile', profileController.updateProfile);
router.post('/profile/password', profileController.changePassword);
router.post('/profile/avatar', require('../../middlewares/upload').single('avatar'), profileController.uploadAvatar);
router.get('/horoscope/daily', profileController.dailyHoroscope);
router.get('/horoscope/all', profileController.allHoroscopes);
router.post('/kundli', profileController.generateKundli);
router.get('/astrologers', profileController.listAstrologers);
router.get('/astrologers/:id', profileController.getAstrologer);

// Wallet
router.get('/wallet', walletController.getWallet);
router.get('/wallet/transactions', walletController.getTransactions);
router.post('/wallet/recharge', rechargeRules, validate, walletController.createRecharge);
router.post('/wallet/verify', walletController.verifyRecharge);
router.get('/wallet/payments/:paymentId', walletController.paymentStatus);
router.post('/wallet/confirm-stub', walletController.confirmStubRecharge);
router.post('/wallet/coupon', walletController.validateCoupon);

// Chat
router.post('/chat/ai/start', chatController.startAi);
router.post('/chat/request', chatController.requestChat);
router.post('/chat/end-active', chatController.endActiveChats);
router.get('/chat/active', chatController.getActiveChat);
router.get('/chats', chatController.history);
router.post('/chat/:id/message', chatMessageRules, validate, chatController.sendMessage);
router.post('/chat/:id/ai-reply', chatMessageRules, validate, chatController.aiReply);
router.post('/chat/:id/end', chatController.endChat);
router.post('/chat/:id/resume', chatController.resumeAi);
router.get('/chat/:id/open', chatController.openAi);
router.get('/chat/:id/messages', chatController.getMessages);

// Store
router.get('/store/products', storeController.listProducts);
router.get('/store/products/:slug', storeController.getProduct);
router.get('/cart', storeController.getCart);
router.post('/cart', storeController.addToCart);
router.patch('/cart/:itemId', storeController.updateCartItem);
router.post('/checkout', storeController.checkout);
router.get('/orders', storeController.myOrders);
router.get('/wishlist', storeController.getWishlist);
router.post('/wishlist', storeController.toggleWishlist);

// Pooja bookings
router.get('/poojas', poojaController.list);
router.get('/poojas/bookings', poojaController.myBookings);
router.get('/poojas/bookings/:id', poojaController.myBooking);
router.post('/poojas/bookings', poojaController.book);
router.post('/poojas/bookings/:id/cancel', poojaController.cancel);
router.get('/poojas/:slug', poojaController.getBySlug);

// Notifications
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const data = await notificationService.listForUser(req.user._id, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      unreadOnly: req.query.unreadOnly === 'true',
    });
    return success(res, { data: data.items, meta: { ...data.meta, unreadCount: data.unreadCount } });
  })
);
router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const data = await notificationService.markRead(req.user._id, req.params.id);
    return success(res, { data });
  })
);
router.patch(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.user._id);
    return success(res, { message: 'All marked read' });
  })
);

module.exports = router;

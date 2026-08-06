const express = require('express');
const walletController = require('../../controllers/customer/wallet.controller');
const chatController = require('../../controllers/customer/chat.controller');
const storeController = require('../../controllers/customer/store.controller');
const profileController = require('../../controllers/customer/profile.controller');
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
router.patch('/profile', profileController.updateProfile);
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
router.post('/wallet/confirm-stub', walletController.confirmStubRecharge);

// Chat
router.post('/chat/ai/start', chatController.startAi);
router.post('/chat/request', chatController.requestChat);
router.post('/chat/:id/message', chatMessageRules, validate, chatController.sendMessage);
router.post('/chat/:id/end', chatController.endChat);
router.get('/chat/:id/messages', chatController.getMessages);
router.get('/chats', chatController.history);

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

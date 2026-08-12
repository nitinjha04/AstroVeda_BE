const express = require('express');
const ctrl = require('../../controllers/admin/admin.controller');
const { authenticate } = require('../../middlewares/auth');
const { authorize } = require('../../middlewares/authorize');
const upload = require('../../middlewares/upload');
const audit = require('../../middlewares/audit');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/dashboard', ctrl.dashboard);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.patch('/users/:id/block', audit('block_user', 'User'), ctrl.blockUser);

router.get('/astrologers', ctrl.listAstrologers);
router.post('/astrologers/:id/approve', audit('approve_astrologer', 'Astrologer'), ctrl.approveAstrologer);
router.post('/astrologers/:id/reject', audit('reject_astrologer', 'Astrologer'), ctrl.rejectAstrologer);

router.get('/ai/settings', ctrl.getAiSettings);
router.put('/ai/settings', audit('update_ai', 'Settings'), ctrl.updateAiSettings);
router.get('/ai/analytics', ctrl.aiAnalytics);

router.get('/categories', ctrl.listCategories);
router.post('/categories', ctrl.createCategory);

router.get('/products', ctrl.listProducts);
router.post('/products', upload.array('images', 8), ctrl.createProduct);
router.patch('/products/:id', ctrl.updateProduct);
router.delete('/products/:id', audit('delete_product', 'Product'), ctrl.deleteProduct);

router.get('/orders', ctrl.listOrders);
router.get('/orders/:id', ctrl.getOrder);
router.patch('/orders/:id/status', ctrl.updateOrderStatus);
router.patch('/orders/:id', ctrl.updateOrderStatus);

router.get('/coupons', ctrl.listCoupons);
router.post('/coupons', ctrl.createCoupon);
router.patch('/coupons/:id', audit('update_coupon', 'Coupon'), ctrl.updateCoupon);

router.get('/banners', ctrl.listBanners);
router.post('/banners', upload.single('image'), ctrl.createBanner);

router.get('/blogs', ctrl.listBlogs);
router.post('/blogs', ctrl.createBlog);

router.post('/wallet/adjust', audit('wallet_adjust', 'Wallet'), ctrl.adjustWallet);
router.get('/wallet/transactions', ctrl.listWalletTransactions);

router.get('/withdrawals', ctrl.listWithdrawals);
router.patch('/withdrawals/:id', audit('process_withdrawal', 'Withdrawal'), ctrl.processWithdrawal);

router.get('/reviews', ctrl.listReviews);
router.patch('/reviews/:id', ctrl.moderateReview);

router.get('/settings/:key', ctrl.getSettings);
router.put('/settings/:key', audit('update_settings', 'Settings'), ctrl.updateSettings);

router.get('/payments', ctrl.listPayments);

router.get('/poojas', ctrl.listPoojasAdmin);
router.post('/poojas', audit('create_pooja', 'Pooja'), ctrl.createPooja);
router.patch('/poojas/:id', audit('update_pooja', 'Pooja'), ctrl.updatePooja);
router.delete('/poojas/:id', audit('delete_pooja', 'Pooja'), ctrl.deletePooja);
router.get('/pooja-bookings', ctrl.listPoojaBookingsAdmin);

router.get('/contacts', ctrl.listContacts);
router.patch('/contacts/:id', ctrl.updateContact);

router.post('/notifications/broadcast', ctrl.broadcastNotification);

module.exports = router;

const express = require('express');
const ctrl = require('../../controllers/astrologer/astrologer.controller');
const { authenticate } = require('../../middlewares/auth');
const { authorize } = require('../../middlewares/authorize');
const upload = require('../../middlewares/upload');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

router.use(authenticate, authorize(ROLES.ASTROLOGER, ROLES.ADMIN));

router.post('/register', ctrl.registerAstrologer);
router.get('/profile', ctrl.getProfile);
router.patch('/profile', ctrl.updateProfile);
router.patch('/availability', ctrl.toggleOnline);
router.post(
  '/kyc',
  upload.fields([
    { name: 'documentFront', maxCount: 1 },
    { name: 'documentBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  ctrl.submitKyc
);
router.post('/certificates', upload.single('file'), ctrl.uploadCertificate);
router.get('/chats/pending', ctrl.pendingChats);
router.post('/chats/:id/accept', ctrl.acceptChat);
router.post('/chats/:id/reject', ctrl.rejectChat);
router.post('/chats/:id/message', ctrl.sendMessage);
router.post('/chats/:id/end', ctrl.endChat);
router.get('/earnings', ctrl.earnings);
router.post('/withdrawals', ctrl.requestWithdrawal);
router.get('/analytics', ctrl.analytics);

module.exports = router;

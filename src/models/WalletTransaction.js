const mongoose = require('mongoose');
const { WALLET_TX_TYPE } = require('../utils/constants');

const walletTransactionSchema = new mongoose.Schema(
  {
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(WALLET_TX_TYPE),
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    reference: { type: String, index: true },
    referenceModel: {
      type: String,
      enum: ['Payment', 'ChatRoom', 'Order', 'PoojaBooking', 'Withdrawal', 'Coupon', 'Referral', 'Admin', null],
      default: null,
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    description: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'reversed'],
      default: 'completed',
      index: true,
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

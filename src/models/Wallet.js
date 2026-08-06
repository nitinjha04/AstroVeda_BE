const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },
    isLocked: { type: Boolean, default: false },
    lockReason: String,
    lifetimeCredit: { type: Number, default: 0 },
    lifetimeDebit: { type: Number, default: 0 },
  },
  { timestamps: true }
);

walletSchema.methods.canAfford = function canAfford(amount) {
  return !this.isLocked && this.balance >= amount;
};

module.exports = mongoose.model('Wallet', walletSchema);

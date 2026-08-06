const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referred: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    code: { type: String, required: true, index: true },
    referrerBonus: { type: Number, default: 0 },
    referredBonus: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'credited', 'cancelled'],
      default: 'pending',
    },
    creditedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Referral', referralSchema);

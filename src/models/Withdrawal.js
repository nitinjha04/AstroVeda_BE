const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    astrologer: { type: mongoose.Schema.Types.ObjectId, ref: 'Astrologer', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid'],
      default: 'pending',
      index: true,
    },
    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      ifsc: String,
      bankName: String,
      upiId: String,
    },
    adminNote: String,
    rejectionReason: String,
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    transactionRef: String,
  },
  { timestamps: true }
);

withdrawalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);

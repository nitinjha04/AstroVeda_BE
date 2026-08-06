const mongoose = require('mongoose');
const { ASTROLOGER_STATUS, KYC_STATUS } = require('../utils/constants');

const scheduleSlotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      required: true,
    },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: false }
);

const astrologerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    displayName: { type: String, required: true, trim: true },
    bio: { type: String, maxlength: 2000, default: '' },
    specialties: [{ type: String, trim: true }],
    languages: [{ type: String, trim: true }],
    experienceYears: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(ASTROLOGER_STATUS),
      default: ASTROLOGER_STATUS.PENDING,
      index: true,
    },
    rejectionReason: String,
    isOnline: { type: Boolean, default: false, index: true },
    isAvailableForChat: { type: Boolean, default: true },
    isAvailableForVoice: { type: Boolean, default: false },
    isAvailableForVideo: { type: Boolean, default: false },
    pricing: {
      chatPerMinute: { type: Number, default: 10, min: 0 },
      voicePerMinute: { type: Number, default: 20, min: 0 },
      videoPerMinute: { type: Number, default: 30, min: 0 },
    },
    schedule: [scheduleSlotSchema],
    certificates: [
      {
        title: String,
        url: String,
        publicId: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    kyc: {
      status: {
        type: String,
        enum: Object.values(KYC_STATUS),
        default: KYC_STATUS.PENDING,
      },
      documentType: String,
      documentNumber: String,
      documentFront: String,
      documentBack: String,
      selfie: String,
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: String,
    },
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    stats: {
      totalChats: { type: Number, default: 0 },
      totalMinutes: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 },
      totalWithdrawn: { type: Number, default: 0 },
    },
    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      ifsc: String,
      bankName: String,
      upiId: String,
    },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

astrologerSchema.index({ status: 1, isOnline: 1 });
astrologerSchema.index({ 'ratings.average': -1 });
astrologerSchema.index({ specialties: 1 });
astrologerSchema.index({ displayName: 'text', bio: 'text', specialties: 'text' });

module.exports = mongoose.model('Astrologer', astrologerSchema);

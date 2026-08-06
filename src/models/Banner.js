const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    subtitle: String,
    image: { type: String, required: true },
    publicId: String,
    link: String,
    placement: {
      type: String,
      enum: ['home_hero', 'home_mid', 'store_top', 'chat_promo'],
      default: 'home_hero',
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Banner', bannerSchema);

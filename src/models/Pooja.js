const mongoose = require('mongoose');

const poojaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    benefits: [{ type: String }],
    duration: { type: String, default: '1–2 hours' },
    category: {
      type: String,
      enum: ['home', 'prosperity', 'health', 'grah', 'lifecycle', 'deity'],
      default: 'deity',
    },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    glyph: { type: String, default: '🕯' },
    image: { type: String, default: '' },
    languages: [{ type: String }],
    includes: [{ type: String }],
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

poojaSchema.index({ isActive: 1, sortOrder: 1 });
poojaSchema.index({ name: 'text', shortDescription: 'text' });

module.exports = mongoose.model('Pooja', poojaSchema);

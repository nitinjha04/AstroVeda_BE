const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema(
  {
    q: String,
    a: String,
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    name: String,
    rating: Number,
    comment: String,
    date: String,
  },
  { _id: false }
);

const aiAstrologerSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    tagline: String,
    about: String,
    avatarEmoji: { type: String, default: '✨' },
    avatar: { type: String, default: '' },
    specialties: [String],
    expertise: { type: [String], index: true },
    knowledgeAreas: [String],
    languages: { type: [String], index: true },
    pricePerMinute: { type: Number, required: true, min: 1 },
    ratingAverage: { type: Number, default: 4.5, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    experienceYears: { type: Number, default: 5 },
    tasks: [String],
    faq: [faqSchema],
    reviews: [reviewSchema],
    suggestedProductSlugs: [String],
    systemPrompt: { type: String, required: true },
    greeting: { type: String, required: true },
    isActive: { type: Boolean, default: true, index: true },
    isOnline: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

aiAstrologerSchema.index({ pricePerMinute: 1 });
aiAstrologerSchema.index({ ratingAverage: -1 });
aiAstrologerSchema.index({ displayName: 'text', tagline: 'text', about: 'text', specialties: 'text' });

module.exports = mongoose.model('AIAstrologer', aiAstrologerSchema);

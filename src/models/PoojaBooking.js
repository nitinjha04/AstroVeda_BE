const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: 'India' },
  },
  { _id: false }
);

const poojaBookingSchema = new mongoose.Schema(
  {
    bookingNumber: { type: String, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pooja: { type: mongoose.Schema.Types.ObjectId, ref: 'Pooja', required: true },
    poojaSnapshot: {
      name: String,
      slug: String,
      price: Number,
      glyph: String,
      duration: String,
    },
    scheduledDate: { type: Date, required: true, index: true },
    preferredTime: { type: String, default: 'morning' }, // morning | afternoon | evening
    address: { type: addressSchema, required: true },
    notes: { type: String, default: '', maxlength: 1000 },
    amount: { type: Number, required: true, min: 0 },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      enum: ['cod_stub', 'wallet', 'razorpay'],
      default: 'razorpay',
    },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'scheduled', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    cancelledAt: Date,
    cancelReason: String,
    completedAt: Date,
    paidAt: Date,
  },
  { timestamps: true }
);

poojaBookingSchema.index({ user: 1, scheduledDate: -1 });
poojaBookingSchema.index({ user: 1, status: 1 });

poojaBookingSchema.pre('validate', function assignNumber(next) {
  if (!this.bookingNumber) {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    this.bookingNumber = `PJ-${ts}-${rnd}`;
  }
  next();
});

module.exports = mongoose.model('PoojaBooking', poojaBookingSchema);

const { Pooja, PoojaBooking } = require('../models');
const AppError = require('../utils/AppError');
const paymentService = require('./payment.service');
const walletService = require('./wallet.service');
const { WALLET_TX_TYPE } = require('../utils/constants');
const { v4: uuidv4 } = require('uuid');

const startOfTodayUTC = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const listPoojas = async ({ search, category, page = 1, limit = 24 } = {}) => {
  const filter = { isActive: true };
  if (category && category !== 'all') filter.category = category;
  if (search) {
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { shortDescription: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') },
    ];
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 50);
  const [items, total] = await Promise.all([
    Pooja.find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Pooja.countDocuments(filter),
  ]);

  return {
    items,
    meta: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) || 1 },
  };
};

const getPoojaBySlug = async (slug) => {
  const pooja = await Pooja.findOne({ slug, isActive: true }).lean();
  if (!pooja) throw new AppError('Pooja not found', 404);
  return pooja;
};

/**
 * Book pooja via Razorpay (pending until paid) or wallet (confirmed immediately).
 */
const bookPooja = async (userId, payload) => {
  const {
    poojaId,
    slug,
    scheduledDate,
    preferredTime = 'morning',
    address,
    notes = '',
    paymentMethod = 'razorpay',
  } = payload || {};

  const method = paymentMethod === 'wallet' ? 'wallet' : 'razorpay';

  if (!scheduledDate) throw new AppError('Scheduled date is required', 400);
  if (!address?.name || !address?.phone || !address?.line1 || !address?.city || !address?.state || !address?.pincode) {
    throw new AppError('Complete service address is required', 400);
  }

  const day = new Date(scheduledDate);
  if (Number.isNaN(day.getTime())) throw new AppError('Invalid scheduled date', 400);
  day.setHours(12, 0, 0, 0);

  const today = startOfTodayUTC();
  if (day < today) {
    throw new AppError('Pooja date must be today or a future date', 400);
  }

  let pooja = null;
  if (poojaId) pooja = await Pooja.findOne({ _id: poojaId, isActive: true });
  if (!pooja && slug) pooja = await Pooja.findOne({ slug, isActive: true });
  if (!pooja) throw new AppError('Pooja not found', 404);

  const preferred = ['morning', 'afternoon', 'evening'].includes(preferredTime)
    ? preferredTime
    : 'morning';

  const amount = Number(pooja.price);
  if (!(amount > 0)) throw new AppError('This pooja has an invalid price', 400);

  const addressDoc = {
    name: address.name.trim(),
    phone: address.phone.trim(),
    line1: address.line1.trim(),
    line2: (address.line2 || '').trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    pincode: address.pincode.trim(),
    country: (address.country || 'India').trim(),
  };

  const snapshot = {
    name: pooja.name,
    slug: pooja.slug,
    price: pooja.price,
    glyph: pooja.glyph,
    duration: pooja.duration,
  };

  if (method === 'wallet') {
    const bal = await walletService.getBalance(userId);
    if (!bal || Number(bal.balance) < amount) {
      throw new AppError('Insufficient wallet balance', 402);
    }

    await walletService.debit({
      userId,
      amount,
      type: WALLET_TX_TYPE.POOJA_PAYMENT,
      description: `Pooja booking · ${pooja.name}`,
    });

    const booking = await PoojaBooking.create({
      user: userId,
      pooja: pooja._id,
      poojaSnapshot: snapshot,
      scheduledDate: day,
      preferredTime: preferred,
      address: addressDoc,
      notes: String(notes || '').slice(0, 1000),
      amount,
      paymentStatus: 'paid',
      paymentMethod: 'wallet',
      status: 'confirmed',
      paidAt: new Date(),
    });

    await booking.populate('pooja', 'name slug glyph duration price category');
    const wallet = await walletService.getBalance(userId);

    return {
      booking,
      paid: true,
      paymentMethod: 'wallet',
      amount,
      wallet,
    };
  }

  const booking = await PoojaBooking.create({
    user: userId,
    pooja: pooja._id,
    poojaSnapshot: snapshot,
    scheduledDate: day,
    preferredTime: preferred,
    address: addressDoc,
    notes: String(notes || '').slice(0, 1000),
    amount,
    paymentStatus: 'pending',
    paymentMethod: 'razorpay',
    status: 'pending',
  });

  const gateway = await paymentService.createGatewayOrder({
    userId,
    amount,
    purpose: 'pooja_booking',
    receipt: `pj_${uuidv4().slice(0, 8)}`,
    poojaBookingId: booking._id,
    notes: {
      bookingId: booking._id.toString(),
      poojaSlug: pooja.slug,
    },
    metadata: {
      bookingId: booking._id.toString(),
      poojaSlug: pooja.slug,
      poojaName: pooja.name,
    },
  });

  booking.payment = gateway.payment._id;
  await booking.save();
  await booking.populate('pooja', 'name slug glyph duration price category');

  return {
    booking,
    paymentId: gateway.payment._id,
    orderId: gateway.gatewayOrderId,
    keyId: gateway.keyId,
    amount: gateway.amount,
    payable: gateway.amount,
    currency: gateway.currency,
    gateway: 'razorpay',
    paid: false,
    paymentMethod: 'razorpay',
  };
};


const listMyBookings = async (userId, { filter = 'all' } = {}) => {
  const today = startOfTodayUTC();
  const query = { user: userId };

  if (filter === 'upcoming') {
    query.scheduledDate = { $gte: today };
    query.status = { $in: ['pending', 'confirmed', 'scheduled'] };
  } else if (filter === 'past') {
    query.$or = [
      { scheduledDate: { $lt: today } },
      { status: { $in: ['completed', 'cancelled'] } },
    ];
  }

  const items = await PoojaBooking.find(query)
    .populate('pooja', 'name slug glyph duration price category')
    .sort({ scheduledDate: filter === 'past' ? -1 : 1 })
    .lean();

  return items;
};

const getMyBooking = async (userId, bookingId) => {
  const booking = await PoojaBooking.findOne({ _id: bookingId, user: userId })
    .populate('pooja', 'name slug glyph duration price category description benefits')
    .lean();
  if (!booking) throw new AppError('Booking not found', 404);
  return booking;
};

const cancelBooking = async (userId, bookingId, reason = '') => {
  const booking = await PoojaBooking.findOne({ _id: bookingId, user: userId });
  if (!booking) throw new AppError('Booking not found', 404);
  if (['completed', 'cancelled'].includes(booking.status)) {
    throw new AppError('This booking cannot be cancelled', 409);
  }
  const today = startOfTodayUTC();
  if (booking.scheduledDate < today) {
    throw new AppError('Past bookings cannot be cancelled', 409);
  }
  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  booking.cancelReason = reason || 'Cancelled by customer';
  await booking.save();
  return booking;
};

const SEED_POOJAS = [
  {
    name: 'Ganesh Pooja',
    slug: 'ganesh-pooja',
    glyph: 'ॐ',
    category: 'deity',
    price: 1500,
    duration: '1 hour',
    shortDescription: 'Begin auspicious work with the remover of obstacles.',
    description:
      'A traditional Ganapati worship for new beginnings — careers, homes, and journeys. Includes sankalp, aarti, and prasadam guidance.',
    benefits: ['Removes obstacles', 'Blesses new ventures', 'Brings clarity and focus'],
    includes: ['Pandit (virtual or on-site coordination)', 'Sankalp', 'Aarti sequence'],
    languages: ['Hindi', 'English'],
    sortOrder: 1,
  },
  {
    name: 'Satyanarayan Katha',
    slug: 'satyanarayan-katha',
    glyph: '✦',
    category: 'prosperity',
    price: 3500,
    duration: '2–3 hours',
    shortDescription: 'Lord Vishnu’s truth-katha for family peace and prosperity.',
    description:
      'Satyanarayan Pooja with full katha, offering sequence, and family participation notes. Ideal on Purnima or before major milestones.',
    benefits: ['Family harmony', 'Fulfilment of vows', 'Gratitude and prosperity'],
    includes: ['Full katha', 'Offering sequence', 'Prasadam notes'],
    languages: ['Hindi', 'English'],
    sortOrder: 2,
  },
  {
    name: 'Griha Pravesh Pooja',
    slug: 'griha-pravesh',
    glyph: '⌂',
    category: 'home',
    price: 7500,
    duration: '2–4 hours',
    shortDescription: 'Housewarming ritual to invite divine energy into a new home.',
    description:
      'Vastu-aware Griha Pravesh with Ganesh, kalash, and havan steps. Schedule on an auspicious morning when your keys are ready.',
    benefits: ['Welcomes prosperity', 'Settles the home’s energy', 'Protects residents'],
    includes: ['Kalash & havan guidance', 'Ganesh invocation', 'Home entry sequence'],
    languages: ['Hindi', 'English', 'Marathi'],
    sortOrder: 3,
  },
  {
    name: 'Rudrabhishek',
    slug: 'rudrabhishek',
    glyph: '☽',
    category: 'health',
    price: 4100,
    duration: '1.5–2 hours',
    shortDescription: 'Abhishek of Shiva with Rudra mantras for peace and protection.',
    description:
      'Powerful Rudra abhishek with milk, water, and sacred offerings. Often chosen on Mondays or before difficult phases.',
    benefits: ['Mental peace', 'Health and protection', 'Spiritual cleansing'],
    includes: ['Rudra mantra sequence', 'Abhishek materials list', 'Aarti'],
    languages: ['Hindi', 'Sanskrit guidance'],
    sortOrder: 4,
  },
  {
    name: 'Navagraha Pooja',
    slug: 'navagraha-pooja',
    glyph: '☉',
    category: 'grah',
    price: 5500,
    duration: '2 hours',
    shortDescription: 'Pacify and honour the nine grahas for smoother progress.',
    description:
      'Navagraha worship for planetary balance — career blocks, delays, and chart stress mentioned in your kundli.',
    benefits: ['Eases delays', 'Supports career and travel', 'Balances planetary heat'],
    includes: ['Nine-graha mantras', 'Offering sequence', 'Remedial notes'],
    languages: ['Hindi', 'English'],
    sortOrder: 5,
  },
  {
    name: 'Lakshmi Pooja',
    slug: 'lakshmi-pooja',
    glyph: '❂',
    category: 'prosperity',
    price: 2800,
    duration: '1–1.5 hours',
    shortDescription: 'Invite Goddess Lakshmi for abundance and household harmony.',
    description:
      'Deep-aarti style Lakshmi Pooja suited to Diwali evenings or any Friday for wealth and cleanliness rituals.',
    benefits: ['Attracts abundance', 'Purifies the household purse', 'Gratitude practice'],
    includes: ['Lakshmi aarti', 'Coin & rice offerings list', 'Deepam sequence'],
    languages: ['Hindi', 'English'],
    sortOrder: 6,
  },
  {
    name: 'Maha Mrityunjaya Jap',
    slug: 'maha-mrityunjaya-jap',
    glyph: '⚕',
    category: 'health',
    price: 3200,
    duration: '1–2 hours',
    shortDescription: 'Healing jap for recovery, longevity, and courage.',
    description:
      'Focused Mahamrityunjaya mantra japa with sankalp for the person named in the booking notes.',
    benefits: ['Supports recovery', 'Calms fear', 'Strengthens longevity resolve'],
    includes: ['Jap count options', 'Sankalp for named person', 'Aarti'],
    languages: ['Hindi', 'English'],
    sortOrder: 7,
  },
  {
    name: 'Kaal Sarp Dosh Shanti',
    slug: 'kaal-sarp-shanti',
    glyph: '☾',
    category: 'grah',
    price: 9100,
    duration: '3 hours',
    shortDescription: 'Special shanti when Kaal Sarp patterns appear in the chart.',
    description:
      'Structured shanti pooja for Kaal Sarp–related anxiety when recommended by a guide. Not a medical claim — ritual support only.',
    benefits: ['Ritual relief for chart tension', 'Focus and discipline', 'Family peace intent'],
    includes: ['Shanti sequence', 'Mantra set', 'Aftercare guidance'],
    languages: ['Hindi'],
    sortOrder: 8,
  },
  {
    name: 'Wedding Muhurat Pooja',
    slug: 'vivah-pooja',
    glyph: '♡',
    category: 'lifecycle',
    price: 12000,
    duration: 'Half day',
    shortDescription: 'Preliminary vivah rituals and sankalp for the marriage day.',
    description:
      'Pre-wedding and wedding-day ritual package coordination. Confirm pandit language and regional customs in notes.',
    benefits: ['Auspicious start to vivah', 'Family alignment', 'Regional flexibility'],
    includes: ['Ganesh + family deities', 'Muhurat support notes', 'Checklist for hosts'],
    languages: ['Hindi', 'English', 'Marathi', 'Gujarati'],
    sortOrder: 9,
  },
  {
    name: 'Vastu Shanti Havan',
    slug: 'vastu-shanti-havan',
    glyph: '◇',
    category: 'home',
    price: 6500,
    duration: '2–3 hours',
    shortDescription: 'Havan to settle Vastu imbalances in an existing home.',
    description:
      'Vastu Shanti havan when renovating, after prolonged stress at home, or on priest recommendation.',
    benefits: ['Settles restless homes', 'Supports renovations', 'Family wellbeing intent'],
    includes: ['Havan sequence', 'Vastu sankalp', 'Smoke-safe notes'],
    languages: ['Hindi', 'English'],
    sortOrder: 10,
  },
];

const seedPoojas = async () => {
  for (const row of SEED_POOJAS) {
    await Pooja.findOneAndUpdate({ slug: row.slug }, { $set: { ...row, isActive: true } }, { upsert: true, new: true });
  }
  return SEED_POOJAS.length;
};

module.exports = {
  listPoojas,
  getPoojaBySlug,
  bookPooja,
  listMyBookings,
  getMyBooking,
  cancelBooking,
  seedPoojas,
  SEED_POOJAS,
};

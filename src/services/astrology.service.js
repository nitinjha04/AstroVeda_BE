/**
 * Daily horoscope & kundli helpers.
 * Production: integrate Swiss Ephemeris / astrology API.
 * This module provides structured, deterministic placeholders keyed by zodiac.
 */

const ZODIAC = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
];

const TRAITS = {
  aries: { element: 'Fire', ruler: 'Mars', quality: 'Cardinal' },
  taurus: { element: 'Earth', ruler: 'Venus', quality: 'Fixed' },
  gemini: { element: 'Air', ruler: 'Mercury', quality: 'Mutable' },
  cancer: { element: 'Water', ruler: 'Moon', quality: 'Cardinal' },
  leo: { element: 'Fire', ruler: 'Sun', quality: 'Fixed' },
  virgo: { element: 'Earth', ruler: 'Mercury', quality: 'Mutable' },
  libra: { element: 'Air', ruler: 'Venus', quality: 'Cardinal' },
  scorpio: { element: 'Water', ruler: 'Mars/Pluto', quality: 'Fixed' },
  sagittarius: { element: 'Fire', ruler: 'Jupiter', quality: 'Mutable' },
  capricorn: { element: 'Earth', ruler: 'Saturn', quality: 'Cardinal' },
  aquarius: { element: 'Air', ruler: 'Saturn/Uranus', quality: 'Fixed' },
  pisces: { element: 'Water', ruler: 'Jupiter/Neptune', quality: 'Mutable' },
};

const getZodiacFromDate = (dateInput) => {
  const d = new Date(dateInput);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const ranges = [
    [1, 20, 'capricorn'], [2, 19, 'aquarius'], [3, 20, 'pisces'], [4, 20, 'aries'],
    [5, 21, 'taurus'], [6, 21, 'gemini'], [7, 22, 'cancer'], [8, 23, 'leo'],
    [9, 23, 'virgo'], [10, 23, 'libra'], [11, 22, 'scorpio'], [12, 22, 'sagittarius'], [12, 32, 'capricorn'],
  ];
  for (const [m, maxDay, sign] of ranges) {
    if (month === m && day <= maxDay) return sign;
    if (month === m && day > maxDay) {
      const idx = ranges.findIndex((r) => r[0] === m && r[1] === maxDay);
      return ranges[idx + 1]?.[2] || sign;
    }
  }
  return 'aries';
};

const dailyHoroscope = (sign, date = new Date()) => {
  const s = (sign || 'aries').toLowerCase();
  if (!ZODIAC.includes(s)) throw Object.assign(new Error('Invalid zodiac sign'), { statusCode: 400 });

  const seed = `${s}-${date.toISOString().slice(0, 10)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 1000;

  const love = 3 + (hash % 3);
  const career = 3 + ((hash >> 2) % 3);
  const health = 3 + ((hash >> 4) % 3);
  const finance = 3 + ((hash >> 6) % 3);

  return {
    sign: s,
    date: date.toISOString().slice(0, 10),
    traits: TRAITS[s],
    summary: `Today favors mindful action for ${s}. Align with ${TRAITS[s].element.toLowerCase()} energy and let ${TRAITS[s].ruler} guide your choices.`,
    love,
    career,
    health,
    finance,
    luckyNumber: (hash % 9) + 1,
    luckyColor: ['crimson', 'gold', 'sapphire', 'emerald', 'violet', 'silver'][hash % 6],
    tip: 'Pause before major decisions and trust your intuition.',
  };
};

const generateKundli = ({ name, dateOfBirth, birthTime, birthPlace, gender }) => {
  const sunSign = getZodiacFromDate(dateOfBirth);
  const moonIndex = (sunSign.charCodeAt(0) + (birthTime || '12:00').length) % 12;
  const moonSign = ZODIAC[moonIndex];
  const risingIndex = (moonIndex + (birthPlace || '').length) % 12;
  const risingSign = ZODIAC[risingIndex];

  const planets = [
    { name: 'Sun', sign: sunSign, house: 1 },
    { name: 'Moon', sign: moonSign, house: 4 },
    { name: 'Mars', sign: ZODIAC[(moonIndex + 2) % 12], house: 3 },
    { name: 'Mercury', sign: ZODIAC[(moonIndex + 1) % 12], house: 2 },
    { name: 'Jupiter', sign: ZODIAC[(moonIndex + 5) % 12], house: 9 },
    { name: 'Venus', sign: ZODIAC[(moonIndex + 3) % 12], house: 7 },
    { name: 'Saturn', sign: ZODIAC[(moonIndex + 7) % 12], house: 10 },
    { name: 'Rahu', sign: ZODIAC[(moonIndex + 8) % 12], house: 11 },
    { name: 'Ketu', sign: ZODIAC[(moonIndex + 2) % 12], house: 5 },
  ];

  return {
    native: { name, dateOfBirth, birthTime, birthPlace, gender },
    chartType: 'South Indian (approx placeholder)',
    sunSign,
    moonSign,
    risingSign,
    planets,
    yogas: ['Raj Yoga (indicative)', 'Gaja Kesari (indicative)'],
    dasha: {
      currentMahadasha: planets[1].name,
      note: 'Connect Swiss Ephemeris for production-accurate Vimshottari dasha.',
    },
    aiHint: `Primary focus areas: career house 10 (${planets.find((p) => p.house === 10)?.sign || '—'}) and relationships house 7.`,
    disclaimer: 'This is a structured placeholder chart. Integrate an ephemeris engine for production kundli accuracy.',
  };
};

const getAllDaily = (date = new Date()) => ZODIAC.map((sign) => dailyHoroscope(sign, date));

module.exports = {
  ZODIAC,
  dailyHoroscope,
  generateKundli,
  getAllDaily,
  getZodiacFromDate,
};

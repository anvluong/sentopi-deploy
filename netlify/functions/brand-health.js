/**
 * Sentopi — Revenue Risk Report
 * Netlify Function: /api/brand-health
 *
 * Accepts POST { input: "B0FB9MXHR1" | "A2YVQMS6C6QFJO" }
 * Auto-detects whether input is an ASIN (B0...) or Seller ID (A...).
 *
 * Flow:
 *   ASIN   → pull product → expand via variationCSV → score brand
 *   Seller → /seller?storefront=1 → ASIN list → score brand
 *
 * Pillars: BSR Health (40pts) + Rating Health (35pts) + Buy Box Health (25pts) = 100
 * Review Velocity removed — revenue impact captured via monthlySold in Revenue at Risk.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const KEEPA_DOMAIN           = 1;    // 1 = Amazon.com
const MAX_ASINS              = 10;
const MIN_REVIEWS_FOR_ROLLUP = 25;

// Pillar weights — sum to 100
const WEIGHTS = { bsr: 40, rating: 35, buybox: 25 };

// ─── KEEPA TIME UTILS ────────────────────────────────────────────────────────

const KEEPA_EPOCH_SEC = Date.UTC(2011, 0, 1) / 1000;

function keepaToDate(keepaMinutes) {
  return new Date((KEEPA_EPOCH_SEC + keepaMinutes * 60) * 1000);
}

function nowKeepa() {
  return Math.floor((Date.now() / 1000 - KEEPA_EPOCH_SEC) / 60);
}

function daysAgoKeepa(n) {
  return nowKeepa() - n * 24 * 60;
}

function parseCSV(csv, sinceKeepa = 0) {
  if (!Array.isArray(csv) || csv.length < 2) return [];
  const out = [];
  for (let i = 0; i < csv.length - 1; i += 2) {
    const t = csv[i], v = csv[i + 1];
    if (v === -1 || t < sinceKeepa) continue;
    out.push({ t, v, date: keepaToDate(t) });
  }
  return out;
}

// csv[18] Buy Box — TRIPLET format [timestamp, price, shipping]
// price = -1 means brand has lost Buy Box at that timestamp
function parseBBTriplets(csv, sinceKeepa = 0) {
  if (!Array.isArray(csv) || csv.length < 3) return [];
  const out = [];
  for (let i = 0; i < csv.length - 2; i += 3) {
    const t = csv[i], price = csv[i + 1], shipping = csv[i + 2];
    if (t < sinceKeepa) continue;
    out.push({ t, price, shipping, date: keepaToDate(t) });
  }
  return out;
}

// ─── CONVERSION RATE MODEL ───────────────────────────────────────────────────
// Piecewise linear — identical to calculator.html. Single source of truth.

const CONV_TABLE = [
  { r: 1.0, i: 0.40 }, { r: 2.0, i: 0.55 }, { r: 2.5, i: 0.65 },
  { r: 3.0, i: 0.75 }, { r: 3.5, i: 0.85 }, { r: 4.0, i: 0.92 },
  { r: 4.2, i: 0.96 }, { r: 4.5, i: 1.00 }, { r: 4.7, i: 0.99 },
  { r: 5.0, i: 0.87 },
];

function convRate(rating) {
  if (!rating || rating <= CONV_TABLE[0].r) return CONV_TABLE[0].i;
  if (rating >= CONV_TABLE[CONV_TABLE.length - 1].r) return CONV_TABLE[CONV_TABLE.length - 1].i;
  for (let j = 0; j < CONV_TABLE.length - 1; j++) {
    const lo = CONV_TABLE[j], hi = CONV_TABLE[j + 1];
    if (rating >= lo.r && rating <= hi.r) {
      const t = (rating - lo.r) / (hi.r - lo.r);
      return lo.i + t * (hi.i - lo.i);
    }
  }
  return 0.92;
}

// ─── PILLAR 1: BSR HEALTH (0–40 pts) ─────────────────────────────────────────

function computeBSRHealth(csvBSR) {
  const cutoff = daysAgoKeepa(90);
  const entries = parseCSV(csvBSR, cutoff);

  if (!entries.length) {
    return { score: Math.round(WEIGHTS.bsr * 0.5), current: null, delta90dPct: null, note: 'insufficient history — neutral' };
  }

  const current = entries[entries.length - 1].v;
  const ago90   = entries[0].v;
  const deltaPct = ago90 ? Math.round(((current - ago90) / ago90) * 1000) / 10 : null;

  let score = WEIGHTS.bsr;
  if (deltaPct !== null) {
    // Each 10% deterioration = –4 pts (scaled to 40pt max)
    score -= Math.max(0, deltaPct) * 0.4;
  }
  score = Math.max(0, Math.min(WEIGHTS.bsr, score));

  return {
    score: Math.round(score * 10) / 10,
    current,
    bsr90dAgo: ago90,
    delta90dPct: deltaPct,
  };
}

// ─── PILLAR 2: RATING HEALTH (0–35 pts) ──────────────────────────────────────

function computeRatingHealth(csvRating) {
  const c90 = daysAgoKeepa(90);
  const c30 = daysAgoKeepa(30);

  const raw = parseCSV(csvRating, c90);
  if (!raw.length) {
    return { score: 0, current: null, delta90d: null, delta30d: null, ratingDropped30d: false, rating30dAgo: null, dropDate: null, note: 'no rating data' };
  }

  // Keepa stores rating as integer × 10 (38 = 3.8★)
  const entries = raw.map(e => ({ ...e, v: e.v / 10 }));

  const current      = entries[entries.length - 1].v;
  const rating90dAgo = entries[0].v;
  const entries30d   = entries.filter(e => e.t >= c30);
  const rating30dAgo = entries30d.length ? entries30d[0].v : rating90dAgo;

  const delta90d = Math.round((current - rating90dAgo) * 100) / 100;
  const delta30d = Math.round((current - rating30dAgo) * 100) / 100;

  // Primary CTA flag — any drop in last 30 days
  const ratingDropped30d = delta30d < 0;

  // Find approximate drop date for CTA copy
  let dropDate = null;
  if (ratingDropped30d && entries30d.length >= 2) {
    for (let i = 1; i < entries30d.length; i++) {
      if (entries30d[i].v < entries30d[i - 1].v) {
        dropDate = entries30d[i].date.toISOString().slice(0, 10);
        break;
      }
    }
  }

  let score = WEIGHTS.rating;
  if (delta90d !== null) score += delta90d * (WEIGHTS.rating / 1.25);  // 0.1★ drop = –2.8 pts
  if (delta30d !== null) score += delta30d * (WEIGHTS.rating / 3.5);   // recency penalty
  score = Math.max(0, Math.min(WEIGHTS.rating, score));

  return {
    score: Math.round(score * 10) / 10,
    current,
    rating90dAgo,
    rating30dAgo,
    delta90d,
    delta30d,
    ratingDropped30d,
    dropDate,
    convRateBefore: convRate(rating30dAgo),
    convRateNow:    convRate(current),
  };
}

// ─── PILLAR 3: BUY BOX HEALTH (0–25 pts) ────────────────────────────────────

function computeBuyBoxHealth(csvBB) {
  const c30 = daysAgoKeepa(30);
  const c60 = daysAgoKeepa(60);
  const recent = parseBBTriplets(csvBB, c30);
  const prior  = parseBBTriplets(csvBB, c60).filter(e => e.t < c30);

  if (!recent.length) {
    return { score: Math.round(WEIGHTS.buybox * 0.5), bbPct30d: null, bbMoMPts: null, lbbDetected: false, competitorUndercut: false, note: 'no BB data — neutral' };
  }

  const total  = recent.length;
  const bbHeld = recent.filter(e => e.price !== -1).length;
  const bbPct  = Math.round((bbHeld / total) * 1000) / 10;

  const bbPct60d = prior.length
    ? Math.round((prior.filter(e => e.price !== -1).length / prior.length) * 1000) / 10
    : null;
  const bbMoMPts = bbPct60d !== null ? Math.round((bbPct - bbPct60d) * 10) / 10 : null;

  const lbbDetected = bbPct < 100;

  const pricesHeld = recent.filter(e => e.price > 0).map(e => e.price);
  let modalPrice = null;
  if (pricesHeld.length) {
    const freq = {};
    pricesHeld.forEach(p => { freq[p] = (freq[p] || 0) + 1; });
    modalPrice = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  }

  // Undercut only meaningful when brand has actually lost the BB
  const competitorUndercut = lbbDetected && modalPrice !== null &&
    recent.some(e => e.price > 0 && e.price < modalPrice * 0.9);

  // Find lowest competitor price seen (for display)
  const competitorPrices = recent
    .filter(e => e.price > 0 && lbbDetected && e.price < (modalPrice || Infinity))
    .map(e => e.price);
  const lowestCompetitorPrice = competitorPrices.length
    ? Math.min(...competitorPrices) : null;

  let score = (bbPct / 100) * WEIGHTS.buybox;
  if (bbPct < 70) score -= WEIGHTS.buybox * 0.2;
  if (bbPct === 0) score -= WEIGHTS.buybox * 0.2;
  if (competitorUndercut) score -= WEIGHTS.buybox * 0.1;
  score = Math.max(0, Math.min(WEIGHTS.buybox, score));

  return {
    score: Math.round(score * 10) / 10,
    bbPct30d: bbPct,
    bbMoMPts,
    lbbDetected,
    modalPriceCents: modalPrice,
    lowestCompetitorPrice,
    competitorUndercut,
    eventsIn30d: total,
  };
}

// ─── LIST PRICE (csv[1]) ──────────────────────────────────────────────────────
// Returns most recent MSRP in cents, or null.

function computeListPrice(csvList) {
  if (!Array.isArray(csvList) || csvList.length < 2) return null;
  for (let i = csvList.length - 1; i >= 1; i -= 2) {
    if (csvList[i] > 0) return csvList[i];
  }
  return null;
}

// ─── ASP WINDOW — avg BB price over a specific day range (csv[18]) ────────────
// daysStart=0, daysEnd=30  → last 30 days (current period)
// daysStart=31, daysEnd=60 → prior 30 days (MoM comparison)

function computeASPWindow(csvBB, daysStart, daysEnd) {
  const from = daysAgoKeepa(daysEnd);
  const to   = daysAgoKeepa(daysStart);
  if (!Array.isArray(csvBB) || csvBB.length < 3) return null;
  const prices = [];
  for (let i = 0; i < csvBB.length - 2; i += 3) {
    const t = csvBB[i], price = csvBB[i + 1];
    if (t < from || t > to) continue;
    if (price > 0) prices.push(price);
  }
  if (!prices.length) return null;
  return Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
}

// ─── BRAND ROLLUP ─────────────────────────────────────────────────────────────

function scoreBrand(products) {
  const coreResults     = [];
  const excludedResults = [];

  for (const p of products) {
    const csv = p.csv || [];

    // Review count for weighting + sparse filter
    const rcEntries   = parseCSV(csv[17] || [], 0);
    const reviewCount = rcEntries.length ? rcEntries[rcEntries.length - 1].v : 0;

    // monthlySold for revenue impact default
    const monthlySold  = p.monthlySold || null;

    // Buy Box modal price for revenue impact default
    const p4 = computeBuyBoxHealth(csv[18] || []);
    const p1 = computeBSRHealth(csv[3] || []);
    const p3 = computeRatingHealth(csv[16] || []);

    const listPriceCents  = computeListPrice(csv[1] || []);
    const asp30dCents     = computeASPWindow(csv[18] || [], 0, 30);
    const aspPrior30Cents = computeASPWindow(csv[18] || [], 31, 60);
    const aspMoMPct = (asp30dCents && aspPrior30Cents)
      ? Math.round((asp30dCents - aspPrior30Cents) / aspPrior30Cents * 1000) / 10
      : null;

    // Revenue at Risk calculation
    // units default = monthlySold; price default = BB modal price (in cents → dollars)
    const defaultUnits = monthlySold || null;
    const defaultPrice = p4.modalPriceCents
      ? Math.round(p4.modalPriceCents) / 100
      : asp30dCents ? Math.round(asp30dCents) / 100
      : listPriceCents ? Math.round(listPriceCents) / 100
      : null;
    const defaultPriceSource = p4.modalPriceCents ? 'bb'
      : asp30dCents ? 'asp'
      : listPriceCents ? 'list'
      : null;
    let revenueAtRiskMonthly = null;

    if (p3.ratingDropped30d && defaultUnits && defaultPrice && p3.convRateBefore !== undefined) {
      const convDelta = p3.convRateBefore - p3.convRateNow;
      revenueAtRiskMonthly = Math.round(defaultUnits * defaultPrice * convDelta);
    }

    const composite = p1.score + p3.score + p4.score;

    const result = {
      asin:         p.asin,
      title:        (p.title || '').slice(0, 70),
      brand:        p.brand || '',
      reviewCount,
      monthlySold,
      pillar_bsr:    p1,
      pillar_rating: p3,
      pillar_buybox: p4,
      composite: Math.round(composite * 10) / 10,
      // Revenue at Risk defaults (user can override in UI)
      defaultUnits,
      defaultPrice,
      defaultPriceSource,
      revenueAtRiskMonthly,
      // Pricing intel
      listPrice: listPriceCents ? Math.round(listPriceCents) / 100 : null,
      asp30d:    asp30dCents    ? Math.round(asp30dCents)    / 100 : null,
      aspMoMPct,
    };

    if (reviewCount < MIN_REVIEWS_FOR_ROLLUP) {
      excludedResults.push(result);
    } else {
      coreResults.push(result);
    }
  }

  const rollupSet = coreResults.length ? coreResults : excludedResults;

  const totalWeight = rollupSet.reduce((s, r) => s + (r.reviewCount || 1), 0) || rollupSet.length;
  const brandScore = rollupSet.reduce((s, r) => {
    const w = totalWeight > 0 ? r.reviewCount / totalWeight : 1 / rollupSet.length;
    return s + r.composite * w;
  }, 0);
  const brandScoreRounded = Math.round(brandScore * 10) / 10;

  let label = brandScoreRounded >= 80 ? 'Healthy'
    : brandScoreRounded >= 50 ? 'At Risk' : 'Critical';

  // Cap logic
  const lbbFlag        = rollupSet.some(r => r.pillar_buybox.lbbDetected);
  const ratingDropFlag = rollupSet.some(r => r.pillar_rating.ratingDropped30d);
  const undercutFlag   = rollupSet.some(r => r.pillar_buybox.competitorUndercut);

  const capReasons = [];
  if (lbbFlag)        capReasons.push('Lost Buy Box on one or more products');
  if (ratingDropFlag) capReasons.push('Rating dropped in the last 30 days');
  if (undercutFlag)   capReasons.push('Competitor undercutting detected');

  if (capReasons.length && label === 'Healthy') label = 'At Risk';

  // Aggregate revenue at risk across core products
  const productsWithRisk = rollupSet.filter(r => r.revenueAtRiskMonthly !== null && r.revenueAtRiskMonthly > 0);
  const totalRevenueAtRiskMonthly = productsWithRisk.reduce((s, r) => s + r.revenueAtRiskMonthly, 0);

  // Rating drop details for CTA copy
  const ratingDropDetails = rollupSet
    .filter(r => r.pillar_rating.ratingDropped30d)
    .map(r => ({
      asin:          r.asin,
      title:         r.title,
      ratingBefore:  r.pillar_rating.rating30dAgo,
      ratingNow:     r.pillar_rating.current,
      delta:         r.pillar_rating.delta30d,
      dropDate:      r.pillar_rating.dropDate,
    }));

  return {
    brandScore:    brandScoreRounded,
    label,
    capReasons,
    ratingDropDetails,
    totalRevenueAtRiskMonthly,
    totalRevenueAtRiskAnnual: totalRevenueAtRiskMonthly * 12,
    asinCountScored:   rollupSet.length,
    asinCountExcluded: coreResults.length ? excludedResults.length : 0,
    products:          rollupSet,
    productsExcluded:  coreResults.length ? excludedResults : [],
    weights: WEIGHTS,
  };
}

// ─── KEEPA API CALLS ──────────────────────────────────────────────────────────

async function fetchSellerASINs(apiKey, sellerId) {
  const url = new URL('https://api.keepa.com/seller');
  url.searchParams.set('key',        apiKey);
  url.searchParams.set('domain',     KEEPA_DOMAIN);
  url.searchParams.set('seller',     sellerId);
  url.searchParams.set('storefront', 1);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Keepa /seller returned ${resp.status}`);

  const data = await resp.json();
  const seller = (data.sellers || {})[sellerId] || {};
  return (seller.asinList || []).slice(0, MAX_ASINS);
}

async function fetchProductData(apiKey, asins) {
  const url = new URL('https://api.keepa.com/product');
  url.searchParams.set('key',    apiKey);
  url.searchParams.set('domain', KEEPA_DOMAIN);
  url.searchParams.set('asin',   asins.join(','));
  url.searchParams.set('stats',  90);
  url.searchParams.set('days',   90);
  url.searchParams.set('rating', 1);   // Required for csv[16] + csv[17]
  url.searchParams.set('buybox', 1);   // Required for csv[18]

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Keepa /product returned ${resp.status}`);

  const data = await resp.json();
  return data.products || [];
}

// ─── MOCK DATA (KEEPA_MOCK=true) ─────────────────────────────────────────────
// Returns realistic TherapetMD data — zero API tokens spent.
// Toggle in .env: KEEPA_MOCK=true (UI testing) | KEEPA_MOCK=false (real run)

const MOCK_RESPONSE = {
  success: true,
  entryPoint: 'seller',
  input: 'A2YVQMS6C6QFJO',
  brandScore: 61.2,
  label: 'At Risk',
  capReasons: ['Rating dropped in the last 30 days', 'Lost Buy Box on one or more products'],
  ratingDropDetails: [
    { asin: 'B0FB9MXHR1', title: 'TherapetMD Dog Calming Diffuser (30-Day)', ratingBefore: 4.0, ratingNow: 3.8, delta: -0.2, dropDate: '2026-04-04' },
    { asin: 'B0G26MM254', title: 'TherapetMD Dog Calming Diffuser Refill Pack', ratingBefore: 3.9, ratingNow: 3.8, delta: -0.1, dropDate: '2026-04-06' },
  ],
  totalRevenueAtRiskMonthly: 0,   // computed client-side once user enters units/price
  totalRevenueAtRiskAnnual: 0,
  asinCountScored: 6,
  asinCountExcluded: 1,
  weights: { bsr: 40, rating: 35, buybox: 25 },
  products: [
    {
      asin: 'B0FB9MXHR1',
      title: 'TherapetMD Dog Calming Diffuser (30-Day)',
      brand: 'TherapetMD',
      reviewCount: 4161,
      monthlySold: 10000,
      defaultUnits: 10000,
      defaultPrice: 33.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 39.99, asp30d: 31.25, aspMoMPct: -5.8,
      composite: 58.5,
      pillar_bsr:    { score: 28.0, current: 278,  bsr90dAgo: 285,  delta90dPct: -2.5 },
      pillar_rating: { score: 16.5, current: 3.8,  rating90dAgo: 4.0, rating30dAgo: 4.0, delta90d: -0.2, delta30d: -0.2, ratingDropped30d: true,  dropDate: '2026-04-04', convRateBefore: 0.92, convRateNow: 0.884 },
      pillar_buybox: { score: 14.0, bbPct30d: 50.2, bbMoMPts: -8.3, lbbDetected: true, modalPriceCents: 3399, lowestCompetitorPrice: 2699, competitorUndercut: true, eventsIn30d: 241 },
    },
    {
      asin: 'B0G26MM254',
      title: 'TherapetMD Dog Calming Diffuser Refill Pack',
      brand: 'TherapetMD',
      reviewCount: 1847,
      monthlySold: 4200,
      defaultUnits: 4200,
      defaultPrice: 24.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 29.99, asp30d: 22.80, aspMoMPct: -4.2,
      composite: 55.0,
      pillar_bsr:    { score: 26.0, current: 412,  bsr90dAgo: 390,  delta90dPct: 5.6 },
      pillar_rating: { score: 17.5, current: 3.8,  rating90dAgo: 3.9, rating30dAgo: 3.9, delta90d: -0.1, delta30d: -0.1, ratingDropped30d: true,  dropDate: '2026-04-06', convRateBefore: 0.906, convRateNow: 0.892 },
      pillar_buybox: { score: 11.5, bbPct30d: 42.0, bbMoMPts: -11.5, lbbDetected: true, modalPriceCents: 2499, lowestCompetitorPrice: 2199, competitorUndercut: true, eventsIn30d: 198 },
    },
    {
      asin: 'B0FWGN8KJB',
      title: 'TherapetMD Cat Calming Diffuser (30-Day)',
      brand: 'TherapetMD',
      reviewCount: 892,
      monthlySold: 2800,
      defaultUnits: 2800,
      defaultPrice: 33.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 39.99, asp30d: 33.40, aspMoMPct: +1.2,
      composite: 78.5,
      pillar_bsr:    { score: 34.0, current: 1204, bsr90dAgo: 1580, delta90dPct: -23.8 },
      pillar_rating: { score: 31.0, current: 4.2,  rating90dAgo: 4.1, rating30dAgo: 4.2, delta90d: 0.1, delta30d: 0.0, ratingDropped30d: false, dropDate: null, convRateBefore: 0.96, convRateNow: 0.96 },
      pillar_buybox: { score: 23.5, bbPct30d: 94.0, bbMoMPts: +2.1, lbbDetected: false, modalPriceCents: 3399, lowestCompetitorPrice: null, competitorUndercut: false, eventsIn30d: 167 },
    },
    {
      asin: 'B0G7LGKT95',
      title: 'TherapetMD Calming Bundle — Dog + Cat',
      brand: 'TherapetMD',
      reviewCount: 334,
      monthlySold: 900,
      defaultUnits: 900,
      defaultPrice: 59.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 69.99, asp30d: 56.20, aspMoMPct: -1.8,
      composite: 65.0,
      pillar_bsr:    { score: 30.0, current: 2841, bsr90dAgo: 2900, delta90dPct: -2.0 },
      pillar_rating: { score: 28.0, current: 4.1,  rating90dAgo: 4.1, rating30dAgo: 4.1, delta90d: 0.0, delta30d: 0.0, ratingDropped30d: false, dropDate: null, convRateBefore: 0.944, convRateNow: 0.944 },
      pillar_buybox: { score: 17.0, bbPct30d: 68.0, bbMoMPts: -4.0, lbbDetected: true, modalPriceCents: 5999, lowestCompetitorPrice: 5499, competitorUndercut: false, eventsIn30d: 88 },
    },
    {
      asin: 'B0FB9MXHR2',
      title: 'TherapetMD Dog Calming Spray (2oz)',
      brand: 'TherapetMD',
      reviewCount: 156,
      monthlySold: 600,
      defaultUnits: 600,
      defaultPrice: 19.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 24.99, asp30d: 19.45, aspMoMPct: +0.5,
      composite: 72.0,
      pillar_bsr:    { score: 32.0, current: 5102, bsr90dAgo: 5800, delta90dPct: -12.1 },
      pillar_rating: { score: 28.5, current: 4.1,  rating90dAgo: 4.2, rating30dAgo: 4.1, delta90d: -0.1, delta30d: 0.0, ratingDropped30d: false, dropDate: null, convRateBefore: 0.944, convRateNow: 0.944 },
      pillar_buybox: { score: 21.5, bbPct30d: 86.0, bbMoMPts: +1.5, lbbDetected: false, modalPriceCents: 1999, lowestCompetitorPrice: null, competitorUndercut: false, eventsIn30d: 72 },
    },
    {
      asin: 'B0FWGN8KJC',
      title: 'TherapetMD Cat Calming Spray (2oz)',
      brand: 'TherapetMD',
      reviewCount: 98,
      monthlySold: 400,
      defaultUnits: 400,
      defaultPrice: 19.99, defaultPriceSource: 'bb',
      revenueAtRiskMonthly: null,
      listPrice: 24.99, asp30d: 18.90, aspMoMPct: -2.1,
      composite: 69.5,
      pillar_bsr:    { score: 31.0, current: 7340, bsr90dAgo: 8200, delta90dPct: -10.5 },
      pillar_rating: { score: 28.0, current: 4.0,  rating90dAgo: 4.0, rating30dAgo: 4.0, delta90d: 0.0, delta30d: 0.0, ratingDropped30d: false, dropDate: null, convRateBefore: 0.92, convRateNow: 0.92 },
      pillar_buybox: { score: 20.5, bbPct30d: 82.0, bbMoMPts: -3.0, lbbDetected: false, modalPriceCents: 1999, lowestCompetitorPrice: null, competitorUndercut: false, eventsIn30d: 61 },
    },
  ],
  productsExcluded: [
    {
      asin: 'B0FB9BUNDLE',
      title: 'TherapetMD Intro Bundle (New)',
      brand: 'TherapetMD',
      reviewCount: 8,
      monthlySold: 120,
      composite: 55.0,
      pillar_bsr:    { score: 22.0, current: 18420, bsr90dAgo: null, delta90dPct: null },
      pillar_rating: { score: 20.0, current: 4.3, ratingDropped30d: false },
      pillar_buybox: { score: 13.0, bbPct30d: 52.0, lbbDetected: true, competitorUndercut: false },
    },
  ],
};

// ─── INPUT DETECTION ──────────────────────────────────────────────────────────

function detectInputType(raw) {
  const input = raw.trim().toUpperCase();
  if (/^B[A-Z0-9]{9}$/.test(input)) return { type: 'asin', value: input };
  if (/^A[A-Z0-9]{11,15}$/.test(input)) return { type: 'seller', value: input };
  return { type: 'unknown', value: input };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Keepa API key not configured' }) };
  }

  let input;
  try {
    ({ input } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!input || typeof input !== 'string' || !input.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'input is required (ASIN or Seller ID)' }) };
  }

  // ─── MOCK MODE ───────────────────────────────────────────────────────────────
  if (process.env.KEEPA_MOCK === 'true') {
    console.log('KEEPA_MOCK=true — returning mock TherapetMD data (zero tokens spent)');
    return { statusCode: 200, headers, body: JSON.stringify(MOCK_RESPONSE) };
  }

  const detected = detectInputType(input);
  if (detected.type === 'unknown') {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: `Couldn't recognize "${input}" as an ASIN (B + 9 chars) or Seller ID (A + 12–15 chars).` }),
    };
  }

  try {
    let asins = [];

    if (detected.type === 'seller') {
      asins = await fetchSellerASINs(apiKey, detected.value);
      if (!asins.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: `No products found for Seller ID "${detected.value}".` }) };
      }
    } else {
      const seedProducts = await fetchProductData(apiKey, [detected.value]);
      if (!seedProducts.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: `ASIN "${detected.value}" not found in Keepa.` }) };
      }
      const seed = seedProducts[0];
      const variations = (seed.variationCSV || '').split(',').map(s => s.trim()).filter(Boolean);
      if (variations.length > 1) {
        asins = [...new Set([detected.value, ...variations])].slice(0, MAX_ASINS);
      } else {
        const result = scoreBrand(seedProducts);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, entryPoint: 'asin', input: detected.value, ...result }) };
      }
    }

    const products = await fetchProductData(apiKey, asins);
    if (!products.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No product data returned from Keepa.' }) };
    }

    const result = scoreBrand(products);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, entryPoint: detected.type, input: detected.value, ...result }) };

  } catch (err) {
    console.error('brand-health error:', err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: `Keepa API error: ${err.message}` }) };
  }
};

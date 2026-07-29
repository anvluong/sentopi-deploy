/**
 * Sentopi — Hero demo widget
 * Netlify Function: /api/product-lookup
 *
 * Accepts POST { asin: "B0FB9MXHR1" }
 * Returns a lightweight product snapshot for the homepage demo card:
 * title, brand, category, image, rating, review count, 30/90-day deltas.
 * No scoring — the widget pairs this with client-side priority templates.
 */

const { daysAgoKeepa, parseCSV, parseBBTriplets, fetchProductData } = require('./_keepa-utils');
const { computeFlywheel } = require('./_flywheel');

// ─── REVENUE AT RISK MODEL ───────────────────────────────────────────────────
// Same conversion model as the Revenue Risk Report (revenue-risk.html):
// rating → relative conversion index, peaking at 4.5★.

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

// ─── SNAPSHOT EXTRACTION ─────────────────────────────────────────────────────

function buildSnapshot(p) {
  const csv = p.csv || [];

  // Rating — Keepa stores as integer × 10 (38 = 3.8★)
  const c90 = daysAgoKeepa(90);
  const c30 = daysAgoKeepa(30);
  let ratingRaw = parseCSV(csv[16] || [], c90).map(e => ({ ...e, v: e.v / 10 }));
  // Sparse-history fallback: a stable rating may have no entries in the last
  // 90 days; the most recent entry in the full series is still current.
  if (!ratingRaw.length) {
    const all = parseCSV(csv[16] || [], 0);
    if (all.length) ratingRaw = [{ ...all[all.length - 1], v: all[all.length - 1].v / 10 }];
  }
  const rating       = ratingRaw.length ? ratingRaw[ratingRaw.length - 1].v : null;
  const rating90dAgo = ratingRaw.length ? ratingRaw[0].v : null;
  const entries30    = ratingRaw.filter(e => e.t >= c30);
  const rating30dAgo = entries30.length ? entries30[0].v : rating90dAgo;
  const ratingDelta30d = (rating !== null && rating30dAgo !== null)
    ? Math.round((rating - rating30dAgo) * 100) / 100 : null;
  const ratingDelta90d = (rating !== null && rating90dAgo !== null)
    ? Math.round((rating - rating90dAgo) * 100) / 100 : null;

  // Review count — csv[17]
  const rcEntries   = parseCSV(csv[17] || [], 0);
  const reviewCount = rcEntries.length ? rcEntries[rcEntries.length - 1].v : null;

  // BSR — csv[3]
  const bsrEntries = parseCSV(csv[3] || [], c90);
  const bsr        = bsrEntries.length ? bsrEntries[bsrEntries.length - 1].v : null;
  const bsr90dAgo  = bsrEntries.length ? bsrEntries[0].v : null;
  const bsrDelta90dPct = (bsr && bsr90dAgo)
    ? Math.round(((bsr - bsr90dAgo) / bsr90dAgo) * 1000) / 10 : null;

  // Category — root of categoryTree reads cleanest ("Pet Supplies", "Beauty & Personal Care")
  const categoryTree = Array.isArray(p.categoryTree) ? p.categoryTree : [];
  const category    = categoryTree.length ? categoryTree[0].name : null;
  const subcategory = categoryTree.length > 1 ? categoryTree[categoryTree.length - 1].name : null;

  // Main image
  const imageFile = (p.imagesCSV || '').split(',')[0] || null;
  const image = imageFile ? `https://images-na.ssl-images-amazon.com/images/I/${imageFile}` : null;

  // Units + price for the revenue model. Price priority mirrors brand-health:
  // modal Buy Box price over 30d, else most recent list price (csv[1]),
  // else most recent Amazon price (csv[0]). Keepa prices are in cents.
  const monthlySold = p.monthlySold || null;
  let priceCents = null;
  const bbAll30 = parseBBTriplets(csv[18] || [], c30);
  const bb30 = bbAll30.filter(e => e.price > 0);
  if (bb30.length) {
    const freq = {};
    bb30.forEach(e => { freq[e.price] = (freq[e.price] || 0) + 1; });
    priceCents = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]);
  } else {
    const list = parseCSV(csv[1] || [], 0);
    const amz  = parseCSV(csv[0] || [], 0);
    if (list.length)     priceCents = list[list.length - 1].v;
    else if (amz.length) priceCents = amz[amz.length - 1].v;
  }
  const price = priceCents ? Math.round(priceCents) / 100 : null;

  // Buy Box held % over 30d — same held/total logic as brand-health's
  // computeBuyBoxHealth (price === -1 means the Buy Box was lost).
  const bbPct30d = bbAll30.length
    ? Math.round((bbAll30.filter(e => e.price !== -1).length / bbAll30.length) * 1000) / 10
    : null;

  // Revenue at risk — same two-case model as the Revenue Risk Report:
  // active 30d drop uses before→now conversion delta; otherwise the chronic
  // gap vs. the 4.5★ conversion peak. Mutually exclusive, no double counting.
  let revRiskMonthly = null, revRiskBasis = null;
  if (monthlySold && price && rating !== null) {
    if (ratingDelta30d !== null && ratingDelta30d < 0 && rating30dAgo !== null) {
      revRiskMonthly = Math.max(0, Math.round(monthlySold * price * (convRate(rating30dAgo) - convRate(rating))));
      revRiskBasis = 'drop';
    } else if (rating < 4.5) {
      revRiskMonthly = Math.max(0, Math.round(monthlySold * price * (convRate(4.5) - convRate(rating))));
      revRiskBasis = 'chronic';
    } else {
      revRiskMonthly = 0;
      revRiskBasis = 'healthy';
    }
  }

  return {
    asin:  p.asin,
    title: (p.title || '').slice(0, 90),
    brand: p.brand || null,
    category,
    subcategory,
    image,
    rating,
    rating30dAgo,
    rating90dAgo,
    ratingDelta30d,
    ratingDelta90d,
    reviewCount,
    bsr,
    bsrDelta90dPct,
    price,
    monthlySold,
    bbPct30d,
    revRiskMonthly,
    revRiskBasis,
    // Retail Flywheel: five levers off the same raw Keepa series.
    // See skills/sentopi-qa/FLYWHEEL-CONTRACT.md.
    flywheel: computeFlywheel([p]),
  };
}

// ─── MOCK DATA (KEEPA_MOCK=true) ─────────────────────────────────────────────

const MOCK_SNAPSHOT = {
  success: true,
  asin: 'B0FB9MXHR1',
  title: 'TherapetMD Dog Calming Diffuser (30-Day)',
  brand: 'TherapetMD',
  category: 'Pet Supplies',
  subcategory: 'Calming Aids',
  image: null,
  rating: 3.8,
  rating30dAgo: 4.0,
  rating90dAgo: 4.0,
  ratingDelta30d: -0.2,
  ratingDelta90d: -0.2,
  reviewCount: 4161,
  bsr: 278,
  bsrDelta90dPct: -2.5,
  price: 28.49,
  monthlySold: 10000,
  bbPct30d: 100,
  revRiskMonthly: 7977,   // 10000 × 28.49 × (conv(4.0) − conv(3.8))
  revRiskBasis: 'drop',
  // Retail Flywheel fixture for the single-ASIN widget path. Numbers follow the
  // snapshot above (rating 3.8 dropping, BSR 278, Buy Box 100%, price $28.49).
  // This fixture carries all four render paths: strong, watch, leaking, and the
  // unmeasured assortment lever a single listing produces.
  flywheel: {
    compositeScore: 63.6,
    measuredCount: 4,
    weakestKey: 'pricing',
    levers: [
      {
        key: 'operations',
        label: 'Operations',
        score: 100,
        status: 'strong',
        headline: 'Buy Box held 100% of the last 30 days',
        metric: { label: 'Buy Box share, 30d', value: '100%', delta: '+3.6 pts', deltaDir: 'up' },
        read: 'You held the Buy Box on 100% of recorded events in the last 30 days. Hold the offer and stock position where they are.',
        confidence: 'high',
        dataNote: null,
        detail: [
          { label: 'Buy Box events, 30d', value: '132' },
          { label: 'Events with Buy Box held', value: '132' },
          { label: 'Out of stock, 30d', value: '0%' },
          { label: 'Buy Box share, prior 30d', value: '96.4%' },
        ],
      },
      {
        key: 'pricing',
        label: 'Pricing',
        score: 33.7,
        status: 'leaking',
        headline: 'Average selling price is $28.49, -5.8% month over month',
        metric: { label: 'Average selling price, 30d', value: '$28.49', delta: '-5.8% MoM', deltaDir: 'down' },
        read: 'Average selling price fell 5.8% month over month to $28.49. That is margin coming out of the same unit volume. You are selling 29% below list, so the reference price on the listing is doing little work. 3 sellers are competing on this listing.',
        confidence: 'medium',
        dataNote: 'Competing offer count comes from the current Keepa offer snapshot, not from 90 days of offer history.',
        detail: [
          { label: 'Price position in 90d range', value: '21.4%' },
          { label: '90d price range', value: '$26.99 to $33.99' },
          { label: 'Discount off list', value: '28.8%' },
          { label: 'Competing offers', value: '3' },
        ],
      },
      {
        key: 'assortment',
        label: 'Assortment',
        score: null,
        status: 'unmeasured',
        headline: 'Single listing with no variant family.',
        metric: { label: 'Listings in family', value: 'No data', delta: null, deltaDir: null },
        read: 'This ASIN has no variation family in Keepa, so there is no variant coverage to score. A single listing is not a failing assortment; there is simply nothing here to measure.',
        confidence: 'low',
        dataNote: 'Single listing with no variation data, so variant coverage cannot be scored.',
        detail: [],
      },
      {
        key: 'visibility',
        label: 'Visibility',
        score: 74.7,
        status: 'watch',
        headline: 'Sales rank improved 2.5% over 90 days',
        metric: { label: 'Sales rank, 90d change', value: '-2.5%', delta: '-1.4% in 30d', deltaDir: 'up' },
        read: 'Sales rank improved 2.5% over 90 days. Visibility is working; the gains show up in units before they show up in reviews.',
        confidence: 'high',
        dataNote: null,
        detail: [
          { label: 'Sales rank now', value: '#278' },
          { label: 'Sales rank 90d ago', value: '#285' },
          { label: 'Rank points in window', value: '490' },
        ],
      },
      {
        key: 'ratings',
        label: 'Ratings',
        score: 47,
        status: 'leaking',
        headline: 'Rating is 3.8 stars, -0.20 over 30 days',
        metric: { label: 'Rating now', value: '3.8', delta: '-0.20 in 30d', deltaDir: 'down' },
        read: 'Rating is 3.8 stars and down 0.20 in the last 30 days. Every tenth of a star costs conversion on traffic you already paid for. 508 new reviews landed in the last 30 days.',
        confidence: 'high',
        dataNote: null,
        detail: [
          { label: 'Rating change, 90d', value: '-0.20' },
          { label: 'New reviews, 30d', value: '508' },
          { label: 'Total reviews', value: '4,161' },
        ],
      },
    ],
  },
};

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

  let asin;
  try {
    ({ asin } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  asin = (asin || '').trim().toUpperCase();
  if (!/^B[A-Z0-9]{9}$/.test(asin)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "That doesn't look like an ASIN. It starts with B and has 10 characters, e.g. B0FB9MXHR1." }) };
  }

  if (process.env.KEEPA_MOCK === 'true') {
    console.log('KEEPA_MOCK=true — returning mock snapshot (zero tokens spent)');
    return { statusCode: 200, headers, body: JSON.stringify({ ...MOCK_SNAPSHOT, asin }) };
  }

  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Keepa API key not configured' }) };
  }

  try {
    const products = await fetchProductData(apiKey, [asin]);
    if (!products.length) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `We couldn't find ASIN "${asin}" on Amazon.com.` }) };
    }
    const snapshot = buildSnapshot(products[0]);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...snapshot }) };
  } catch (err) {
    console.error('product-lookup error:', err);
    const userMsg = err.status === 429
      ? "We're seeing high demand. Please try again in a few minutes."
      : 'Something went wrong. Please try again later.';
    return { statusCode: 502, headers, body: JSON.stringify({ error: userMsg }) };
  }
};

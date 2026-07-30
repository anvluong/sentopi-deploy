/**
 * Sentopi: Retail Flywheel scoring layer
 *
 * Single source of truth for the five levers defined in
 * skills/sentopi-qa/FLYWHEEL-CONTRACT.md. Imported by brand-health.js
 * (scored product set) and product-lookup.js (single ASIN).
 *
 * Honesty rules baked in here, not in the callers:
 *   - A lever with no usable data reports status 'unmeasured' and score null.
 *     It never gets a fabricated or neutral-looking number.
 *   - confidence drops to 'medium' or 'low' whenever the window is short or a
 *     proxy stood in for the primary series, and dataNote names the proxy.
 *   - deltaDir 'up' always means GOOD for that lever. Falling BSR is an
 *     improvement, so a falling BSR reports 'up'.
 *   - compositeScore averages measured levers only, and is null below 3.
 */

const { daysAgoKeepa, parseCSV, parseBBTriplets } = require('./_keepa-utils');
/* Lever order, weights, thresholds and the composite rule live in exactly one
   place so the scorer, both renderers, the fixtures and the QA gate cannot
   disagree about what the contract says. */
const { LEVER_ORDER, LEVER_WEIGHTS, MIN_MEASURED_FOR_COMPOSITE, statusFor } = require('../../flywheel-core.js');

// A variant needs this many reviews before it is doing any real work in search.
// Mirrors MIN_REVIEWS_FOR_ROLLUP in brand-health.js.
const REVIEWS_FOR_COVERAGE = 25;
// Buy Box share at or above this counts as "carrying the Buy Box".
const BB_COVERAGE_PCT = 90;

// ─── SMALL SAFE HELPERS ───────────────────────────────────────────────────────

const num    = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp  = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1     = (v) => (num(v) === null ? null : Math.round(v * 10) / 10);
const r2     = (v) => (num(v) === null ? null : Math.round(v * 100) / 100);

function signedPct(v, dp = 1) {
  if (num(v) === null) return null;
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(dp)}%`;
}
function signedPts(v, dp = 1) {
  if (num(v) === null) return null;
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(dp)} pts`;
}
function money(cents) {
  if (num(cents) === null || cents <= 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}
// Weighted mean over [{ v, w }]; ignores null values and non-positive weights.
function wmean(pairs) {
  let sv = 0, sw = 0;
  for (const p of pairs) {
    const v = num(p && p.v), w = num(p && p.w);
    if (v === null || w === null || w <= 0) continue;
    sv += v * w; sw += w;
  }
  return sw > 0 ? sv / sw : null;
}
function sum(values) {
  let s = 0;
  for (const v of values) { const n = num(v); if (n !== null) s += n; }
  return s;
}

// deltaDir where a RISING number is good (Buy Box share, rating, price).
function dirRiseGood(delta, tol) {
  if (num(delta) === null) return null;
  if (delta > tol) return 'up';
  if (delta < -tol) return 'down';
  return 'flat';
}
// deltaDir where a FALLING number is good (sales rank).
function dirFallGood(delta, tol) {
  if (num(delta) === null) return null;
  if (delta < -tol) return 'up';
  if (delta > tol) return 'down';
  return 'flat';
}

function lever(key, label, out) {
  const score = num(out.score) === null ? null : r1(clamp(out.score, 0, 100));
  const detail = (out.detail || [])
    .filter((d) => d && d.value !== null && d.value !== undefined && d.value !== '')
    .slice(0, 4)
    .map((d) => ({ label: String(d.label), value: String(d.value) }));
  return {
    key,
    label,
    score,
    status: statusFor(score),
    headline: out.headline,
    metric: {
      label: out.metricLabel,
      value: out.metricValue === null || out.metricValue === undefined ? 'No data' : String(out.metricValue),
      delta: out.delta === undefined ? null : out.delta,
      deltaDir: out.deltaDir === undefined ? null : out.deltaDir,
    },
    read: out.read,
    confidence: out.confidence,
    dataNote: out.dataNote === undefined ? null : out.dataNote,
    detail,
  };
}

// ─── PER-PRODUCT SIGNAL EXTRACTION ───────────────────────────────────────────
// Everything the five levers need, pulled once per product so each lever
// aggregates the same numbers the pillars already report.

function outOfStockPct(p, key) {
  const arr = p.stats && Array.isArray(p.stats[key]) ? p.stats[key] : null;
  if (!arr) return null;
  const bb = num(arr[18]);          // Buy Box availability
  if (bb !== null && bb >= 0) return bb;
  const mkt = num(arr[1]);          // marketplace new
  if (mkt !== null && mkt >= 0) return mkt;
  return null;
}

// csv[11] is COUNT_NEW. On live data it is often a single stale point outside
// the 90d window, so the stats snapshot is the honest fallback and gets flagged.
function offerCount(p, csv) {
  const inWindow = parseCSV(csv[11] || [], daysAgoKeepa(90));
  if (inWindow.length) return { value: inWindow[inWindow.length - 1].v, proxy: false };

  const current = p.stats && Array.isArray(p.stats.current) ? num(p.stats.current[11]) : null;
  if (current !== null && current >= 0) return { value: current, proxy: true };

  const total = p.stats ? num(p.stats.totalOfferCount) : null;
  if (total !== null && total >= 0) return { value: total, proxy: true };

  const all = parseCSV(csv[11] || [], 0);
  if (all.length) return { value: all[all.length - 1].v, proxy: true };

  return { value: null, proxy: false };
}

// Average Buy Box price over a day range. Mirrors computeASPWindow in
// brand-health.js so the flywheel and the pricing intel fields agree.
function aspWindow(csvBB, daysStart, daysEnd) {
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
  return Math.round(sum(prices) / prices.length);
}

// csv[4] is LISTPRICE (MSRP). csv[1] is the NEW marketplace price, which is a
// selling price, so it is never used as the list-price anchor here.
function listPrice(csv) {
  const arr = csv[4];
  if (!Array.isArray(arr) || arr.length < 2) return null;
  for (let i = arr.length - 1; i >= 1; i -= 2) if (arr[i] > 0) return arr[i];
  return null;
}

function familyAsins(p) {
  const out = new Set();
  if (p.asin) out.add(String(p.asin).toUpperCase());
  String(p.variationCSV || '').split(',').map((s) => s.trim()).filter(Boolean)
    .forEach((a) => out.add(a.toUpperCase()));
  if (Array.isArray(p.variations)) {
    p.variations.forEach((v) => { if (v && v.asin) out.add(String(v.asin).toUpperCase()); });
  }
  return out;
}

function productSignals(p) {
  const csv = Array.isArray(p.csv) ? p.csv : [];
  const c30 = daysAgoKeepa(30), c60 = daysAgoKeepa(60), c90 = daysAgoKeepa(90);

  // Review count drives the aggregation weight.
  const rcAll = parseCSV(csv[17] || [], 0);
  const reviewCount = rcAll.length ? rcAll[rcAll.length - 1].v : 0;

  // ── Buy Box (csv[18] triplets; price === -1 means the Buy Box was lost)
  const bb30    = parseBBTriplets(csv[18] || [], c30);
  const bb90    = parseBBTriplets(csv[18] || [], c90);
  const bbPrior = parseBBTriplets(csv[18] || [], c60).filter((e) => e.t < c30);
  const heldIn = (arr) => arr.filter((e) => e.price !== -1).length;

  // ── Price position inside its own 90d range
  let priceValues = parseCSV(csv[1] || [], c90).map((e) => e.v).filter((v) => v > 0);
  let priceSource = 'new';
  if (!priceValues.length) {
    priceValues = bb90.filter((e) => e.price > 0).map((e) => e.price);
    priceSource = 'buybox';
  }
  const pricePoints = priceValues.length;
  const priceNow = priceValues.length ? priceValues[priceValues.length - 1] : null;
  const priceMin = priceValues.length ? Math.min(...priceValues) : null;
  const priceMax = priceValues.length ? Math.max(...priceValues) : null;
  const pricePosition = (priceValues.length > 1 && priceMax > priceMin)
    ? clamp((priceNow - priceMin) / (priceMax - priceMin), 0, 1) * 100
    : null;

  const asp30      = aspWindow(csv[18] || [], 0, 30);
  const aspPrior30 = aspWindow(csv[18] || [], 31, 60);
  const aspMoMPct  = (asp30 && aspPrior30) ? ((asp30 - aspPrior30) / aspPrior30) * 100 : null;

  const list = listPrice(csv);
  const effectivePrice = asp30 || priceNow;
  const discountPct = (list && effectivePrice && list > effectivePrice)
    ? ((list - effectivePrice) / list) * 100 : null;

  // ── Sales rank (csv[3])
  const bsr90 = parseCSV(csv[3] || [], c90);
  const bsr30 = bsr90.filter((e) => e.t >= c30);
  const bsrNow   = bsr90.length ? bsr90[bsr90.length - 1].v : null;
  const bsrAgo90 = bsr90.length ? bsr90[0].v : null;
  const bsrAgo30 = bsr30.length ? bsr30[0].v : null;
  const bsrDelta90Pct = (bsr90.length >= 2 && bsrAgo90 > 0) ? ((bsrNow - bsrAgo90) / bsrAgo90) * 100 : null;
  const bsrDelta30Pct = (bsr30.length >= 2 && bsrAgo30 > 0) ? ((bsrNow - bsrAgo30) / bsrAgo30) * 100 : null;

  // ── Rating (csv[16], stored as integer x 10) and review velocity (csv[17])
  const ratingPts = parseCSV(csv[16] || [], c90).map((e) => ({ t: e.t, v: e.v / 10 }));
  const rating30  = ratingPts.filter((e) => e.t >= c30);
  const ratingNow   = ratingPts.length ? ratingPts[ratingPts.length - 1].v : null;
  const ratingAgo90 = ratingPts.length ? ratingPts[0].v : null;
  const ratingAgo30 = rating30.length ? rating30[0].v : ratingAgo90;
  const ratingDelta90 = (ratingPts.length >= 2) ? ratingNow - ratingAgo90 : null;
  const ratingDelta30 = (rating30.length >= 2) ? ratingNow - ratingAgo30
    : (ratingPts.length >= 2 ? ratingNow - ratingAgo30 : null);

  const rc30 = parseCSV(csv[17] || [], c30);
  const reviewsAdded30 = rc30.length >= 2 ? rc30[rc30.length - 1].v - rc30[0].v : null;

  return {
    asin: p.asin || null,
    weight: reviewCount > 0 ? reviewCount : 1,
    reviewCount,
    bbEvents30: bb30.length,
    bbEvents90: bb90.length,
    bbHeld30: heldIn(bb30),
    bbHeld90: heldIn(bb90),
    bbEventsPrior: bbPrior.length,
    bbHeldPrior: heldIn(bbPrior),
    oos30: outOfStockPct(p, 'outOfStockPercentage30'),
    priceNow, priceMin, priceMax, pricePosition, priceSource, pricePoints,
    asp30, aspPrior30, aspMoMPct,
    listPrice: list,
    discountPct,
    offers: offerCount(p, csv),
    bsrNow, bsrAgo90, bsrDelta90Pct, bsrDelta30Pct, bsrPoints: bsr90.length,
    ratingNow, ratingDelta30, ratingDelta90, ratingPoints: ratingPts.length,
    reviewsAdded30,
    family: familyAsins(p),
  };
}

// ─── LEVER 1: OPERATIONS ─────────────────────────────────────────────────────
// Buy Box share is the same held/total event math computeBuyBoxHealth uses, so
// the lever and pillar_buybox never disagree. Keepa records one Buy Box point
// per change, so a thin event window is called out rather than smoothed over.

function buildOperations(sig) {
  const L = ['operations', 'Operations'];

  const ev30 = sum(sig.map((s) => s.bbEvents30));
  const ev90 = sum(sig.map((s) => s.bbEvents90));

  // A single Buy Box record is not a share. Two is the floor for a ratio, and
  // anything under 8 events is flagged as thin rather than reported as fact.
  let window = null, events = 0, held = 0;
  if (ev30 >= 3)      { window = 30; events = ev30; held = sum(sig.map((s) => s.bbHeld30)); }
  else if (ev90 >= 3) { window = 90; events = ev90; held = sum(sig.map((s) => s.bbHeld90)); }
  else if (ev30 >= 2) { window = 30; events = ev30; held = sum(sig.map((s) => s.bbHeld30)); }
  else if (ev90 >= 2) { window = 90; events = ev90; held = sum(sig.map((s) => s.bbHeld90)); }

  if (!window || events < 2) {
    const only = ev90 === 1;
    return lever(...L, {
      score: null,
      headline: only ? 'Only one Buy Box record in the window.' : 'No Buy Box history returned for this listing.',
      metricLabel: 'Buy Box share, 30d',
      metricValue: null,
      delta: null, deltaDir: null,
      read: only
        ? 'Keepa holds a single Buy Box record for this ASIN in the last 90 days. One record cannot produce a share, so this lever stays unscored.'
        : 'Keepa has no Buy Box records for this ASIN in the last 90 days, so Buy Box share cannot be measured. Nothing is being inferred from the gap.',
      confidence: 'low',
      dataNote: only
        ? 'One Buy Box record in 90 days is too few to compute a share.'
        : 'No Buy Box records in the last 90 days.',
      detail: [],
    });
  }

  const share = (held / events) * 100;

  // Prior 30d window for the month-over-month move, only when 30d is the window.
  const evPrior   = sum(sig.map((s) => s.bbEventsPrior));
  const heldPrior = sum(sig.map((s) => s.bbHeldPrior));
  const priorShare = (window === 30 && evPrior >= 3) ? (heldPrior / evPrior) * 100 : null;
  const deltaPts = priorShare === null ? null : share - priorShare;

  const oos = wmean(sig.map((s) => ({ v: s.oos30, w: s.weight })));

  // Buy Box loss is the most expensive leak on the page, so it is penalised
  // harder than a straight 1:1 read of share, then out of stock is charged on top.
  let score = 100 - (100 - share) * 1.4;
  if (oos !== null) score -= Math.min(20, oos * 0.4);

  const proxyWindow = window === 90;
  const thin = events < 8;
  const confidence = (proxyWindow || thin) ? 'low' : (events < 20 ? 'medium' : 'high');

  const notes = [];
  if (proxyWindow) notes.push('No Buy Box changes were recorded in the last 30 days, so share is measured over the 90 day window instead.');
  if (thin) notes.push(`Share comes from ${events} Buy Box change event${events === 1 ? '' : 's'}, which is a thin sample.`);
  const dataNote = notes.length ? notes.join(' ') : null;

  const lostPct = 100 - share;
  const read = share >= 95
    ? `You held the Buy Box on ${share.toFixed(0)}% of recorded events in the last ${window} days. Hold the offer and stock position where they are.`
    : `You lost the Buy Box on ${lostPct.toFixed(0)}% of recorded events in the last ${window} days. Traffic and conversion fall together every time that happens.`;
  const oosClause = (oos !== null && oos >= 1) ? ` Stock was unavailable ${oos.toFixed(0)}% of the window.` : '';

  return lever(...L, {
    score,
    headline: `Buy Box held ${share.toFixed(0)}% of the last ${window} days`,
    metricLabel: `Buy Box share, ${window}d`,
    metricValue: `${r1(share)}%`,
    delta: signedPts(deltaPts),
    deltaDir: dirRiseGood(deltaPts, 0.5),
    read: read + oosClause,
    confidence,
    dataNote,
    detail: [
      { label: `Buy Box events, ${window}d`, value: String(events) },
      { label: 'Events with Buy Box held', value: String(held) },
      oos !== null ? { label: 'Out of stock, 30d', value: `${r1(oos)}%` } : null,
      priorShare !== null ? { label: 'Buy Box share, prior 30d', value: `${r1(priorShare)}%` } : null,
    ].filter(Boolean),
  });
}

// ─── LEVER 2: PRICING ────────────────────────────────────────────────────────
// Four components, each scored only when its source exists, then weighted over
// whatever is present. Position, month-over-month ASP, discount off MSRP, offers.

function buildPricing(sig) {
  const L = ['pricing', 'Pricing'];

  const asp     = wmean(sig.map((s) => ({ v: s.asp30, w: s.weight })));
  const aspMoM  = wmean(sig.map((s) => ({ v: s.aspMoMPct, w: s.weight })));
  const position = wmean(sig.map((s) => ({ v: s.pricePosition, w: s.weight })));
  const discount = wmean(sig.map((s) => ({ v: s.discountPct, w: s.weight })));
  const priceNow = wmean(sig.map((s) => ({ v: s.priceNow, w: s.weight })));
  const list     = wmean(sig.map((s) => ({ v: s.listPrice, w: s.weight })));

  const withOffers = sig.filter((s) => s.offers && num(s.offers.value) !== null);
  const offers = withOffers.length
    ? wmean(withOffers.map((s) => ({ v: s.offers.value, w: s.weight })))
    : null;
  const offersProxy = withOffers.length > 0 && withOffers.every((s) => s.offers.proxy);

  const anyPrice = priceNow !== null || asp !== null;
  if (!anyPrice) {
    return lever(...L, {
      score: null,
      headline: 'No price history returned for this listing.',
      metricLabel: 'Average selling price, 30d',
      metricValue: null,
      delta: null, deltaDir: null,
      read: 'Keepa returned no price points in the last 90 days, so price position and month over month movement cannot be measured.',
      confidence: 'low',
      dataNote: 'No price history in the last 90 days.',
      detail: [],
    });
  }

  // Components, 0-100 each.
  const parts = [];
  if (position !== null) parts.push({ v: position, w: 0.30 });                               // high in its own range = pricing power
  if (aspMoM !== null)   parts.push({ v: clamp(50 + aspMoM * 5, 0, 100), w: 0.35 });          // falling ASP = margin erosion
  if (discount !== null) parts.push({ v: clamp(100 - discount * 2, 0, 100), w: 0.20 });       // deep discount off MSRP = leak
  if (offers !== null)   parts.push({ v: clamp(100 - (offers - 1) * 12, 20, 100), w: 0.15 }); // more offers = more pressure

  const score = wmean(parts.map((p) => ({ v: p.v, w: p.w })));

  // Confidence: honest about how much of the model actually had data.
  const notes = [];
  if (offersProxy) notes.push('Competing offer count comes from the current Keepa offer snapshot, not from 90 days of offer history.');
  if (position === null) {
    const thinSeries = sig.every((s) => s.pricePoints <= 1);
    notes.push(thinSeries
      ? 'Only one price point came back in the 90 day window, so there is no range to position the current price against.'
      : 'The price did not move across the 90 day window, so there is no range to position the current price against.');
  }
  if (aspMoM === null) notes.push('There is no prior 30 day Buy Box price window, so the month over month move is not included.');
  const dataNote = notes.length ? notes.join(' ') : null;

  const confidence = parts.length >= 4 && !offersProxy ? 'high'
    : parts.length >= 3 ? 'medium' : 'low';

  const dispPrice = asp || priceNow;
  const direction = aspMoM === null ? 'flat' : (aspMoM > 0.5 ? 'up' : aspMoM < -0.5 ? 'down' : 'flat');

  let read;
  if (direction === 'down') {
    read = `Average selling price fell ${Math.abs(aspMoM).toFixed(1)}% month over month to ${money(dispPrice)}. That is margin coming out of the same unit volume.`;
  } else if (direction === 'up') {
    read = `Average selling price rose ${aspMoM.toFixed(1)}% month over month to ${money(dispPrice)}. Watch conversion for the next 30 days to confirm the increase sticks.`;
  } else {
    read = `Average selling price is holding near ${money(dispPrice)} with no meaningful month over month move.`;
  }
  if (discount !== null && discount >= 15) {
    read += ` You are selling ${discount.toFixed(0)}% below list, so the reference price on the listing is doing little work.`;
  }
  if (offers !== null && offers >= 3) {
    read += ` ${Math.round(offers)} sellers are competing on this listing.`;
  }

  return lever(...L, {
    score,
    headline: `Average selling price is ${money(dispPrice)}, ${aspMoM === null ? 'no month over month comparison' : `${signedPct(aspMoM)} month over month`}`,
    metricLabel: 'Average selling price, 30d',
    metricValue: money(dispPrice) || 'No data',
    delta: aspMoM === null ? null : `${signedPct(aspMoM)} MoM`,
    deltaDir: dirRiseGood(aspMoM, 0.5),
    read,
    confidence,
    dataNote,
    detail: [
      position !== null ? { label: 'Price position in 90d range', value: `${r1(position)}%` } : null,
      (sig.length === 1 && sig[0].priceMin && sig[0].priceMax)
        ? { label: '90d price range', value: `${money(sig[0].priceMin)} to ${money(sig[0].priceMax)}` }
        : (list !== null ? { label: 'List price', value: money(list) } : null),
      discount !== null ? { label: 'Discount off list', value: `${r1(discount)}%` } : null,
      offers !== null ? { label: 'Competing offers', value: String(Math.round(offers)) } : null,
    ].filter(Boolean),
  });
}

// ─── LEVER 3: ASSORTMENT ─────────────────────────────────────────────────────
// A single-listing product is not a failing assortment. It is unmeasured.

function buildAssortment(sig) {
  const L = ['assortment', 'Assortment'];

  const family = new Set();
  sig.forEach((s) => s.family.forEach((a) => family.add(a)));
  const familySize = Math.max(family.size, sig.length);
  const known = sig.length;

  if (familySize <= 1) {
    return lever(...L, {
      score: null,
      headline: 'Single listing with no variant family.',
      metricLabel: 'Listings in family',
      metricValue: null,
      delta: null, deltaDir: null,
      read: 'This ASIN has no variation family in Keepa, so there is no variant coverage to score. A single listing is not a failing assortment; there is simply nothing here to measure.',
      confidence: 'low',
      dataNote: 'Single listing with no variation data, so variant coverage cannot be scored.',
      detail: [],
    });
  }

  // Breadth: more listings in the family means more shelf, with fast diminishing returns.
  const breadth = clamp(40 + familySize * 10, 40, 90);

  if (known < 2) {
    return lever(...L, {
      score: null,
      headline: `${familySize} listings in this family, coverage not fetched`,
      metricLabel: 'Listings in family',
      metricValue: String(familySize),
      delta: null, deltaDir: null,
      read: `Keepa reports ${familySize} listings in this family. Only the ASIN you entered was fetched, so how the other variants are performing on reviews and Buy Box is unknown. Run the full report to score this lever.`,
      confidence: 'low',
      dataNote: `Only the entered ASIN was fetched, so reviews and Buy Box for the other ${familySize - 1} listing${familySize - 1 === 1 ? '' : 's'} in the family are unknown.`,
      detail: [{ label: 'Listings in family', value: String(familySize) }],
    });
  }

  const reviewed = sig.filter((s) => s.reviewCount >= REVIEWS_FOR_COVERAGE).length;
  const withBB = sig.filter((s) => {
    const ev = s.bbEvents30 >= 3 ? s.bbEvents30 : s.bbEvents90;
    const held = s.bbEvents30 >= 3 ? s.bbHeld30 : s.bbHeld90;
    return ev > 0 && (held / ev) * 100 >= BB_COVERAGE_PCT;
  }).length;

  const reviewedShare = (reviewed / known) * 100;
  const bbShare = (withBB / known) * 100;
  const coverage = reviewedShare * 0.6 + bbShare * 0.4;
  const score = breadth * 0.35 + coverage * 0.65;

  const partial = known < familySize;
  const confidence = partial ? 'medium' : 'high';
  const dataNote = partial
    ? `Coverage is measured on the ${known} of ${familySize} listings Keepa returned for this family.`
    : null;

  const dead = known - reviewed;
  const read = dead > 0
    ? `${dead} of ${known} listings carry fewer than ${REVIEWS_FOR_COVERAGE} reviews, so they get little search weight. ${withBB} of ${known} hold the Buy Box outright.`
    : `All ${known} listings carry ${REVIEWS_FOR_COVERAGE} or more reviews. ${withBB} of ${known} hold the Buy Box outright, which is where the remaining upside sits.`;

  return lever(...L, {
    score,
    headline: `${familySize} listings in the family, ${reviewedShare.toFixed(0)}% carrying ${REVIEWS_FOR_COVERAGE} or more reviews`,
    metricLabel: 'Listings with review depth',
    metricValue: `${reviewed} of ${known}`,
    delta: null,
    deltaDir: null,
    read,
    confidence,
    dataNote,
    detail: [
      { label: 'Listings in family', value: String(familySize) },
      { label: `Listings with ${REVIEWS_FOR_COVERAGE}+ reviews`, value: `${reviewed} of ${known}` },
      { label: 'Listings holding Buy Box', value: `${withBB} of ${known}` },
    ],
  });
}

// ─── LEVER 4: VISIBILITY ─────────────────────────────────────────────────────
// Sales rank trajectory. Falling rank is an improvement, so deltaDir inverts.

function buildVisibility(sig) {
  const L = ['visibility', 'Visibility'];

  const usable = sig.filter((s) => s.bsrPoints >= 2 && s.bsrDelta90Pct !== null);
  if (!usable.length) {
    const anyRank = sig.find((s) => s.bsrNow !== null);
    return lever(...L, {
      score: null,
      headline: anyRank ? 'Only one sales rank point in the window.' : 'No sales rank history returned.',
      metricLabel: 'Sales rank, 90d change',
      metricValue: null,
      delta: null, deltaDir: null,
      read: 'Fewer than two sales rank points came back in the last 90 days, so there is no trajectory to read. A single point cannot tell you whether visibility is moving.',
      confidence: 'low',
      dataNote: 'Fewer than two sales rank points in the last 90 days.',
      detail: anyRank ? [{ label: 'Sales rank now', value: `#${anyRank.bsrNow.toLocaleString('en-US')}` }] : [],
    });
  }

  const d90 = wmean(usable.map((s) => ({ v: s.bsrDelta90Pct, w: s.weight })));
  const d30 = wmean(usable.map((s) => ({ v: s.bsrDelta30Pct, w: s.weight })));

  // Flat rank scores 72. Every point of 90d deterioration costs 0.9, with the
  // last 30 days charged again at 0.3 so a fresh slide shows up fast.
  let score = 72 - d90 * 0.9;
  if (d30 !== null) score -= d30 * 0.3;

  const lead = usable.slice().sort((a, b) => b.weight - a.weight)[0];
  const points = sum(usable.map((s) => s.bsrPoints));
  const confidence = points >= 30 ? 'high' : points >= 8 ? 'medium' : 'low';
  const dataNote = points < 8
    ? `Trajectory is drawn from ${points} sales rank point${points === 1 ? '' : 's'} in 90 days, which is a thin series.`
    : null;

  const improving = d90 < -1;
  const worsening = d90 > 1;
  const read = improving
    ? `Sales rank improved ${Math.abs(d90).toFixed(1)}% over 90 days. Visibility is working; the gains show up in units before they show up in reviews.`
    : worsening
      ? `Sales rank slipped ${d90.toFixed(1)}% over 90 days. You are being outranked, and rank loss compounds because fewer impressions means fewer reviews.`
      : `Sales rank is flat over 90 days, within ${Math.abs(d90).toFixed(1)}% of where it started.`;

  return lever(...L, {
    score,
    headline: improving
      ? `Sales rank improved ${Math.abs(d90).toFixed(1)}% over 90 days`
      : worsening
        ? `Sales rank slipped ${d90.toFixed(1)}% over 90 days`
        : `Sales rank is flat over 90 days, within ${Math.abs(d90).toFixed(1)}%`,
    metricLabel: 'Sales rank, 90d change',
    metricValue: signedPct(d90),
    delta: d30 === null ? null : `${signedPct(d30)} in 30d`,
    deltaDir: dirFallGood(d30 === null ? d90 : d30, 1),
    read,
    confidence,
    dataNote,
    detail: [
      lead && lead.bsrNow !== null
        ? { label: sig.length > 1 ? 'Sales rank now, top listing' : 'Sales rank now', value: `#${lead.bsrNow.toLocaleString('en-US')}` }
        : null,
      lead && lead.bsrAgo90 !== null
        ? { label: sig.length > 1 ? 'Sales rank 90d ago, top listing' : 'Sales rank 90d ago', value: `#${lead.bsrAgo90.toLocaleString('en-US')}` }
        : null,
      { label: 'Rank points in window', value: String(points) },
    ].filter(Boolean),
  });
}

// ─── LEVER 5: RATINGS ────────────────────────────────────────────────────────
// Review velocity is reported but deliberately not scored: there is no category
// benchmark in the payload to score a velocity against, and inventing one would
// be a fabricated number.

function buildRatings(sig) {
  const L = ['ratings', 'Ratings'];

  const usable = sig.filter((s) => s.ratingNow !== null);
  if (!usable.length) {
    return lever(...L, {
      score: null,
      headline: 'No rating history returned for this listing.',
      metricLabel: 'Rating now',
      metricValue: null,
      delta: null, deltaDir: null,
      read: 'Keepa returned no rating points in the last 90 days, so neither the current star rating nor its movement can be measured.',
      confidence: 'low',
      dataNote: 'No rating points in the last 90 days.',
      detail: [],
    });
  }

  const rating = wmean(usable.map((s) => ({ v: s.ratingNow, w: s.weight })));
  const d30 = wmean(usable.map((s) => ({ v: s.ratingDelta30, w: s.weight })));
  const d90 = wmean(usable.map((s) => ({ v: s.ratingDelta90, w: s.weight })));
  const added30 = usable.every((s) => s.reviewsAdded30 === null)
    ? null : sum(usable.map((s) => s.reviewsAdded30));
  const reviewTotal = sum(usable.map((s) => s.reviewCount));

  // 2.5 stars scores 0, 4.5 stars scores 100, then recent movement is charged.
  let score = clamp((rating - 2.5) / 2.0 * 100, 0, 100);
  if (d30 !== null) score += d30 * 60;
  if (d90 !== null) score += d90 * 30;

  const trendPoints = sum(usable.map((s) => s.ratingPoints));
  const noTrend = d30 === null && d90 === null;
  const confidence = noTrend ? 'low' : trendPoints >= 8 ? 'high' : 'medium';
  const dataNote = noTrend
    ? 'Only one rating point came back in the 90 day window, so the score reflects the current rating with no trend.'
    : (trendPoints < 8 ? `Trend is drawn from ${trendPoints} rating point${trendPoints === 1 ? '' : 's'} in 90 days.` : null);

  const dropping = d30 !== null && d30 <= -0.05;
  const rising = d30 !== null && d30 >= 0.05;
  let read;
  if (dropping) {
    read = `Rating is ${r2(rating)} stars and down ${Math.abs(d30).toFixed(2)} in the last 30 days. Every tenth of a star costs conversion on traffic you already paid for.`;
  } else if (rising) {
    read = `Rating is ${r2(rating)} stars and up ${d30.toFixed(2)} in the last 30 days. Recent reviews are pulling the average back up.`;
  } else if (rating < 4.2) {
    read = `Rating is holding at ${r2(rating)} stars. It is stable, and it is below the 4.5 mark where conversion peaks.`;
  } else {
    read = `Rating is holding at ${r2(rating)} stars with no meaningful 30 day move.`;
  }
  if (added30 !== null) {
    read += added30 > 0
      ? ` ${added30.toLocaleString('en-US')} new reviews landed in the last 30 days.`
      : ' No new reviews landed in the last 30 days, so the current rating will not correct itself quickly.';
  }

  return lever(...L, {
    score,
    headline: `Rating is ${r2(rating)} stars, ${d30 === null ? 'no 30 day comparison' : `${d30 >= 0 ? '+' : ''}${d30.toFixed(2)} over 30 days`}`,
    metricLabel: 'Rating now',
    metricValue: `${r2(rating)}`,
    delta: d30 === null ? null : `${d30 >= 0 ? '+' : ''}${d30.toFixed(2)} in 30d`,
    deltaDir: dirRiseGood(d30, 0.005),
    read,
    confidence,
    dataNote,
    detail: [
      d90 !== null ? { label: 'Rating change, 90d', value: `${d90 >= 0 ? '+' : ''}${d90.toFixed(2)}` } : null,
      added30 !== null ? { label: 'New reviews, 30d', value: added30.toLocaleString('en-US') } : null,
      reviewTotal > 0 ? { label: 'Total reviews', value: reviewTotal.toLocaleString('en-US') } : null,
    ].filter(Boolean),
  });
}

// ─── COMPOSITE ───────────────────────────────────────────────────────────────

function computeFlywheel(rawProducts) {
  const list = (Array.isArray(rawProducts) ? rawProducts : []).filter((p) => p && typeof p === 'object');
  const sig = list.map(productSignals);

  const levers = [
    buildOperations(sig),
    buildPricing(sig),
    buildAssortment(sig),
    buildVisibility(sig),
    buildRatings(sig),
  ];

  const measured = levers.filter((l) => l.score !== null);
  const measuredCount = measured.length;

  let compositeScore = null;
  if (measuredCount >= MIN_MEASURED_FOR_COMPOSITE) {
    const wsum = sum(measured.map((l) => LEVER_WEIGHTS[l.key]));
    compositeScore = wsum > 0
      ? r1(sum(measured.map((l) => l.score * LEVER_WEIGHTS[l.key])) / wsum)
      : null;
  }

  const weakest = measured.slice().sort((a, b) => a.score - b.score)[0];

  return {
    compositeScore,
    measuredCount,
    weakestKey: weakest ? weakest.key : null,
    levers,
  };
}

module.exports = {
  computeFlywheel,
  LEVER_ORDER,
  LEVER_WEIGHTS,
};

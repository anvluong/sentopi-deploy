/**
 * Sentopi — revenue impact model
 *
 * The ONE definition of how a star rating maps to relative conversion, and
 * therefore of every dollar figure the site publishes. Imported by:
 *
 *   netlify/functions/brand-health.js    brand-level revenue at risk
 *   netlify/functions/product-lookup.js  single-ASIN revenue at risk
 *   src/rrr-app.jsx                      Revenue Risk Report
 *   src/calc-app.jsx                     Star Rating Calculator
 *
 * This table was previously copy-pasted into all four, with one copy carrying a
 * comment claiming it was the single source of truth. They happened to agree,
 * but nothing enforced it: a one-line edit in any copy would have made the
 * calculator and the report quote different dollars for the same product, which
 * is the one mistake a product selling financial rigour cannot make. qa-check
 * now fails if a second definition appears.
 *
 * Curve: purchase probability rises steeply to roughly 4.5 stars and declines
 * toward 5.0, the "too good to be true" effect. Sources shown on the site:
 * Spiegel Research Center (2017), PowerReviews, Pattern.com. Values are a
 * relative index, not absolute conversion rates.
 *
 * Loads in Node (require) and the browser (window.RevenueModel).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.RevenueModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONV_TABLE = [
    { r: 1.0, i: 0.40 }, { r: 2.0, i: 0.55 }, { r: 2.5, i: 0.65 },
    { r: 3.0, i: 0.75 }, { r: 3.5, i: 0.85 }, { r: 4.0, i: 0.92 },
    { r: 4.2, i: 0.96 }, { r: 4.5, i: 1.00 }, { r: 4.7, i: 0.99 },
    { r: 5.0, i: 0.87 },
  ];

  // Rating at which the conversion index peaks; the recovery target we quote.
  const PEAK_RATING = 4.5;

  /** Relative conversion index for a star rating, linearly interpolated. */
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

  return { CONV_TABLE, PEAK_RATING, convRate };
});

/**
 * Sentopi — cached flywheel samples, one definition per real ASIN.
 *
 * The homepage hero chips (HERO_SAMPLES) and the Revenue Risk Report chips
 * (SAMPLE_CHIPS) show the same three cached ASINs. They used to carry separate
 * copies of the story, so one set gained a flywheel and the other silently kept
 * rendering the pre-flywheel card. There is now one definition per ASIN and both
 * fixture files reference it.
 *
 * Levers are declared; composite, status and weakest lever are derived by
 * flywheel-core.js. Load order: flywheel-core.js, then this file, then fixtures.
 */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports)
    ? require('./flywheel-core.js')
    : root.FlywheelCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FLYWHEEL_SAMPLES = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';
  const FW = core.finalize;
  return {
    'B0FB9MXHR1': FW([
        { key: "operations", label: "Operations", score: 95,
          metric: { label: "Buy Box share, 30d", value: "100%", delta: null, deltaDir: null },
          read: "You held the Buy Box the whole month. Nothing here is costing you units.", confidence: "high", dataNote: null },
        { key: "pricing", label: "Pricing", score: 62,
          metric: { label: "Current price", value: "$28.49", delta: null, deltaDir: null },
          read: "Priced at $28.49. Steady, though there is no history in this snapshot to judge the trend.", confidence: "low", dataNote: "Single cached price point, so there is no 90-day price history behind this." },
        { key: "assortment", label: "Assortment", score: null,
          metric: { label: "Listings in family", value: "No data", delta: null, deltaDir: null },
          read: "", confidence: "low", dataNote: "Cached sample snapshot carries no variant family, so coverage cannot be scored." },
        { key: "visibility", label: "Visibility", score: 22,
          metric: { label: "Sales rank, 90d change", value: "#519", delta: "-201.7%", deltaDir: "down" },
          read: "Rank fell from roughly 170 to 519 in 90 days. Far fewer people are seeing this listing than a quarter ago, so every other lever is working on a smaller audience.", confidence: "high", dataNote: null },
        { key: "ratings", label: "Ratings", score: 38,
          metric: { label: "Rating now", value: "3.6", delta: "-0.40 in 90d", deltaDir: "down" },
          read: "The rating slid from 4.0 to 3.6 over 90 days and has stalled there. Below 4.0 you pay a conversion penalty on every visit.", confidence: "high", dataNote: null }
        ]),
    'B0C35WRR24': FW([
        { key: "operations", label: "Operations", score: null,
          metric: { label: "Buy Box share, 30d", value: "No data", delta: null, deltaDir: null },
          read: "", confidence: "low", dataNote: "No Buy Box history in this cached snapshot." },
        { key: "pricing", label: "Pricing", score: 64,
          metric: { label: "Current price", value: "$29.95", delta: null, deltaDir: null },
          read: "Priced at $29.95. Steady, though there is no history in this snapshot to judge the trend.", confidence: "low", dataNote: "Single cached price point, so there is no 90-day price history behind this." },
        { key: "assortment", label: "Assortment", score: null,
          metric: { label: "Listings in family", value: "No data", delta: null, deltaDir: null },
          read: "", confidence: "low", dataNote: "Cached sample snapshot carries no variant family, so coverage cannot be scored." },
        { key: "visibility", label: "Visibility", score: 41,
          metric: { label: "Sales rank, 90d change", value: "#13,340", delta: "-73.5%", deltaDir: "down" },
          read: "Rank worsened 73.5% over 90 days. The listing is getting materially less exposure than it was.", confidence: "high", dataNote: null },
        { key: "ratings", label: "Ratings", score: 55,
          metric: { label: "Rating now", value: "3.7", delta: "flat", deltaDir: "flat" },
          read: "The rating is steady at 3.7. Steady is not the same as healthy: sitting below 4.0 costs conversion on every visit.", confidence: "high", dataNote: null }
        ]),
    'B0GXB717TN': FW([
        { key: "operations", label: "Operations", score: 95,
          metric: { label: "Buy Box share, 30d", value: "100%", delta: null, deltaDir: null },
          read: "You held the Buy Box the whole month.", confidence: "high", dataNote: null },
        { key: "pricing", label: "Pricing", score: 66,
          metric: { label: "Current price", value: "$21.59", delta: null, deltaDir: null },
          read: "Priced at $21.59. Steady, though there is no history in this snapshot to judge the trend.", confidence: "low", dataNote: "Single cached price point, so there is no 90-day price history behind this." },
        { key: "assortment", label: "Assortment", score: null,
          metric: { label: "Listings in family", value: "No data", delta: null, deltaDir: null },
          read: "", confidence: "low", dataNote: "Cached sample snapshot carries no variant family, so coverage cannot be scored." },
        { key: "visibility", label: "Visibility", score: 92,
          metric: { label: "Sales rank, 90d change", value: "#2,155", delta: "+98.5%", deltaDir: "up" },
          read: "Rank improved sharply over 90 days. Traffic is not your problem.", confidence: "high", dataNote: null },
        { key: "ratings", label: "Ratings", score: 30,
          metric: { label: "Rating now", value: "3.9", delta: "-0.60 in 30d", deltaDir: "down" },
          read: "The rating dropped 0.6 stars in a single month while rank improved. You are buying traffic with one hand and losing the sale with the other, and on 82 reviews each new one moves the average hard.", confidence: "high", dataNote: null }
        ]),
  };
});

/* Category-matched priority-row templates for the homepage hero demo widget.
   When a visitor looks up their ASIN, /api/product-lookup returns the product's
   root category; we match it to a bucket below and render the rows as a
   personalized "here's what your fix list will look like" preview.

   These are pattern previews, not findings — the real report is built from the
   product's actual reviews. Copy is grounded in Sentopi's research base:
   40-55% of 1-star reviews trace to listing accuracy, not product failure.

   Row shape mirrors the original mockup rows: badge (P0/HIGH/MED),
   issue text, trend tag. */

window.PRIORITY_TEMPLATES = {
  pet: {
    match: ['pet supplies', 'pet'],
    rows: [
      { badge: 'P0',   text: 'No visible effect on pet behavior',      tag: 'rising' },
      { badge: 'HIGH', text: 'Listing over-promises results timeline', tag: 'rising' },
      { badge: 'MED',  text: 'Scent / dispenser complaints',           tag: 'steady' },
    ],
  },
  kitchen: {
    match: ['home & kitchen', 'kitchen & dining', 'home', 'furniture', 'appliances'],
    rows: [
      { badge: 'P0',   text: 'Arrived damaged / broken in transit',   tag: 'rising' },
      { badge: 'HIGH', text: 'Size smaller than photos suggest',      tag: 'rising' },
      { badge: 'MED',  text: 'Material feels cheaper than expected',  tag: 'steady' },
    ],
  },
  beauty: {
    match: ['beauty & personal care', 'beauty', 'health & household', 'health'],
    rows: [
      { badge: 'P0',   text: 'No results after expected timeframe',    tag: 'rising' },
      { badge: 'HIGH', text: 'Skin reaction / sensitivity reports',    tag: 'rising' },
      { badge: 'MED',  text: 'Smaller quantity than listing implies',  tag: 'steady' },
    ],
  },
  electronics: {
    match: ['electronics', 'camera & photo', 'computers', 'cell phones & accessories', 'office products'],
    rows: [
      { badge: 'P0',   text: 'Setup / connectivity failures',          tag: 'rising' },
      { badge: 'HIGH', text: 'Features missing vs. listing claims',    tag: 'rising' },
      { badge: 'MED',  text: 'App experience drags the rating down',   tag: 'steady' },
    ],
  },
  outdoor: {
    match: ['sports & outdoors', 'patio, lawn & garden', 'automotive', 'tools & home improvement'],
    rows: [
      { badge: 'P0',   text: 'Durability fails under normal use',      tag: 'rising' },
      { badge: 'HIGH', text: 'Sizing / fit runs off from size chart',  tag: 'rising' },
      { badge: 'MED',  text: 'Weather resistance below claims',        tag: 'steady' },
    ],
  },
  apparel: {
    match: ['clothing, shoes & jewelry', 'clothing', 'shoes'],
    rows: [
      { badge: 'P0',   text: 'Sizing runs small vs. size chart',       tag: 'rising' },
      { badge: 'HIGH', text: 'Color differs from listing photos',      tag: 'rising' },
      { badge: 'MED',  text: 'Fabric quality below price point',       tag: 'steady' },
    ],
  },
  grocery: {
    match: ['grocery & gourmet food', 'grocery'],
    rows: [
      { badge: 'P0',   text: 'Taste / flavor not as described',        tag: 'rising' },
      { badge: 'HIGH', text: 'Arrived melted, stale, or near expiry',  tag: 'rising' },
      { badge: 'MED',  text: 'Package size reads bigger online',       tag: 'steady' },
    ],
  },
  toys: {
    match: ['toys & games', 'baby products', 'baby'],
    rows: [
      { badge: 'P0',   text: 'Breaks within first weeks of use',       tag: 'rising' },
      { badge: 'HIGH', text: 'Age grading off; too hard or too easy',  tag: 'rising' },
      { badge: 'MED',  text: 'Missing pieces out of the box',          tag: 'steady' },
    ],
  },
  general: {
    match: [],
    rows: [
      { badge: 'P0',   text: 'Product fails core use case',            tag: 'rising' },
      { badge: 'HIGH', text: 'Listing over-promise vs. delivery',      tag: 'rising' },
      { badge: 'MED',  text: 'Quality inconsistent between units',     tag: 'steady' },
    ],
  },
};

/* Sample chips for the hero widget — same real ASINs as the Revenue Risk
   Report page, snapshot-shaped to mirror /api/product-lookup output.
   Cached June 2026; rendered client-side, zero API tokens spent. */
window.HERO_SAMPLES = [
  {
    asin:  'B0FB9MXHR1',
    label: 'Pet Diffuser · 3.6★',
    data: {
      success: true, asin: 'B0FB9MXHR1',
      title: 'TheraPetMD 60-Day Dog Calming Diffuser Kit',
      brand: 'TheraPetMD', category: 'Pet Supplies',
      rating: 3.6, rating30dAgo: 3.6, rating90dAgo: 4.0,
      ratingDelta30d: null, ratingDelta90d: -0.4,
      reviewCount: 4518, bsr: 519, bsrDelta90dPct: 201.7,
      price: 28.49, monthlySold: 10000, bbPct30d: 100,
      revRiskMonthly: 38746, revRiskBasis: 'chronic',
    },
  },
  {
    asin:  'B0C35WRR24',
    label: 'Hair Serum · 3.7★',
    data: {
      success: true, asin: 'B0C35WRR24',
      title: 'ForChics Hair Growth Serum for Women',
      brand: 'Forchics', category: 'Beauty & Personal Care',
      rating: 3.7, rating30dAgo: 3.7, rating90dAgo: 3.7,
      ratingDelta30d: 0, ratingDelta90d: 0,
      reviewCount: 1017, bsr: 13340, bsrDelta90dPct: 73.5,
      price: 29.95, monthlySold: 1000, bbPct30d: null,
      revRiskMonthly: 3654, revRiskBasis: 'chronic',
    },
  },
  {
    asin:  'B0GXB717TN',
    label: 'Mini Camera · 3.9★',
    data: {
      success: true, asin: 'B0GXB717TN',
      title: 'Braload Mini Camera Nanny Cam for Home',
      brand: 'Braload', category: 'Electronics',
      rating: 3.9, rating30dAgo: 4.5, rating90dAgo: 4.7,
      ratingDelta30d: -0.6, ratingDelta90d: -0.8,
      reviewCount: 82, bsr: 2155, bsrDelta90dPct: -98.5,
      price: 21.59, monthlySold: 1000, bbPct30d: 100,
      revRiskMonthly: 2029, revRiskBasis: 'drop',
    },
  },
];

/* Match a Keepa root-category name to a template bucket. */
window.matchPriorityTemplate = function (categoryName) {
  const c = (categoryName || '').toLowerCase();
  if (c) {
    for (const key of Object.keys(window.PRIORITY_TEMPLATES)) {
      if (key === 'general') continue;
      if (window.PRIORITY_TEMPLATES[key].match.some(m => c.includes(m) || m.includes(c))) {
        return window.PRIORITY_TEMPLATES[key];
      }
    }
  }
  return window.PRIORITY_TEMPLATES.general;
};

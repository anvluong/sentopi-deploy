# Retail Flywheel payload contract

The single integration point between the Keepa scoring functions and every UI surface. Backend and UI are built against this document. Do not change a field name without updating both sides and this file.

## Principle

A lever that cannot be measured reports `status: "unmeasured"` and `score: null`. It never receives a fabricated or neutral-looking score. Confidence travels with the data all the way to the screen: if a number is derived from a proxy, `dataNote` says so in plain language and the UI renders it.

## Shape

`brand-health` and `product-lookup` responses gain a top-level `flywheel` object. The existing `pillar_bsr` / `pillar_rating` / `pillar_buybox` fields stay exactly as they are (the current RRR UI depends on them).

```js
flywheel: {
  compositeScore: 62.4,        // 0-100, weighted mean of MEASURED levers only, or null
  measuredCount: 4,            // how many of the 5 levers had real data
  weakestKey: 'ratings',       // key of the lowest-scoring measured lever, or null
  levers: [ Lever, Lever, Lever, Lever, Lever ]   // ALWAYS 5, always this order:
                                                  // operations, pricing, assortment, visibility, ratings
}
```

### Lever

```js
{
  key: 'operations',                 // operations | pricing | assortment | visibility | ratings
  label: 'Operations',
  score: 71.2,                       // 0-100, or null when unmeasured
  status: 'watch',                   // strong (>=75) | watch (50-74) | leaking (<50) | unmeasured
  headline: 'Buy Box held 71% of the last 30 days',   // one clause, the number stated plainly
  metric: {
    label: 'Buy Box share, 30d',     // what the primary number is
    value: '71%',                    // preformatted for display
    delta: '-8.3 pts',               // preformatted, or null
    deltaDir: 'down'                 // up | down | flat | null; 'up' is ALWAYS good for the lever
  },
  read: 'You lost the Buy Box on 29% of the last 30 days, which takes traffic and conversion down together.',
  confidence: 'high',                // high | medium | low
  dataNote: null,                    // string when a proxy or partial window was used, else null
  detail: [                          // 0-4 supporting rows, rendered in the dense detail table
    { label: 'Buy Box events, 30d', value: '241' },
    { label: 'Lowest competitor price', value: '$26.99' }
  ]
}
```

## Lever definitions and their data sources

| Lever | Keepa source | Primary metric | Unmeasured when |
|---|---|---|---|
| **Operations** | `csv[18]` Buy Box triplets | Buy Box share over 30d; out-of-stock episodes | no Buy Box history |
| **Pricing** | `csv[1]`, `csv[18]` ASP windows, `csv[11]` offer count, `p.stats` | current price position vs its own 90d range; MoM ASP change; competing offer count | no price history |
| **Assortment** | `variationCSV`, sibling fetch | variant count in family; share of variants carrying reviews and Buy Box | single-ASIN product with no variation data (report unmeasured, NOT "score 0") |
| **Visibility** | `csv[3]` sales rank | BSR trajectory 90d and 30d | fewer than 2 rank points |
| **Ratings** | `csv[16]`, `csv[17]` | current rating, 30d and 90d delta, review velocity | no rating data |

Assortment note: a genuinely single-variant product is not a failing assortment. When `variationCSV` is absent, the lever is `unmeasured` with `dataNote` explaining that a single-listing product has no variant coverage to score.

## Composite

Weighted mean over measured levers only, rescaled to 100. Weights: Operations 22, Pricing 22, Assortment 14, Visibility 20, Ratings 22. If fewer than 3 levers are measured, `compositeScore` is `null` and the UI shows the levers without a headline score rather than a misleading one.

## Mocks

`KEEPA_MOCK=true` fixtures must include a fully populated `flywheel` for every mocked product, including at least one lever in each of `strong`, `watch`, `leaking`, and `unmeasured` across the fixture set, so local QA exercises every render path.

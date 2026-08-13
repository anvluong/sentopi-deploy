# Sentopi

Sentopi marketing site (sentopi.com): review intelligence for Amazon brands.

## Tech stack

- Static HTML / CSS / JavaScript (single-file pages, inline CSS, no build step for content pages)
- React 18 UMD (cdnjs) for the Revenue Risk Report app; `src/rrr-app.jsx` is precompiled to `rrr-app.js` with Babel. **Never hand-edit the compiled `.js`.** Rebuild with `npx babel src/rrr-app.jsx --presets @babel/preset-react -o rrr-app.js`.
- [Netlify Functions](https://docs.netlify.com/functions/overview/) for the Keepa-backed product lookups
- Netlify Forms for lead capture (form `demo`, POST → `/success.html`)
- Google Tag Manager container `GTM-MLF5DHCH` on every page

## File overview

- `index.html` — homepage
- `revenue-risk.html` — Revenue Risk Report (free tool; served at `/revenue-risk-report`)
- `listing-accuracy.html` — original research article (3,725 reviews)
- `growth-loop.html` — Growth Loop framework article
- `why-are-my-amazon-sales-down.html` — seller diagnostic article
- `guides.html` — content hub
- `legal.html` — privacy + terms
- `success.html` — post-signup confirmation (noindex, excluded from sitemap)
- `netlify.toml` — redirects + functions config
- `netlify/functions/brand-health.js` — calls the Keepa API, computes the BSR / Rating / Buy Box pillar scores, returns structured product data for the Revenue Risk Report
- `netlify/functions/product-lookup.js` — lightweight ASIN lookup for the homepage hero widget
- `netlify/functions/_keepa-utils.js` — shared Keepa helpers
- `scripts/qa-check.mjs` — the Tier 1 QA gate (run before every handback; enforced by `.githooks/pre-push`)
- `skills/sentopi-qa/SKILL.md` — the full QA process (tiers, when each runs)

## Local preview

Preferred (full redirects + functions, no Keepa spend):

```bash
KEEPA_MOCK=true KEEPA_API_KEY=mock npx netlify dev --port 4322
```

Static only (no clean URLs from netlify.toml, no functions):

```bash
npx serve -l 4488 .
```

Note: Netlify Forms POSTs return 405 under `netlify dev`; forms only work on the deployed site.

## Deployment

Hosted on [Netlify](https://www.netlify.com/). Auto-deploys on push to `main`. Run `node scripts/qa-check.mjs` before any push; the pre-push hook enforces it.

### Required environment variables

Set in **Netlify site settings → Environment variables**:

- `KEEPA_API_KEY` *(required)* — Keepa API key for the product lookup functions
- `KEEPA_MOCK` *(local only)* — set `true` to serve mock TherapetMD data without spending Keepa tokens

Without `KEEPA_API_KEY`, the lookup functions return a 500 and the tools fall back to sample data.

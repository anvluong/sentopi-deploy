# Sentopi

Sentopi landing page — review intelligence for e-commerce.

## Tech stack

- Static HTML / CSS / JavaScript (single-file pages, inline CSS)
- [Chart.js](https://www.chartjs.org/) loaded from CDN
- [Netlify Functions](https://docs.netlify.com/functions/overview/) for the email subscribe endpoint
- [ConvertKit (Kit) v3 API](https://developers.convertkit.com/) for subscriber management

## File overview

- `index.html` — main landing page
- `calculator.html` — free star rating revenue impact calculator
- `brand-health.html` — Revenue Risk Report (React, single-file, Babel CDN)
- `success.html` — post-signup confirmation page
- `favicon.svg` — site favicon
- `netlify.toml` — Netlify config (points to `netlify/functions`)
- `netlify/functions/subscribe.js` — serverless function that POSTs to the Kit v3 API to add subscribers to a sequence
- `netlify/functions/brand-health.js` — serverless function that calls the Keepa API, computes all three pillar scores (BSR / Rating / Buy Box), rolls up a composite score, and returns structured product data for the Revenue Risk Report

## Local preview

No build step required — just serve the folder statically:

```bash
npx serve .
```

Or simply open `index.html` in a browser. (Note: the Netlify function won't run locally without `netlify dev`.)

To test the function locally:

```bash
npx netlify dev
```

## Deployment

Hosted on [Netlify](https://www.netlify.com/). The repo is auto-deployed on push to `main`.

### Required environment variables

Set these in **Netlify site settings → Environment variables**:

- `KIT_API_KEY` *(required)* — your ConvertKit/Kit v3 API key
- `KIT_SEQUENCE_ID` *(optional)* — Kit sequence ID to subscribe new emails to (defaults to a hard-coded fallback in `subscribe.js`)
- `KEEPA_API_KEY` *(required for brand-health)* — Keepa API key for the brand health scorecard endpoint. **Rotate before production deploy.**

Without `KIT_API_KEY`, the `/api/subscribe` function will fail with a 502. Without `KEEPA_API_KEY`, the `/api/brand-health` function will return a 500 — the scorecard will fall back to mock TherapetMD data in development mode.

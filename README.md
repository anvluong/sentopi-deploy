# Sentopi

Sentopi landing page — review intelligence for e-commerce.

## Tech stack

- Static HTML / CSS / JavaScript (single-file pages, inline CSS)
- [Chart.js](https://www.chartjs.org/) loaded from CDN
- [Netlify Functions](https://docs.netlify.com/functions/overview/) for the email subscribe endpoint
- [ConvertKit (Kit) v3 API](https://developers.convertkit.com/) for subscriber management

## File overview

- `index.html` — main landing page
- `calculator.html` — free calculator tool
- `success.html` — post-signup confirmation page
- `favicon.svg` — site favicon
- `netlify.toml` — Netlify config (points to `netlify/functions`)
- `netlify/functions/subscribe.js` — serverless function that POSTs to the Kit v3 API to add subscribers to a sequence

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

Without `KIT_API_KEY`, the `/api/subscribe` function will fail with a 502.

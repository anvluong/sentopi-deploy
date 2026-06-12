/**
 * Sentopi — shared Keepa helpers
 * Used by brand-health.js and product-lookup.js. Single source of truth for
 * Keepa time math, CSV parsing, and the /product fetch.
 */

const KEEPA_DOMAIN = 1; // 1 = Amazon.com

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
  if (!resp.ok) { const e = new Error(`Keepa /product returned ${resp.status}`); e.status = resp.status; throw e; }

  const data = await resp.json();
  return data.products || [];
}

module.exports = {
  KEEPA_DOMAIN,
  keepaToDate,
  nowKeepa,
  daysAgoKeepa,
  parseCSV,
  parseBBTriplets,
  fetchProductData,
};

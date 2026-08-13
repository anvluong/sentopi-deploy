#!/usr/bin/env node
/*
 * Generates the homepage landing-state card between the GENERATED:LANDING
 * markers in index.html.
 *
 * Why generated: the pre-interaction card is the first thing a cold visitor
 * sees, and it was hand-written. It drifted from the fixture behind the first
 * sample chip, so clicking that chip changed the numbers and, at one point,
 * rendered a completely different card. Rendering it from HERO_SAMPLES[0]
 * through flywheel-view.js means the landing state and the chip agree by
 * construction.
 *
 *   node scripts/gen-landing.mjs          write
 *   node scripts/gen-landing.mjs --check  exit 1 if out of sync (used by qa-check)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const core = require(join(ROOT, 'flywheel-core.js'));
const view = require(join(ROOT, 'flywheel-view.js'));

// priority-templates.js is a browser script; give it the globals it expects,
// including the shared per-ASIN samples it references.
global.window = { FlywheelCore: core, FlywheelView: view };
global.window.FLYWHEEL_SAMPLES = require(join(ROOT, 'flywheel-samples.js'));
require(join(ROOT, 'priority-templates.js'));
const sample = global.window.HERO_SAMPLES[0];
const d = sample.data;

const START = '<!-- GENERATED:LANDING start';
const END = '<!-- GENERATED:LANDING end -->';

const esc = view.escapeHtml;

function stars(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '☆' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

function badge(d) {
  const delta = d.ratingDelta30d !== null && d.ratingDelta30d !== undefined ? d.ratingDelta30d : d.ratingDelta90d;
  if (delta === null || delta === undefined) return { cls: 'mockup-rating-badge', text: '' };
  if (delta < 0) return { cls: 'mockup-rating-badge', text: '↓ Slipping' };
  if (delta > 0) return { cls: 'mockup-rating-badge up', text: '↑ Rising' };
  return { cls: 'mockup-rating-badge', text: '→ Flat' };
}

const b = badge(d);
const riskAnnual = d.revRiskMonthly ? d.revRiskMonthly * 12 : null;

const html = [
  '          <!-- Product header -->',
  '          <div class="mockup-product-header">',
  `            <div class="mockup-product-name" id="heroProductName">${esc(d.title)}</div>`,
  '            <div class="mockup-product-meta">',
  `              <span class="mockup-stars" id="heroStars">${stars(d.rating)}</span>`,
  `              <span class="mockup-rating-text" id="heroRatingText">${d.rating.toFixed(1)} avg · ${Number(d.reviewCount).toLocaleString()} reviews</span>`,
  b.text ? `              <span class="${b.cls}" id="heroRatingBadge">${b.text}</span>` : '',
  '            </div>',
  '          </div>',
  '          ' + view.render(d.flywheel, riskAnnual),
].filter(Boolean).join('\n');

const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
const si = src.indexOf(START);
const ei = src.indexOf(END);
if (si === -1 || ei === -1) {
  console.error('gen-landing: GENERATED:LANDING markers not found in index.html');
  process.exit(1);
}
const headEnd = src.indexOf('-->', si) + 3;
const next = src.slice(0, headEnd) + '\n' + html + '\n          ' + src.slice(ei);

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error('gen-landing: index.html landing block is OUT OF SYNC with HERO_SAMPLES[0].');
    console.error('Regenerate with: node scripts/gen-landing.mjs');
    process.exit(1);
  }
  console.log('gen-landing: landing block in sync.');
  process.exit(0);
}

writeFileSync(join(ROOT, 'index.html'), next);
console.log(`gen-landing: wrote landing card for ${sample.asin} (${d.flywheel.compositeScore}/100, weakest ${d.flywheel.weakestKey}).`);

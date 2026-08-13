#!/usr/bin/env node
/*
 * Sentopi pre-push QA gate - fast, static, dependency-light, no network.
 * Run: node scripts/qa-check.mjs   (exit 1 on any FAIL, WARN never blocks)
 *
 * This is the `static` mode of the sentopi-qa skill. It catches the
 * deterministic regressions we keep hitting: compiled-asset drift, stale
 * lead-CTA copy, visible em-dashes, broken links, Netlify form mismatches,
 * and committed secrets. Behavioral, visual and judgment checks live in the
 * skill (see .claude/skills/sentopi-qa/SKILL.md), not here.
 *
 * Every block below that can call fail() carries a stable [gate:<id>] tag.
 * scripts/qa-skill-drift.mjs holds those ids equal to the fenced table in
 * the skill, in both directions. Add a check here, add its row there.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkSkillDrift } from './qa-skill-drift.mjs';

const ROOT = process.cwd();
const fails = [];
const warns = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);

function tracked(glob = '') {
  try {
    return execSync(`git ls-files ${glob}`, { cwd: ROOT })
      .toString().trim().split('\n').filter(Boolean);
  } catch { return []; }
}
const read = (f) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } };

const html = tracked("'*.html'")
  .filter((f) => !/google[0-9a-f]+\.html$/.test(f))
  .filter((f) => f !== '_template-article.html');
const jsx  = tracked("'src/*.jsx'");
const js   = tracked("'*.js'").filter((f) => !f.includes('node_modules'));
const allCode = [...html, ...jsx, ...js];

/* ── 1. Compiled apps in sync with their src/*.jsx sources [gate:compiled-drift] ── */
for (const [srcF, outF] of [['src/rrr-app.jsx', 'rrr-app.js'], ['src/calc-app.jsx', 'calc-app.js']]) {
  if (!existsSync(join(ROOT, srcF)) || !existsSync(join(ROOT, outF))) continue;
  let out;
  try {
    out = execSync(`npx --no-install babel ${srcF} --presets @babel/preset-react`,
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    warn(`Could not run babel to verify ${outF} is in sync (run \`npm i\`). Compile check skipped.`);
    continue;
  }
  const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
  if (norm(out) !== norm(read(outF)))
    fail(`${outF} is OUT OF SYNC with ${srcF}. Recompile: npx babel ${srcF} --presets @babel/preset-react -o ${outF}`);
}

/* ── 2. JS syntax (parse-only) [gate:js-syntax] ──────────────────────── */
for (const f of js) {
  try { execSync(`node --check ${JSON.stringify(f)}`, { cwd: ROOT, stdio: 'ignore' }); }
  catch { fail(`JS syntax error in ${f} (node --check failed).`); }
}

/* ── 3. Stale lead-CTA copy [gate:stale-cta] ─────────────────────────── */
for (const f of allCode) {
  read(f).split('\n').forEach((ln, i) => {
    if (/Get My Free|Free 48hr Report|\b48hr Report\b/.test(ln))
      fail(`Stale lead CTA ${f}:${i + 1}: use "Get your free report" (drop "48hr").`);
  });
}

/* ── 4. Visible em-dashes in copy surfaces (comments stripped) [gate:em-dash] ── */
// Scope: .html + src/*.jsx (where marketing copy lives). Comments are blanked
// in place (positions preserved) so multi-line /* */ and <!-- --> don't false-trip.
// Generated rrr-app.js and backend .js notes are out of scope (see SKILL Tier 3).
const blankComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
for (const f of [...html, ...jsx]) {
  blankComments(read(f)).split('\n').forEach((ln, i) => {
    if (ln.includes('—')) fail(`Em-dash in visible copy ${f}:${i + 1}: brand rule, use a spaced hyphen, a comma, or a period.`);
  });
}

/* ── 5. AI-tells / placeholders [warn-only] ──────────────────────────── */
const tells = /\b(of course|in conclusion|it'?s worth noting|needless to say|rest assured)\b/i;
const placeholders = /\b(lorem ipsum|TODO|FIXME|PLACEHOLDER|TBD)\b/;
for (const f of html) {
  read(f).split('\n').forEach((ln, i) => {
    if (tells.test(ln)) warn(`Possible AI-tell ${f}:${i + 1}: "${ln.trim().slice(0, 70)}"`);
    if (placeholders.test(ln)) warn(`Placeholder/TODO text ${f}:${i + 1}.`);
  });
}

/* ── 6. Internal links + anchors resolve [gate:broken-link] ──────────── */
const toml = read('netlify.toml');
const redirects = {};
{
  const froms = [...toml.matchAll(/from\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const tos   = [...toml.matchAll(/to\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  froms.forEach((fr, i) => { if (tos[i]) redirects[fr] = tos[i]; });
}
// Every id/name across html+js+jsx (covers React-rendered ids), for anchor checks.
const anchors = new Set();
for (const f of allCode) {
  const c = read(f);
  for (const m of c.matchAll(/\b(?:id|name)\s*=\s*["']([A-Za-z][\w-]*)["']/g)) anchors.add(m[1]);
  for (const m of c.matchAll(/\b(?:id|name)\s*=\s*\{\s*[`'"]([A-Za-z][\w-]*)[`'"]/g)) anchors.add(m[1]);
}
const resolvePath = (p) => {
  if (p === '/') return 'index.html';
  if (redirects[p]) p = redirects[p];
  const rel = p.replace(/^\//, '');
  if (existsSync(join(ROOT, rel))) return rel;
  if (existsSync(join(ROOT, rel + '.html'))) return rel + '.html';
  return null;
};
for (const f of html) {
  for (const m of read(f).matchAll(/href\s*=\s*"([^"]+)"/g)) {
    const href = m[1];
    if (href === '#' || /^(mailto:|tel:|https?:|data:|javascript:)/.test(href)) continue;
    const [pathPart, anchor] = href.split('#');
    if (pathPart === '') {
      if (anchor && !anchors.has(anchor)) warn(`Anchor not found in ${f}: "#${anchor}".`);
      continue;
    }
    if (!resolvePath(pathPart)) { fail(`Broken internal link ${f}: "${href}" → no matching file/redirect.`); continue; }
    if (anchor && !anchors.has(anchor)) warn(`Anchor not found ${f}: "${href}".`);
  }
}

/* ── 7. Netlify form integrity [gate:netlify-form] ───────────────────── */
const registered = new Set();
for (const f of html) {
  const c = read(f);
  for (const m of c.matchAll(/<form\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>/g)) {
    if (!/data-netlify\s*=\s*"true"/.test(m[0])) continue;
    registered.add(m[1]);
    const body = c.slice(m.index, m.index + 1500);
    if (!new RegExp(`name="form-name"\\s+value="${m[1]}"`).test(body))
      warn(`Form name="${m[1]}" in ${f} may lack its hidden <input name="form-name" value="${m[1]}">.`);
  }
}
for (const f of allCode) {
  for (const m of read(f).matchAll(/['"]form-name['"]\s*:\s*['"]([^'"]+)['"]/g)) {
    if (!registered.has(m[1]))
      fail(`${f}: posts form-name "${m[1]}" but no registered <form data-netlify name="${m[1]}"> exists. Netlify will reject it.`);
  }
}

/* ── 8. Meta hygiene [warn-only] ─────────────────────────────────────── */
for (const f of html) {
  const c = read(f);
  if (!/<meta[^>]+name=["']viewport["']/.test(c)) warn(`${f}: missing viewport meta.`);
  if (!/<title>[^<]+<\/title>/.test(c)) warn(`${f}: missing or empty <title>.`);
  const h1 = (c.match(/<h1\b/g) || []).length;
  if (h1 > 1) warn(`${f}: ${h1} <h1> tags (prefer one per page).`);
  if (!/GTM-[A-Z0-9]+/.test(c)) warn(`${f}: no GTM container found (analytics may be missing).`);
}

/* ── 9. Secret scan (tracked, non-binary) [gate:secrets] ─────────────── */
const secretPat = /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']|AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]{10,}/i;
for (const f of tracked()) {
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf)$/i.test(f) || f.includes('node_modules') || f.endsWith('qa-check.mjs')) continue;
  if (secretPat.test(read(f))) fail(`Possible secret committed in ${f}. Move it to an env var / gitignored .env.`);
}

/* ── 10. Page contract [gate:canonical] [gate:meta-description] ──────── */
// Every page (success.html included, it carries both for hygiene) must have a
// canonical URL and a meta description. Length is advisory only.
for (const f of html) {
  const c = read(f);
  const canon = c.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
  if (!canon) fail(`${f}: missing <link rel="canonical">.`);
  const desc = c.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  if (!desc) fail(`${f}: missing <meta name="description">.`);
  else if (desc[1].length < 70 || desc[1].length > 165)
    warn(`${f}: meta description is ${desc[1].length} chars (aim for 70-165).`);
}

/* ── 11. JSON-LD blocks must parse [gate:jsonld-parse] ───────────────── */
for (const f of html) {
  const c = read(f);
  let n = 0;
  for (const m of c.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    n += 1;
    try { JSON.parse(m[1]); }
    catch (e) { fail(`${f}: JSON-LD block #${n} does not parse (${e.message.slice(0, 60)}).`); }
  }
}

/* ── 12. Freshness + sitemap [gate:sitemap-loc] [gate:datemodified-lastmod] ── */
// Article dateModified must equal the page's sitemap lastmod (the drift class
// behind the July merge conflicts). Every sitemap loc must resolve to a file;
// every indexable page must appear in the sitemap.
const sitemap = read('sitemap.xml');
const lastmods = {};
for (const m of sitemap.matchAll(/<loc>https:\/\/sentopi\.com(\/[^<]*)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g))
  lastmods[m[1]] = m[2];
const sitemapFiles = new Set();
for (const loc of Object.keys(lastmods)) {
  const resolved = resolvePath(loc);
  if (!resolved) fail(`sitemap.xml: <loc> ${loc} does not resolve to a file or redirect.`);
  else sitemapFiles.add(resolved);
}
for (const f of html) {
  const c = read(f);
  const canon = c.match(/<link\s+rel="canonical"\s+href="https:\/\/sentopi\.com(\/[^"]*)"/);
  const dm = c.match(/"dateModified":\s*"([^"]+)"/);
  if (dm && canon && lastmods[canon[1]] && lastmods[canon[1]] !== dm[1])
    fail(`${f}: dateModified "${dm[1]}" != sitemap lastmod "${lastmods[canon[1]]}". Update both together.`);
  if (!sitemapFiles.has(f) && f !== 'success.html')
    warn(`${f}: not reachable from sitemap.xml (add an entry or note why).`);
}

/* ── 13. Article footer link set + price [gate:price-drift] ──────────── */
const FOOT_LINKS = ['/', '/revenue-risk-report', '/guides'];
for (const f of html) {
  const c = read(f);
  const foot = c.match(/<footer\s+class="art-foot">([\s\S]*?)<\/footer>/);
  if (foot) for (const req of FOOT_LINKS)
    if (!new RegExp(`href="${req}"`).test(foot[1]))
      warn(`${f}: article footer is missing the "${req}" link (copy the canonical art-foot nav).`);
}
// The one monthly price on this site is $149. Any other "$X per month / $X/mo"
// string is a regression (the old $49/$149 discrepancy class).
for (const f of [...html, ...jsx]) {
  blankComments(read(f)).split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(/\$\s?(\d[\d,]*)\s*(?:\/\s*mo(?:nth)?\b|per\s+month\b)/gi)) {
      if (m[1] !== '149') fail(`Price drift ${f}:${i + 1}: "$${m[1]}" monthly price found; the canonical price is $149/mo.`);
    }
  });
}

/* ── 14. Flywheel conformance [gate:flywheel-conformance] ───────────── */
// Every surface that shows a sample must ship flywheel data, and every payload
// must agree with the contract. The homepage sample chips silently rendered the
// pre-flywheel card for a full session because nothing asserted this.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  let core = null;
  try {
    core = require(join(ROOT, 'flywheel-core.js'));
  } catch (e) {
    fail(`flywheel-core.js failed to load (${e.message.slice(0, 60)}). Every flywheel surface depends on it.`);
  }
  if (core) {

  try { require(join(ROOT, 'flywheel-view.js')); }
  catch (e) { fail(`flywheel-view.js failed to load (${e.message.slice(0, 60)}).`); }

  // Fixture files are browser scripts; give them the globals they expect.
  // Shared per-ASIN samples must exist before any fixture that references them.
  global.window = { FlywheelCore: core };
  try { global.window.FLYWHEEL_SAMPLES = require(join(ROOT, 'flywheel-samples.js')); }
  catch (e) { fail(`flywheel-samples.js failed to load (${e.message.slice(0, 60)}).`); }

  const fixtureFiles = tracked("'*.js'").filter((f) =>
    !f.includes('node_modules') && /fixtures|templates/i.test(f));
  for (const f of fixtureFiles) {
    try { require(join(ROOT, f)); }
    catch (e) { fail(`${f} failed to load (${e.message.slice(0, 70)}).`); }
  }

  /* Discover every scored payload rather than naming the globals we happen to
     know about. SAMPLE_CHIPS was a fourth fixture set nobody had listed, so it
     kept rendering the pre-flywheel card while the enumerated sets passed. */
  const found = [];
  const seen = new Set();
  const looksScored = (o) => o && typeof o === 'object' &&
    (o.brandScore !== undefined || Array.isArray(o.products) ||
     (o.asin !== undefined && o.rating !== undefined));
  (function walk(node, path, depth) {
    if (!node || typeof node !== 'object' || depth > 5 || seen.has(node)) return;
    seen.add(node);
    if (looksScored(node)) { found.push([path, node]); return; }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'function') continue;
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  })(global.window, '', 0);

  if (found.length < 3) {
    warn(`Only ${found.length} scored sample payloads discovered. Did a fixture file move or change shape?`);
  }
  for (const [where, payload] of found) {
    if (!payload.flywheel) {
      fail(`${where}: scored sample has no flywheel payload. It will silently render the pre-flywheel card.`);
      continue;
    }
    for (const err of core.validate(payload.flywheel, where)) fail(err);
  }
  }
}

/* ── 15. Single-source guards ────────────────────────────────────────── */
// The rating-to-conversion table drives every dollar figure the site publishes.
// It used to be copy-pasted into four files, one of which claimed in a comment
// to be the single source of truth. A second definition means the calculator
// and the report can quote different dollars for the same product.
for (const f of [...js, ...jsx]) {
  if (f === 'revenue-model.js') continue;
  if (/const CONV_TABLE\s*=\s*\[/.test(read(f)))
    fail(`${f} defines its own CONV_TABLE. The rating-to-conversion model lives only in revenue-model.js; import it instead.`);
}
for (const f of [...js, ...jsx]) {
  if (f === 'flywheel-core.js') continue;
  if (/const LEVER_WEIGHTS\s*=\s*\{/.test(read(f)))
    fail(`${f} defines its own LEVER_WEIGHTS. The flywheel contract lives only in flywheel-core.js.`);
}

/* ── 16. Generated landing block is in sync ──────────────────────────── */
try {
  execSync('node scripts/gen-landing.mjs --check', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  const out = ((e.stderr || '') + (e.stdout || '')).toString().trim().split('\n')[0];
  fail(`index.html landing block is out of sync with HERO_SAMPLES[0]. Regenerate: node scripts/gen-landing.mjs (${out})`);
}

/* ── 15. The skill's check table equals this file [gate:skill-drift] ── */
// Registered on both sides, the way GoutSafe's qa:skill-drift is. Lives in
// its own module so CI can run it alone in ~200ms with no install.
for (const m of checkSkillDrift()) fail(m);

/* ── Report ──────────────────────────────────────────────────────────── */
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[0m';
console.log('\nSentopi pre-push QA gate\n========================');
if (!fails.length && !warns.length) console.log(`${G}All checks passed.${D}`);
for (const w of warns) console.log(`${Y}WARN${D}  ${w}`);
for (const m of fails) console.log(`${R}FAIL${D}  ${m}`);
console.log(`\n${fails.length} fail, ${warns.length} warn.`);
if (fails.length) {
  console.log(`${R}Push blocked.${D} Fix FAILs (run the sentopi-qa skill to auto-fix mechanical ones), then retry. Emergency bypass: git push --no-verify`);
  process.exit(1);
}
process.exit(0);

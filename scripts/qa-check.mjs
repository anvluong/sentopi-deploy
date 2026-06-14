#!/usr/bin/env node
/*
 * Sentopi pre-push QA gate — fast, static, dependency-light, no network.
 * Run: node scripts/qa-check.mjs   (exit 1 on any FAIL; WARN never blocks)
 *
 * This is the AUTOMATED tier of the sentopi-qa skill. It catches the
 * deterministic regressions we keep hitting: compiled-asset drift, stale
 * lead-CTA copy, visible em-dashes, broken links, Netlify form mismatches,
 * and committed secrets. Behavioral/conversion checks live in the skill
 * (see skills/sentopi-qa/SKILL.md), not here.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

const html = tracked("'*.html'").filter((f) => !/google[0-9a-f]+\.html$/.test(f));
const jsx  = tracked("'src/*.jsx'");
const js   = tracked("'*.js'").filter((f) => !f.includes('node_modules'));
const allCode = [...html, ...jsx, ...js];

/* ── 1. Compiled rrr-app.js in sync with src/rrr-app.jsx ─────────────── */
(() => {
  if (!existsSync(join(ROOT, 'src/rrr-app.jsx')) || !existsSync(join(ROOT, 'rrr-app.js'))) return;
  let out;
  try {
    out = execSync('npx --no-install babel src/rrr-app.jsx --presets @babel/preset-react',
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    warn('Could not run babel to verify rrr-app.js is in sync (run `npm i`). Compile check skipped.');
    return;
  }
  const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
  if (norm(out) !== norm(read('rrr-app.js')))
    fail('rrr-app.js is OUT OF SYNC with src/rrr-app.jsx. Recompile: npx babel src/rrr-app.jsx --presets @babel/preset-react -o rrr-app.js');
})();

/* ── 2. JS syntax (parse-only) ───────────────────────────────────────── */
for (const f of js) {
  try { execSync(`node --check ${JSON.stringify(f)}`, { cwd: ROOT, stdio: 'ignore' }); }
  catch { fail(`JS syntax error in ${f} (node --check failed).`); }
}

/* ── 3. Stale lead-CTA copy ──────────────────────────────────────────── */
for (const f of allCode) {
  read(f).split('\n').forEach((ln, i) => {
    if (/Get My Free|Free 48hr Report|\b48hr Report\b/.test(ln))
      fail(`Stale lead CTA ${f}:${i + 1}: use "Get your free report" (drop "48hr").`);
  });
}

/* ── 4. Visible em-dashes in copy surfaces (comments stripped) ───────── */
// Scope: .html + src/*.jsx (where marketing copy lives). Comments are blanked
// in place (positions preserved) so multi-line /* */ and <!-- --> don't false-trip.
// Generated rrr-app.js and backend .js notes are out of scope (see SKILL Tier 3).
const blankComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
for (const f of [...html, ...jsx]) {
  blankComments(read(f)).split('\n').forEach((ln, i) => {
    if (ln.includes('—')) fail(`Em-dash in visible copy ${f}:${i + 1}: brand rule, use a colon, semicolon, or period.`);
  });
}

/* ── 5. AI-tells / placeholders (WARN) ───────────────────────────────── */
const tells = /\b(of course|in conclusion|it'?s worth noting|needless to say|rest assured)\b/i;
const placeholders = /\b(lorem ipsum|TODO|FIXME|PLACEHOLDER|TBD)\b/;
for (const f of html) {
  read(f).split('\n').forEach((ln, i) => {
    if (tells.test(ln)) warn(`Possible AI-tell ${f}:${i + 1}: "${ln.trim().slice(0, 70)}"`);
    if (placeholders.test(ln)) warn(`Placeholder/TODO text ${f}:${i + 1}.`);
  });
}

/* ── 6. Internal links + anchors resolve ─────────────────────────────── */
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

/* ── 7. Netlify form integrity ───────────────────────────────────────── */
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

/* ── 8. Meta hygiene (WARN) ──────────────────────────────────────────── */
for (const f of html) {
  const c = read(f);
  if (!/<meta[^>]+name=["']viewport["']/.test(c)) warn(`${f}: missing viewport meta.`);
  if (!/<title>[^<]+<\/title>/.test(c)) warn(`${f}: missing or empty <title>.`);
  const h1 = (c.match(/<h1\b/g) || []).length;
  if (h1 > 1) warn(`${f}: ${h1} <h1> tags (prefer one per page).`);
  if (!/GTM-[A-Z0-9]+/.test(c)) warn(`${f}: no GTM container found (analytics may be missing).`);
}

/* ── 9. Secret scan (tracked, non-binary) ────────────────────────────── */
const secretPat = /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']|AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]{10,}/i;
for (const f of tracked()) {
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|pdf)$/i.test(f) || f.includes('node_modules') || f.endsWith('qa-check.mjs')) continue;
  if (secretPat.test(read(f))) fail(`Possible secret committed in ${f}. Move it to an env var / gitignored .env.`);
}

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

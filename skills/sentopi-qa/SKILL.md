---
name: sentopi-qa
description: "Run the Sentopi site QA gate before pushing to main. Use this skill whenever you are about to push, commit for deploy, or ship changes to the Sentopi site (sentopi-deploy), or when the user says 'QA the site', 'ready to push', 'pre-push check', 'run QA', or 'check before deploy'. Verifies copy, routing/funnel, build integrity, Netlify forms, analytics, and (for risky changes) live behavior. Auto-fixes mechanical issues and surfaces judgment calls for review."
---

# Sentopi QA

Pre-push quality gate for the Sentopi site (`sentopi-deploy`). Complete this **before every push to `main`**. A git pre-push hook also runs the automated tier and blocks the push on failure, but this skill covers the parts a script can't: behavioral verification and funnel/strategy judgment.

Guiding principle for this site: **every page leads to a sign-up or the instant tool, the copy is on-brand, and the build that ships matches the source.**

---

## Tiered process

### Tier 1 — Fast static gate (ALWAYS run)

From the `sentopi-deploy` root:

```
node scripts/qa-check.mjs
```

It checks, and FAILs the push on:
- **Compiled drift:** `rrr-app.js` out of sync with `src/rrr-app.jsx` (the #1 footgun — never hand-edit the compiled file).
- **JS syntax** errors (`node --check`).
- **Stale lead CTAs:** any "Get My Free 48hr Report" / "48hr Report" → must read "Get your free report".
- **Visible em-dashes** in user-facing copy (comments are ignored). Brand rule: colon, semicolon, or period.
- **Broken internal links** (href → no file/redirect).
- **Netlify form mismatch:** a JS `form-name` that no registered `data-netlify` form declares (Netlify rejects it).
- **Committed secrets.**
- **Page contract:** missing canonical or meta description on any page; a JSON-LD block that does not `JSON.parse`; Article `dateModified` out of sync with the page's sitemap `lastmod`; a sitemap `<loc>` that resolves to nothing; any monthly price string other than $149.
- **Flywheel conformance:** any fixture sample without a flywheel payload; levers out of contract order; a `status` that disagrees with its score; an unmeasured lever with no stated reason; a `compositeScore`, `measuredCount` or `weakestKey` that does not recompute from its own levers; the generated landing block in `index.html` out of sync with `HERO_SAMPLES[0]`.

WARNs (surface, don't block): AI-tells, placeholder/TODO text, missing viewport/title/GTM, anchors not found, multiple `<h1>`, meta description length outside 70-165 chars, an indexable page missing from the sitemap, an article footer missing the canonical link set.

New-page conventions (chromes, head order, schema per page class, the 5-step wiring checklist) live in `PAGE-CONVENTIONS.md` next to this file; clone new article pages from `_template-article.html`.

### Tier 2 — Deep behavioral pass (run when risk is touched)

Trigger when the diff touches any of: `index.html`, `revenue-risk.html`, `src/rrr-app.jsx`, `rrr-app.js`, `netlify/functions/*`, or anything involving forms/widgets/analytics. `git diff --name-only origin/main` to decide.

1. Recompile if `src/rrr-app.jsx` changed: `npx babel src/rrr-app.jsx --presets @babel/preset-react -o rrr-app.js`.
2. Start the mocked dev server (free, no Keepa spend): `preview_start` with the `revenue-risk-mock` launch config (`netlify dev`, `KEEPA_MOCK=true`, port 4322).
3. Verify the funnel behaviors that matter:
   - **Homepage real lookup** (paste an ASIN): inline capture appears with the brand name, URL pre-filled, redundant scroll CTA hidden, `inline_capture_shown` fires.
   - **Homepage sample chip:** inline capture does NOT appear (not peak interest), scroll CTA stays.
   - **RRR real lookup:** `InlineClaim` renders at the result with the brand; demo/chip states do not show it.
   - **No console errors** (`preview_console_logs` level error).
4. Note the known-local limitation: Netlify Forms POSTs return **405 under `netlify dev`** (forms only run on the deployed site). This affects all forms equally — not a regression.

### Tier 3 — Funnel & copy judgment (human/agent review, not scripted)

Walk every page and confirm intent, not just syntax:
- **Every page leads somewhere we want.** No dead-ends. Nav + primary CTAs reach a sign-up or the instant tool. `success.html` should cross-sell the instant tool.
- **Instant-tool-first for cold traffic.** Ad/landing entry points lead with the tool, not a context-free email form. (Content pages like the research article may capture email for the deeper report, since that offer maps to the 48hr report, not the instant tool — that's intentional, confirm it still holds.)
- **Copy register:** painkiller framing, no AI-tells, "insight and action engine" not "analytics tool". Delivery time ("within 48 hours") stays honest at the form, even though lead CTAs drop "48hr".
- **Routing decisions in flight:** if the `#demo` anchor is being retired (see WBR next-steps), confirm CTAs were repointed, not just recopied.

---

## Auto-fix policy

**Auto-fix (mechanical, deterministic):** recompile `rrr-app.js`; stale-CTA copy; visible em-dashes; obvious broken-link typos. Re-run the gate after fixing.

**Surface for review (judgment / strategy):** CTA destination changes, funnel/routing decisions, conversion-copy rewrites, anything where the "right" answer is a product call. Report these; don't decide them unilaterally.

After a run, report: what passed, what was auto-fixed, and a short list of items needing the user's review.

---

## Scope notes

- **Conversion quality is separate.** The 15-criterion landing-page rubric in `../00_Product/QA-rubric.md` is a design-review tool for when you're iterating on a page, not part of the per-push gate. Don't run it here.
- Keep this skill current. An outdated checklist is worse than none — when a new failure mode bites (a new page, a new form, a new compiled asset), add a check to `scripts/qa-check.mjs` and a line here.

## Sources

Session-derived patterns (compiled-asset drift, instant-tool-first, Netlify form registration, inline-capture gating) plus web QA best practice: pre-launch/pre-deploy checklists (Semrush, Cheeeck, DEV Community), CRO/landing-page QA (Unbounce, Instapage, Landingi), automated accessibility/performance (Lighthouse CI, axe-core, Pa11y), and QA-process guidance (BrowserStack, Testlio, VirtuosoQA) on tiering automated gates vs. exploratory/judgment review.

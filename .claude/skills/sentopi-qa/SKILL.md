---
name: sentopi-qa
description: "The Sentopi site gate, for sentopi-deploy only. Four modes: `static` is the free deterministic qa-check.mjs pass the pre-push hook also runs, `behavioral` adds the mocked funnel pass, `visual` adds screenshots and the 45-point rubric, `full` adds the funnel and copy read. Use before pushing sentopi-deploy, or when Oliver says 'gate the Sentopi site', 'Sentopi pre-push check', or 'is Sentopi ready to push'. The single definition of this gate: sentopi-fix-cycle and ux-review call it by mode rather than restating it. Not GoutSafe, use goutsafe-qa."
---

# Sentopi QA

The single definition of the gate for `sentopi-deploy`. `sentopi-fix-cycle` and `ux-review` call this skill **by mode** rather than restating it, because until 2026-08-13 the check list existed in three places and two of them had drifted.

Guiding principle: **every page leads to a sign-up or the instant tool, the copy is on-brand, and the build that ships matches the source.**

| Mode | What runs | When |
|---|---|---|
| `static` | `node scripts/qa-check.mjs`. Deterministic, free, no browser. | Every caller, every time. The baseline before touching anything. Also what the pre-push hook runs. |
| `behavioral` | `static`, then the mocked funnel pass. | The diff touches `index.html`, `revenue-risk.html`, `calculator.html`, `sales-drop-diagnostic.html`, `src/*.jsx`, a compiled `*-app.js`, `netlify/functions/*`, or anything with a form, widget, or analytics. |
| `visual` | `behavioral`, then screenshots at both presets and the rubric score. | Any change with a rendered effect. |
| `full` | `visual`, then the funnel and copy judgment read. | Before recommending a merge to Oliver. |

**Never report "done" while a mode was skipped or partially run. Say which mode you ran.**

---

## Mode: `static`

```bash
node scripts/qa-check.mjs
```

Exit 1 on any FAIL. WARN never blocks.

### What it enforces

Do not transcribe a subset of this table anywhere else. That is exactly how the gate ended up with three versions. `scripts/qa-skill-drift.mjs` fails the run when this table and the `[gate:*]` tags in `qa-check.mjs` disagree **in either direction**, and it is itself registered on both sides.

<!-- gate:static-start -->

| Check | What it holds |
|---|---|
| `compiled-drift` | `rrr-app.js` and `calc-app.js` match their `src/*.jsx`. The number one footgun: never hand-edit a compiled file. |
| `js-syntax` | Every tracked `*.js` passes `node --check`. |
| `stale-cta` | No "Get My Free" or "48hr Report" copy survives. Remedy: `Get your free report`. |
| `em-dash` | No visible em-dash in `.html` or `src/*.jsx`, comments excluded. Remedy: `a spaced hyphen, a comma, or a period`. Never a semicolon, see `Voice/rules.md`. |
| `broken-link` | Every internal `href` resolves to a file or a `netlify.toml` redirect. |
| `netlify-form` | Every JS-posted `form-name` has a registered `<form data-netlify>`. Netlify rejects the rest. |
| `secrets` | No committed key, token, or password in a tracked non-binary file. |
| `canonical` | Every page has `<link rel="canonical">`. |
| `meta-description` | Every page has `<meta name="description">`. Length is advisory. |
| `jsonld-parse` | Every `application/ld+json` block passes `JSON.parse`. |
| `sitemap-loc` | Every sitemap `<loc>` resolves to a file or redirect. |
| `datemodified-lastmod` | An article's `dateModified` equals that page's sitemap `lastmod`. Move them together. |
| `price-drift` | The only monthly price on this site is $149. Remedy: `the canonical price is $149/mo`. |
| `skill-drift` | This table equals the `[gate:*]` tags in `qa-check.mjs`, both directions, and any pinned Remedy string appears verbatim in the code. |

<!-- gate:static-end -->

A row may pin its **Remedy** in backticks. That string must appear verbatim in `qa-check.mjs`, so the message the gate prints to a human cannot drift from the rule it enforces. This is not decoration. Until 2026-08-13 the em-dash failure told the fixer to use "a colon, semicolon, or period", which `Voice/rules.md:29` names as the exact construction that pushes output toward something Oliver has never written. An id-only comparison passes that happily, because the id was never wrong.

WARNs surface and do not block: AI-tells, placeholder and TODO text, missing viewport or title or GTM, anchors not found, multiple `<h1>`, meta description outside 70-165 chars, a page missing from the sitemap, an article footer missing the canonical link set.

### Failure policy

**Auto-fix, mechanical and deterministic:** recompile a drifted `*-app.js`, stale-CTA copy, visible em-dashes, obvious broken-link typos. Re-run the gate after fixing.

**Surface for review, judgment and strategy:** CTA destination changes, funnel and routing decisions, conversion-copy rewrites, anything where the right answer is a product call. Report these. Do not decide them alone.

---

## Mode: `behavioral`

Recompile first if a `src/*.jsx` changed:

```bash
npx babel src/rrr-app.jsx --presets @babel/preset-react -o rrr-app.js
```

Start the mocked dev server, which costs no Keepa spend: `preview_start` the **`revenue-risk-mock`** config. It lives in `Ventures/Sentopi/.claude/launch.json`, runs `netlify dev` with `KEEPA_MOCK=true` on port 4322, and `netlify-cli` is available through `npx`, so it starts headless.

**Do not conclude this mode is unavailable without actually attempting `preview_start "revenue-risk-mock"`.** The recurring mistake is reading `sentopi-deploy/.claude/launch.json`, which holds only `sentopi-static` on port 4488, and concluding the mock does not exist. Run `preview_list` first and reuse the server if it is already up.

Verify the funnel behaviors that matter:

- **Homepage real lookup**, pasting a real ASIN: inline capture appears with the brand name, the URL pre-filled, the redundant scroll CTA hidden, and `inline_capture_shown` fires.
- **Homepage sample chip:** inline capture does **not** appear, because a sample is not peak interest. The scroll CTA stays.
- **Revenue Risk real lookup:** `InlineClaim` renders at the result with the brand. Demo and chip states do not show it.
- **Zero console errors**, read at `error` level.

**Known local limitation, not a regression:** Netlify Forms POSTs return 405 under `netlify dev`. Forms only run on the deployed site, and this affects every form equally.

---

## Mode: `visual`

Screenshot every touched page at desktop and mobile, then score it against `../../../../Product/QA-rubric.md` (15 criteria, max 45). **Pass is >= 38/45 on any touched page, and zero visual regressions against the prior state.**

Look for layout shift or overlap, broken or empty sections, clipped text, invisible or duplicated CTAs, and anything that reads machine-generated.

**The mechanics, all learned the hard way and all still true.** These cost about eight wasted calls on 2026-06-24 before they were written down:

- **Preset viewports only.** Use the `desktop` and `mobile` presets. A custom width or height desyncs the capture viewport from the eval viewport and yields blank cream screenshots. To check a specific width, screenshot at the preset and confirm dimensions in JS, never by custom-resizing.
- **Force-reveal before shooting.** Sentopi fades content in with `.reveal` at `opacity:0` until an IntersectionObserver fires, and an instant programmatic scroll skips the observer, so a below-fold section screenshots blank. Run `document.querySelectorAll('.reveal').forEach(e=>e.classList.add('visible'))` first. That renders what a real scrolling user would see.
- **Scroll atomically.** Scroll with `behavior:'instant'` and read `getBoundingClientRect().top` in the **same** eval as the `scrollTo`. The page sets `scroll-behavior:smooth`, so a separate readback lands mid-animation and reports the wrong position.
- **Confirm independently of the screenshot.** Check `el.classList.contains('visible')`, a non-zero `getBoundingClientRect().height`, and `document.documentElement.scrollWidth <= window.innerWidth + 1` for horizontal overflow. Do **not** read computed `opacity` right after adding `.visible`: the reveal has an opacity transition and you will catch it mid-flight near 0.

If a touched page drops below 38/45 or shows a visual regression, the change does not ship.

---

## Mode: `full`

Agent judgment, not scripted. Walk every page and confirm intent, not syntax.

- **Every page leads somewhere we want.** No dead ends. Nav and primary CTAs reach a sign-up or an instant tool. `success.html` cross-sells the instant tool.
- **Instant-tool-first for cold traffic.** Ad and landing entry points lead with a tool, not a context-free email form. Content pages may capture email for the deeper report, because that offer maps to the 48hr report rather than the instant tool. That is intentional. Confirm it still holds.
- **Copy register:** painkiller framing, no AI-tells, "insight and action engine" and not "analytics tool". Delivery time stays honest at the form ("within 48 hours") even though lead CTAs drop "48hr".
- **Routing decisions in flight:** when an anchor is being retired, confirm the CTAs actually moved to the new destination. Recopied text with an old href is the failure here.

---

## Report

Say which mode ran. Then what **passed**, what was **auto-fixed** and re-verified, and what **needs Oliver's review**. Name any check that was skipped and why. A verdict with no evidence is an opinion.

## Keep this current

When a new failure mode bites, add the check where it belongs, which is almost never this file.

- **A new deterministic check** goes in `scripts/qa-check.mjs` with a `[gate:<id>]` tag on its block, **and** a row in the fenced table above. `skill-drift` fails the run until both exist.
- **A new page** follows `PAGE-CONVENTIONS.md` next to this file: chromes, head order, schema per page class, and the five-step wiring checklist. Clone article pages from `_template-article.html`.
- **Only a new mechanic or a new lesson** belongs in this file.

**Where the guard reaches.** `scripts/qa-skill-drift.mjs` runs inside `qa-check.mjs`, so the pre-push hook catches it on every ref, and `.github/workflows/skills.yml` catches it on push for skill-only commits that the hook would miss on a machine without `core.hooksPath` set. GitHub evaluates workflow `paths` per push and not per commit, so a mixed push runs the workflow regardless. Do not claim the workflow proves isolation.

## Scope notes

- **Conversion quality is separate.** The 15-criterion rubric at `../../../../Product/QA-rubric.md` is scored in mode `visual` when a page is touched. It is a design-review tool, not a per-push gate. Do not run it in `static`.
- This gate covers `sentopi-deploy` only. The review pipeline in `reviews_saas/` has no gate.

## Sources

Session-derived patterns (compiled-asset drift, instant-tool-first, Netlify form registration, inline-capture gating, the reveal and viewport mechanics) plus web QA best practice: pre-launch and pre-deploy checklists (Semrush, Cheeeck, DEV Community), CRO and landing-page QA (Unbounce, Instapage, Landingi), automated accessibility and performance (Lighthouse CI, axe-core, Pa11y), and QA-process guidance (BrowserStack, Testlio, VirtuosoQA) on tiering automated gates against exploratory review.

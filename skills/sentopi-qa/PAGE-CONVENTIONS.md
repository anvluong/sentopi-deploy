# Sentopi Page Conventions

The site has no framework. These conventions plus the qa-check page-contract assertions are what keep 15+ single-file pages from drifting. Every new page follows this document; `scripts/qa-check.mjs` enforces the mechanical parts.

## The two page chromes

**App chrome** (index.html, revenue-risk.html, success.html): sticky `.nav` with `.nav-links` + `.nav-cta`, dark `.footer`/`.footer-inner`. Used for product surfaces.

**Article chrome** (growth-loop, why-are-my-amazon-sales-down, listing-accuracy, guides, all new content pages): `<header class="art-top">` (brand link + "All guides" + one CTA to `/revenue-risk-report`), `<article class="gl-wrap">`, `<footer class="art-foot">` with the canonical link nav (Home / Revenue Risk Report / Guides / Research / Growth Loop / Sales Drop Diagnostic / Privacy / Contact). All new diagnostic and benchmark pages use this chrome. Clone from `_template-article.html` (which mirrors `why-are-my-amazon-sales-down.html`, the canonical exemplar).

## Head block order (identical on every page)

1. charset, viewport
2. GTM snippet (`GTM-MLF5DHCH`)
3. `<title>` : question + verdict + `| Sentopi`, under 60 chars where possible
4. `<meta name="description">` : 70 to 165 chars; answer the question, withhold the monetizable specifics behind the click
5. `<link rel="canonical">` : clean URL (`https://sentopi.com/<slug>`, no `.html`)
6. OG + Twitter tags (og:url matches canonical; og-image.png)
7. JSON-LD blocks (see below)
8. Inline `<style>`

## JSON-LD requirements by page class

- **Diagnostic / article pages:** `Article` (with `datePublished`, `dateModified`, `image`, `author` Person, `publisher`, `mainEntityOfPage`, `citation` array mirroring the visible Sources section) + `FAQPage` (answers must match visible FAQ text exactly) + `BreadcrumbList`. Add `HowTo` only when the page is genuinely stepwise.
- **Benchmark / research pages:** all of the above plus a `Dataset` block: `variableMeasured` PropertyValues carrying the published numbers with sample sizes, `creator`, `citation`, and the page's one-sentence verdict as `description`. The point is being citable by AI answer engines with provenance attached.
- **Tool pages:** `WebApplication` + `FAQPage` + `BreadcrumbList` + `Offer` (price 0).
- **Freshness rule:** Article `dateModified` must equal the page's `<lastmod>` in sitemap.xml. qa-check FAILs on mismatch. Update both together, only when content genuinely changes.

## The 5-step new-page checklist

1. Create `<slug>.html` from `_template-article.html`; replace every `PLACEHOLDER_*`.
2. Add the clean-URL rewrite in `netlify.toml` (status 200, like `/revenue-risk-report`).
3. Add the sitemap.xml entry (`lastmod` = today, priority 0.7 content / 0.8 tools).
4. Add a card on `guides.html`.
5. Add at least 2 question-phrased internal links from related pages (diagnostics link to their Flywheel lever on the homepage and to sibling pages).

Then: `node scripts/qa-check.mjs` and update `llms.txt` if the page belongs in Core pages.

## Copy rules (enforced or checked by qa-check)

- No em-dashes anywhere. Colon, semicolon, or period.
- Verdict-first titles: answer the yes/no the SERP can lift; gate the specific numbers behind the click.
- Painkiller framing; "insight and action engine", never "analytics tool".
- Monthly price is $149 everywhere it appears. qa-check FAILs on any other monthly price string.
- Every claim traces to a named source or our own dataset; sources render visibly and in schema `citation`.
- No "not this, but that" contrast constructions.

## The Retail Flywheel: one source, one renderer

The flywheel scorecard appears on the homepage widget and on `/revenue-risk-report`, and its data comes from the Keepa functions, two fixture files, and a generated block in `index.html`. It is easy for those to drift apart, and they did: the homepage sample chips kept rendering the pre-flywheel card for a full session because each surface carried its own copy of the contract. The structure below exists to make that impossible rather than to make it unlikely.

- **`flywheel-core.js`** owns the contract: lever order, weights, status thresholds, and how a composite is derived. Nothing else defines them. It loads in Node and the browser.
- **`flywheel-view.js`** is the only renderer. `index.html` calls it directly; `src/rrr-app.jsx` wraps it in a component via `dangerouslySetInnerHTML` (the module escapes every value). Never write a second renderer: a behavioural fix must land on both surfaces at once.
- **Fixtures declare levers, never summaries.** `demo-fixtures.js` and `priority-templates.js` wrap their lever arrays in `FW(...)`, which calls `flywheel-core.finalize()`. Composite, `measuredCount`, `weakestKey` and each lever's `status` are computed there, so a stated summary cannot disagree with the levers under it.
- **The landing card is generated.** The block between the `GENERATED:LANDING` markers in `index.html` comes from `node scripts/gen-landing.mjs`, rendered from `HERO_SAMPLES[0]`. Never hand-edit it; regenerate. The gate fails if it drifts.
- **A lever with no data is `unmeasured`, with a reason.** Never a zero, never a neutral placeholder. The gate rejects an unmeasured lever that gives no `dataNote`.

The QA gate validates every fixture against the contract and fails when a sample has no flywheel at all. Adding a new sample surface means adding it to that check; a sample nothing validates is a sample that will silently render the wrong card.

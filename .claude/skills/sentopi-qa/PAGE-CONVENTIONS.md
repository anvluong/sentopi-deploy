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

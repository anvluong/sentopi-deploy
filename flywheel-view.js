/**
 * Sentopi — Retail Flywheel renderer
 *
 * The ONE renderer for the flywheel scorecard. Both surfaces use it:
 *   index.html        vanilla, injected into the hero widget
 *   src/rrr-app.jsx   React, via dangerouslySetInnerHTML
 *
 * It previously existed twice, once per surface, which meant a behavioural fix
 * had to be made in two languages and could silently land in only one. Status
 * vocabulary and thresholds come from flywheel-core.js so this file never
 * decides what "strong" means.
 *
 * Every interpolated value is escaped here, so the output is safe to inject.
 * Spec: .claude/skills/sentopi-qa/FLYWHEEL-CONTRACT.md
 */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports)
    ? require('./flywheel-core.js')
    : root.FlywheelCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FlywheelView = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const SCORE_WORD = { strong: 'Healthy', watch: 'At risk', leaking: 'Leaking' };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const isUnmeasured = (l) => l.status === 'unmeasured' || l.score === null || l.score === undefined;

  /* The alarm fires only when the weakest lever is genuinely watch or leaking.
     Flagging a "weakest lever" on a healthy brand trains the reader to ignore
     the callout on the day it matters. */
  const isAlarming = (l) => l.status === 'watch' || l.status === 'leaking';

  function head(fw, riskAnnual) {
    const c = fw.compositeScore;
    const status = (c === null || c === undefined) ? null : core.statusFor(c);
    const score = status
      ? '<span class="fw-head-score">' + Math.round(c) + '<span class="fw-out">/100</span></span>' +
        '<span class="fw-chip ' + status + '">' + SCORE_WORD[status] + '</span>'
      : '<span class="fw-chip unmeasured">Not enough data to score</span>';

    const risk = (riskAnnual !== null && riskAnnual !== undefined && riskAnnual > 0)
      ? '<div class="fw-head-risk">' +
          '<div class="fw-head-risk-label">Revenue at risk</div>' +
          '<div class="fw-head-risk-val">$' + Number(riskAnnual).toLocaleString() + '<span class="fw-out">/yr</span></div>' +
        '</div>'
      : '';

    return '<div class="fw-head"><div class="fw-head-left">' +
      '<span class="fw-head-label">Flywheel</span>' + score +
    '</div>' + risk + '</div>';
  }

  function tile(l, weakestKey) {
    const un = isUnmeasured(l);
    const cls = ['fw-tile'];
    if (un) cls.push('is-unmeasured');
    else if (l.key === weakestKey && isAlarming(l)) cls.push('is-weak');

    const score = un
      ? '<div class="fw-score unmeasured">&ndash;&ndash;</div>'
      : '<div class="fw-score ' + l.status + '">' + Math.round(l.score) + '</div>';

    const m = l.metric || {};
    /* An unmeasured tile shows a short label only. The full reason goes to the
       confidence line so one verbose note cannot stretch the whole grid row. */
    const body = un
      ? '<div class="fw-note">Not measured</div>'
      : '<div class="fw-metric">' + esc(m.value) + '</div>' +
        (m.delta ? '<div class="fw-delta ' + esc(m.deltaDir || 'flat') + '">' + esc(m.delta) + '</div>' : '') +
        (m.label ? '<div class="fw-note">' + esc(m.label) + '</div>' : '');

    return '<div class="' + cls.join(' ') + '">' +
      '<div class="fw-lever">' + esc(l.label || l.key) + '</div>' + score + body +
    '</div>';
  }

  function weakBlock(fw) {
    const weak = fw.levers.find((l) => l.key === fw.weakestKey && isAlarming(l));
    if (!weak) return '';
    return '<div class="fw-weak">' +
      '<span class="fw-weak-mark">&#9888;</span>' +
      '<div><div class="fw-weak-title">Weakest lever: ' + esc(weak.label) + '</div>' +
      '<div class="fw-weak-read">' + esc(weak.read || weak.headline || '') + '</div></div>' +
    '</div>';
  }

  /* Ratings is the lever this product is actually built on, and until 2026-08-13
     the grid rendered it as one tile of five with nothing to say it goes deeper.
     Every competitor scoring a listing covers more listing surface than we do.
     The only thing none of them does is read the reviews and say which lever the
     customers are describing, so that has to be visible on the instrument. */
  function deepBlock(fw) {
    const r = fw.levers.find((l) => l.key === 'ratings');
    if (!r || isUnmeasured(r)) return '';
    return '<div class="fw-deep">' +
      '<div class="fw-deep-title">Ratings is the deepest lever</div>' +
      '<div class="fw-deep-read">The score above is the rating trend on its own. ' +
      'The full report reads every written review on this listing and maps each ' +
      'complaint to a root cause, so you see which of the other levers your ' +
      'customers are actually describing.</div>' +
    '</div>';
  }

  /* A lever that cannot be scored on this surface leaves the grid rather than
     sitting in it as a blank cell. Assortment needs the whole variation family
     and a single-ASIN lookup fetches one listing, so it was permanently blank on
     every sample and every real lookup. One blank cell reads as restraint, a
     permanently blank one reads as broken. Naming it is honest, showing an empty
     tile is not. */
  function notScoredBlock(unmeasured) {
    if (!unmeasured.length) return '';
    const names = unmeasured.map((l) => l.label || l.key);
    const verb = names.length > 1 ? ' are not scored here. ' : ' is not scored here. ';
    const why = unmeasured.map((l) => l.dataNote).filter(Boolean).join(' ');
    return '<div class="fw-notscored">' + esc(names.join(' and ') + verb + why) + '</div>';
  }

  /* Surface every caveat the scorer attached rather than burying it. A score
     shown without the strength of the evidence behind it is the thing this
     product exists to stop. Unmeasured levers are handled by notScoredBlock, so
     this covers only the levers that did score but carry a proxy or short window. */
  function confBlock(fw) {
    const caveats = fw.levers.filter((l) => l.dataNote && !isUnmeasured(l))
      .map((l) => l.label + ': ' + l.dataNote);
    return caveats.length ? '<div class="fw-conf">' + esc(caveats.join(' ')) + '</div>' : '';
  }

  /** Returns '' when there is no payload, so a caller can fall back cleanly. */
  function render(fw, riskAnnual) {
    if (!fw || !Array.isArray(fw.levers) || !fw.levers.length) return '';
    const unmeasured = fw.levers.filter(isUnmeasured);
    const measured = fw.levers.filter((l) => !isUnmeasured(l));
    /* Never render an empty grid: if nothing scored, show what we have and let
       notScoredBlock carry the explanation. */
    const grid = measured.length ? measured : fw.levers;
    return '<div class="fw">' +
      head(fw, riskAnnual) +
      '<div class="fw-grid fw-grid-' + grid.length + '">' +
        grid.map((l) => tile(l, fw.weakestKey)).join('') + '</div>' +
      weakBlock(fw) + deepBlock(fw) +
      (measured.length ? notScoredBlock(unmeasured) : '') + confBlock(fw) +
    '</div>';
  }

  return { render, escapeHtml: esc };
});

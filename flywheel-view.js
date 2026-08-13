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

  /* Surface every caveat the scorer attached rather than burying it. A score
     shown without the strength of the evidence behind it is the thing this
     product exists to stop. */
  function confBlock(fw) {
    const unmeasured = fw.levers.filter((l) => isUnmeasured(l))
      .map((l) => l.label + (l.dataNote ? ': ' + l.dataNote : '.'));
    const caveats = fw.levers.filter((l) => l.dataNote && !isUnmeasured(l))
      .map((l) => l.label + ': ' + l.dataNote);
    const bits = [];
    if (unmeasured.length) bits.push('Not measured from public data. ' + unmeasured.join(' '));
    if (caveats.length) bits.push(caveats.join(' '));
    return bits.length ? '<div class="fw-conf">' + esc(bits.join(' ')) + '</div>' : '';
  }

  /** Returns '' when there is no payload, so a caller can fall back cleanly. */
  function render(fw, riskAnnual) {
    if (!fw || !Array.isArray(fw.levers) || !fw.levers.length) return '';
    return '<div class="fw">' +
      head(fw, riskAnnual) +
      '<div class="fw-grid">' + fw.levers.map((l) => tile(l, fw.weakestKey)).join('') + '</div>' +
      weakBlock(fw) + confBlock(fw) +
    '</div>';
  }

  return { render, escapeHtml: esc };
});

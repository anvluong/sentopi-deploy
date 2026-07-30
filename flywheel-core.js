/**
 * Sentopi — Retail Flywheel core
 *
 * The ONE definition of the flywheel contract: lever order, weights, status
 * thresholds, and how a composite is derived. Everything that touches flywheel
 * data imports this file:
 *
 *   netlify/functions/_flywheel.js   the real Keepa scorer
 *   flywheel-view.js                 the one renderer
 *   demo-fixtures.js                 Revenue Risk Report samples
 *   priority-templates.js            homepage hero samples
 *   scripts/qa-check.mjs             the conformance gate
 *
 * The contract used to be re-implemented in five places and hand-stated in
 * three fixture sets, which is how the homepage sample chips silently kept
 * rendering the pre-flywheel card. Fixtures now DECLARE levers and this module
 * DERIVES compositeScore / measuredCount / weakestKey, so a stated value can no
 * longer disagree with the levers it claims to summarise.
 *
 * Loads in both Node (require) and the browser (window.FlywheelCore).
 * Spec: skills/sentopi-qa/FLYWHEEL-CONTRACT.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FlywheelCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Render order. Never reordered: the UI and the gate both rely on it.
  const LEVER_ORDER = ['operations', 'pricing', 'assortment', 'visibility', 'ratings'];

  const LEVER_WEIGHTS = { operations: 22, pricing: 22, assortment: 14, visibility: 20, ratings: 22 };

  const LEVER_LABELS = {
    operations: 'Operations', pricing: 'Pricing', assortment: 'Assortment',
    visibility: 'Visibility', ratings: 'Ratings',
  };

  // A composite over one or two levers is not a brand score, so we show the
  // levers without a headline number rather than a confident meaningless one.
  const MIN_MEASURED_FOR_COMPOSITE = 3;

  const STRONG_AT = 75;
  const WATCH_AT = 50;

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function statusFor(score) {
    if (!isNum(score)) return 'unmeasured';
    if (score >= STRONG_AT) return 'strong';
    if (score >= WATCH_AT) return 'watch';
    return 'leaking';
  }

  const measured = (levers) => (levers || []).filter((l) => l && isNum(l.score));

  /** Weighted mean over measured levers only, rescaled to 100. */
  function compositeOf(levers) {
    const m = measured(levers);
    if (m.length < MIN_MEASURED_FOR_COMPOSITE) return null;
    const wsum = m.reduce((a, l) => a + (LEVER_WEIGHTS[l.key] || 0), 0);
    if (!wsum) return null;
    const total = m.reduce((a, l) => a + l.score * (LEVER_WEIGHTS[l.key] || 0), 0);
    return Math.round((total / wsum) * 10) / 10;
  }

  /** Lowest-scoring measured lever, or null when nothing is measured. */
  function weakestOf(levers) {
    const m = measured(levers);
    if (!m.length) return null;
    return m.reduce((a, b) => (b.score < a.score ? b : a)).key;
  }

  /**
   * Take declared levers and return a complete, self-consistent payload.
   * Status is recomputed from the score so a fixture cannot label a 75 as
   * "watch", and the composite/weakest are derived rather than asserted.
   */
  function finalize(levers) {
    const byKey = {};
    (levers || []).forEach((l) => { if (l && l.key) byKey[l.key] = l; });

    const ordered = LEVER_ORDER.map((key) => {
      const l = byKey[key] || {};
      const score = isNum(l.score) ? l.score : null;
      return Object.assign({}, l, {
        key,
        label: l.label || LEVER_LABELS[key],
        score,
        status: statusFor(score),
        metric: l.metric || {},
        read: l.read || '',
        confidence: l.confidence || (score === null ? 'low' : 'high'),
        dataNote: l.dataNote === undefined ? null : l.dataNote,
        detail: l.detail || [],
      });
    });

    return {
      compositeScore: compositeOf(ordered),
      measuredCount: measured(ordered).length,
      weakestKey: weakestOf(ordered),
      levers: ordered,
    };
  }

  /**
   * Structural check used by the QA gate. Returns an array of human-readable
   * problems; empty means the payload conforms to the contract.
   */
  function validate(fw, context) {
    const where = context ? context + ': ' : '';
    const errs = [];
    if (!fw || typeof fw !== 'object') return [where + 'no flywheel payload'];
    if (!Array.isArray(fw.levers)) return [where + 'flywheel.levers is not an array'];

    const keys = fw.levers.map((l) => l && l.key);
    if (keys.join(',') !== LEVER_ORDER.join(',')) {
      errs.push(where + 'levers must be exactly [' + LEVER_ORDER.join(', ') + '], got [' + keys.join(', ') + ']');
    }

    fw.levers.forEach((l) => {
      if (!l) return;
      const expected = statusFor(isNum(l.score) ? l.score : null);
      if (l.status !== expected) {
        errs.push(where + l.key + ' status "' + l.status + '" does not match score ' + l.score + ' (expected "' + expected + '")');
      }
      if (l.status === 'unmeasured' && l.score !== null && l.score !== undefined) {
        errs.push(where + l.key + ' is unmeasured but carries a score');
      }
      if (l.status === 'unmeasured' && !l.dataNote) {
        errs.push(where + l.key + ' is unmeasured but gives no reason (dataNote)');
      }
      if (isNum(l.score) && (l.score < 0 || l.score > 100)) {
        errs.push(where + l.key + ' score ' + l.score + ' is outside 0-100');
      }
    });

    const expComposite = compositeOf(fw.levers);
    const gotComposite = isNum(fw.compositeScore) ? fw.compositeScore : null;
    if (expComposite === null && gotComposite !== null) {
      errs.push(where + 'compositeScore is stated but fewer than ' + MIN_MEASURED_FOR_COMPOSITE + ' levers are measured');
    } else if (expComposite !== null && (gotComposite === null || Math.abs(expComposite - gotComposite) > 0.15)) {
      errs.push(where + 'compositeScore ' + fw.compositeScore + ' does not recompute from its levers (expected ' + expComposite + ')');
    }

    const expWeakest = weakestOf(fw.levers);
    if ((fw.weakestKey || null) !== expWeakest) {
      errs.push(where + 'weakestKey "' + fw.weakestKey + '" is not the lowest measured lever (expected "' + expWeakest + '")');
    }

    const expCount = measured(fw.levers).length;
    if (fw.measuredCount !== expCount) {
      errs.push(where + 'measuredCount ' + fw.measuredCount + ' does not match the ' + expCount + ' levers carrying scores');
    }

    return errs;
  }

  return {
    LEVER_ORDER, LEVER_WEIGHTS, LEVER_LABELS,
    MIN_MEASURED_FOR_COMPOSITE, STRONG_AT, WATCH_AT,
    statusFor, compositeOf, weakestOf, finalize, validate,
  };
});

const {
  useState,
  useCallback
} = React;

// ─── Conversion rate model — identical to calculator.html ─────────────────────
const CONV_TABLE = [{
  r: 1.0,
  i: 0.40
}, {
  r: 2.0,
  i: 0.55
}, {
  r: 2.5,
  i: 0.65
}, {
  r: 3.0,
  i: 0.75
}, {
  r: 3.5,
  i: 0.85
}, {
  r: 4.0,
  i: 0.92
}, {
  r: 4.2,
  i: 0.96
}, {
  r: 4.5,
  i: 1.00
}, {
  r: 4.7,
  i: 0.99
}, {
  r: 5.0,
  i: 0.87
}];
function convRate(rating) {
  if (!rating || rating <= CONV_TABLE[0].r) return CONV_TABLE[0].i;
  if (rating >= CONV_TABLE[CONV_TABLE.length - 1].r) return CONV_TABLE[CONV_TABLE.length - 1].i;
  for (let j = 0; j < CONV_TABLE.length - 1; j++) {
    const lo = CONV_TABLE[j],
      hi = CONV_TABLE[j + 1];
    if (rating >= lo.r && rating <= hi.r) {
      const t = (rating - lo.r) / (hi.r - lo.r);
      return lo.i + t * (hi.i - lo.i);
    }
  }
  return 0.92;
}
function calcRevenueAtRisk(units, price, ratingBefore, ratingNow) {
  if (!units || !price || !ratingBefore || !ratingNow) return 0;
  const delta = convRate(ratingBefore) - convRate(ratingNow);
  return Math.max(0, Math.round(units * price * delta));
}

// Lost revenue from chronically under-peak rating (vs. 4.5★ conversion peak).
// Captures the "stuck at 3.8★ for a year" case the 30d-drop logic misses.
function calcChronicGap(units, price, currentRating) {
  if (!units || !price || !currentRating || currentRating >= 4.5) return 0;
  const delta = convRate(4.5) - convRate(currentRating);
  return Math.max(0, Math.round(units * price * delta));
}

// Lost revenue from not holding the Buy Box. Conservative: assume 40% of BB-loss
// windows result in a competing seller capturing the sale (the rest goes to brand-loyal
// buyers, off-Amazon purchase, or no purchase). Units here are Keepa's ASIN-level
// monthlySold estimate, which represents total demand across all sellers on the ASIN.
function calcBBLoss(units, price, bbPct) {
  // Threshold at 90% — below this LBB is materially meaningful; above is noise from
  // brief stockouts or pricing micro-events.
  if (!units || !price || bbPct === null || bbPct === undefined || bbPct >= 90) return 0;
  const lossShare = (100 - bbPct) / 100;
  return Math.max(0, Math.round(units * price * lossShare * 0.4));
}

// Reviews needed to move from a → b given current review count.
// Solves: (a*N + 5*X) / (N+X) = b   →   X = N*(b-a)/(5-b)
function reviewsNeeded(currentRating, currentCount, targetRating) {
  if (!currentRating || !currentCount || !targetRating || targetRating <= currentRating || targetRating >= 5) return null;
  return Math.ceil(currentCount * (targetRating - currentRating) / (5 - targetRating));
}

// Smart truncation that breaks at a word boundary and adds an ellipsis.
// Prevents the "Latest Relea" stub look when slicing mid-word inside a quoted string.
function truncTitle(s, max = 45) {
  if (!s) return '';
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const clean = (lastSpace > max * 0.55 ? slice.slice(0, lastSpace) : slice).replace(/[,;:\s(]+$/, '');
  return clean + '…';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (!n && n !== 0) return '-';
  return '$' + Math.round(n).toLocaleString();
}
function fmtPct(n) {
  if (n === null || n === undefined) return '-';
  return n.toFixed(1) + '%';
}
function fmtDelta(d, inverse = false) {
  if (d === null || d === undefined) return null;
  const bad = inverse ? d < 0 : d > 0;
  const cls = Math.abs(d) < 0.01 ? 'delta-flat' : bad ? 'delta-up' : 'delta-down';
  const sign = d > 0 ? '+' : '';
  return {
    cls,
    text: sign + d
  };
}
function pillarHealth(score, max) {
  const p = score / max;
  if (p >= 0.75) return 'healthy';
  if (p >= 0.45) return 'warning';
  return 'danger';
}
function labelClass(l) {
  return l === 'Healthy' ? 'healthy' : l === 'At Risk' ? 'at-risk' : 'critical';
}
function labelColor(l) {
  return l === 'Healthy' ? '#059669' : l === 'At Risk' ? '#d97706' : '#dc2626';
}
function scoreChip(c) {
  return c >= 75 ? 'good' : c >= 45 ? 'mid' : 'bad';
}
const CAP_REASON_COPY = {
  'Lost Buy Box on one or more products': {
    icon: '🚨',
    text: 'Buy Box lost on key products'
  },
  'Rating dropped in the last 30 days': {
    icon: '⚠️',
    text: 'Active rating drop'
  },
  'Competitor undercutting detected': {
    icon: '⬇️',
    text: 'Competitor undercutting you'
  }
};
function monthName(dateStr) {
  if (!dateStr) return 'recent';
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleString('en-US', {
      month: 'long'
    });
  } catch {
    return 'recent';
  }
}

// ─── Rating sparkline (90d ago → 30d ago → now) ──────────────────────────────
function RatingSparkline({
  r90,
  r30,
  rNow
}) {
  const pts = [r90, r30, rNow].filter(v => v != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts, 3.5);
  const hi = Math.max(...pts, 4.7);
  const span = Math.max(0.4, hi - lo);
  const w = 56,
    h = 18,
    pad = 2;
  const xs = pts.map((_, i) => pad + i * (w - 2 * pad) / (pts.length - 1));
  const ys = pts.map(v => h - pad - (v - lo) / span * (h - 2 * pad));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const dropped = pts[pts.length - 1] < pts[0];
  const color = dropped ? '#dc2626' : '#059669';
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    style: {
      display: 'block',
      marginTop: 3
    },
    "aria-label": "rating trend"
  }, /*#__PURE__*/React.createElement("path", {
    d: d,
    fill: "none",
    stroke: color,
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), xs.map((x, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: x,
    cy: ys[i],
    r: i === xs.length - 1 ? 1.8 : 1.2,
    fill: color
  })));
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({
  score,
  label
}) {
  const r = 42,
    cx = 50,
    cy = 50,
    circ = 2 * Math.PI * r;
  const offset = circ - score / 100 * circ;
  return /*#__PURE__*/React.createElement("div", {
    className: "score-ring"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 100 100"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: r,
    fill: "none",
    stroke: "#e5d9c8",
    strokeWidth: "7"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: r,
    fill: "none",
    stroke: labelColor(label),
    strokeWidth: "7",
    strokeDasharray: circ,
    strokeDashoffset: offset,
    strokeLinecap: "round",
    style: {
      transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "score-ring-text"
  }, /*#__PURE__*/React.createElement("span", {
    className: "score-number"
  }, score), /*#__PURE__*/React.createElement("span", {
    className: "score-denom"
  }, "/100")));
}

// ─── Tooltip (portal-based to escape table overflow clipping) ────────────────
function Tip({
  text
}) {
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  function show() {
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: r.left + r.width / 2,
      y: r.top
    });
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    ref: ref,
    className: "col-tip-icon",
    onMouseEnter: show,
    onMouseLeave: () => setPos(null)
  }, "i"), pos && ReactDOM.createPortal(/*#__PURE__*/React.createElement("span", {
    style: {
      position: 'fixed',
      left: pos.x,
      top: pos.y - 8,
      transform: 'translate(-50%, -100%)',
      background: '#1a1714',
      color: '#fff',
      fontSize: '0.72rem',
      lineHeight: 1.5,
      padding: '7px 10px',
      borderRadius: '4px',
      width: '220px',
      zIndex: 9999,
      pointerEvents: 'none',
      fontWeight: 400,
      textAlign: 'left',
      whiteSpace: 'normal',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)'
    }
  }, text), document.body));
}

// ─── Revenue Deep Dive table ──────────────────────────────────────────────────
function RevenueDeepDive({
  productRevs,
  fields,
  onUpdate,
  totalMonthly,
  totalAnnual,
  noWrapper = false
}) {
  const sorted = [...productRevs].sort((a, b) => (b.computedRisk || 0) - (a.computedRisk || 0));

  // Compute per-row recovery and total
  let totalRecovery = 0;
  const rows = sorted.map(pr => {
    const f = fields[pr.asin] || {};
    const units = parseFloat(f.units) || 0;
    const price = parseFloat(f.price) || 0;
    const targetRating = parseFloat(f.targetRating) || 0;
    const currentRating = pr.pillar_rating.current || 0;
    const recoveryAmt = targetRating > currentRating && units > 0 && price > 0 ? Math.max(0, Math.round(units * price * (convRate(targetRating) - convRate(currentRating)))) : 0;
    totalRecovery += recoveryAmt;
    return {
      ...pr,
      recoveryAmt
    };
  });
  const tableContent = /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "products-table"
  }, /*#__PURE__*/React.createElement(SharedColGroup, null), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Product"), /*#__PURE__*/React.createElement("th", null, "Rating"), /*#__PURE__*/React.createElement("th", null, "Monthly Units"), /*#__PURE__*/React.createElement("th", null, "Price (USD)"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'normal',
      lineHeight: 1.35,
      textAlign: 'right'
    }
  }, "Monthly", /*#__PURE__*/React.createElement("br", null), "Risk"), /*#__PURE__*/React.createElement(Tip, {
    text: "Revenue you're leaving on the table vs. your star rating from 30 days ago."
  }))), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'normal',
      lineHeight: 1.35,
      textAlign: 'right'
    }
  }, "Upside", /*#__PURE__*/React.createElement("br", null), "Potential"), /*#__PURE__*/React.createElement(Tip, {
    text: "Additional monthly revenue if you recover to your target star rating."
  }))))), /*#__PURE__*/React.createElement("tbody", null, rows.map(pr => {
    const f = fields[pr.asin] || {};
    const rat = pr.pillar_rating;
    return /*#__PURE__*/React.createElement("tr", {
      key: pr.asin
    }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "p-title"
    }, pr.title ? pr.title.slice(0, 40) + (pr.title.length > 40 ? '…' : '') : pr.asin), /*#__PURE__*/React.createElement("div", {
      className: "asin-code"
    }, pr.asin), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.67rem',
        color: 'var(--ink5)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        fontWeight: 600
      }
    }, "Target \u2605"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      min: "1",
      max: "5",
      step: "0.1",
      className: "target-rating-input",
      value: f.targetRating,
      onChange: e => onUpdate(pr.asin, 'targetRating', e.target.value)
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.67rem',
        color: 'var(--ink5)'
      }
    }, "\u2605"))), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        whiteSpace: 'nowrap'
      }
    }, rat.current ? rat.current.toFixed(1) + '★' : '-', rat.ratingDropped30d && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 4,
        fontSize: '0.8rem'
      }
    }, "\u26A0\uFE0F")), rat.ratingDropped30d && rat.delta30d != null ? /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--rust)',
        fontWeight: 600,
        marginTop: 2,
        whiteSpace: 'nowrap'
      }
    }, rat.delta30d, " MoM") : /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--ink5)',
        marginTop: 2,
        whiteSpace: 'nowrap'
      }
    }, "stable")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
      type: "number",
      className: "rev-deep-input",
      value: f.units,
      placeholder: "e.g. 10000",
      onChange: e => onUpdate(pr.asin, 'units', e.target.value)
    }), /*#__PURE__*/React.createElement("div", {
      className: "rev-source-tag-sm"
    }, f.unitsDirty ? 'your value' : pr.defaultUnits ? `~${pr.defaultUnits.toLocaleString()} (est.)` : 'enter units')), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "rev-deep-price-wrap"
    }, /*#__PURE__*/React.createElement("span", {
      className: "rev-deep-prefix"
    }, "$"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      step: "0.01",
      className: "rev-deep-input rev-deep-price-input",
      value: f.price,
      placeholder: "33.99",
      onChange: e => onUpdate(pr.asin, 'price', e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      className: "rev-source-tag-sm"
    }, f.priceDirty ? 'your value' : pr.defaultPrice ? `$${pr.defaultPrice.toFixed(2)} (${pr.defaultPriceSource === 'bb' ? 'Buy Box' : pr.defaultPriceSource === 'asp' ? 'ASP est.' : 'List est.'})` : 'enter price')), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, !pr.pillar_rating.ratingDropped30d ? /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.8rem'
      }
    }, "-") : pr.computedRisk > 0 ? /*#__PURE__*/React.createElement("div", {
      className: "rev-risk-cell",
      style: {
        fontSize: '0.9rem'
      }
    }, fmt$(pr.computedRisk)) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.75rem'
      }
    }, "enter data \u2191")), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, pr.recoveryAmt > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "recovery-amount",
      style: {
        fontSize: '0.9rem'
      }
    }, "+", fmt$(pr.recoveryAmt)), /*#__PURE__*/React.createElement("div", {
      className: "recovery-label"
    }, "if ", parseFloat(f.targetRating).toFixed(1), "\u2605")) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.75rem'
      }
    }, "-")));
  })), (totalMonthly > 0 || totalRecovery > 0) && /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 4,
    style: {
      fontWeight: 600,
      fontSize: '0.78rem',
      color: 'var(--ink3)',
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, "Total"), /*#__PURE__*/React.createElement("td", {
    style: {
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, totalMonthly > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--amber)',
      fontSize: '0.95rem'
    }
  }, fmt$(totalMonthly)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink4)',
      marginTop: 2
    }
  }, fmt$(totalMonthly * 12), "/yr"))), /*#__PURE__*/React.createElement("td", {
    style: {
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, totalRecovery > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--forest)',
      fontSize: '0.95rem'
    }
  }, "+", fmt$(totalRecovery)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink4)',
      marginTop: 2
    }
  }, "+", fmt$(totalRecovery * 12), "/yr")))))));
  if (noWrapper) return tableContent;
  return /*#__PURE__*/React.createElement("div", {
    className: "products-section animate-in",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Serif Display', serif",
      fontSize: '1.1rem',
      fontWeight: 400,
      color: 'var(--ink)',
      marginBottom: 2
    }
  }, "Monthly Risk & Upside Calculator"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink5)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 600
    }
  }, productRevs.length, " product", productRevs.length !== 1 ? 's' : '')), tableContent, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 14px',
      fontSize: '0.72rem',
      color: 'var(--ink5)',
      borderTop: '1px solid var(--cream2)',
      lineHeight: 1.5
    }
  }, "Estimates use Sentopi's conversion rate model. Update units and target rating with your actual data for accuracy."));
}

// ─── Headline narrative ───────────────────────────────────────────────────────
function HeadlineNarrative({
  data,
  totalRiskMonthly,
  worstProduct
}) {
  const {
    label,
    products,
    brandScore
  } = data;
  const annual = totalRiskMonthly * 12;

  // Critical / At Risk → lead with the dollar amount + the product driving it
  if (label !== 'Healthy' && totalRiskMonthly > 0 && worstProduct) {
    const title = truncTitle(worstProduct.title, 50) || worstProduct.asin;
    const tone = label === 'Critical' ? 'critical' : 'risk';
    const icon = label === 'Critical' ? '🚨' : '⚠️';
    return /*#__PURE__*/React.createElement("div", {
      className: `narrative ${tone} animate-in`
    }, /*#__PURE__*/React.createElement("span", {
      className: "narrative-icon"
    }, icon), /*#__PURE__*/React.createElement("div", {
      className: "narrative-body"
    }, "Your biggest revenue risk is ", /*#__PURE__*/React.createElement("strong", null, "\"", title, "\""), ", losing an estimated", ' ', /*#__PURE__*/React.createElement("span", {
      className: "narrative-amount"
    }, fmt$(totalRiskMonthly), "/mo"), ' ', "(", /*#__PURE__*/React.createElement("strong", null, fmt$(annual), "/yr"), ") across the signals below."));
  }

  // Healthy → lead with the strongest signal as a "stay ahead" framing
  if (label === 'Healthy') {
    // Find the most improved BSR product
    const bestBSR = products.filter(p => p.pillar_bsr.delta90dPct !== null && p.pillar_bsr.delta90dPct < 0).sort((a, b) => a.pillar_bsr.delta90dPct - b.pillar_bsr.delta90dPct)[0];
    const bestRating = products.filter(p => (p.pillar_rating.current || 0) >= 4.5).sort((a, b) => (b.pillar_rating.current || 0) - (a.pillar_rating.current || 0))[0];
    let copy = /*#__PURE__*/React.createElement(React.Fragment, null, "Your brand scored ", /*#__PURE__*/React.createElement("strong", null, brandScore, "/100"), ". No active revenue threats detected across BSR, rating trajectory, or Buy Box in the last 90 days.");
    if (bestBSR && bestBSR.pillar_bsr.delta90dPct < -10) {
      copy = /*#__PURE__*/React.createElement(React.Fragment, null, "Your strongest signal: ", /*#__PURE__*/React.createElement("strong", null, "\"", truncTitle(bestBSR.title, 50) || bestBSR.asin, "\""), " improved BSR by", ' ', /*#__PURE__*/React.createElement("strong", null, Math.abs(bestBSR.pillar_bsr.delta90dPct).toFixed(0), "%"), " over 90 days. No active revenue threats detected, but a single bad review cycle could change that.");
    } else if (bestRating) {
      copy = /*#__PURE__*/React.createElement(React.Fragment, null, "Your strongest signal: ", /*#__PURE__*/React.createElement("strong", null, "\"", truncTitle(bestRating.title, 50) || bestRating.asin, "\""), " holds at", ' ', /*#__PURE__*/React.createElement("strong", null, bestRating.pillar_rating.current.toFixed(1), "\u2605"), ", squarely in the high-conversion zone. No active threats detected.");
    }
    return /*#__PURE__*/React.createElement("div", {
      className: "narrative safe animate-in"
    }, /*#__PURE__*/React.createElement("span", {
      className: "narrative-icon"
    }, "\u2705"), /*#__PURE__*/React.createElement("div", {
      className: "narrative-body"
    }, copy));
  }

  // At Risk but no quantified $ yet (user hasn't entered units, or signals are non-financial)
  return /*#__PURE__*/React.createElement("div", {
    className: "narrative risk animate-in"
  }, /*#__PURE__*/React.createElement("span", {
    className: "narrative-icon"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", {
    className: "narrative-body"
  }, "Your brand scored ", /*#__PURE__*/React.createElement("strong", null, brandScore, "/100"), ". We detected risk signals below. Enter monthly units on at-risk products to see the dollar impact."));
}

// ─── Per-signal recommendations ──────────────────────────────────────────────
function Recommendations({
  data,
  brandRiskMonthly,
  brandBBLoss,
  brandChronicGap
}) {
  const {
    products,
    label
  } = data;
  const recs = [];

  // 1) Worst rating drop
  const worstDrop = products.filter(p => p.pillar_rating.ratingDropped30d).sort((a, b) => (a.pillar_rating.delta30d || 0) - (b.pillar_rating.delta30d || 0))[0];
  if (worstDrop) {
    const t = truncTitle(worstDrop.title) || worstDrop.asin;
    const dropMo = monthName(worstDrop.pillar_rating.dropDate);
    recs.push({
      tag: 'Rating drop',
      tagCls: 'rust',
      title: `Investigate "${t}": rating fell to ${worstDrop.pillar_rating.current}★ around ${dropMo}.`,
      sub: 'Pull every review from the drop window. Look for a single repeating issue (defect, expectation gap, packaging change). One pattern usually drives most of the drop.'
    });
  }

  // 2) Lost Buy Box — only flag if materially below 90%
  const lbbProduct = products.filter(p => p.pillar_buybox.lbbDetected && (p.pillar_buybox.bbPct30d || 100) < 90).sort((a, b) => (a.pillar_buybox.bbPct30d || 0) - (b.pillar_buybox.bbPct30d || 0))[0];
  if (lbbProduct) {
    const t = truncTitle(lbbProduct.title) || lbbProduct.asin;
    const pct = lbbProduct.pillar_buybox.bbPct30d;
    const undercut = lbbProduct.pillar_buybox.competitorUndercut;
    recs.push({
      tag: 'Buy Box',
      tagCls: 'amber',
      title: `Reclaim Buy Box on "${t}": holding only ${pct?.toFixed?.(0) ?? '-'}% of the time.`,
      sub: undercut ? 'A competitor is undercutting your price. Verify stock health, then test a matched price or a coupon to recover share.' : 'Check inventory, fulfillment latency, and seller-rating health. Out-of-stock and late shipments are the usual culprits.'
    });
  }

  // 3) Chronic underperformance (largest gap to 4.5★)
  const chronic = products.filter(p => (p.pillar_rating.current || 0) > 0 && (p.pillar_rating.current || 0) < 4.4 && !p.pillar_rating.ratingDropped30d).sort((a, b) => (a.pillar_rating.current || 0) - (b.pillar_rating.current || 0))[0];
  if (chronic) {
    const t = truncTitle(chronic.title) || chronic.asin;
    recs.push({
      tag: 'Chronic gap',
      tagCls: 'amber',
      title: `Lift "${t}" from ${chronic.pillar_rating.current}★: every 0.2★ here meaningfully shifts conversion.`,
      sub: 'Two paths: (1) eliminate the top 1-star theme so new reviews skew higher, (2) accelerate review velocity from satisfied buyers so the existing 1-stars get diluted.'
    });
  }

  // 4) BSR deteriorating
  const bsrSlip = products.filter(p => p.pillar_bsr.delta90dPct !== null && p.pillar_bsr.delta90dPct > 15).sort((a, b) => (b.pillar_bsr.delta90dPct || 0) - (a.pillar_bsr.delta90dPct || 0))[0];
  if (bsrSlip) {
    const t = truncTitle(bsrSlip.title) || bsrSlip.asin;
    recs.push({
      tag: 'BSR slip',
      tagCls: 'amber',
      title: `"${t}" rank worsened ${bsrSlip.pillar_bsr.delta90dPct.toFixed(0)}% over 90 days.`,
      sub: 'Map rank decline to the same window as rating / pricing / inventory changes. The trigger is usually one of those three.'
    });
  }

  // Healthy path — defensive recommendations
  if (!recs.length && label === 'Healthy') {
    recs.push({
      tag: 'Stay ahead',
      tagCls: 'green',
      title: 'Set up sentiment monitoring on your top SKUs.',
      sub: "When ratings start to slip, you're already 2–4 weeks behind the review wave that caused it. Catch the language change as it happens, before the star average moves."
    });
    recs.push({
      tag: 'Compound it',
      tagCls: 'green',
      title: 'Run a review-velocity push on your highest-margin SKU.',
      sub: 'A 4.5★ product with 2× review velocity dominates the long tail of search. The math: more reviews = more rank = more conversion = more reviews.'
    });
  }
  if (!recs.length) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "rec-strip animate-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rec-strip-head"
  }, "Top ", Math.min(recs.length, 3), " action", recs.length === 1 ? '' : 's', " this week"), recs.slice(0, 3).map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rec-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: `rec-item-num ${label === 'Healthy' ? 'safe' : ''}`
  }, i + 1), /*#__PURE__*/React.createElement("div", {
    className: "rec-item-body"
  }, /*#__PURE__*/React.createElement("span", {
    className: `rec-item-tag ${r.tagCls}`
  }, r.tag), /*#__PURE__*/React.createElement("strong", null, r.title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 3,
      color: 'var(--ink4)',
      fontSize: '0.82rem'
    }
  }, r.sub)))));
}

// ─── Watch List (new / sparse ASINs) ─────────────────────────────────────────
function WatchList({
  items
}) {
  if (!items || !items.length) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "watchlist animate-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "watchlist-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "watchlist-title"
  }, "Launch Watch List"), /*#__PURE__*/React.createElement("span", {
    className: "watchlist-tag"
  }, items.length, " new ASIN", items.length === 1 ? '' : 's')), /*#__PURE__*/React.createElement("div", {
    className: "watchlist-sub"
  }, "Excluded from the brand score (under 25 reviews). For new launches, the first 90 days are make-or-break: early 1-stars set the trajectory. Watch these closely."), items.map(p => {
    const r = p.pillar_rating?.current;
    const rc = p.reviewCount || 0;
    const fragile = r != null && r < 4.0 && rc < 25;
    return /*#__PURE__*/React.createElement("div", {
      key: p.asin,
      className: "watchlist-row"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "p-title"
    }, p.title ? p.title.slice(0, 50) + (p.title.length > 50 ? '…' : '') : p.asin), /*#__PURE__*/React.createElement("div", {
      className: "asin-code"
    }, p.asin), fragile && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--rust)',
        fontWeight: 600,
        marginTop: 3
      }
    }, "\u26A0\uFE0F Early reviews skew low. Investigate before the pattern locks in.")), /*#__PURE__*/React.createElement("div", {
      className: "watchlist-metric"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lbl"
    }, "Reviews"), /*#__PURE__*/React.createElement("strong", null, rc)), /*#__PURE__*/React.createElement("div", {
      className: "watchlist-metric"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lbl"
    }, "Rating"), /*#__PURE__*/React.createElement("strong", null, r != null ? r.toFixed(1) + '★' : '-')), /*#__PURE__*/React.createElement("div", {
      className: "watchlist-metric"
    }, /*#__PURE__*/React.createElement("span", {
      className: "lbl"
    }, "Buy Box"), /*#__PURE__*/React.createElement("strong", null, p.pillar_buybox?.bbPct30d != null ? fmtPct(p.pillar_buybox.bbPct30d) : '-')));
  }));
}

// ─── Methodology drawer ──────────────────────────────────────────────────────
function Methodology() {
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "meth no-print"
  }, /*#__PURE__*/React.createElement("button", {
    className: "meth-head",
    "aria-expanded": open,
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement("span", null, "How we calculate this"), /*#__PURE__*/React.createElement("span", {
    className: "chev"
  }, "\u25B8")), open && /*#__PURE__*/React.createElement("div", {
    className: "meth-body"
  }, /*#__PURE__*/React.createElement("h4", null, "Data sources"), /*#__PURE__*/React.createElement("p", null, "Best Seller Rank, star rating history, review count, list price, Buy Box ownership, and average sale price are pulled from live Amazon signals over a 90-day window. Updated daily."), /*#__PURE__*/React.createElement("h4", null, "Brand Score (0\u2013100)"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "BSR Health (40 pts):"), " 90-day rank trajectory. Each 10% deterioration costs 4 points."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "Rating Health (35 pts):"), " Penalizes both the absolute drop and the recency. A drop in the last 30 days hurts more than a drop 60 days ago."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "Buy Box Health (25 pts):"), " % of time you held the Buy Box in the last 30 days. Extra penalty when competitors undercut.")), /*#__PURE__*/React.createElement("h4", null, "Revenue at risk"), /*#__PURE__*/React.createElement("p", null, "For each product where the rating dropped, we apply a conversion-rate index by star rating (based on Spiegel Research Center 2017, PowerReviews, and Pattern.com). Conversion peaks around 4.5\u2605 and declines toward 5.0\u2605 (\"too good to be true\" skepticism)."), /*#__PURE__*/React.createElement("p", null, "Monthly risk = ", /*#__PURE__*/React.createElement("code", null, "units \xD7 price \xD7 (conv@oldRating \u2212 conv@newRating)"), ". We default units to the Amazon monthly-sold estimate and price to your Buy Box modal price. Override either for a sharper number."), /*#__PURE__*/React.createElement("h4", null, "Chronic gap & Buy Box loss"), /*#__PURE__*/React.createElement("p", null, "We also surface (a) chronic underperformance: revenue left on the table by sitting below the 4.5\u2605 peak, even without a recent drop, and (b) Buy Box loss: assuming a 40% capture rate by competing sellers during the windows you don't hold the Buy Box. The rest is split between brand-loyal direct buys, off-Amazon purchase, and no purchase at all."), /*#__PURE__*/React.createElement("h4", null, "Limitations"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, "Estimates are observational, not causal. Actual lift varies by category, price point, and competitive density."), /*#__PURE__*/React.createElement("li", null, "Brand score caps at \"At Risk\" when an active rating drop or lost Buy Box is detected, even if the underlying pillar math is otherwise high."), /*#__PURE__*/React.createElement("li", null, "Products under 25 reviews are excluded from the brand-score rollup. They appear in the Watch List instead."))));
}

// ─── Pillar cards ─────────────────────────────────────────────────────────────
function PillarCard({
  name,
  metric,
  metricSub,
  score,
  max,
  flags
}) {
  const noData = score === null || score === undefined;
  const pct = noData ? 0 : Math.round(score / max * 100);
  const health = noData ? '' : pillarHealth(score, max);
  return /*#__PURE__*/React.createElement("div", {
    className: "pillar-card animate-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pillar-name"
  }, name), /*#__PURE__*/React.createElement("div", {
    className: "pillar-metric"
  }, metric), /*#__PURE__*/React.createElement("div", {
    className: "pillar-metric-sub"
  }, metricSub || ''), /*#__PURE__*/React.createElement("div", {
    className: "pillar-bar-track"
  }, /*#__PURE__*/React.createElement("div", {
    className: `pillar-bar-fill ${health}`,
    style: {
      width: `${pct}%`
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "pillar-score-line"
  }, "Score: ", /*#__PURE__*/React.createElement("strong", null, noData ? '-' : `${score}/${max}`)), flags && flags.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: `pillar-flag ${f.color}`
  }, f.icon, " ", f.text)));
}

// ─── Shared colgroup — both tables use identical widths for column alignment ──
const SharedColGroup = () => /*#__PURE__*/React.createElement("colgroup", null, /*#__PURE__*/React.createElement("col", {
  style: {
    width: '22%'
  }
}), /*#__PURE__*/React.createElement("col", {
  style: {
    width: '12%'
  }
}), /*#__PURE__*/React.createElement("col", {
  style: {
    width: '16%'
  }
}), /*#__PURE__*/React.createElement("col", {
  style: {
    width: '14%'
  }
}), /*#__PURE__*/React.createElement("col", {
  style: {
    width: '18%'
  }
}), /*#__PURE__*/React.createElement("col", {
  style: {
    width: '18%'
  }
}));

// ─── Products table ───────────────────────────────────────────────────────────
function ProductsTable({
  products,
  weights,
  noWrapper = false
}) {
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "products-header"
  }, "Products Analyzed (", products.length, ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    className: "products-table"
  }, /*#__PURE__*/React.createElement(SharedColGroup, null), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Product"), /*#__PURE__*/React.createElement("th", null, "Rating"), /*#__PURE__*/React.createElement("th", {
    className: "bsr-header"
  }, "Best Seller", /*#__PURE__*/React.createElement("br", null), "Rank"), /*#__PURE__*/React.createElement("th", null, "Buy Box"), /*#__PURE__*/React.createElement("th", null, "ASP"), /*#__PURE__*/React.createElement("th", {
    className: "col-score"
  }, "Score"))), /*#__PURE__*/React.createElement("tbody", null, products.map(p => {
    const rat = p.pillar_rating;
    const bsr = p.pillar_bsr;
    const bb = p.pillar_buybox;
    const d30 = fmtDelta(rat.delta30d, true); // inverse: drop is bad
    const bsrD = fmtDelta(bsr.delta90dPct, false); // increase is bad
    return /*#__PURE__*/React.createElement("tr", {
      key: p.asin
    }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "p-title"
    }, p.title ? p.title.slice(0, 45) + (p.title.length > 45 ? '…' : '') : p.asin), /*#__PURE__*/React.createElement("div", {
      className: "asin-code"
    }, p.asin)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, rat.current ? rat.current.toFixed(1) + '★' : '-'), d30 && /*#__PURE__*/React.createElement("div", {
      className: d30.cls,
      style: {
        fontSize: '0.75rem'
      }
    }, d30.text, " vs. 30d"), rat.ratingDropped30d && /*#__PURE__*/React.createElement("span", {
      title: "Rating dropped",
      style: {
        fontSize: '0.8rem'
      }
    }, "\u26A0\uFE0F")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, bsr.current ? '#' + bsr.current.toLocaleString() : '-'), bsrD && bsr.delta90dPct !== null && /*#__PURE__*/React.createElement("div", {
      className: bsrD.cls,
      style: {
        fontSize: '0.75rem'
      }
    }, bsrD.text, "% vs. 90d")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, bb.bbPct30d !== null ? fmtPct(bb.bbPct30d) : '-'), bb.lbbDetected && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--rust)',
        fontWeight: 600
      }
    }, "\uD83D\uDEA8 LBB"), bb.competitorUndercut && bb.lowestCompetitorPrice && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--amber)'
      }
    }, "Competitor: $", (bb.lowestCompetitorPrice / 100).toFixed(2))), /*#__PURE__*/React.createElement("td", null, p.asp30d != null ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, "$", p.asp30d.toFixed(2)), p.aspMoMPct != null && (() => {
      const d = fmtDelta(p.aspMoMPct, true);
      return d ? /*#__PURE__*/React.createElement("div", {
        className: d.cls,
        style: {
          fontSize: '0.75rem'
        }
      }, d.text, "% MoM") : null;
    })(), p.listPrice != null && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.7rem',
        color: 'var(--ink5)',
        marginTop: 1
      }
    }, "List $", p.listPrice.toFixed(2))) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink5)'
      }
    }, "-")), /*#__PURE__*/React.createElement("td", {
      className: "col-score"
    }, /*#__PURE__*/React.createElement("span", {
      className: `score-chip ${scoreChip(p.composite)}`
    }, p.composite)));
  })))));
  return noWrapper ? inner : /*#__PURE__*/React.createElement("div", {
    className: "products-section animate-in"
  }, inner);
}

// ─── Score card ───────────────────────────────────────────────────────────────
function ScoreCard({
  data
}) {
  const {
    brandScore,
    label,
    capReasons,
    ratingDropDetails,
    products,
    productsExcluded,
    weights,
    asinCountExcluded
  } = data;
  const hasRatingDrop = ratingDropDetails && ratingDropDetails.length > 0;

  // ── Revenue state (shared between hero card + deep dive table) ───────────────
  const initFields = {};
  products.forEach(p => {
    const cur = p.pillar_rating?.current || 0;
    const ago = p.pillar_rating?.rating30dAgo || 0;
    const defaultTarget = cur > 0 ? Math.min(5, Math.max(cur + 0.2, ago)).toFixed(1) : '';
    initFields[p.asin] = {
      units: p.defaultUnits || '',
      price: p.defaultPrice || '',
      targetRating: defaultTarget,
      unitsDirty: false,
      priceDirty: false
    };
  });
  const [fields, setFields] = useState(initFields);
  function updateField(asin, key, val) {
    setFields(prev => ({
      ...prev,
      [asin]: {
        ...prev[asin],
        [key]: val,
        [`${key}Dirty`]: true
      }
    }));
  }

  // ── Compute revenue at risk ───────────────────────────────────────────────────
  // We surface three categories of monthly $ exposure:
  //   (1) Active drop  — rating fell in last 30d
  //   (2) Chronic gap  — sitting below the 4.5★ peak (no recent drop required)
  //   (3) Buy Box loss — % of time you don't hold the BB × conservative capture
  let totalMonthly = 0;
  let totalChronic = 0;
  let totalBBLoss = 0;
  const productRevs = products.map(p => {
    const f = fields[p.asin] || {};
    const units = parseFloat(f.units) || 0;
    const price = parseFloat(f.price) || 0;
    const rb = p.pillar_rating.rating30dAgo;
    const rn = p.pillar_rating.current;
    const risk = p.pillar_rating.ratingDropped30d ? calcRevenueAtRisk(units, price, rb, rn) : 0;
    const chronic = !p.pillar_rating.ratingDropped30d ? calcChronicGap(units, price, rn) : 0;
    const bbLoss = calcBBLoss(units, price, p.pillar_buybox?.bbPct30d);
    totalMonthly += risk;
    totalChronic += chronic;
    totalBBLoss += bbLoss;
    return {
      ...p,
      computedRisk: risk,
      computedChronic: chronic,
      computedBBLoss: bbLoss
    };
  });
  const totalAnnual = totalMonthly * 12;
  const totalExposureMonthly = totalMonthly + totalChronic + totalBBLoss;
  const isRisk = hasRatingDrop && totalMonthly > 0;

  // At-risk brands: show drops + sub-4.5★ products. Healthy brands: show all so units can be entered.
  const displayProducts = hasRatingDrop ? productRevs.filter(p => p.pillar_rating.ratingDropped30d || (p.pillar_rating.current || 0) < 4.5) : productRevs;

  // Compute calculator rows + recovery totals (for merged single-table rendering)
  const sortedCalc = [...displayProducts].sort((a, b) => (b.computedRisk || 0) - (a.computedRisk || 0));
  let calcTotalRecovery = 0;
  const calcRows = sortedCalc.map(pr => {
    const f = fields[pr.asin] || {};
    const units = parseFloat(f.units) || 0;
    const price = parseFloat(f.price) || 0;
    const targetRating = parseFloat(f.targetRating) || 0;
    const currentRating = pr.pillar_rating.current || 0;
    const recoveryAmt = targetRating > currentRating && units > 0 && price > 0 ? Math.max(0, Math.round(units * price * (convRate(targetRating) - convRate(currentRating)))) : 0;
    calcTotalRecovery += recoveryAmt;
    return {
      ...pr,
      recoveryAmt
    };
  });

  // For healthy brands — revenue protected estimate
  let protectedMonthly = 0;
  if (!hasRatingDrop) {
    products.forEach(p => {
      const f = fields[p.asin] || {};
      const units = parseFloat(f.units) || 0;
      const price = parseFloat(f.price) || 0;
      if (units && price && p.pillar_rating.current) {
        const worstCase = Math.max(1.0, p.pillar_rating.current - 0.5);
        protectedMonthly += calcRevenueAtRisk(units, price, p.pillar_rating.current, worstCase);
      }
    });
  }
  const worstDrop = products.filter(p => p.pillar_rating.ratingDropped30d).sort((a, b) => (a.pillar_rating.delta30d || 0) - (b.pillar_rating.delta30d || 0))[0];

  // ── Buy Box average (must be computed before pillar averages) ─────────────────
  const avgBB = (() => {
    const valid = products.filter(p => p.pillar_buybox.bbPct30d !== null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, p) => s + p.pillar_buybox.bbPct30d, 0) / valid.length * 10) / 10;
  })();
  const anyLBB = products.some(p => p.pillar_buybox.lbbDetected);
  const anyUndercut = products.some(p => p.pillar_buybox.competitorUndercut);
  const avgASP = (() => {
    const valid = products.filter(p => p.asp30d != null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, p) => s + p.asp30d, 0) / valid.length * 100) / 100;
  })();
  const avgListPrice = (() => {
    const valid = products.filter(p => p.listPrice != null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, p) => s + p.listPrice, 0) / valid.length * 100) / 100;
  })();
  const avgAspMoMPct = (() => {
    const valid = products.filter(p => p.asp30d != null && p.aspMoMPct != null);
    if (!valid.length) return null;
    const totalW = valid.reduce((s, p) => s + (p.reviewCount || 1), 0);
    return Math.round(valid.reduce((s, p) => s + p.aspMoMPct * (p.reviewCount || 1) / totalW, 0) * 10) / 10;
  })();
  const avgBBMoM = (() => {
    const valid = products.filter(p => p.pillar_buybox.bbMoMPts != null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, p) => s + p.pillar_buybox.bbMoMPts, 0) / valid.length * 10) / 10;
  })();
  const bbSub = avgBBMoM != null ? avgBBMoM >= 0 ? `▲${avgBBMoM.toFixed(1)}pp MoM` : `▼${Math.abs(avgBBMoM).toFixed(1)}pp MoM` : avgBB !== null ? `${products.length > 1 ? 'Avg ' : ''}${fmtPct(avgBB)} last 30d` : 'No BB data';

  // ── Weighted pillar averages for display ──────────────────────────────────────
  const totalW = products.reduce((s, p) => s + (p.reviewCount || 1), 0);
  function wAvg(key) {
    return Math.round(products.reduce((s, p) => {
      const w = (p.reviewCount || 1) / totalW;
      return s + p[key].score * w;
    }, 0) * 10) / 10;
  }
  const bsrScore = wAvg('pillar_bsr');
  const ratScore = wAvg('pillar_rating');
  const bbScore = avgBB !== null ? wAvg('pillar_buybox') : null;
  const lead = products[0] || {};

  // BSR
  const bsrMetric = lead.pillar_bsr?.current ? '#' + lead.pillar_bsr.current.toLocaleString() : '-';
  const bsrDelta = lead.pillar_bsr?.delta90dPct !== null ? lead.pillar_bsr?.delta90dPct : null;
  const bsrSub = bsrDelta !== null ? `${bsrDelta > 0 ? '▲' : '▼'}${Math.abs(bsrDelta)}% vs. 90d ${bsrDelta > 0 ? '(worsening)' : '(improving)'}` : 'No rank history';

  // Rating
  const avgRating = products.length ? Math.round(products.reduce((s, p) => s + (p.pillar_rating.current || 0), 0) / products.length * 10) / 10 : null;
  const worstDelta30 = products.reduce((worst, p) => {
    const d = p.pillar_rating.delta30d;
    return d !== null && d < worst ? d : worst;
  }, 0);
  const ratSub = avgRating ? worstDelta30 < 0 ? `▼${Math.abs(worstDelta30)} vs. 30d` : 'Stable last 30d' : 'No rating data';
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HeadlineNarrative, {
    data: data,
    totalRiskMonthly: totalExposureMonthly,
    worstProduct: worstDrop || productRevs.sort((a, b) => b.computedRisk + b.computedChronic + b.computedBBLoss - (a.computedRisk + a.computedChronic + a.computedBBLoss))[0]
  }), /*#__PURE__*/React.createElement("div", {
    className: "hero-split animate-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hero-score-inner"
  }, /*#__PURE__*/React.createElement(ScoreRing, {
    score: brandScore,
    label: label
  }), /*#__PURE__*/React.createElement("div", {
    className: "score-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "score-brand-name"
  }, lead.brand || 'Your Brand', " Brand Score"), /*#__PURE__*/React.createElement("div", {
    className: `score-label-badge ${labelClass(label)}`,
    style: {
      marginTop: 6
    }
  }, label === 'Healthy' ? '✓' : label === 'At Risk' ? '⚠' : '✕', " ", label), capReasons.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5,
      marginTop: 8
    }
  }, capReasons.map((r, i) => {
    const c = CAP_REASON_COPY[r] || {
      icon: '⚠',
      text: r
    };
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      className: "pillar-flag amber"
    }, c.icon, " ", c.text);
  }))))), (() => {
    const showExposureHero = label !== 'Healthy';
    const heroAmount = showExposureHero ? totalExposureMonthly > 0 ? fmt$(totalExposureMonthly * 12) + '/yr' : null : protectedMonthly > 0 ? fmt$(protectedMonthly * 12) + '/yr' : null;
    return /*#__PURE__*/React.createElement("div", {
      className: `hero-card ${showExposureHero ? 'rev-risk-card' : 'rev-safe-card'}`
    }, /*#__PURE__*/React.createElement("div", {
      className: `rev-card-label ${showExposureHero ? 'risk' : 'safe'}`
    }, showExposureHero ? '⚠️  Total Monthly Exposure' : '✅  Revenue Resilience'), /*#__PURE__*/React.createElement("div", {
      className: "rev-card-amount"
    }, heroAmount || /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.9rem',
        fontWeight: 500,
        color: 'var(--ink5)',
        lineHeight: 1.5
      }
    }, "Add monthly units below to estimate what's at stake.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem'
      }
    }, "Set a Target \u2605 to also see upside potential."))), showExposureHero && totalExposureMonthly > 0 && /*#__PURE__*/React.createElement("div", {
      className: "risk-breakdown"
    }, totalMonthly > 0 && /*#__PURE__*/React.createElement("div", {
      className: "risk-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "risk-row-label"
    }, "Active rating drop"), /*#__PURE__*/React.createElement("span", {
      className: "risk-row-amt"
    }, fmt$(totalMonthly), "/mo")), totalChronic > 0 && /*#__PURE__*/React.createElement("div", {
      className: "risk-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "risk-row-label"
    }, "Chronic gap to 4.5\u2605"), /*#__PURE__*/React.createElement("span", {
      className: "risk-row-amt"
    }, fmt$(totalChronic), "/mo")), totalBBLoss > 0 && /*#__PURE__*/React.createElement("div", {
      className: "risk-row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "risk-row-label"
    }, "Lost Buy Box revenue"), /*#__PURE__*/React.createElement("span", {
      className: "risk-row-amt"
    }, fmt$(totalBBLoss), "/mo"))), !showExposureHero && protectedMonthly > 0 && /*#__PURE__*/React.createElement("div", {
      className: "rev-card-desc",
      style: {
        marginTop: 10
      }
    }, "Your conversion stays roughly intact today. If your rating slipped 0.5\u2605, this is what would be at stake within 12 months."), !heroAmount && /*#__PURE__*/React.createElement("a", {
      href: "#calc-table",
      className: "rev-card-cta",
      style: {
        marginTop: 10
      },
      onClick: e => {
        e.preventDefault();
        document.getElementById('calc-table')?.scrollIntoView({
          behavior: 'smooth'
        });
      }
    }, "Go to calculator \u2193"), showExposureHero && totalExposureMonthly > 0 && /*#__PURE__*/React.createElement("div", {
      className: "rev-card-annual"
    }, fmt$(totalExposureMonthly), "/mo total exposure"), !showExposureHero && protectedMonthly > 0 && /*#__PURE__*/React.createElement("div", {
      className: "rev-card-annual"
    }, fmt$(protectedMonthly), "/mo at stake if rating slips 0.5\u2605"), isRisk && worstDrop && /*#__PURE__*/React.createElement("div", {
      className: "rev-card-desc"
    }, "\"", worstDrop.title ? worstDrop.title.slice(0, 45) + (worstDrop.title.length > 45 ? '…' : '') : worstDrop.asin, "\" dropped from", ' ', /*#__PURE__*/React.createElement("strong", null, worstDrop.pillar_rating.rating30dAgo, "\u2605"), " to", ' ', /*#__PURE__*/React.createElement("strong", null, worstDrop.pillar_rating.current, "\u2605"), " over the past 30 days."), showExposureHero && /*#__PURE__*/React.createElement("a", {
      href: "#claim",
      className: "rev-card-cta",
      onClick: e => {
        e.preventDefault();
        document.getElementById('claim')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }, hasRatingDrop && worstDrop ? `Diagnose the ${monthName(worstDrop.pillar_rating.dropDate)} ratings drop with full sentiment analysis →` : anyLBB ? 'Diagnose your Buy Box loss with the full Sentopi analysis →' : 'Get the full Sentopi analysis →'));
  })()), /*#__PURE__*/React.createElement(Recommendations, {
    data: data,
    brandRiskMonthly: totalMonthly,
    brandBBLoss: totalBBLoss,
    brandChronicGap: totalChronic
  }), avgASP != null && /*#__PURE__*/React.createElement("div", {
    className: "asp-strip animate-in"
  }, /*#__PURE__*/React.createElement("div", {
    className: "asp-strip-label"
  }, lead.brand || 'Brand', " ASP"), /*#__PURE__*/React.createElement("div", {
    className: "asp-strip-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "asp-strip-amount"
  }, "$", avgASP.toFixed(2)), avgAspMoMPct != null && (() => {
    const d = fmtDelta(avgAspMoMPct, true);
    return d ? /*#__PURE__*/React.createElement("span", {
      className: `asp-strip-delta ${d.cls}`
    }, d.text, "% MoM") : null;
  })(), avgListPrice != null && /*#__PURE__*/React.createElement("div", {
    className: "asp-strip-list"
  }, "\xB7 Avg List $", avgListPrice.toFixed(2))), /*#__PURE__*/React.createElement("div", {
    className: "pillars-grid"
  }, /*#__PURE__*/React.createElement(PillarCard, {
    name: "Best Seller Rank",
    metric: bsrMetric,
    metricSub: bsrSub,
    score: bsrScore,
    max: weights.bsr
  }), /*#__PURE__*/React.createElement(PillarCard, {
    name: "Rating Health",
    metric: avgRating ? avgRating.toFixed(1) + '★' : '-',
    metricSub: ratSub,
    score: ratScore,
    max: weights.rating,
    flags: [...(hasRatingDrop ? [{
      color: 'amber',
      icon: '⚠',
      text: 'Rating dropped last 30d'
    }] : [])]
  }), /*#__PURE__*/React.createElement(PillarCard, {
    name: "Buy Box",
    metric: avgBB !== null ? fmtPct(avgBB) : '-',
    metricSub: bbSub,
    score: bbScore,
    max: weights.buybox,
    flags: [...(anyLBB ? [{
      color: 'red',
      icon: '🚨',
      text: 'Lost Buy Box'
    }] : []), ...(anyUndercut ? [{
      color: 'amber',
      icon: '⬇',
      text: 'Competitor undercutting'
    }] : [])]
  })), /*#__PURE__*/React.createElement("div", {
    className: "products-section animate-in",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px 12px',
      borderBottom: '1px solid var(--cream2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Serif Display', serif",
      fontSize: '1.1rem',
      fontWeight: 400,
      color: 'var(--ink)',
      marginBottom: 3
    }
  }, "Product Deep Dive"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink5)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 600
    }
  }, products.length, " product", products.length !== 1 ? 's' : '')), /*#__PURE__*/React.createElement("table", {
    className: "products-table",
    style: {
      tableLayout: 'fixed',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: '30%'
    }
  }, "Product"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "Rating"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    },
    className: "bsr-header"
  }, "Best Seller", /*#__PURE__*/React.createElement("br", null), "Rank"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "Buy Box"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "ASP"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    },
    className: "col-score"
  }, "Score"))), /*#__PURE__*/React.createElement("tbody", null, products.map(p => {
    const rat = p.pillar_rating;
    const bsr = p.pillar_bsr;
    const bb = p.pillar_buybox;
    const d30 = fmtDelta(rat.delta30d, true);
    const bsrD = fmtDelta(bsr.delta90dPct, false);
    return /*#__PURE__*/React.createElement("tr", {
      key: p.asin
    }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "p-title"
    }, p.title ? p.title.slice(0, 45) + (p.title.length > 45 ? '…' : '') : p.asin), /*#__PURE__*/React.createElement("div", {
      className: "asin-code"
    }, p.asin)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, rat.current ? rat.current.toFixed(1) + '★' : '-'), d30 && /*#__PURE__*/React.createElement("div", {
      className: d30.cls,
      style: {
        fontSize: '0.75rem'
      }
    }, d30.text, " vs. 30d"), rat.ratingDropped30d && /*#__PURE__*/React.createElement("span", {
      title: "Rating dropped",
      style: {
        fontSize: '0.8rem'
      }
    }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement(RatingSparkline, {
      r90: rat.rating90dAgo,
      r30: rat.rating30dAgo,
      rNow: rat.current
    })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, bsr.current ? '#' + bsr.current.toLocaleString() : '-'), bsrD && bsr.delta90dPct !== null && /*#__PURE__*/React.createElement("div", {
      className: bsrD.cls,
      style: {
        fontSize: '0.75rem'
      }
    }, bsrD.text, "% vs. 90d")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, bb.bbPct30d !== null ? fmtPct(bb.bbPct30d) : '-'), bb.bbMoMPts != null && (() => {
      const up = bb.bbMoMPts >= 0;
      return /*#__PURE__*/React.createElement("div", {
        className: up ? 'delta-down' : 'delta-up',
        style: {
          fontSize: '0.75rem'
        }
      }, up ? '+' : '', bb.bbMoMPts.toFixed(1), "pp MoM");
    })(), bb.lbbDetected && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--rust)',
        fontWeight: 600
      }
    }, "\uD83D\uDEA8 LBB")), /*#__PURE__*/React.createElement("td", null, p.asp30d != null ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, "$", p.asp30d.toFixed(2)), p.aspMoMPct != null && (() => {
      const d = fmtDelta(p.aspMoMPct, true);
      return d ? /*#__PURE__*/React.createElement("div", {
        className: d.cls,
        style: {
          fontSize: '0.75rem'
        }
      }, d.text, "% MoM") : null;
    })(), p.listPrice != null && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.7rem',
        color: 'var(--ink5)',
        marginTop: 1
      }
    }, "List $", p.listPrice.toFixed(2))) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink5)'
      }
    }, "-")), /*#__PURE__*/React.createElement("td", {
      className: "col-score"
    }, /*#__PURE__*/React.createElement("span", {
      className: `score-chip ${scoreChip(p.composite)}`
    }, p.composite)));
  }))), asinCountExcluded > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.78rem',
      color: 'var(--ink5)',
      padding: '8px 18px',
      textAlign: 'center',
      borderTop: '1px solid var(--cream2)'
    }
  }, "+ ", asinCountExcluded, " new/sparse product", asinCountExcluded > 1 ? 's' : '', " excluded from brand score (<25 reviews)"))), displayProducts.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "products-section animate-in",
    id: "calc-table",
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Serif Display', serif",
      fontSize: '1.1rem',
      fontWeight: 400,
      color: 'var(--ink)',
      marginBottom: 3
    }
  }, "Monthly Risk & Upside Calculator"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink5)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 600,
      paddingBottom: 0
    }
  }, displayProducts.length, " product", displayProducts.length !== 1 ? 's' : '')), /*#__PURE__*/React.createElement("table", {
    className: "products-table",
    style: {
      tableLayout: 'fixed',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      width: '30%'
    }
  }, "Product"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "Rating"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "Monthly Units"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, "Price (USD)"), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'normal',
      lineHeight: 1.35
    }
  }, "Monthly", /*#__PURE__*/React.createElement("br", null), "Risk"), /*#__PURE__*/React.createElement(Tip, {
    text: "Revenue you're leaving on the table vs. your star rating from 30 days ago."
  }))), /*#__PURE__*/React.createElement("th", {
    style: {
      width: '14%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'normal',
      lineHeight: 1.35
    }
  }, "Upside", /*#__PURE__*/React.createElement("br", null), "Potential"), /*#__PURE__*/React.createElement(Tip, {
    text: "Additional monthly revenue if you recover to your target star rating."
  }))))), /*#__PURE__*/React.createElement("tbody", null, calcRows.map(pr => {
    const f = fields[pr.asin] || {};
    const rat = pr.pillar_rating;
    return /*#__PURE__*/React.createElement("tr", {
      key: pr.asin
    }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "p-title"
    }, pr.title ? pr.title.slice(0, 40) + (pr.title.length > 40 ? '…' : '') : pr.asin), /*#__PURE__*/React.createElement("div", {
      className: "asin-code"
    }, pr.asin), !hasRatingDrop && (pr.pillar_rating.current || 0) >= 4.5 && /*#__PURE__*/React.createElement("span", {
      className: "pillar-flag green",
      style: {
        marginTop: 4
      }
    }, "\u2665 Top-Rated"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.67rem',
        color: 'var(--ink5)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        fontWeight: 600
      }
    }, "Target \u2605"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      min: "1",
      max: "5",
      step: "0.1",
      className: "target-rating-input",
      value: f.targetRating,
      onChange: e => updateField(pr.asin, 'targetRating', e.target.value)
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.67rem',
        color: 'var(--ink5)'
      }
    }, "\u2605"))), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        whiteSpace: 'nowrap'
      }
    }, rat.current ? rat.current.toFixed(1) + '★' : '-', rat.ratingDropped30d && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 4,
        fontSize: '0.8rem'
      }
    }, "\u26A0\uFE0F")), rat.ratingDropped30d && rat.delta30d != null ? /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--rust)',
        fontWeight: 600,
        marginTop: 2,
        whiteSpace: 'nowrap'
      }
    }, rat.delta30d, " MoM") : /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        color: 'var(--ink5)',
        marginTop: 2,
        whiteSpace: 'nowrap'
      }
    }, "stable")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
      type: "number",
      className: "rev-deep-input",
      value: f.units,
      placeholder: "e.g. 10000",
      onChange: e => updateField(pr.asin, 'units', e.target.value)
    }), /*#__PURE__*/React.createElement("div", {
      className: "rev-source-tag-sm",
      style: {
        color: !hasRatingDrop && f.unitsDirty ? 'var(--green, #2d7a4f)' : undefined
      }
    }, f.unitsDirty ? !hasRatingDrop ? '→ Rev Protected ↑' : 'your value' : pr.defaultUnits ? `~${pr.defaultUnits.toLocaleString()} (est.)` : 'enter units')), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
      className: "rev-deep-price-wrap"
    }, /*#__PURE__*/React.createElement("span", {
      className: "rev-deep-prefix"
    }, "$"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      step: "0.01",
      className: "rev-deep-input rev-deep-price-input",
      value: f.price,
      placeholder: "33.99",
      onChange: e => updateField(pr.asin, 'price', e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      className: "rev-source-tag-sm"
    }, f.priceDirty ? 'your value' : pr.defaultPrice ? `$${pr.defaultPrice.toFixed(2)} (${pr.defaultPriceSource === 'bb' ? 'Buy Box' : pr.defaultPriceSource === 'asp' ? 'ASP est.' : 'List est.'})` : 'enter price')), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, !pr.pillar_rating.ratingDropped30d ? /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.8rem'
      }
    }, "-") : pr.computedRisk > 0 ? /*#__PURE__*/React.createElement("div", {
      className: "rev-risk-cell",
      style: {
        fontSize: '0.9rem'
      }
    }, fmt$(pr.computedRisk)) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.75rem'
      }
    }, "enter data \u2191")), /*#__PURE__*/React.createElement("td", {
      style: {
        verticalAlign: 'middle'
      }
    }, pr.recoveryAmt > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "recovery-amount",
      style: {
        fontSize: '0.9rem'
      }
    }, "+", fmt$(pr.recoveryAmt)), /*#__PURE__*/React.createElement("div", {
      className: "recovery-label"
    }, "if ", parseFloat(f.targetRating).toFixed(1), "\u2605")) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--ink5)',
        fontSize: '0.75rem'
      }
    }, "-")));
  })), (totalMonthly > 0 || calcTotalRecovery > 0) && /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 4,
    style: {
      fontWeight: 600,
      fontSize: '0.78rem',
      color: 'var(--ink3)',
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, "Total"), /*#__PURE__*/React.createElement("td", {
    style: {
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, totalMonthly > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--amber)',
      fontSize: '0.95rem'
    }
  }, fmt$(totalMonthly)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink4)',
      marginTop: 2
    }
  }, fmt$(totalMonthly * 12), "/yr"))), /*#__PURE__*/React.createElement("td", {
    style: {
      paddingTop: 12,
      borderTop: '2px solid var(--cream2)'
    }
  }, calcTotalRecovery > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--forest)',
      fontSize: '0.95rem'
    }
  }, "+", fmt$(calcTotalRecovery)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.72rem',
      color: 'var(--ink4)',
      marginTop: 2
    }
  }, "+", fmt$(calcTotalRecovery * 12), "/yr")))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 14px',
      fontSize: '0.72rem',
      color: 'var(--ink5)',
      borderTop: '1px solid var(--cream2)',
      lineHeight: 1.5
    }
  }, "Estimates use Sentopi's conversion rate model (Spiegel, PowerReviews, Pattern). Override units and target rating with your actual data for a sharper number."))), /*#__PURE__*/React.createElement(WatchList, {
    items: data.productsExcluded || []
  }), /*#__PURE__*/React.createElement(Methodology, null), /*#__PURE__*/React.createElement("div", {
    className: "trust-strip no-print"
  }, /*#__PURE__*/React.createElement("span", null, "Built on live Amazon signals"), /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), /*#__PURE__*/React.createElement("span", null, "90-day window"), /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), /*#__PURE__*/React.createElement("span", null, "Refreshed daily"), /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), /*#__PURE__*/React.createElement("span", null, "No account required")), /*#__PURE__*/React.createElement("div", {
    className: "bottom-cta animate-in"
  }, /*#__PURE__*/React.createElement("h3", null, hasRatingDrop ? 'Your score is slipping. Find out exactly why.' : label === 'Healthy' ? 'You\'re ahead. Stay there.' : 'Something is off. Your reviews hold the answer.'), /*#__PURE__*/React.createElement("p", null, hasRatingDrop ? 'Sentopi reads every review and hands you a prioritized action plan: what changed, who is affected, and what to fix first to recover the revenue.' : label === 'Healthy' ? 'Sentopi monitors every new review on your top SKUs and flags issues weeks before the star average moves. The earlier you catch a problem, the cheaper it is to fix.' : 'Sentopi surfaces the root causes your brand score cannot see: exact issues, customer language, and a prioritized action plan.'), /*#__PURE__*/React.createElement("a", {
    href: "#claim",
    className: "btn-cta-main",
    onClick: e => {
      e.preventDefault();
      document.getElementById('claim')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, hasRatingDrop ? 'Diagnose the drop →' : label === 'Healthy' ? 'Set up monitoring →' : 'Get the full analysis →')));
}

// ─── Input form ───────────────────────────────────────────────────────────────
function InputForm({
  onResult,
  autoRun,
  forcedInput
}) {
  const [input, setInput] = useState(autoRun || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  function cacheKey(v) {
    return `bh:${v.toLowerCase().trim()}`;
  }
  function readCache(val) {
    try {
      const raw = localStorage.getItem(cacheKey(val));
      if (!raw) return null;
      const {
        data,
        ts
      } = JSON.parse(raw);
      return Date.now() - ts < CACHE_TTL ? data : null;
    } catch {
      return null;
    }
  }
  function writeCache(val, data) {
    try {
      localStorage.setItem(cacheKey(val), JSON.stringify({
        data,
        ts: Date.now()
      }));
    } catch {/* storage full — silent fail */}
  }
  async function runAnalysis(val) {
    const cached = readCache(val);
    if (cached) {
      onResult(cached);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/.netlify/functions/brand-health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: val
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error || 'Something went wrong. Try again.');
      } else {
        writeCache(val, data);
        onResult(data);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          event: 'tool_usage',
          tool: 'revenue_risk_report'
        });
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    if (autoRun) runAnalysis(autoRun);
  }, []);
  React.useEffect(() => {
    if (forcedInput) setInput(forcedInput.asin);
  }, [forcedInput]);
  async function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    window.history.pushState({}, '', `?s=${encodeURIComponent(input.trim())}`);
    await runAnalysis(input.trim());
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, /*#__PURE__*/React.createElement("span", {
    className: "panel-header-title"
  }, "Analyze your brand"), /*#__PURE__*/React.createElement("span", {
    className: "panel-header-tag"
  }, "Free \xB7 ~30s")), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: handleSubmit
  }, /*#__PURE__*/React.createElement("div", {
    className: "input-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "input-wrap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "input-icon"
  }, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "main-input",
    placeholder: "Seller ID or ASIN  (e.g. A2YVQMS6C6QFJO)",
    value: input,
    onChange: e => setInput(e.target.value),
    disabled: loading
  })), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "btn-analyze",
    disabled: loading || !input.trim()
  }, loading ? 'Analyzing…' : 'Analyze Brand →')), /*#__PURE__*/React.createElement("p", {
    className: "input-hint"
  }, "Enter your Seller ID (e.g. ", /*#__PURE__*/React.createElement("code", null, "A2YVQMS6C6QFJO"), ") or an ASIN. Results in ~30 seconds. No account required.")), error && /*#__PURE__*/React.createElement("div", {
    className: "error-box"
  }, "\u26A0 ", error), loading && /*#__PURE__*/React.createElement("div", {
    className: "loading-box"
  }, /*#__PURE__*/React.createElement("div", {
    className: "spinner"
  }), /*#__PURE__*/React.createElement("div", {
    className: "loading-text"
  }, "Analyzing your brand across Amazon signals\u2026"))));
}

// ─── Share strip ──────────────────────────────────────────────────────────────
function ShareStrip({
  brandName
}) {
  const [copied, setCopied] = useState(false);
  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  function saveAsPdf() {
    window.print();
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "no-print",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginTop: 24,
      marginBottom: 8,
      padding: '12px 16px',
      background: 'var(--white)',
      border: '1px solid var(--cream3)',
      borderRadius: 8,
      boxShadow: '0 1px 4px rgba(26,23,20,0.04)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '0.78rem',
      color: 'var(--ink4)',
      fontWeight: 500,
      flex: 1
    }
  }, "Share this scorecard"), /*#__PURE__*/React.createElement("button", {
    onClick: copyLink,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 14px',
      background: copied ? 'var(--forest)' : 'var(--ink)',
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      fontSize: '0.78rem',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'background 0.2s'
    }
  }, copied ? '✓ Copied' : '🔗 Copy link'), /*#__PURE__*/React.createElement("button", {
    onClick: saveAsPdf,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 14px',
      background: 'none',
      color: 'var(--ink3)',
      border: '1px solid var(--cream3)',
      borderRadius: 6,
      fontSize: '0.78rem',
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit'
    }
  }, "\u2193 Save as PDF"));
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const autoRun = new URLSearchParams(window.location.search).get('s') || '';
  const fixtures = window.DEMO_FIXTURES || {};
  const chips = window.SAMPLE_CHIPS || [];

  // Single sample brand for the on-land preview. If ?s= is present in the URL,
  // the autoRun result overwrites this once the API returns.
  const SAMPLE_KEY = 'ratingSlip';
  const [result, setResult] = useState(autoRun ? null : fixtures[SAMPLE_KEY] || null);
  const [isDemo, setIsDemo] = useState(!autoRun);
  const [isChipResult, setIsChipResult] = useState(false);
  const [activeChip, setActiveChip] = useState(null);
  const [chipInput, setChipInput] = useState(null);
  const resultEl = React.useRef(null);
  const scorecardEl = React.useRef(null);
  function handleResult(data) {
    setResult(data);
    setIsDemo(false);
    setIsChipResult(false);
    setActiveChip(null);
    setTimeout(() => resultEl.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    }), 100);
  }
  function handleReset() {
    setResult(fixtures[SAMPLE_KEY] || null);
    setIsDemo(true);
    setIsChipResult(false);
    setActiveChip(null);
    setChipInput(null);
    window.history.pushState({}, '', window.location.pathname);
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
  function handleChipClick(chip) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'sample_chip_clicked',
      asin: chip.asin,
      chip_label: chip.label,
      page: 'revenue-risk-report'
    });
    setActiveChip(chip.key);
    setChipInput({
      asin: chip.asin,
      ts: Date.now()
    });
    setResult(chip.data);
    setIsDemo(false);
    setIsChipResult(true);
    setTimeout(() => resultEl.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    }), 100);
  }
  function scrollTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
  const brandName = result?.products?.[0]?.brand || '';
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "hero-v2 no-print"
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow"
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow-dot"
  }), " Free Revenue Risk Report"), /*#__PURE__*/React.createElement("h1", null, "Find the six-figure fix ", /*#__PURE__*/React.createElement("em", null, "hiding in your Amazon listing.")), /*#__PURE__*/React.createElement("p", {
    className: "hero-sub"
  }, "A slipping Best Seller Rank (BSR), a 0.3-star rating drop, a Buy Box you lost three weeks ago. These slow leaks quietly subtract from your topline. See yours, scored in dollars, in about 30 seconds."), /*#__PURE__*/React.createElement("div", {
    className: "hero-input-prompt"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hero-input-prompt-arrow"
  }, "\u2193"), " See your brand's report with just an ASIN."), /*#__PURE__*/React.createElement("div", {
    id: "hero-input",
    className: "hero-input-wrap"
  }, chips.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "demo-pills",
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pills-label"
  }, "Try a live sample:"), chips.map(chip => /*#__PURE__*/React.createElement("button", {
    key: chip.key,
    className: `demo-pill${activeChip === chip.key ? ' active' : ''}`,
    onClick: () => handleChipClick(chip)
  }, chip.label))), /*#__PURE__*/React.createElement(InputForm, {
    onResult: handleResult,
    autoRun: autoRun,
    forcedInput: chipInput
  })), /*#__PURE__*/React.createElement("div", {
    className: "hero-microcopy"
  }, "~30 seconds ", /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\xB7"), " No account required ", /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\xB7"), ' ', /*#__PURE__*/React.createElement("a", {
    href: "#claim",
    className: "hero-microcopy-link",
    onClick: e => {
      e.preventDefault();
      scrollTo('claim');
    }
  }, "Or get the deeper 48hr Custom Report \u2192")), /*#__PURE__*/React.createElement("div", {
    className: "hero-trust-strip no-print",
    "aria-label": "What powers the report"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-chip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-dot"
  }), " Live Amazon signals"), /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-chip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-dot"
  }), " 90-day signal window"), /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-chip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hero-trust-dot"
  }), " No affiliate rankings"))), result && /*#__PURE__*/React.createElement("div", {
    ref: resultEl,
    className: "demo-wrap"
  }, isDemo && /*#__PURE__*/React.createElement("div", {
    className: "demo-banner no-print"
  }, /*#__PURE__*/React.createElement("div", {
    className: "demo-banner-left"
  }, /*#__PURE__*/React.createElement("span", {
    className: "demo-banner-tag"
  }, "SAMPLE REPORT"), /*#__PURE__*/React.createElement("span", {
    className: "demo-banner-line1"
  }, "A free instant read on your listings or a competitor's. Paste an ASIN or Seller ID above to run yours.")), /*#__PURE__*/React.createElement("a", {
    href: "#hero-input",
    className: "demo-banner-cta",
    onClick: e => {
      e.preventDefault();
      document.querySelector('.main-input')?.focus({
        preventScroll: false
      });
      document.querySelector('.hero-input-wrap')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, "Paste yours \u2191")), !isDemo && !isChipResult && /*#__PURE__*/React.createElement("div", {
    className: "no-print",
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '0.78rem',
      color: 'var(--ink5)'
    }
  }, result.asinCountScored, " product", result.asinCountScored !== 1 ? 's' : '', " analyzed \xB7", ' ', result.entryPoint === 'seller' ? 'Seller ID lookup' : 'ASIN + variations'), /*#__PURE__*/React.createElement("button", {
    onClick: handleReset,
    style: {
      background: 'none',
      border: '1px solid var(--cream3)',
      color: 'var(--ink4)',
      fontSize: '0.8rem',
      padding: '5px 12px',
      borderRadius: 'var(--r)',
      cursor: 'pointer',
      fontFamily: 'inherit'
    }
  }, "\u2190 Back to example")), /*#__PURE__*/React.createElement("div", {
    ref: scorecardEl
  }, /*#__PURE__*/React.createElement(ScoreCard, {
    key: isDemo ? `demo-${SAMPLE_KEY}` : result.input,
    data: result
  })), !isDemo && /*#__PURE__*/React.createElement(ShareStrip, {
    brandName: brandName
  })), /*#__PURE__*/React.createElement("section", {
    className: "proof-section no-print"
  }, /*#__PURE__*/React.createElement("span", {
    className: "proof-eyebrow"
  }, "Why trust it"), /*#__PURE__*/React.createElement("h2", null, "Built from public Amazon data."), /*#__PURE__*/React.createElement("div", {
    className: "proof-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "proof-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "proof-card-num"
  }, "90 days"), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-title"
  }, "Of BSR, rating, and Buy Box history."), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-body"
  }, "The same Amazon signals your paid analyst tools surface, scored against revenue impact instead of vanity charts.")), /*#__PURE__*/React.createElement("div", {
    className: "proof-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "proof-card-num"
  }, "3 pillars"), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-title"
  }, "BSR (40%), rating (35%), Buy Box (25%)."), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-body"
  }, "Each weighted by how much it actually moves topline. A 0.3-star slip on a high-volume SKU outranks a small BSR wobble on a long-tail one.")), /*#__PURE__*/React.createElement("div", {
    className: "proof-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "proof-card-num"
  }, "$ impact"), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-title"
  }, "Every signal priced in dollars."), /*#__PURE__*/React.createElement("div", {
    className: "proof-card-body"
  }, "Active rating drops, chronic gaps below the 4.5\u2605 peak, and lost Buy Box windows all converted to monthly and annual exposure on your own units and price."))), /*#__PURE__*/React.createElement("div", {
    className: "faq-strip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "faq-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "faq-q"
  }, "Is the data real?"), /*#__PURE__*/React.createElement("div", {
    className: "faq-a"
  }, "Yes. Live Amazon signals on every run. The numbers match what your paid analyst tools already show. No estimates, no scraping, no AI-fabricated figures.")), /*#__PURE__*/React.createElement("div", {
    className: "faq-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "faq-q"
  }, "What does it cost?"), /*#__PURE__*/React.createElement("div", {
    className: "faq-a"
  }, "Nothing for the first report. No card, no trial timer. The free version is the report; the paid version is monthly tracking and recommendations.")), /*#__PURE__*/React.createElement("div", {
    className: "faq-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "faq-q"
  }, "Will I get spammed?"), /*#__PURE__*/React.createElement("div", {
    className: "faq-a"
  }, "One email when your report is ready. Your address stays with us, no third-party sharing, unsubscribe in one click.")))), /*#__PURE__*/React.createElement("section", {
    className: "tease-section no-print"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tease-eyebrow"
  }, "In the 48hr Custom Report"), /*#__PURE__*/React.createElement("h2", null, "What you'll actually see on your brand."), /*#__PURE__*/React.createElement("div", {
    className: "tease-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tease-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tease-num"
  }, "100"), /*#__PURE__*/React.createElement("div", {
    className: "tease-title"
  }, "Of your real reviews, decomposed."), /*#__PURE__*/React.createElement("div", {
    className: "tease-body"
  }, "Each complaint sorted into listing, product, or ops. So you know which ones a copy edit can fix and which ones need engineering.")), /*#__PURE__*/React.createElement("div", {
    className: "tease-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tease-num"
  }, "P0 to P3"), /*#__PURE__*/React.createElement("div", {
    className: "tease-title"
  }, "Priority-scored, owner-assigned."), /*#__PURE__*/React.createElement("div", {
    className: "tease-body"
  }, "Every issue ranked by revenue impact, with the team that owns the fix already named on the line.")), /*#__PURE__*/React.createElement("div", {
    className: "tease-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tease-num"
  }, "48h"), /*#__PURE__*/React.createElement("div", {
    className: "tease-title"
  }, "Delivered in under two business days."), /*#__PURE__*/React.createElement("div", {
    className: "tease-body"
  }, "No async waiting. The full report lands in your inbox, ready to share with your team in your next standup."))), /*#__PURE__*/React.createElement("div", {
    className: "bridge-cta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bridge-cta-text"
  }, /*#__PURE__*/React.createElement("strong", null, "The Revenue Risk Report tells you where the leak is."), /*#__PURE__*/React.createElement("span", null, " The 48hr Custom Report tells you why and what to fix.")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "bridge-cta-btn",
    "aria-label": "Scroll to the 48hr Custom Report form",
    onClick: () => scrollTo('claim')
  }, "Get My Free 48hr Report \u2192"))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));

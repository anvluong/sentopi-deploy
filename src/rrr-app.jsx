const { useState, useCallback } = React;

// ─── Conversion rate model — identical to calculator.html ─────────────────────
const CONV_TABLE = [
  { r: 1.0, i: 0.40 }, { r: 2.0, i: 0.55 }, { r: 2.5, i: 0.65 },
  { r: 3.0, i: 0.75 }, { r: 3.5, i: 0.85 }, { r: 4.0, i: 0.92 },
  { r: 4.2, i: 0.96 }, { r: 4.5, i: 1.00 }, { r: 4.7, i: 0.99 },
  { r: 5.0, i: 0.87 },
];
function convRate(rating) {
  if (!rating || rating <= CONV_TABLE[0].r) return CONV_TABLE[0].i;
  if (rating >= CONV_TABLE[CONV_TABLE.length - 1].r) return CONV_TABLE[CONV_TABLE.length - 1].i;
  for (let j = 0; j < CONV_TABLE.length - 1; j++) {
    const lo = CONV_TABLE[j], hi = CONV_TABLE[j + 1];
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

// Total monthly $ exposure across all products using each product's default
// units/price — mirrors ScoreCard's pre-edit state (see ScoreCard, ~L760-782).
// Used by the above-fold SummaryStrip to surface a headline figure without the
// interactive calculator.
function defaultExposure(products) {
  if (!products) return 0;
  return products.reduce((sum, p) => {
    const units = parseFloat(p.defaultUnits) || 0;
    const price = parseFloat(p.defaultPrice) || 0;
    const rb = p.pillar_rating?.rating30dAgo;
    const rn = p.pillar_rating?.current;
    const risk    = p.pillar_rating?.ratingDropped30d ? calcRevenueAtRisk(units, price, rb, rn) : 0;
    const chronic = !p.pillar_rating?.ratingDropped30d ? calcChronicGap(units, price, rn) : 0;
    const bbLoss  = calcBBLoss(units, price, p.pillar_buybox?.bbPct30d);
    return sum + risk + chronic + bbLoss;
  }, 0);
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
  return { cls, text: sign + d };
}
function pillarHealth(score, max) {
  const p = score / max;
  if (p >= 0.75) return 'healthy';
  if (p >= 0.45) return 'warning';
  return 'danger';
}
function labelClass(l) { return l === 'Healthy' ? 'healthy' : l === 'At Risk' ? 'at-risk' : 'critical'; }
function labelColor(l) { return l === 'Healthy' ? '#059669' : l === 'At Risk' ? '#d97706' : '#dc2626'; }
function scoreChip(c) { return c >= 75 ? 'good' : c >= 45 ? 'mid' : 'bad'; }
const CAP_REASON_COPY = {
  'Lost Buy Box on one or more products': { icon: '🚨', text: 'Buy Box lost on key products' },
  'Rating dropped in the last 30 days':   { icon: '⚠️', text: 'Active rating drop' },
  'Competitor undercutting detected':      { icon: '⬇️', text: 'Competitor undercutting you' },
};
function monthName(dateStr) {
  if (!dateStr) return 'recent';
  try { return new Date(dateStr + 'T12:00:00').toLocaleString('en-US', { month: 'long' }); }
  catch { return 'recent'; }
}

// ─── Rating sparkline (90d ago → 30d ago → now) ──────────────────────────────
function RatingSparkline({ r90, r30, rNow }) {
  const pts = [r90, r30, rNow].filter(v => v != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts, 3.5);
  const hi = Math.max(...pts, 4.7);
  const span = Math.max(0.4, hi - lo);
  const w = 56, h = 18, pad = 2;
  const xs = pts.map((_, i) => pad + (i * (w - 2*pad)) / (pts.length - 1));
  const ys = pts.map(v => h - pad - ((v - lo) / span) * (h - 2*pad));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const dropped = pts[pts.length - 1] < pts[0];
  const color = dropped ? '#dc2626' : '#059669';
  return (
    <svg width={w} height={h} style={{ display: 'block', marginTop: 3 }} aria-label="rating trend">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={i === xs.length - 1 ? 1.8 : 1.2} fill={color} />
      ))}
    </svg>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function headlineScore(data) {
  /* The flywheel composite is the headline whenever it exists. The pillar
     brandScore uses a different weighting, so rendering both as "the score"
     put two different numbers for one brand on the same screen. The pillar
     figures survive below as signal detail. */
  const fw = data && data.flywheel;
  if (fw && fw.compositeScore !== null && fw.compositeScore !== undefined) {
    const score = Math.round(fw.compositeScore);
    const label = score >= 75 ? 'Healthy' : score >= 50 ? 'At Risk' : 'Critical';
    return { score, label, isFlywheel: true };
  }
  return { score: data ? data.brandScore : 0, label: data ? data.label : 'At Risk', isFlywheel: false };
}

function ScoreRing({ score, label }) {
  const r = 42, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 100 100">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5d9c8" strokeWidth="7"/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={labelColor(label)} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)' }}/>
      </svg>
      <div className="score-ring-text">
        <span className="score-number">{score}</span>
        <span className="score-denom">/100</span>
      </div>
    </div>
  );
}

// ─── Tooltip (portal-based to escape table overflow clipping) ────────────────
function Tip({ text }) {
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  function show() {
    const r = ref.current.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top });
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span ref={ref} className="col-tip-icon"
        onMouseEnter={show} onMouseLeave={() => setPos(null)}>i</span>
      {pos && ReactDOM.createPortal(
        <span style={{
          position: 'fixed', left: pos.x, top: pos.y - 8,
          transform: 'translate(-50%, -100%)',
          background: '#1a1714', color: '#fff',
          fontSize: '0.72rem', lineHeight: 1.5,
          padding: '7px 10px', borderRadius: '4px',
          width: '220px', zIndex: 9999,
          pointerEvents: 'none', fontWeight: 400,
          textAlign: 'left', whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>{text}</span>,
        document.body
      )}
    </span>
  );
}

// ─── Revenue Deep Dive table ──────────────────────────────────────────────────
function RevenueDeepDive({ productRevs, fields, onUpdate, totalMonthly, totalAnnual, noWrapper = false }) {
  const sorted = [...productRevs].sort((a, b) => (b.computedRisk || 0) - (a.computedRisk || 0));

  // Compute per-row recovery and total
  let totalRecovery = 0;
  const rows = sorted.map(pr => {
    const f = fields[pr.asin] || {};
    const units        = parseFloat(f.units) || 0;
    const price        = parseFloat(f.price) || 0;
    const targetRating = parseFloat(f.targetRating) || 0;
    const currentRating = pr.pillar_rating.current || 0;
    const recoveryAmt = (targetRating > currentRating && units > 0 && price > 0)
      ? Math.max(0, Math.round(units * price * (convRate(targetRating) - convRate(currentRating))))
      : 0;
    totalRecovery += recoveryAmt;
    return { ...pr, recoveryAmt };
  });

  const tableContent = (
    <div style={{ overflowX: 'auto' }}>
      <table className="products-table">
        <SharedColGroup />
        <thead>
          <tr>
            <th>Product</th>
            <th>Rating</th>
            <th>Monthly Units</th>
            <th>Price (USD)</th>
            <th style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                <span style={{ whiteSpace: 'normal', lineHeight: 1.35, textAlign: 'right' }}>Monthly<br/>Risk</span>
                <Tip text="Revenue you're leaving on the table vs. your star rating from 30 days ago." />
              </span>
            </th>
            <th style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                <span style={{ whiteSpace: 'normal', lineHeight: 1.35, textAlign: 'right' }}>Upside<br/>Potential</span>
                <Tip text="Additional monthly revenue if you recover to your target star rating." />
              </span>
            </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(pr => {
              const f = fields[pr.asin] || {};
              const rat = pr.pillar_rating;

              return (
                <tr key={pr.asin}>
                  <td>
                    <div className="p-title">{pr.title ? pr.title.slice(0, 40) + (pr.title.length > 40 ? '…' : '') : pr.asin}</div>
                    <div className="asin-code">{pr.asin}</div>
                    {/* Target rating input */}
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: '0.67rem', color: 'var(--ink5)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Target ★</span>
                      <input
                        type="number"
                        min="1" max="5" step="0.1"
                        className="target-rating-input"
                        value={f.targetRating}
                        onChange={e => onUpdate(pr.asin, 'targetRating', e.target.value)}
                      />
                      <span style={{ fontSize: '0.67rem', color: 'var(--ink5)' }}>★</span>
                    </div>
                  </td>
                  {/* Rating column */}
                  <td style={{ verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {rat.current ? rat.current.toFixed(1) + '★' : '-'}
                      {rat.ratingDropped30d && <span style={{ marginLeft: 4, fontSize: '0.8rem' }}>⚠️</span>}
                    </div>
                    {rat.ratingDropped30d && rat.delta30d != null ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--rust)', fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap' }}>
                        {rat.delta30d} MoM
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink5)', marginTop: 2, whiteSpace: 'nowrap' }}>stable</div>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      className="rev-deep-input"
                      value={f.units}
                      placeholder="e.g. 10000"
                      onChange={e => onUpdate(pr.asin, 'units', e.target.value)}
                    />
                    <div className="rev-source-tag-sm">
                      {f.unitsDirty ? 'your value' : pr.defaultUnits ? `~${pr.defaultUnits.toLocaleString()} (est.)` : 'enter units'}
                    </div>
                  </td>
                  <td>
                    <div className="rev-deep-price-wrap">
                      <span className="rev-deep-prefix">$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="rev-deep-input rev-deep-price-input"
                        value={f.price}
                        placeholder="33.99"
                        onChange={e => onUpdate(pr.asin, 'price', e.target.value)}
                      />
                    </div>
                    <div className="rev-source-tag-sm">
                      {f.priceDirty ? 'your value' : pr.defaultPrice ? `$${pr.defaultPrice.toFixed(2)} (${pr.defaultPriceSource === 'bb' ? 'Buy Box' : pr.defaultPriceSource === 'asp' ? 'ASP est.' : 'List est.'})` : 'enter price'}
                    </div>
                  </td>
                  {/* Monthly Risk */}
                  <td style={{ verticalAlign: 'middle' }}>
                    {!pr.pillar_rating.ratingDropped30d
                      ? <div style={{ color: 'var(--ink5)', fontSize: '0.8rem' }}>-</div>
                      : pr.computedRisk > 0
                        ? <div className="rev-risk-cell" style={{ fontSize: '0.9rem' }}>{fmt$(pr.computedRisk)}</div>
                        : <div style={{ color: 'var(--ink5)', fontSize: '0.75rem' }}>enter data ↑</div>
                    }
                  </td>
                  {/* Upside Potential */}
                  <td style={{ verticalAlign: 'middle' }}>
                    {pr.recoveryAmt > 0 ? (
                      <>
                        <div className="recovery-amount" style={{ fontSize: '0.9rem' }}>+{fmt$(pr.recoveryAmt)}</div>
                        <div className="recovery-label">if {parseFloat(f.targetRating).toFixed(1)}★</div>
                      </>
                    ) : (
                      <div style={{ color: 'var(--ink5)', fontSize: '0.75rem' }}>-</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {(totalMonthly > 0 || totalRecovery > 0) && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--ink3)', paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                  Total
                </td>
                <td style={{ paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                  {totalMonthly > 0 && (
                    <>
                      <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: '0.95rem' }}>{fmt$(totalMonthly)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink4)', marginTop: 2 }}>{fmt$(totalMonthly * 12)}/yr</div>
                    </>
                  )}
                </td>
                <td style={{ paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                  {totalRecovery > 0 && (
                    <>
                      <div style={{ fontWeight: 700, color: 'var(--forest)', fontSize: '0.95rem' }}>+{fmt$(totalRecovery)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--ink4)', marginTop: 2 }}>+{fmt$(totalRecovery * 12)}/yr</div>
                    </>
                  )}
                </td>
              </tr>
            </tfoot>
          )}
      </table>
    </div>
  );

  if (noWrapper) return tableContent;

  return (
    <div className="products-section animate-in" style={{ marginBottom: 16 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream2)' }}>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.1rem', fontWeight: 400, color: 'var(--ink)', marginBottom: 2 }}>
          Monthly Risk &amp; Upside Calculator
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--ink5)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          {productRevs.length} product{productRevs.length !== 1 ? 's' : ''}
        </div>
      </div>
      {tableContent}
      <div style={{ padding: '10px 14px', fontSize: '0.72rem', color: 'var(--ink5)', borderTop: '1px solid var(--cream2)', lineHeight: 1.5 }}>
        Estimates use Sentopi's conversion rate model. Update units and target rating with your actual data for accuracy.
      </div>
    </div>
  );
}

// ─── Headline narrative ───────────────────────────────────────────────────────
function HeadlineNarrative({ data, totalRiskMonthly, worstProduct }) {
  const { label, products, brandScore } = data;
  const annual = totalRiskMonthly * 12;

  // Critical / At Risk → lead with the dollar amount + the product driving it
  if (label !== 'Healthy' && totalRiskMonthly > 0 && worstProduct) {
    const title = truncTitle(worstProduct.title, 50) || worstProduct.asin;
    const tone = label === 'Critical' ? 'critical' : 'risk';
    const icon = label === 'Critical' ? '🚨' : '⚠️';
    return (
      <div className={`narrative ${tone} animate-in`}>
        <span className="narrative-icon">{icon}</span>
        <div className="narrative-body">
          Your biggest revenue risk is <strong>"{title}"</strong>, losing an estimated{' '}
          <span className="narrative-amount">{fmt$(totalRiskMonthly)}/mo</span>{' '}
          (<strong>{fmt$(annual)}/yr</strong>) across the signals below.
        </div>
      </div>
    );
  }

  // Healthy → lead with the strongest signal as a "stay ahead" framing
  if (label === 'Healthy') {
    // Find the most improved BSR product
    const bestBSR = products
      .filter(p => p.pillar_bsr.delta90dPct !== null && p.pillar_bsr.delta90dPct < 0)
      .sort((a, b) => a.pillar_bsr.delta90dPct - b.pillar_bsr.delta90dPct)[0];
    const bestRating = products
      .filter(p => (p.pillar_rating.current || 0) >= 4.5)
      .sort((a, b) => (b.pillar_rating.current || 0) - (a.pillar_rating.current || 0))[0];

    let copy = (
      <>Your brand scored <strong>{brandScore}/100</strong>. No active revenue threats detected across BSR,
        rating trajectory, or Buy Box in the last 90 days.</>
    );
    if (bestBSR && bestBSR.pillar_bsr.delta90dPct < -10) {
      copy = (
        <>Your strongest signal: <strong>"{truncTitle(bestBSR.title, 50) || bestBSR.asin}"</strong> improved BSR by{' '}
          <strong>{Math.abs(bestBSR.pillar_bsr.delta90dPct).toFixed(0)}%</strong> over 90 days. No active revenue
          threats detected, but a single bad review cycle could change that.</>
      );
    } else if (bestRating) {
      copy = (
        <>Your strongest signal: <strong>"{truncTitle(bestRating.title, 50) || bestRating.asin}"</strong> holds at{' '}
          <strong>{bestRating.pillar_rating.current.toFixed(1)}★</strong>, squarely in the high-conversion zone.
          No active threats detected.</>
      );
    }
    return (
      <div className="narrative safe animate-in">
        <span className="narrative-icon">✅</span>
        <div className="narrative-body">{copy}</div>
      </div>
    );
  }

  // At Risk but no quantified $ yet (user hasn't entered units, or signals are non-financial)
  return (
    <div className="narrative risk animate-in">
      <span className="narrative-icon">⚠️</span>
      <div className="narrative-body">
        Your brand scored <strong>{brandScore}/100</strong>. We detected risk signals below. Enter monthly units
        on at-risk products to see the dollar impact.
      </div>
    </div>
  );
}

// ─── Per-signal recommendations ──────────────────────────────────────────────
function Recommendations({ data, brandRiskMonthly, brandBBLoss, brandChronicGap }) {
  const { products, label } = data;

  const recs = [];

  // 1) Worst rating drop
  const worstDrop = products
    .filter(p => p.pillar_rating.ratingDropped30d)
    .sort((a, b) => (a.pillar_rating.delta30d || 0) - (b.pillar_rating.delta30d || 0))[0];
  if (worstDrop) {
    const t = truncTitle(worstDrop.title) || worstDrop.asin;
    const dropMo = monthName(worstDrop.pillar_rating.dropDate);
    recs.push({
      tag: 'Rating drop', tagCls: 'rust',
      title: `Investigate "${t}": rating fell to ${worstDrop.pillar_rating.current}★ around ${dropMo}.`,
      sub: 'Pull every review from the drop window. Look for a single repeating issue (defect, expectation gap, packaging change). One pattern usually drives most of the drop.',
    });
  }

  // 2) Lost Buy Box — only flag if materially below 90%
  const lbbProduct = products
    .filter(p => p.pillar_buybox.lbbDetected && (p.pillar_buybox.bbPct30d || 100) < 90)
    .sort((a, b) => (a.pillar_buybox.bbPct30d || 0) - (b.pillar_buybox.bbPct30d || 0))[0];
  if (lbbProduct) {
    const t = truncTitle(lbbProduct.title) || lbbProduct.asin;
    const pct = lbbProduct.pillar_buybox.bbPct30d;
    const undercut = lbbProduct.pillar_buybox.competitorUndercut;
    recs.push({
      tag: 'Buy Box', tagCls: 'amber',
      title: `Reclaim Buy Box on "${t}": holding only ${pct?.toFixed?.(0) ?? '-'}% of the time.`,
      sub: undercut
        ? 'A competitor is undercutting your price. Verify stock health, then test a matched price or a coupon to recover share.'
        : 'Check inventory, fulfillment latency, and seller-rating health. Out-of-stock and late shipments are the usual culprits.',
    });
  }

  // 3) Chronic underperformance (largest gap to 4.5★)
  const chronic = products
    .filter(p => (p.pillar_rating.current || 0) > 0 && (p.pillar_rating.current || 0) < 4.4 && !p.pillar_rating.ratingDropped30d)
    .sort((a, b) => (a.pillar_rating.current || 0) - (b.pillar_rating.current || 0))[0];
  if (chronic) {
    const t = truncTitle(chronic.title) || chronic.asin;
    recs.push({
      tag: 'Chronic gap', tagCls: 'amber',
      title: `Lift "${t}" from ${chronic.pillar_rating.current}★: every 0.2★ here meaningfully shifts conversion.`,
      sub: 'Two paths: (1) eliminate the top 1-star theme so new reviews skew higher, (2) accelerate review velocity from satisfied buyers so the existing 1-stars get diluted.',
    });
  }

  // 4) BSR deteriorating
  const bsrSlip = products
    .filter(p => p.pillar_bsr.delta90dPct !== null && p.pillar_bsr.delta90dPct > 15)
    .sort((a, b) => (b.pillar_bsr.delta90dPct || 0) - (a.pillar_bsr.delta90dPct || 0))[0];
  if (bsrSlip) {
    const t = truncTitle(bsrSlip.title) || bsrSlip.asin;
    recs.push({
      tag: 'BSR slip', tagCls: 'amber',
      title: `"${t}" rank worsened ${bsrSlip.pillar_bsr.delta90dPct.toFixed(0)}% over 90 days.`,
      sub: 'Map rank decline to the same window as rating / pricing / inventory changes. The trigger is usually one of those three.',
    });
  }

  // Healthy path — defensive recommendations
  if (!recs.length && label === 'Healthy') {
    recs.push({
      tag: 'Stay ahead', tagCls: 'green',
      title: 'Set up sentiment monitoring on your top SKUs.',
      sub: "When ratings start to slip, you're already 2–4 weeks behind the review wave that caused it. Catch the language change as it happens, before the star average moves.",
    });
    recs.push({
      tag: 'Compound it', tagCls: 'green',
      title: 'Run a review-velocity push on your highest-margin SKU.',
      sub: 'A 4.5★ product with 2× review velocity dominates the long tail of search. The math: more reviews = more rank = more conversion = more reviews.',
    });
  }

  if (!recs.length) return null;

  return (
    <div className="rec-strip animate-in">
      <div className="rec-strip-head">Top {Math.min(recs.length, 3)} action{recs.length === 1 ? '' : 's'} this week</div>
      {recs.slice(0, 3).map((r, i) => (
        <div key={i} className="rec-item">
          <div className={`rec-item-num ${label === 'Healthy' ? 'safe' : ''}`}>{i + 1}</div>
          <div className="rec-item-body">
            <span className={`rec-item-tag ${r.tagCls}`}>{r.tag}</span>
            <strong>{r.title}</strong>
            <div style={{ marginTop: 3, color: 'var(--ink4)', fontSize: '0.82rem' }}>{r.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Watch List (new / sparse ASINs) ─────────────────────────────────────────
function WatchList({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="watchlist animate-in">
      <div className="watchlist-head">
        <div className="watchlist-title">Launch Watch List</div>
        <span className="watchlist-tag">{items.length} new ASIN{items.length === 1 ? '' : 's'}</span>
      </div>
      <div className="watchlist-sub">
        Excluded from the brand score (under 25 reviews). For new launches, the first 90 days are make-or-break:
        early 1-stars set the trajectory. Watch these closely.
      </div>
      {items.map(p => {
        const r = p.pillar_rating?.current;
        const rc = p.reviewCount || 0;
        const fragile = r != null && r < 4.0 && rc < 25;
        return (
          <div key={p.asin} className="watchlist-row">
            <div>
              <div className="p-title">{p.title ? p.title.slice(0, 50) + (p.title.length > 50 ? '…' : '') : p.asin}</div>
              <div className="asin-code">{p.asin}</div>
              {fragile && (
                <div style={{ fontSize: '0.72rem', color: 'var(--rust)', fontWeight: 600, marginTop: 3 }}>
                  ⚠️ Early reviews skew low. Investigate before the pattern locks in.
                </div>
              )}
            </div>
            <div className="watchlist-metric">
              <span className="lbl">Reviews</span>
              <strong>{rc}</strong>
            </div>
            <div className="watchlist-metric">
              <span className="lbl">Rating</span>
              <strong>{r != null ? r.toFixed(1) + '★' : '-'}</strong>
            </div>
            <div className="watchlist-metric">
              <span className="lbl">Buy Box</span>
              <strong>{p.pillar_buybox?.bbPct30d != null ? fmtPct(p.pillar_buybox.bbPct30d) : '-'}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Methodology drawer ──────────────────────────────────────────────────────
function Methodology() {
  const [open, setOpen] = useState(false);
  return (
    <div className="meth no-print">
      <button className="meth-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>How we calculate this</span>
        <span className="chev">▸</span>
      </button>
      {open && (
        <div className="meth-body">
          <h4>Data sources</h4>
          <p>Best Seller Rank, star rating history, review count, list price, Buy Box ownership, and average sale price are pulled from live Amazon signals over a 90-day window. Updated daily.</p>

          <h4>Flywheel Score (0–100)</h4>
          <p>The headline number is a weighted mean of the five levers, over the levers we could actually measure from public data. Weights: Operations 22, Pricing 22, Assortment 14, Visibility 20, Ratings 22.</p>
          <ul>
            <li><strong>Operations:</strong> share of the last 30 days you held the Buy Box, plus time out of stock.</li>
            <li><strong>Pricing:</strong> where your price sits in its own 90-day range, the month-over-month move in average selling price, discount against list, and how many sellers compete on the listing.</li>
            <li><strong>Assortment:</strong> how many listings are in the variant family and how many of them carry reviews and the Buy Box.</li>
            <li><strong>Visibility:</strong> Best Seller Rank trajectory over 90 and 30 days.</li>
            <li><strong>Ratings:</strong> current rating, the 30 and 90 day move, and review velocity.</li>
          </ul>
          <p>A lever we cannot measure is reported as not measured, with the reason stated. It is never given a score, and it is left out of the mean rather than counted as a zero. When fewer than three levers can be measured we show the levers without a headline score, because an average of two is not a brand score.</p>

          <h4>Signal detail (0–100)</h4>
          <ul>
            <li><strong>BSR Health (40 pts):</strong> 90-day rank trajectory. Each 10% deterioration costs 4 points.</li>
            <li><strong>Rating Health (35 pts):</strong> Penalizes both the absolute drop and the recency. A drop in the last 30 days hurts more than a drop 60 days ago.</li>
            <li><strong>Buy Box Health (25 pts):</strong> % of time you held the Buy Box in the last 30 days. Extra penalty when competitors undercut.</li>
          </ul>
          <p>These three readings sit underneath the levers and use their own weighting, so the detail score and the Flywheel Score answer different questions and will not match.</p>

          <h4>Revenue at risk</h4>
          <p>For each product where the rating dropped, we apply a conversion-rate index by star rating (based on Spiegel Research Center 2017, PowerReviews, and Pattern.com). Conversion peaks around 4.5★ and declines toward 5.0★ ("too good to be true" skepticism).</p>
          <p>Monthly risk = <code>units × price × (conv@oldRating − conv@newRating)</code>. We default units to the Amazon monthly-sold estimate and price to your Buy Box modal price. Override either for a sharper number.</p>

          <h4>Chronic gap & Buy Box loss</h4>
          <p>We also surface (a) chronic underperformance: revenue left on the table by sitting below the 4.5★ peak, even without a recent drop, and (b) Buy Box loss: assuming a 40% capture rate by competing sellers during the windows you don't hold the Buy Box. The rest is split between brand-loyal direct buys, off-Amazon purchase, and no purchase at all.</p>

          <h4>Limitations</h4>
          <ul>
            <li>Estimates are observational, not causal. Actual lift varies by category, price point, and competitive density.</li>
            <li>Brand score caps at "At Risk" when an active rating drop or lost Buy Box is detected, even if the underlying pillar math is otherwise high.</li>
            <li>Products under 25 reviews are excluded from the brand-score rollup. They appear in the Watch List instead.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Pillar cards ─────────────────────────────────────────────────────────────
function PillarCard({ name, metric, metricSub, score, max, flags }) {
  const noData = score === null || score === undefined;
  const pct    = noData ? 0 : Math.round((score / max) * 100);
  const health = noData ? '' : pillarHealth(score, max);
  return (
    <div className="pillar-card animate-in">
      <div className="pillar-name">{name}</div>
      <div className="pillar-metric">{metric}</div>
      <div className="pillar-metric-sub">{metricSub || ''}</div>
      <div className="pillar-bar-track">
        <div className={`pillar-bar-fill ${health}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="pillar-score-line">
        Score: <strong>{noData ? '-' : `${score}/${max}`}</strong>
      </div>
      {flags && flags.map((f, i) => (
        <div key={i} className={`pillar-flag ${f.color}`}>{f.icon} {f.text}</div>
      ))}
    </div>
  );
}

// ─── Retail Flywheel ──────────────────────────────────────────────────────────
// Renders the five-lever payload described in skills/sentopi-qa/FLYWHEEL-CONTRACT.md.
// This is the React twin of renderFlywheel() in index.html: same class names, same
// order, same rules, so the homepage cockpit and this page read identically.
// Returns null when the payload is absent, so an older cached response still
// renders the signal detail below it on its own.
/* The flywheel scorecard is rendered by flywheel-view.js, the same module the
   homepage uses, so a behavioural fix lands on both surfaces at once. It used
   to exist twice, once here in JSX and once in vanilla JS. The module escapes
   every interpolated value, so the markup is safe to inject. */
function Flywheel({ fw, riskAnnual }) {
  const html = (typeof window !== 'undefined' && window.FlywheelView)
    ? window.FlywheelView.render(fw, riskAnnual)
    : '';
  if (!html) return null;
  return <div className="fw-card" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Shared colgroup — both tables use identical widths for column alignment ──
const SharedColGroup = () => (
  <colgroup>
    <col style={{ width: '22%' }} />
    <col style={{ width: '12%' }} />
    <col style={{ width: '16%' }} />
    <col style={{ width: '14%' }} />
    <col style={{ width: '18%' }} />
    <col style={{ width: '18%' }} />
  </colgroup>
);

// ─── Products table ───────────────────────────────────────────────────────────
function ProductsTable({ products, weights, noWrapper = false }) {
  const inner = (
    <>
      <div className="products-header">Products Analyzed ({products.length})</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="products-table">
          <SharedColGroup />
          <thead>
            <tr>
              <th>Product</th>
              <th>Rating</th>
              <th className="bsr-header">Best Seller<br/>Rank</th>
              <th>Buy Box</th>
              <th>ASP</th>
              <th className="col-score">Score</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const rat  = p.pillar_rating;
              const bsr  = p.pillar_bsr;
              const bb   = p.pillar_buybox;
              const d30  = fmtDelta(rat.delta30d, true);  // inverse: drop is bad
              const bsrD = fmtDelta(bsr.delta90dPct, false); // increase is bad
              return (
                <tr key={p.asin}>
                  <td>
                    <div className="p-title">{p.title ? p.title.slice(0,45) + (p.title.length > 45 ? '…' : '') : p.asin}</div>
                    <div className="asin-code">{p.asin}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{rat.current ? rat.current.toFixed(1) + '★' : '-'}</div>
                    {d30 && <div className={d30.cls} style={{ fontSize: '0.75rem' }}>{d30.text} vs. 30d</div>}
                    {rat.ratingDropped30d && <span title="Rating dropped" style={{ fontSize: '0.8rem' }}>⚠️</span>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{bsr.current ? '#' + bsr.current.toLocaleString() : '-'}</div>
                    {bsrD && bsr.delta90dPct !== null && (
                      <div className={bsrD.cls} style={{ fontSize: '0.75rem' }}>{bsrD.text}% vs. 90d</div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{bb.bbPct30d !== null ? fmtPct(bb.bbPct30d) : '-'}</div>
                    {bb.lbbDetected && <div style={{ fontSize: '0.72rem', color: 'var(--rust)', fontWeight: 600 }}>🚨 LBB</div>}
                    {bb.competitorUndercut && bb.lowestCompetitorPrice && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>
                        Competitor: ${(bb.lowestCompetitorPrice / 100).toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.asp30d != null ? (
                      <>
                        <div style={{ fontWeight: 600 }}>${p.asp30d.toFixed(2)}</div>
                        {p.aspMoMPct != null && (() => {
                          const d = fmtDelta(p.aspMoMPct, true);
                          return d ? <div className={d.cls} style={{ fontSize: '0.75rem' }}>{d.text}% MoM</div> : null;
                        })()}
                        {p.listPrice != null && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--ink5)', marginTop: 1 }}>
                            List ${p.listPrice.toFixed(2)}
                          </div>
                        )}
                      </>
                    ) : <span style={{ color: 'var(--ink5)' }}>-</span>}
                  </td>
                  <td className="col-score"><span className={`score-chip ${scoreChip(p.composite)}`}>{p.composite}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
  return noWrapper ? inner : <div className="products-section animate-in">{inner}</div>;
}

// ─── Score card ───────────────────────────────────────────────────────────────
function ScoreCard({ data, lede = true }) {
  const { brandScore, label, capReasons, ratingDropDetails, products,
          productsExcluded, weights, asinCountExcluded } = data;
  const head = headlineScore(data);

  const hasRatingDrop = ratingDropDetails && ratingDropDetails.length > 0;

  // ── Revenue state (shared between hero card + deep dive table) ───────────────
  const initFields = {};
  products.forEach(p => {
    const cur = p.pillar_rating?.current || 0;
    const ago = p.pillar_rating?.rating30dAgo || 0;
    const defaultTarget = cur > 0
      ? Math.min(5, Math.max(cur + 0.2, ago)).toFixed(1)
      : '';
    initFields[p.asin] = {
      units:        p.defaultUnits || '',
      price:        p.defaultPrice || '',
      targetRating: defaultTarget,
      unitsDirty: false,
      priceDirty: false,
    };
  });
  const [fields, setFields] = useState(initFields);

  function updateField(asin, key, val) {
    setFields(prev => ({
      ...prev,
      [asin]: { ...prev[asin], [key]: val, [`${key}Dirty`]: true },
    }));
  }

  // ── Compute revenue at risk ───────────────────────────────────────────────────
  // We surface three categories of monthly $ exposure:
  //   (1) Active drop  — rating fell in last 30d
  //   (2) Chronic gap  — sitting below the 4.5★ peak (no recent drop required)
  //   (3) Buy Box loss — % of time you don't hold the BB × conservative capture
  let totalMonthly = 0;
  let totalChronic = 0;
  let totalBBLoss  = 0;
  const productRevs = products.map(p => {
    const f = fields[p.asin] || {};
    const units = parseFloat(f.units) || 0;
    const price = parseFloat(f.price) || 0;
    const rb = p.pillar_rating.rating30dAgo;
    const rn = p.pillar_rating.current;
    const risk = p.pillar_rating.ratingDropped30d
      ? calcRevenueAtRisk(units, price, rb, rn)
      : 0;
    const chronic = !p.pillar_rating.ratingDropped30d
      ? calcChronicGap(units, price, rn)
      : 0;
    const bbLoss = calcBBLoss(units, price, p.pillar_buybox?.bbPct30d);
    totalMonthly += risk;
    totalChronic += chronic;
    totalBBLoss  += bbLoss;
    return { ...p, computedRisk: risk, computedChronic: chronic, computedBBLoss: bbLoss };
  });
  const totalAnnual = totalMonthly * 12;
  const totalExposureMonthly = totalMonthly + totalChronic + totalBBLoss;
  const isRisk = hasRatingDrop && totalMonthly > 0;

  // At-risk brands: show drops + sub-4.5★ products. Healthy brands: show all so units can be entered.
  const displayProducts = hasRatingDrop
    ? productRevs.filter(p => p.pillar_rating.ratingDropped30d || (p.pillar_rating.current || 0) < 4.5)
    : productRevs;

  // Compute calculator rows + recovery totals (for merged single-table rendering)
  const sortedCalc = [...displayProducts].sort((a, b) => (b.computedRisk || 0) - (a.computedRisk || 0));
  let calcTotalRecovery = 0;
  const calcRows = sortedCalc.map(pr => {
    const f = fields[pr.asin] || {};
    const units         = parseFloat(f.units) || 0;
    const price         = parseFloat(f.price) || 0;
    const targetRating  = parseFloat(f.targetRating) || 0;
    const currentRating = pr.pillar_rating.current || 0;
    const recoveryAmt   = (targetRating > currentRating && units > 0 && price > 0)
      ? Math.max(0, Math.round(units * price * (convRate(targetRating) - convRate(currentRating))))
      : 0;
    calcTotalRecovery += recoveryAmt;
    return { ...pr, recoveryAmt };
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

  const worstDrop = products
    .filter(p => p.pillar_rating.ratingDropped30d)
    .sort((a, b) => (a.pillar_rating.delta30d || 0) - (b.pillar_rating.delta30d || 0))[0];

  // ── Buy Box average (must be computed before pillar averages) ─────────────────
  const avgBB = (() => {
    const valid = products.filter(p => p.pillar_buybox.bbPct30d !== null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, p) => s + p.pillar_buybox.bbPct30d, 0) / valid.length * 10) / 10;
  })();
  const anyLBB      = products.some(p => p.pillar_buybox.lbbDetected);
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
  const bbSub = avgBBMoM != null
    ? (avgBBMoM >= 0 ? `▲${avgBBMoM.toFixed(1)}pp MoM` : `▼${Math.abs(avgBBMoM).toFixed(1)}pp MoM`)
    : avgBB !== null ? `${products.length > 1 ? 'Avg ' : ''}${fmtPct(avgBB)} last 30d` : 'No BB data';

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
  const bbScore  = avgBB !== null ? wAvg('pillar_buybox') : null;

  const lead = products[0] || {};

  // BSR
  const bsrMetric = lead.pillar_bsr?.current ? '#' + lead.pillar_bsr.current.toLocaleString() : '-';
  const bsrDelta  = lead.pillar_bsr?.delta90dPct !== null ? lead.pillar_bsr?.delta90dPct : null;
  const bsrSub    = bsrDelta !== null
    ? `${bsrDelta > 0 ? '▲' : '▼'}${Math.abs(bsrDelta)}% vs. 90d ${bsrDelta > 0 ? '(worsening)' : '(improving)'}`
    : 'No rank history';

  // Rating
  const avgRating = products.length
    ? Math.round(products.reduce((s, p) => s + (p.pillar_rating.current || 0), 0) / products.length * 10) / 10
    : null;
  const worstDelta30 = products.reduce((worst, p) => {
    const d = p.pillar_rating.delta30d;
    return d !== null && d < worst ? d : worst;
  }, 0);
  const ratSub = avgRating
    ? (worstDelta30 < 0 ? `▼${Math.abs(worstDelta30)} vs. 30d` : 'Stable last 30d')
    : 'No rating data';

  // Flywheel head carries the same exposure figure the hero and calculator use,
  // so one lookup never shows two different dollar numbers.
  const fwRiskAnnual = totalExposureMonthly > 0 ? Math.round(totalExposureMonthly * 12) : null;

  return (
    <div>
      {/* ── Primary result: the five levers ── */}
      <Flywheel fw={data.flywheel} riskAnnual={fwRiskAnnual} />

      {lede && (<>
      {/* ── Headline narrative — one-sentence read of the situation ── */}
      <HeadlineNarrative
        data={data}
        totalRiskMonthly={totalExposureMonthly}
        worstProduct={worstDrop || productRevs.sort((a,b) => (b.computedRisk + b.computedChronic + b.computedBBLoss) - (a.computedRisk + a.computedChronic + a.computedBBLoss))[0]}
      />

      {/* ── Hero split: Brand Score | Revenue at Risk ── */}
      <div className="hero-split animate-in">
        {/* Left: Brand Health Score */}
        <div className="hero-card">
          <div className="hero-score-inner">
            <ScoreRing score={head.score} label={head.label} />
            <div className="score-meta">
              <div className="score-brand-name">{lead.brand || 'Your Brand'} {head.isFlywheel ? 'Flywheel Score' : 'Brand Score'}</div>
              <div className={`score-label-badge ${labelClass(head.label)}`} style={{ marginTop: 6 }}>
                {head.label === 'Healthy' ? '✓' : head.label === 'At Risk' ? '⚠' : '✕'} {head.label}
              </div>
              {capReasons.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {capReasons.map((r, i) => {
                    const c = CAP_REASON_COPY[r] || { icon: '⚠', text: r };
                    return (
                      <span key={i} className="pillar-flag amber">
                        {c.icon} {c.text}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Revenue at Risk */}
        {(() => {
          const showExposureHero = label !== 'Healthy';
          const heroAmount = showExposureHero
            ? (totalExposureMonthly > 0 ? fmt$(totalExposureMonthly * 12) + '/yr' : null)
            : (protectedMonthly > 0 ? fmt$(protectedMonthly * 12) + '/yr' : null);
          return (
        <div className={`hero-card ${showExposureHero ? 'rev-risk-card' : 'rev-safe-card'}`}>
          <div className={`rev-card-label ${showExposureHero ? 'risk' : 'safe'}`}>
            {showExposureHero ? '⚠️  Total Monthly Exposure' : '✅  Revenue Resilience'}
          </div>
          <div className="rev-card-amount">
            {heroAmount || (
              <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--ink5)', lineHeight: 1.5 }}>
                Add monthly units below to estimate what's at stake.
                <br/>
                <span style={{ fontSize: '0.78rem' }}>Set a Target ★ to also see upside potential.</span>
              </span>
            )}
          </div>
          {showExposureHero && totalExposureMonthly > 0 && (
            <div className="risk-breakdown">
              {totalMonthly > 0 && (
                <div className="risk-row">
                  <span className="risk-row-label">Active rating drop</span>
                  <span className="risk-row-amt">{fmt$(totalMonthly)}/mo</span>
                </div>
              )}
              {totalChronic > 0 && (
                <div className="risk-row">
                  <span className="risk-row-label">Chronic gap to 4.5★</span>
                  <span className="risk-row-amt">{fmt$(totalChronic)}/mo</span>
                </div>
              )}
              {totalBBLoss > 0 && (
                <div className="risk-row">
                  <span className="risk-row-label">Lost Buy Box revenue</span>
                  <span className="risk-row-amt">{fmt$(totalBBLoss)}/mo</span>
                </div>
              )}
            </div>
          )}
          {!showExposureHero && protectedMonthly > 0 && (
            <div className="rev-card-desc" style={{ marginTop: 10 }}>
              Your conversion stays roughly intact today. If your rating slipped 0.5★, this is what would be at stake within 12 months.
            </div>
          )}
          {!heroAmount && (
            <a
              href="#calc-table"
              className="rev-card-cta"
              style={{ marginTop: 10 }}
              onClick={e => { e.preventDefault(); document.getElementById('calc-table')?.scrollIntoView({ behavior: 'smooth' }); }}
            >
              Go to calculator ↓
            </a>
          )}
          {showExposureHero && totalExposureMonthly > 0 && (
            <div className="rev-card-annual">{fmt$(totalExposureMonthly)}/mo total exposure</div>
          )}
          {!showExposureHero && protectedMonthly > 0 && (
            <div className="rev-card-annual">{fmt$(protectedMonthly)}/mo at stake if rating slips 0.5★</div>
          )}
          {isRisk && worstDrop && (
            <div className="rev-card-desc">
              "{worstDrop.title ? worstDrop.title.slice(0, 45) + (worstDrop.title.length > 45 ? '…' : '') : worstDrop.asin}" dropped from{' '}
              <strong>{worstDrop.pillar_rating.rating30dAgo}★</strong> to{' '}
              <strong>{worstDrop.pillar_rating.current}★</strong> over the past 30 days.
            </div>
          )}
          {showExposureHero && (
            <a href="#claim" className="rev-card-cta"
               onClick={e => { e.preventDefault(); document.getElementById('claim')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              {hasRatingDrop && worstDrop
                ? `Diagnose the ${monthName(worstDrop.pillar_rating.dropDate)} ratings drop with full sentiment analysis →`
                : anyLBB
                ? 'Diagnose your Buy Box loss with the full Sentopi analysis →'
                : 'Get the full Sentopi analysis →'}
            </a>
          )}
        </div>
          );
        })()}
      </div>
      </>)}

      {/* ── Per-signal recommendations ── */}
      <Recommendations
        data={data}
        brandRiskMonthly={totalMonthly}
        brandBBLoss={totalBBLoss}
        brandChronicGap={totalChronic}
      />

      {/* ── Brand ASP strip ── */}
      {avgASP != null && (
        <div className="asp-strip animate-in">
          <div className="asp-strip-label">{lead.brand || 'Brand'} ASP</div>
          <div className="asp-strip-divider" />
          <div className="asp-strip-amount">${avgASP.toFixed(2)}</div>
          {avgAspMoMPct != null && (() => {
            const d = fmtDelta(avgAspMoMPct, true);
            return d ? <span className={`asp-strip-delta ${d.cls}`}>{d.text}% MoM</span> : null;
          })()}
          {avgListPrice != null && (
            <div className="asp-strip-list">· Avg List ${avgListPrice.toFixed(2)}</div>
          )}
        </div>
      )}

      {/* ── Signal detail: the raw signals the levers are scored from ── */}
      {data.flywheel && (
        <div className="fw-detail-head">
          Signal detail
          <span>The rank, rating, and Buy Box readings behind the levers above.</span>
        </div>
      )}
      <div className="pillars-grid">
        <PillarCard
          name="Best Seller Rank"
          metric={bsrMetric}
          metricSub={bsrSub}
          score={bsrScore} max={weights.bsr}
        />
        <PillarCard
          name="Rating Health"
          metric={avgRating ? avgRating.toFixed(1) + '★' : '-'}
          metricSub={ratSub}
          score={ratScore} max={weights.rating}
          flags={[
            ...(hasRatingDrop ? [{ color: 'amber', icon: '⚠', text: 'Rating dropped last 30d' }] : []),
          ]}
        />
        <PillarCard
          name="Buy Box"
          metric={avgBB !== null ? fmtPct(avgBB) : '-'}
          metricSub={bbSub}
          score={bbScore} max={weights.buybox}
          flags={[
            ...(anyLBB      ? [{ color: 'red',   icon: '🚨', text: 'Lost Buy Box' }] : []),
            ...(anyUndercut ? [{ color: 'amber',  icon: '⬇',  text: 'Competitor undercutting' }] : []),
          ]}
        />
      </div>

      {/* ── Card 1: Products Analyzed ── */}
      <div className="products-section animate-in" style={{ marginBottom: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--cream2)' }}>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.1rem', fontWeight: 400, color: 'var(--ink)', marginBottom: 3 }}>
              Product Deep Dive
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--ink5)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              {products.length} product{products.length !== 1 ? 's' : ''}
            </div>
          </div>
          <table className="products-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Product</th>
                <th style={{ width: '14%' }}>Rating</th>
                <th style={{ width: '14%' }} className="bsr-header">Best Seller<br/>Rank</th>
                <th style={{ width: '14%' }}>Buy Box</th>
                <th style={{ width: '14%' }}>ASP</th>
                <th style={{ width: '14%' }} className="col-score">Score</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const rat  = p.pillar_rating;
                const bsr  = p.pillar_bsr;
                const bb   = p.pillar_buybox;
                const d30  = fmtDelta(rat.delta30d, true);
                const bsrD = fmtDelta(bsr.delta90dPct, false);
                return (
                  <tr key={p.asin}>
                    <td>
                      <div className="p-title">{p.title ? p.title.slice(0,45) + (p.title.length > 45 ? '…' : '') : p.asin}</div>
                      <div className="asin-code">{p.asin}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{rat.current ? rat.current.toFixed(1) + '★' : '-'}</div>
                      {d30 && <div className={d30.cls} style={{ fontSize: '0.75rem' }}>{d30.text} vs. 30d</div>}
                      {rat.ratingDropped30d && <span title="Rating dropped" style={{ fontSize: '0.8rem' }}>⚠️</span>}
                      <RatingSparkline r90={rat.rating90dAgo} r30={rat.rating30dAgo} rNow={rat.current} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{bsr.current ? '#' + bsr.current.toLocaleString() : '-'}</div>
                      {bsrD && bsr.delta90dPct !== null && (
                        <div className={bsrD.cls} style={{ fontSize: '0.75rem' }}>{bsrD.text}% vs. 90d</div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{bb.bbPct30d !== null ? fmtPct(bb.bbPct30d) : '-'}</div>
                      {bb.bbMoMPts != null && (() => {
                        const up = bb.bbMoMPts >= 0;
                        return <div className={up ? 'delta-down' : 'delta-up'} style={{ fontSize: '0.75rem' }}>{up ? '+' : ''}{bb.bbMoMPts.toFixed(1)}pp MoM</div>;
                      })()}
                      {bb.lbbDetected && <div style={{ fontSize: '0.72rem', color: 'var(--rust)', fontWeight: 600 }}>🚨 LBB</div>}
                    </td>
                    <td>
                      {p.asp30d != null ? (
                        <>
                          <div style={{ fontWeight: 600 }}>${p.asp30d.toFixed(2)}</div>
                          {p.aspMoMPct != null && (() => {
                            const d = fmtDelta(p.aspMoMPct, true);
                            return d ? <div className={d.cls} style={{ fontSize: '0.75rem' }}>{d.text}% MoM</div> : null;
                          })()}
                          {p.listPrice != null && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--ink5)', marginTop: 1 }}>
                              List ${p.listPrice.toFixed(2)}
                            </div>
                          )}
                        </>
                      ) : <span style={{ color: 'var(--ink5)' }}>-</span>}
                    </td>
                    <td className="col-score">
                      <span className={`score-chip ${scoreChip(p.composite)}`}>{p.composite}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {asinCountExcluded > 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--ink5)', padding: '8px 18px', textAlign: 'center', borderTop: '1px solid var(--cream2)' }}>
              + {asinCountExcluded} new/sparse product{asinCountExcluded > 1 ? 's' : ''} excluded from brand score (&lt;25 reviews)
            </div>
          )}
        </div>
      </div>

      {/* ── Card 2: Monthly Risk & Upside Calculator ── */}
      {displayProducts.length > 0 && (
        <div className="products-section animate-in" id="calc-table" style={{ marginBottom: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ padding: '14px 18px 0' }}>
              <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.1rem', fontWeight: 400, color: 'var(--ink)', marginBottom: 3 }}>
                Monthly Risk &amp; Upside Calculator
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--ink5)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, paddingBottom: 0 }}>
                {displayProducts.length} product{displayProducts.length !== 1 ? 's' : ''}
              </div>
            </div>
            <table className="products-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Product</th>
                  <th style={{ width: '14%' }}>Rating</th>
                  <th style={{ width: '14%' }}>Monthly Units</th>
                  <th style={{ width: '14%' }}>Price (USD)</th>
                  <th style={{ width: '14%' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>Monthly<br/>Risk</span>
                      <Tip text="Revenue you're leaving on the table vs. your star rating from 30 days ago." />
                    </span>
                  </th>
                  <th style={{ width: '14%' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>Upside<br/>Potential</span>
                      <Tip text="Additional monthly revenue if you recover to your target star rating." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {calcRows.map(pr => {
                  const f = fields[pr.asin] || {};
                  const rat = pr.pillar_rating;
                  return (
                    <tr key={pr.asin}>
                      <td>
                        <div className="p-title">{pr.title ? pr.title.slice(0, 40) + (pr.title.length > 40 ? '…' : '') : pr.asin}</div>
                        <div className="asin-code">{pr.asin}</div>
                        {!hasRatingDrop && (pr.pillar_rating.current || 0) >= 4.5 && (
                          <span className="pillar-flag green" style={{ marginTop: 4 }}>♥ Top-Rated</span>
                        )}
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: '0.67rem', color: 'var(--ink5)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Target ★</span>
                          <input
                            type="number"
                            min="1" max="5" step="0.1"
                            className="target-rating-input"
                            value={f.targetRating}
                            onChange={e => updateField(pr.asin, 'targetRating', e.target.value)}
                          />
                          <span style={{ fontSize: '0.67rem', color: 'var(--ink5)' }}>★</span>
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {rat.current ? rat.current.toFixed(1) + '★' : '-'}
                          {rat.ratingDropped30d && <span style={{ marginLeft: 4, fontSize: '0.8rem' }}>⚠️</span>}
                        </div>
                        {rat.ratingDropped30d && rat.delta30d != null ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--rust)', fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap' }}>
                            {rat.delta30d} MoM
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink5)', marginTop: 2, whiteSpace: 'nowrap' }}>stable</div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="rev-deep-input"
                          value={f.units}
                          placeholder="e.g. 10000"
                          onChange={e => updateField(pr.asin, 'units', e.target.value)}
                        />
                        <div className="rev-source-tag-sm" style={{ color: (!hasRatingDrop && f.unitsDirty) ? 'var(--green, #2d7a4f)' : undefined }}>
                          {f.unitsDirty
                            ? (!hasRatingDrop ? '→ Rev Protected ↑' : 'your value')
                            : pr.defaultUnits ? `~${pr.defaultUnits.toLocaleString()} (est.)` : 'enter units'}
                        </div>
                      </td>
                      <td>
                        <div className="rev-deep-price-wrap">
                          <span className="rev-deep-prefix">$</span>
                          <input
                            type="number"
                            step="0.01"
                            className="rev-deep-input rev-deep-price-input"
                            value={f.price}
                            placeholder="33.99"
                            onChange={e => updateField(pr.asin, 'price', e.target.value)}
                          />
                        </div>
                        <div className="rev-source-tag-sm">
                          {f.priceDirty ? 'your value' : pr.defaultPrice ? `$${pr.defaultPrice.toFixed(2)} (${pr.defaultPriceSource === 'bb' ? 'Buy Box' : pr.defaultPriceSource === 'asp' ? 'ASP est.' : 'List est.'})` : 'enter price'}
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        {!pr.pillar_rating.ratingDropped30d
                          ? <div style={{ color: 'var(--ink5)', fontSize: '0.8rem' }}>-</div>
                          : pr.computedRisk > 0
                            ? <div className="rev-risk-cell" style={{ fontSize: '0.9rem' }}>{fmt$(pr.computedRisk)}</div>
                            : <div style={{ color: 'var(--ink5)', fontSize: '0.75rem' }}>enter data ↑</div>
                        }
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        {pr.recoveryAmt > 0 ? (
                          <>
                            <div className="recovery-amount" style={{ fontSize: '0.9rem' }}>+{fmt$(pr.recoveryAmt)}</div>
                            <div className="recovery-label">if {parseFloat(f.targetRating).toFixed(1)}★</div>
                          </>
                        ) : (
                          <div style={{ color: 'var(--ink5)', fontSize: '0.75rem' }}>-</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(totalMonthly > 0 || calcTotalRecovery > 0) && (
                <tbody>
                  <tr>
                    <td colSpan={4} style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--ink3)', paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                      Total
                    </td>
                    <td style={{ paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                      {totalMonthly > 0 && (
                        <>
                          <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: '0.95rem' }}>{fmt$(totalMonthly)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink4)', marginTop: 2 }}>{fmt$(totalMonthly * 12)}/yr</div>
                        </>
                      )}
                    </td>
                    <td style={{ paddingTop: 12, borderTop: '2px solid var(--cream2)' }}>
                      {calcTotalRecovery > 0 && (
                        <>
                          <div style={{ fontWeight: 700, color: 'var(--forest)', fontSize: '0.95rem' }}>+{fmt$(calcTotalRecovery)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--ink4)', marginTop: 2 }}>+{fmt$(calcTotalRecovery * 12)}/yr</div>
                        </>
                      )}
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
            <div style={{ padding: '10px 14px', fontSize: '0.72rem', color: 'var(--ink5)', borderTop: '1px solid var(--cream2)', lineHeight: 1.5 }}>
              Estimates use Sentopi's conversion rate model (Spiegel, PowerReviews, Pattern). Override units and target rating with your actual data for a sharper number.
            </div>
          </div>
        </div>
      )}

      {/* ── Watch List (new / sparse ASINs) ── */}
      <WatchList items={data.productsExcluded || []} />

      {/* ── Methodology drawer (collapsible) ── */}
      <Methodology />

      {/* ── Trust strip ── */}
      <div className="trust-strip no-print">
        <span>Built on live Amazon signals</span>
        <span className="dot" />
        <span>90-day window</span>
        <span className="dot" />
        <span>Refreshed daily</span>
        <span className="dot" />
        <span>No account required</span>
      </div>

      {/* ── Bottom CTA — varies by archetype ── */}
      <div className="bottom-cta animate-in">
        <h3>
          {hasRatingDrop
            ? 'Your score is slipping. Find out exactly why.'
            : label === 'Healthy'
              ? 'You\'re ahead. Stay there.'
              : 'Something is off. Your reviews hold the answer.'}
        </h3>
        <p>
          {hasRatingDrop
            ? 'Sentopi reads every review and hands you a prioritized action plan: what changed, who is affected, and what to fix first to recover the revenue.'
            : label === 'Healthy'
              ? 'Sentopi monitors every new review on your top SKUs and flags issues weeks before the star average moves. The earlier you catch a problem, the cheaper it is to fix.'
              : 'Sentopi surfaces the root causes your brand score cannot see: exact issues, customer language, and a prioritized action plan.'}
        </p>
        <a href="#claim" className="btn-cta-main"
           onClick={e => { e.preventDefault(); document.getElementById('claim')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          {hasRatingDrop
            ? 'Diagnose the drop →'
            : label === 'Healthy'
              ? 'Set up monitoring →'
              : 'Get the full analysis →'}
        </a>
      </div>
    </div>
  );
}

// ─── Input form ───────────────────────────────────────────────────────────────
// Staged progress: honest descriptions of the lookup, shown while it runs
// (labor-perception pattern; a silent 30s wait undersells the work).
const ANALYZE_STAGES = [
  'Pulling 90-day price and rank history…',
  'Reading rating trajectory…',
  'Checking Buy Box and velocity…',
  'Scoring the five levers…',
  'Building your report…',
];

function InputForm({ onResult, autoRun, forcedInput, onLoading, bare }) {
  const [input, setInput]     = useState(autoRun || '');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState(0);

  React.useEffect(() => {
    if (!loading) { setStage(0); return; }
    const t = setInterval(() => {
      setStage(s => Math.min(s + 1, ANALYZE_STAGES.length - 1));
    }, 4000);
    return () => clearInterval(t);
  }, [loading]);

  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  function cacheKey(v) { return `bh:${v.toLowerCase().trim()}`; }

  function readCache(val) {
    try {
      const raw = localStorage.getItem(cacheKey(val));
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      return (Date.now() - ts < CACHE_TTL) ? data : null;
    } catch { return null; }
  }

  function writeCache(val, data) {
    try { localStorage.setItem(cacheKey(val), JSON.stringify({ data, ts: Date.now() })); }
    catch { /* storage full — silent fail */ }
  }

  async function runAnalysis(val) {
    const cached = readCache(val);
    if (cached) { onResult(cached); return; }
    setError(''); setLoading(true); onLoading && onLoading(true);
    try {
      const resp = await fetch('/.netlify/functions/brand-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: val }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) { setError(data.error || 'Something went wrong. Try again.'); }
      else {
        writeCache(val, data); onResult(data);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'tool_usage', tool: 'revenue_risk_report' });
      }
    } catch { setError('Network error. Check your connection and try again.'); }
    finally { setLoading(false); onLoading && onLoading(false); }
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

  return (
    <div className="panel">
      {!bare && (
        <div className="panel-header">
          <span className="panel-header-title">Analyze your brand</span>
          <span className="panel-header-tag">Free · ~30s</span>
        </div>
      )}
      <div className="panel-body">
        <form onSubmit={handleSubmit}>
          <div className="input-row">
            <div className="input-wrap">
              <span className="input-icon">🔍</span>
              <input type="text" className="main-input"
                placeholder="Seller ID or ASIN  (e.g. A2YVQMS6C6QFJO)"
                value={input} onChange={e => setInput(e.target.value)}
                disabled={loading} />
            </div>
            <button type="submit" className="btn-analyze" disabled={loading || !input.trim()}>
              {loading ? 'Analyzing…' : 'Analyze Brand →'}
            </button>
          </div>
          {loading
            ? <p className="input-hint" aria-live="polite">{ANALYZE_STAGES[stage]}</p>
            : <p className="input-hint">
                Enter your Seller ID (e.g. <code>A2YVQMS6C6QFJO</code>) or an ASIN.
                Results in ~30 seconds. No account required.
              </p>}
        </form>
        {error && <div className="error-box">⚠ {error}</div>}
      </div>
    </div>
  );
}

// ─── Share strip ──────────────────────────────────────────────────────────────
function ShareStrip({ brandName }) {
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

  return (
    <div className="no-print" style={{
      display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 8,
      padding: '12px 16px', background: 'var(--white)', border: '1px solid var(--cream3)',
      borderRadius: 8, boxShadow: '0 1px 4px rgba(26,23,20,0.04)',
    }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--ink4)', fontWeight: 500, flex: 1 }}>
        Share this scorecard
      </span>
      <button onClick={copyLink} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
        background: copied ? 'var(--forest)' : 'var(--ink)', color: '#fff',
        border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.2s',
      }}>
        {copied ? '✓ Copied' : '🔗 Copy link'}
      </button>
      <button onClick={saveAsPdf} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
        background: 'none', color: 'var(--ink3)', border: '1px solid var(--cream3)',
        borderRadius: 6, fontSize: '0.78rem', fontWeight: 500,
        cursor: 'pointer', fontFamily: 'inherit',
      }}>
        ↓ Save as PDF
      </button>
    </div>
  );
}

// ─── Results skeleton (CLS-stable loading placeholder) ─────────────────────────
function ResultsSkeleton() {
  return (
    <div className="result-skeleton" aria-hidden="true">
      <div className="skel skel-ring" />
      <div className="skel-stack">
        <div className="skel skel-line w60" />
        <div className="skel skel-line w40" />
        <div className="skel skel-amt" />
        <div className="skel skel-line w50" />
      </div>
    </div>
  );
}

// ─── Summary cards (above-the-fold sample: Brand Score | Revenue at Risk) ───────
function SummaryStrip({ data, isDemo, loading }) {
  if (loading || !data) {
    return (
      <div id="rrr-summary" className="summary-wrap animate-in">
        <div className="summary-cards">
          <div className="summary-card"><ResultsSkeleton /></div>
          <div className="summary-card">
            <div className="skel-stack" style={{ width: '100%' }}>
              <div className="skel skel-line w40" />
              <div className="skel skel-amt" />
              <div className="skel skel-line w50" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  const exposure    = defaultExposure(data.products);
  const brand       = data.products?.[0]?.brand || 'Your Brand';
  const summaryHead = headlineScore(data);
  const labelIcon   = summaryHead.label === 'Healthy' ? '✓' : summaryHead.label === 'At Risk' ? '⚠' : '✕';
  return (
    <div id="rrr-summary" className="summary-wrap animate-in">
      {isDemo && <div className="summary-sample-tag">Sample report</div>}
      <div className="summary-cards">
        {/* Brand Score */}
        <div className="summary-card score-card">
          <div className="summary-card-label">{summaryHead.isFlywheel ? 'Flywheel Score' : 'Brand Score'}</div>
          <div className="summary-score-row">
            <ScoreRing score={summaryHead.score} label={summaryHead.label} />
            <div className="summary-score-meta">
              <div className="summary-brand">{brand}</div>
              <div className={`score-label-badge ${labelClass(summaryHead.label)}`}>{labelIcon} {summaryHead.label}</div>
            </div>
          </div>
        </div>
        {/* Revenue at Risk */}
        <div className={`summary-card revenue-card ${exposure > 0 ? 'risk' : 'safe'}`}>
          <div className={`summary-card-label ${exposure > 0 ? 'risk' : 'safe'}`}>
            {exposure > 0 ? '⚠ Revenue at Risk' : '✓ Revenue at Risk'}
          </div>
          {exposure > 0 ? (
            <>
              <div className="summary-rev-amt">{fmt$(exposure * 12)}<span className="summary-rev-per">/yr</span></div>
              <div className="summary-rev-sub">{fmt$(exposure)}/mo estimated exposure</div>
            </>
          ) : (
            <div className="summary-rev-safe">On track. No active revenue leak detected on this brand.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
// Inline post-result email capture — renders only on a real (non-demo, non-chip) result.
// Submits programmatically to the Netlify-registered name="demo-rrr" form (static form in revenue-risk.html).
function InlineClaim({ data }) {
  const brand = data?.products?.[0]?.brand || 'your brand';
  const asin  = data?.entryPoint === 'asin' ? data?.input : (data?.products?.[0]?.asin || '');
  const url   = asin ? `https://amazon.com/dp/${asin}` : (data?.input || '');
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done | error

  React.useEffect(() => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'inline_capture_shown', page: 'revenue-risk-report', brand });
  }, []);

  function submit(e) {
    e.preventDefault();
    setStatus('sending');
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'form-name': 'demo-rrr', name, email, url }).toString(),
    })
      .then(res => {
        if (!res.ok) throw new Error('failed');
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'generate_lead', form_name: 'demo-rrr', source: 'inline_result' });
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }

  if (status === 'done') {
    return (
      <div className="inline-claim inline-claim-done no-print">
        ✓ You're in. Your fix list for {brand} is on its way, within 48 hours.
      </div>
    );
  }

  return (
    <form className="inline-claim no-print" onSubmit={submit}>
      <div className="inline-claim-title">Get the full fix list for {brand}</div>
      <div className="inline-claim-sub">Built from 100 of your actual reviews. Delivered within 48 hours.</div>
      <div className="inline-claim-row">
        <input className="inline-claim-input" type="text" placeholder="Your name" value={name}
               onChange={e => setName(e.target.value)} required />
        <input className="inline-claim-input" type="email" placeholder="Work email" value={email}
               onChange={e => setEmail(e.target.value)} required />
      </div>
      <button className="inline-claim-submit" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending...' : 'See what your reviews are costing you →'}
      </button>
      {status === 'error' && <div className="inline-claim-err">Something went wrong. Try again.</div>}
    </form>
  );
}

function App() {
  const autoRun = new URLSearchParams(window.location.search).get('s') || '';
  const fixtures = window.DEMO_FIXTURES || {};
  const chips    = window.SAMPLE_CHIPS  || [];

  // Single sample brand for the on-land preview. If ?s= is present in the URL,
  // the autoRun result overwrites this once the API returns.
  const SAMPLE_KEY = 'ratingSlip';
  const [result,       setResult]       = useState(autoRun ? null : (fixtures[SAMPLE_KEY] || null));
  const [isDemo,       setIsDemo]       = useState(!autoRun);
  const [isChipResult, setIsChipResult] = useState(false);
  const [activeChip,   setActiveChip]   = useState(null);
  const [chipInput,    setChipInput]    = useState(null);
  const [loading,      setLoading]      = useState(false);

  const resultEl    = React.useRef(null);
  const scorecardEl = React.useRef(null);

  function scrollToResult() {
    // Scroll to the input block (not the cards) so the input bar stays peeking
    // above the result cards. scroll-margin-top on .rrr-input-block clears the sticky nav.
    setTimeout(() => document.getElementById('hero-input')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function handleResult(data) {
    setResult(data);
    setIsDemo(false);
    setIsChipResult(false);
    setActiveChip(null);
    scrollToResult();
  }

  function handleReset() {
    setResult(fixtures[SAMPLE_KEY] || null);
    setIsDemo(true);
    setIsChipResult(false);
    setActiveChip(null);
    setChipInput({ asin: '', ts: Date.now() }); // clears the input field via InputForm's forcedInput effect
    window.history.pushState({}, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleChipClick(chip) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'sample_chip_clicked', asin: chip.asin, chip_label: chip.label, page: 'revenue-risk-report' });
    setActiveChip(chip.key);
    setChipInput({ asin: chip.asin, ts: Date.now() });
    setResult(chip.data);
    setIsDemo(false);
    setIsChipResult(true);
    scrollToResult();
  }

  function scrollTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const brandName = result?.products?.[0]?.brand || '';

  return (
    <>
      {/* ── Compact header (label stack; page H1 is static in revenue-risk.html) ── */}
      <div className="rrr-head no-print">
        <div className="eyebrow"><span className="eyebrow-dot" /> Analyze your brand</div>
        <div className="rrr-head-title">Revenue Risk Report</div>
      </div>

      {/* ── Primary action: input bar on top ────────────────────────────── */}
      <div id="hero-input" className="rrr-input-block">
        <InputForm onResult={handleResult} autoRun={autoRun} forcedInput={chipInput} onLoading={setLoading} bare />
        <div className="rrr-input-foot">
          {chips.length > 0 && (
            <div className="demo-pills">
              <span className="pills-label">Try a live sample:</span>
              {chips.map(chip => (
                <button
                  key={chip.key}
                  className={`demo-pill${activeChip === chip.key ? ' active' : ''}`}
                  onClick={() => handleChipClick(chip)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          <div className="hero-microcopy">
            ~30 seconds <span className="sep">·</span> No account required <span className="sep">·</span>{' '}
            <a href="#claim" className="hero-microcopy-link"
               onClick={e => { e.preventDefault(); scrollTo('claim'); }}>
              Or get the deeper Custom Report →
            </a>
          </div>
        </div>
      </div>

      {/* ── Above the fold: sample result — Brand Score | Revenue at Risk ── */}
      <SummaryStrip data={result} isDemo={isDemo} loading={loading} />

      {/* ── Detailed results (skeleton while loading; full card otherwise) ── */}
      {(result || loading) && (
        <div ref={resultEl} className="demo-wrap">
          {loading ? (
            <div className="detail-skeleton" aria-hidden="true">
              <div className="skel skel-line w40" />
              <div className="skel skel-block" />
              <div className="skel skel-block" />
            </div>
          ) : (
            <>
              {isDemo && (
                <div className="demo-banner no-print">
                  <div className="demo-banner-left">
                    <span className="demo-banner-tag">SAMPLE REPORT</span>
                    <span className="demo-banner-line1">The full breakdown behind the sample above. Paste your ASIN or Seller ID to run yours.</span>
                  </div>
                  <a href="#hero-input"
                     className="demo-banner-cta"
                     onClick={e => { e.preventDefault(); document.querySelector('.main-input')?.focus({ preventScroll: false }); document.getElementById('hero-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                    Run yours ↑
                  </a>
                </div>
              )}

              {!isDemo && !isChipResult && (
                <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ink5)' }}>
                    {result.asinCountScored} product{result.asinCountScored !== 1 ? 's' : ''} analyzed ·{' '}
                    {result.entryPoint === 'seller' ? 'Seller ID lookup' : 'ASIN + variations'}
                  </div>
                  <button onClick={handleReset}
                    style={{ background: 'none', border: '1px solid var(--cream3)', color: 'var(--ink4)', fontSize: '0.8rem', padding: '5px 12px', borderRadius: 'var(--r)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    ← Back to example
                  </button>
                </div>
              )}

              <div ref={scorecardEl}>
                <ScoreCard key={isDemo ? `demo-${SAMPLE_KEY}` : result.input} data={result} lede={false} />
              </div>

              {!isDemo && !isChipResult && <InlineClaim data={result} />}

              {!isDemo && <ShareStrip brandName={brandName} />}

              {/* feature chips relocated below results (was above the fold) */}
              <div className="hero-trust-strip no-print" aria-label="What powers the report" style={{ marginTop: 20 }}>
                <span className="hero-trust-chip"><span className="hero-trust-dot"/> Live Amazon signals</span>
                <span className="hero-trust-chip"><span className="hero-trust-dot"/> 90-day signal window</span>
                <span className="hero-trust-chip"><span className="hero-trust-dot"/> No affiliate rankings</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Proof / objection handling ────────────────────────────────── */}
      <section className="proof-section no-print">
        <span className="proof-eyebrow">Why trust it</span>
        <h2>Built from public Amazon data.</h2>
        <div className="proof-grid">
          <div className="proof-card">
            <div className="proof-card-num">90 days</div>
            <div className="proof-card-title">Of stock, price, rank, and rating history.</div>
            <div className="proof-card-body">
              The same Amazon signals your paid analyst tools surface, scored against revenue impact instead of vanity charts.
            </div>
          </div>
          <div className="proof-card">
            <div className="proof-card-num">5 levers</div>
            <div className="proof-card-title">Operations, pricing, assortment, visibility, ratings.</div>
            <div className="proof-card-body">
              Every lever scored on your own data, the weakest one named. A lever public data cannot measure is reported as unmeasured rather than scored anyway.
            </div>
          </div>
          <div className="proof-card">
            <div className="proof-card-num">$ impact</div>
            <div className="proof-card-title">Every signal priced in dollars.</div>
            <div className="proof-card-body">
              Active rating drops, chronic gaps below the 4.5★ peak, and lost Buy Box windows all converted to monthly and annual exposure on your own units and price.
            </div>
          </div>
        </div>

        <div className="faq-strip">
          <div className="faq-card">
            <div className="faq-q">Is the data real?</div>
            <div className="faq-a">Yes. Live Amazon signals on every run. The numbers match what your paid analyst tools already show. No estimates, no scraping, no AI-fabricated figures.</div>
          </div>
          <div className="faq-card">
            <div className="faq-q">What does it cost?</div>
            <div className="faq-a">Nothing for the first report. No card, no trial timer. The free version is the report; the paid version is monthly tracking and recommendations.</div>
          </div>
          <div className="faq-card">
            <div className="faq-q">Will I get spammed?</div>
            <div className="faq-a">One email when your report is ready. Your address stays with us, no third-party sharing, unsubscribe in one click.</div>
          </div>
        </div>
      </section>

      {/* ── What you'll get in the 48hr report ───────────────────────── */}
      <section className="tease-section no-print">
        <span className="tease-eyebrow">In the 48hr Custom Report</span>
        <h2>What you'll actually see on your brand.</h2>
        <div className="tease-grid">
          <div className="tease-card">
            <div className="tease-num">100</div>
            <div className="tease-title">Of your real reviews, decomposed.</div>
            <div className="tease-body">Each complaint sorted into listing, product, or ops. So you know which ones a copy edit can fix and which ones need engineering.</div>
          </div>
          <div className="tease-card">
            <div className="tease-num">P0 to P3</div>
            <div className="tease-title">Priority-scored, owner-assigned.</div>
            <div className="tease-body">Every issue ranked by revenue impact, with the team that owns the fix already named on the line.</div>
          </div>
          <div className="tease-card">
            <div className="tease-num">48h</div>
            <div className="tease-title">Delivered in under two business days.</div>
            <div className="tease-body">No async waiting. The full report lands in your inbox, ready to share with your team in your next standup.</div>
          </div>
        </div>

        <div className="bridge-cta">
          <div className="bridge-cta-text">
            <strong>The Revenue Risk Report names the lever that is leaking.</strong>
            <span> The 48hr Custom Report reads your reviews and tells you why, and what to fix.</span>
          </div>
          <button type="button" className="bridge-cta-btn"
            aria-label="Scroll to the 48hr Custom Report form"
            onClick={() => scrollTo('claim')}>
            See what your reviews are costing you →
          </button>
        </div>
      </section>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

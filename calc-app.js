const {
  useState,
  useMemo
} = React;
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
function lerp(rating) {
  if (rating <= CONV_TABLE[0].r) return CONV_TABLE[0].i;
  if (rating >= CONV_TABLE[CONV_TABLE.length - 1].r) return CONV_TABLE[CONV_TABLE.length - 1].i;
  for (let j = 0; j < CONV_TABLE.length - 1; j++) {
    const lo = CONV_TABLE[j],
      hi = CONV_TABLE[j + 1];
    if (rating >= lo.r && rating <= hi.r) {
      const t = (rating - lo.r) / (hi.r - lo.r);
      return lo.i + t * (hi.i - lo.i);
    }
  }
  return 0.75;
}
function fmt$(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v < 0 ? "-$" : "$") + (a / 1e6).toFixed(2) + "M";
  return (v < 0 ? "-$" : "$") + a.toLocaleString("en-US", {
    maximumFractionDigits: 0
  });
}
function Stars({
  rating
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "stars"
  }, [0, 1, 2, 3, 4].map(i => /*#__PURE__*/React.createElement("svg", {
    key: i,
    width: "14",
    height: "14",
    viewBox: "0 0 20 20",
    fill: i < Math.floor(rating) ? "#f59e0b" : i === Math.floor(rating) && rating % 1 > 0 ? "#fcd34d" : "var(--cream3)"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
  }))));
}
function Field({
  label,
  tip,
  prefix,
  suffix,
  value,
  onChange,
  min,
  max,
  step
}) {
  const cls = ["field-input", prefix ? "has-prefix" : "", suffix ? "has-suffix" : ""].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: "field"
  }, /*#__PURE__*/React.createElement("div", {
    className: "field-label"
  }, label, tip && /*#__PURE__*/React.createElement("span", {
    className: "field-tip",
    title: tip
  }, "?")), /*#__PURE__*/React.createElement("div", {
    className: "field-wrap"
  }, prefix && /*#__PURE__*/React.createElement("span", {
    className: "field-prefix"
  }, prefix), /*#__PURE__*/React.createElement("input", {
    className: cls,
    type: "number",
    value: value,
    onChange: e => onChange(e.target.value),
    min: min,
    max: max,
    step: step
  }), suffix && /*#__PURE__*/React.createElement("span", {
    className: "field-suffix"
  }, suffix)));
}
function StatCard({
  icon,
  label,
  value,
  sub,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `stat-card ${color}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-label"
  }, /*#__PURE__*/React.createElement("span", null, icon), label), /*#__PURE__*/React.createElement("div", {
    className: "stat-value"
  }, value), sub && /*#__PURE__*/React.createElement("div", {
    className: "stat-sub"
  }, sub));
}
function App() {
  const [cr, setCr] = useState("3.7");
  const [rc, setRc] = useState("1200");
  const [tr, setTr] = useState("4.0");
  const [mr, setMr] = useState("50000");
  const [cvr, setCvr] = useState("3.0");
  const [whatIf, setWhatIf] = useState(null);
  const [showWI, setShowWI] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const out = useMemo(() => {
    const cN = parseFloat(cr),
      rN = parseInt(rc),
      tN = parseFloat(tr),
      mN = parseFloat(mr),
      cvrN = parseFloat(cvr);
    const errs = [];
    if (!cN || cN < 1 || cN > 5) errs.push("Current rating must be 1.0–5.0");
    if (!rN || rN <= 0) errs.push("Review count must be greater than 0");
    if (!tN || tN < 1 || tN > 5) errs.push("Target rating must be 1.0–5.0");
    if (tN <= cN) errs.push("Target must be higher than current rating");
    if (!cvrN || cvrN <= 0 || cvrN > 100) errs.push("Conversion rate must be between 0.1% and 100%");
    if (errs.length) return {
      errs
    };
    const needed = tN >= 5 ? Infinity : Math.ceil((tN - cN) * rN / (5 - tN));
    const iC = lerp(cN),
      iT = lerp(tN);
    const lift = (iT / iC - 1) * 100;
    const newCvr = cvrN * (1 + lift / 100);
    const mo = mN * lift / 100;
    let wi = null;
    if (whatIf !== null) {
      const n = parseInt(whatIf) || 0;
      const wiR = Math.min(5, (cN * rN + 5 * n) / (rN + n));
      const wiL = (lerp(wiR) / iC - 1) * 100;
      wi = {
        r: wiR,
        lift: wiL,
        cvr: cvrN * (1 + wiL / 100),
        mo: mN * wiL / 100,
        yr: mN * wiL / 100 * 12,
        hit: wiR >= tN
      };
    }
    return {
      errs: null,
      needed,
      lift,
      currentCvr: cvrN,
      newCvr,
      mo,
      yr: mo * 12,
      wi,
      cN,
      tN,
      rN
    };
  }, [cr, rc, tr, mr, cvr, whatIf]);
  const maxSlider = out.needed && out.needed !== Infinity ? Math.max(out.needed * 2, 100) : 500;
  {/* Hero renders statically in calculator.html; the app owns only the grid. */}
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "main-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, "Your Product Data"), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Field, {
    label: "Current Star Rating",
    tip: "Your product's average star rating on Amazon",
    value: cr,
    onChange: setCr,
    min: 1,
    max: 5,
    step: 0.1
  }), cr && parseFloat(cr) >= 1 && parseFloat(cr) <= 5 && /*#__PURE__*/React.createElement(Stars, {
    rating: parseFloat(cr)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Total Review Count",
    tip: "Total number of reviews your product currently has",
    value: rc,
    onChange: setRc,
    min: 1,
    step: 1
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Field, {
    label: "Target Star Rating",
    tip: "The rating you want to achieve",
    value: tr,
    onChange: setTr,
    min: 1,
    max: 5,
    step: 0.1
  }), tr && parseFloat(tr) >= 1 && parseFloat(tr) <= 5 && /*#__PURE__*/React.createElement(Stars, {
    rating: parseFloat(tr)
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Monthly Revenue",
    tip: "Your product's current monthly revenue or GMV",
    prefix: "$",
    value: mr,
    onChange: setMr,
    min: 0,
    step: 1000
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Current Conversion Rate",
    tip: "% of visitors who purchase",
    suffix: "%",
    value: cvr,
    onChange: setCvr,
    min: 0.1,
    max: 100,
    step: 0.1
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("button", {
    className: "method-toggle",
    onClick: () => setShowMethod(!showMethod)
  }, /*#__PURE__*/React.createElement("span", {
    className: "method-caret",
    style: {
      transform: showMethod ? "rotate(90deg)" : "rotate(0)"
    }
  }, "\u25B6"), "How we calculate this"), showMethod && /*#__PURE__*/React.createElement("div", {
    className: "method-body",
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Reviews needed:"), " Solves for N in the weighted average: (current_rating \xD7 reviews + 5 \xD7 N) \xF7 (reviews + N) = target_rating."), /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Conversion lift:"), " Uses a piecewise linear model mapping star ratings to a relative conversion index. Purchase probability peaks at ~4.5 stars, then declines toward 5.0: the \"too good to be true\" effect documented by the Spiegel Research Center."), /*#__PURE__*/React.createElement("p", null, "Sources: Spiegel Research Center (2017), PowerReviews, Pattern.com. Directional estimates; actual lift varies by category, price point, and competitive context."))))), /*#__PURE__*/React.createElement("div", {
    className: "output-col"
  }, out.errs ? /*#__PURE__*/React.createElement("div", {
    className: "error-panel"
  }, /*#__PURE__*/React.createElement("h4", null, "Fix these inputs"), out.errs.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "error-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "error-dot"
  }), e))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "cards-grid"
  }, /*#__PURE__*/React.createElement(StatCard, {
    icon: "\uD83D\uDCDD",
    label: "Reviews Needed",
    color: "indigo",
    value: out.needed === Infinity ? "∞" : out.needed.toLocaleString(),
    sub: out.needed === Infinity ? "Impossible to reach 5.0 with finite reviews" : `New 5-star reviews to reach ${parseFloat(tr).toFixed(1)}★`
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "\uD83D\uDCC8",
    label: "Conversion Lift",
    color: out.lift >= 0 ? "emerald" : "amber",
    value: `${out.lift >= 0 ? "+" : ""}${out.lift.toFixed(2)}%`,
    sub: `${parseFloat(cvr).toFixed(2)}% → ${out.newCvr.toFixed(2)}%`
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "\uD83D\uDCB0",
    label: "Monthly Uplift",
    color: out.mo >= 0 ? "emerald" : "amber",
    value: `${out.mo >= 0 ? "+" : ""}${fmt$(out.mo)}`,
    sub: "Estimated incremental monthly revenue"
  }), /*#__PURE__*/React.createElement(StatCard, {
    icon: "\uD83C\uDFAF",
    label: "Annual Uplift",
    color: out.yr >= 0 ? "violet" : "amber",
    value: `${out.yr >= 0 ? "+" : ""}${fmt$(out.yr)}`,
    sub: "Projected 12-month impact"
  })), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, "Rating Journey"), /*#__PURE__*/React.createElement("div", {
    className: "panel-body",
    style: {
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "0.875rem",
      fontWeight: 600,
      color: "var(--ink2)"
    }
  }, out.cN.toFixed(1), "\u2605 to ", out.tN.toFixed(1), "\u2605"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "0.78rem",
      color: "var(--ink5)"
    }
  }, "Peak conversion ~4.5\u2605")), /*#__PURE__*/React.createElement("div", {
    className: "journey-bar-track"
  }, /*#__PURE__*/React.createElement("div", {
    className: "journey-bar-current",
    style: {
      width: `${(out.cN - 1) / 4 * 100}%`
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "journey-bar-target",
    style: {
      width: `${(out.tN - 1) / 4 * 100}%`
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "journey-peak",
    title: "Peak conversion ~4.5\u2605"
  })), /*#__PURE__*/React.createElement("div", {
    className: "journey-ticks"
  }, ["1.0", "2.0", "3.0", "4.0", "5.0"].map(v => /*#__PURE__*/React.createElement("span", {
    key: v
  }, v))), /*#__PURE__*/React.createElement("div", {
    className: "journey-legend"
  }, /*#__PURE__*/React.createElement("div", {
    className: "legend-pip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pip",
    style: {
      background: "var(--parchment)"
    }
  }), " Current"), /*#__PURE__*/React.createElement("div", {
    className: "legend-pip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pip",
    style: {
      background: "var(--forest)"
    }
  }), " Target"), /*#__PURE__*/React.createElement("div", {
    className: "legend-pip"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pip",
    style: {
      background: "var(--ochre)",
      width: 10,
      height: 2,
      borderRadius: 1
    }
  }), " Peak zone")))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-header"
  }, "Sensitivity Analysis"), /*#__PURE__*/React.createElement("div", {
    className: "panel-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "toggle-row",
    onClick: () => {
      const next = !showWI;
      setShowWI(next);
      if (next && whatIf === null) setWhatIf(String(Math.round(out.needed !== Infinity ? out.needed / 2 : 50)));
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "toggle-track",
    style: {
      background: showWI ? "var(--forest)" : "var(--parchment)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "toggle-thumb",
    style: {
      left: showWI ? 21 : 3
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "toggle-label"
  }, "What if I get X new 5-star reviews?")), showWI && whatIf !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      animation: "fadeUp 0.2s ease-out"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "0.8125rem",
      color: "var(--ink4)"
    }
  }, "New 5-star reviews"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: whatIf,
    onChange: e => setWhatIf(e.target.value),
    min: 0,
    max: maxSlider,
    style: {
      width: 72,
      border: "1px solid var(--cream3)",
      borderRadius: 4,
      padding: "4px 8px",
      fontSize: "0.875rem",
      textAlign: "right",
      fontFamily: "inherit",
      background: "var(--cream)",
      color: "var(--ink2)",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: 0,
    max: maxSlider,
    value: whatIf,
    onChange: e => setWhatIf(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "0.72rem",
      color: "var(--ink5)",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("span", null, "0"), out.needed !== Infinity && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--forest)",
      fontWeight: 600
    }
  }, out.needed, " needed for target"), /*#__PURE__*/React.createElement("span", null, maxSlider)), out.wi && /*#__PURE__*/React.createElement("div", {
    className: `whatif-result ${out.wi.hit ? "hit" : "miss"}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "whatif-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-label"
  }, "New rating"), /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-val"
  }, out.wi.r.toFixed(2), " ", /*#__PURE__*/React.createElement(Stars, {
    rating: out.wi.r
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-label"
  }, "Conversion lift"), /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-val",
    style: {
      color: out.wi.lift >= 0 ? "var(--forest)" : "var(--ochre)"
    }
  }, out.wi.lift >= 0 ? "+" : "", out.wi.lift.toFixed(2), "%")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-label"
  }, "Monthly uplift"), /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-val"
  }, out.wi.mo >= 0 ? "+" : "", fmt$(out.wi.mo))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-label"
  }, "Annual uplift"), /*#__PURE__*/React.createElement("div", {
    className: "whatif-item-val"
  }, out.wi.yr >= 0 ? "+" : "", fmt$(out.wi.yr)))), out.wi.hit && /*#__PURE__*/React.createElement("div", {
    className: "whatif-hit-msg"
  }, "\u2713 Target rating reached"))))), /*#__PURE__*/React.createElement("p", {
    className: "assumptions"
  }, /*#__PURE__*/React.createElement("strong", null, "Methodology:"), " Conversion lift estimates based on Spiegel Research Center (2017), PowerReviews, and Pattern.com observational data. Purchase probability peaks at 4.2\u20134.7\u2605 and declines toward 5.0 due to consumer skepticism. Revenue projections assume stable traffic and pricing. Actual results vary by product category, price point, and competitive context. All new reviews assumed to be 5-star."), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--ink)",
      borderRadius: 6,
      padding: "28px 24px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "0.72rem",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: "rgba(255,255,255,0.4)",
      marginBottom: 10
    }
  }, "Want the full picture?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Serif Display', serif",
      fontSize: "1.3rem",
      fontWeight: 400,
      color: "#fff",
      letterSpacing: "-0.02em",
      marginBottom: 8
    }
  }, "See exactly which reviews are costing you stars."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: "0.875rem",
      color: "rgba(255,255,255,0.5)",
      marginBottom: 20,
      lineHeight: 1.6
    }
  }, "Sentopi analyzes every review for your product and delivers a prioritized action plan to get you there."), /*#__PURE__*/React.createElement("a", {
    href: "/#demo",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      background: "var(--ochre)",
      color: "#fff",
      fontWeight: 500,
      fontSize: "0.9375rem",
      padding: "13px 28px",
      borderRadius: 4,
      textDecoration: "none",
      transition: "background 0.15s"
    }
  }, "Get your free report \u2192"))))));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));

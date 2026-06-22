import React, { useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// CALL FUNNEL — Sankey flow  (Jun 22, 2026)
//
// A real Sankey (curved proportional ribbons) drawn in pure SVG — NO
// d3-sankey dependency. Ribbon widths are proportional to call counts, so
// the picture reads "most volume → X" at a glance.
//
// DATA: reads metrics.ai (already on the Metrics page). No backend change.
//   Total Calls (calls_handled)
//     ├─ Spam              (calls_spam)        dead-end, gray
//     └─ Answered          (handled − spam)
//          ├─ Booked       (calls_booked)      green  — the win
//          ├─ Follow-up    (calls_followup)    amber  — in progress
//          ├─ Transferred  (calls_transferred) blue   — human handoff
//          ├─ Hung up      (calls_hung_up)     rose   — lost
//          ├─ Confused     (calls_confused)    rose-light — lost
//          └─ Other        (remainder ≥ 0)     gray   — unclassified
//
// HONESTY: dispositions rarely sum exactly to handled, so we show the
// positive remainder as "Other" rather than force-balancing. The right-edge
// "→ Revenue" node is intentionally omitted until the CRM job-completed loop
// is live — Booked is the honest terminal node today. Adding Revenue later is
// a node append, not a rebuild.
//
// USAGE (Metrics → PerformanceView, near the AI Performance Breakdown):
//     <CallFunnelSankey ai={metrics.ai} />
// ─────────────────────────────────────────────────────────────────────────

const COLORS = {
  total:       "#64748b", // slate-500
  answered:    "#0ea5e9", // sky-500
  spam:        "#cbd5e1", // slate-300
  booked:      "#10b981", // emerald-500
  followup:    "#f59e0b", // amber-500
  transferred: "#3b82f6", // blue-500
  hungup:      "#f43f5e", // rose-500
  confused:    "#fb7185", // rose-400
  other:       "#e2e8f0", // slate-200
};

// One ribbon: a filled cubic-Bézier band from (x0, y0top..y0bot) to
// (x1, y1top..y1bot). This is the same geometry d3-sankey produces.
function ribbonPath(x0, y0t, y0b, x1, y1t, y1b) {
  const xc = (x0 + x1) / 2; // control-point x — halfway, gives the S-curve
  return [
    `M ${x0},${y0t}`,
    `C ${xc},${y0t} ${xc},${y1t} ${x1},${y1t}`, // top edge
    `L ${x1},${y1b}`,                            // down the right cap
    `C ${xc},${y1b} ${xc},${y0b} ${x0},${y0b}`,  // bottom edge back
    "Z",
  ].join(" ");
}

export default function CallFunnelSankey({ ai }) {
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    const a = ai || {};
    const handled     = Number(a.calls_handled) || 0;
    const spam        = Number(a.calls_spam) || 0;
    const booked      = Number(a.calls_booked) || 0;
    const followup    = Number(a.calls_followup) || 0;
    const transferred = Number(a.calls_transferred) || 0;
    const hungup      = Number(a.calls_hung_up) || 0;
    const confused    = Number(a.calls_confused) || 0;

    const answered = Math.max(0, handled - spam);
    const classified = booked + followup + transferred + hungup + confused;
    const other = Math.max(0, answered - classified);

    return { handled, spam, answered, booked, followup, transferred, hungup, confused, other };
  }, [ai]);

  // Nothing to draw.
  if (!model.handled) return null;

  // ── Layout geometry ──────────────────────────────────────────────────
  const W = 760;
  const H = 420;
  const PAD_Y = 14;        // vertical gap between stacked nodes
  const NODE_W = 14;       // node bar thickness
  const usableH = H - PAD_Y * 2;
  const scale = usableH / model.handled; // px per call (height)

  // Three columns: x for Total | Answered/Spam | leaf dispositions
  const xTotal = 8;
  const xMid = W / 2 - NODE_W / 2;
  const xLeaf = W - NODE_W - 8;

  // Column 1: Total (single full-height node)
  const totalNode = { x: xTotal, y0: PAD_Y, y1: PAD_Y + model.handled * scale };

  // Column 2: Answered (top) + Spam (bottom), stacked
  const midNodes = [];
  {
    let y = PAD_Y;
    if (model.answered > 0) {
      midNodes.push({ key: "answered", label: "Answered", count: model.answered, color: COLORS.answered, x: xMid, y0: y, y1: y + model.answered * scale });
      y += model.answered * scale + PAD_Y;
    }
    if (model.spam > 0) {
      midNodes.push({ key: "spam", label: "Spam / Junk", count: model.spam, color: COLORS.spam, x: xMid, y0: y, y1: y + model.spam * scale });
    }
  }

  // Column 3: leaf dispositions (children of Answered), stacked in order
  const leafDefs = [
    ["booked", "Booked", model.booked, COLORS.booked],
    ["followup", "Follow-up needed", model.followup, COLORS.followup],
    ["transferred", "Transferred", model.transferred, COLORS.transferred],
    ["hungup", "Hung up", model.hungup, COLORS.hungup],
    ["confused", "Confused", model.confused, COLORS.confused],
    ["other", "Other", model.other, COLORS.other],
  ].filter(([, , c]) => c > 0);

  const leafNodes = [];
  {
    let y = PAD_Y;
    for (const [key, label, count, color] of leafDefs) {
      const h = count * scale;
      leafNodes.push({ key, label, count, color, x: xLeaf, y0: y, y1: y + h });
      y += h + PAD_Y;
    }
  }

  // ── Ribbons ───────────────────────────────────────────────────────────
  // Total → Answered, Total → Spam  (left set)
  const leftRibbons = [];
  {
    let srcY = totalNode.y0;
    for (const n of midNodes) {
      const h = n.y1 - n.y0;
      leftRibbons.push({
        key: `t-${n.key}`,
        d: ribbonPath(xTotal + NODE_W, srcY, srcY + h, n.x, n.y0, n.y1),
        color: n.color,
        relates: n.key,
      });
      srcY += h;
    }
  }

  // Answered → each leaf (right set). Source slice walks down the Answered node.
  const rightRibbons = [];
  {
    const answeredNode = midNodes.find((n) => n.key === "answered");
    if (answeredNode) {
      let srcY = answeredNode.y0;
      for (const n of leafNodes) {
        const h = n.y1 - n.y0;
        rightRibbons.push({
          key: `a-${n.key}`,
          d: ribbonPath(answeredNode.x + NODE_W, srcY, srcY + h, n.x, n.y0, n.y1),
          color: n.color,
          relates: n.key,
        });
        srcY += h;
      }
    }
  }

  const pct = (n) => (model.handled ? Math.round((n / model.handled) * 100) : 0);
  const ribbonOpacity = (relates) =>
    hover == null ? 0.45 : hover === relates ? 0.72 : 0.12;

  return (
    <section className="space-y-4 pt-4">
      {/* SectionTitle */}
      <div className="flex items-center gap-3 py-1">
        <div className="w-1 h-3.5 bg-brand-600 rounded-full shadow-sm" />
        <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">
          Call Pipeline Flow
        </h2>
      </div>

      <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/10">
          <div>
            <h3 className="text-sm font-bold text-gray-900 leading-tight">
              Where every call goes
            </h3>
            <p className="text-[10px] text-gray-400 font-medium">
              Volume split by outcome · {model.handled.toLocaleString()} calls
            </p>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            Last 30 days
          </div>
        </div>

        {/* Diagram */}
        <div className="p-6 overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ minWidth: 680 }}
            onMouseLeave={() => setHover(null)}
          >
            {/* ribbons first (under nodes) */}
            {leftRibbons.map((r) => (
              <path
                key={r.key}
                d={r.d}
                fill={r.color}
                opacity={ribbonOpacity(r.relates)}
                style={{ transition: "opacity 120ms" }}
              />
            ))}
            {rightRibbons.map((r) => (
              <path
                key={r.key}
                d={r.d}
                fill={r.color}
                opacity={ribbonOpacity(r.relates)}
                style={{ transition: "opacity 120ms" }}
              />
            ))}

            {/* Column 1 — Total node */}
            <g>
              <rect
                x={totalNode.x}
                y={totalNode.y0}
                width={NODE_W}
                height={totalNode.y1 - totalNode.y0}
                rx={3}
                fill={COLORS.total}
              />
              <text x={totalNode.x + NODE_W + 8} y={totalNode.y0 + 16} className="fill-gray-900" style={{ fontSize: 12, fontWeight: 700 }}>
                Total Calls
              </text>
              <text x={totalNode.x + NODE_W + 8} y={totalNode.y0 + 32} className="fill-gray-400" style={{ fontSize: 11, fontWeight: 600 }}>
                {model.handled.toLocaleString()}
              </text>
            </g>

            {/* Column 2 — Answered / Spam */}
            {midNodes.map((n) => (
              <g key={n.key} onMouseEnter={() => setHover(n.key)} style={{ cursor: "default" }}>
                <rect x={n.x} y={n.y0} width={NODE_W} height={n.y1 - n.y0} rx={3} fill={n.color} />
                <text x={n.x - 8} y={n.y0 + 14} textAnchor="end" className="fill-gray-900" style={{ fontSize: 12, fontWeight: 700 }}>
                  {n.label}
                </text>
                <text x={n.x - 8} y={n.y0 + 29} textAnchor="end" className="fill-gray-400" style={{ fontSize: 10.5, fontWeight: 600 }}>
                  {n.count.toLocaleString()} · {pct(n.count)}%
                </text>
              </g>
            ))}

            {/* Column 3 — leaf dispositions */}
            {leafNodes.map((n) => (
              <g key={n.key} onMouseEnter={() => setHover(n.key)} style={{ cursor: "default" }}>
                <rect x={n.x} y={n.y0} width={NODE_W} height={n.y1 - n.y0} rx={3} fill={n.color} />
                <text x={n.x - 8} y={(n.y0 + n.y1) / 2 - 2} textAnchor="end" className="fill-gray-900" style={{ fontSize: 11.5, fontWeight: 700 }}>
                  {n.label}
                </text>
                <text x={n.x - 8} y={(n.y0 + n.y1) / 2 + 12} textAnchor="end" className="fill-gray-400" style={{ fontSize: 10, fontWeight: 600 }}>
                  {n.count.toLocaleString()} · {pct(n.count)}%
                </text>
              </g>
            ))}
          </svg>

          {/* Footnote — honest about the missing revenue node */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-start gap-3">
            <div className="w-4 h-4 mt-0.5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black shrink-0">
              i
            </div>
            <p className="text-[11px] text-blue-800/90 leading-relaxed">
              Flow ends at <strong>Booked</strong> today. Once completed jobs &amp;
              revenue flow from your CRM, a <strong>Revenue</strong> stage joins
              the right edge — turning booked calls into booked dollars.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

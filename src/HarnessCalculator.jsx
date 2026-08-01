import React, { useMemo, useState } from "react";

const mono = "'IBM Plex Mono', 'Roboto Mono', monospace";
const sans = "'Inter', 'Helvetica Neue', sans-serif";

const POWER = "#F5A623";
const DATA = "#4FD1E8";
const CORE = "#5B6B82";
const BG = "#0A0F16";
const PANEL = "#101826";
const LINE = "#1E2A3B";
const TEXT = "#DCE6F2";
const DIM = "#7A8AA0";
const DANGER = "#E05C6B";

let idSeq = 1;
const nextId = () => idSeq++;

function NumField({ value, onChange, width = 64, step = 1, min = 0 }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width,
        background: "#0D1420",
        border: `1px solid ${LINE}`,
        borderRadius: 4,
        color: TEXT,
        fontFamily: mono,
        fontSize: 13,
        padding: "5px 7px",
        outline: "none",
      }}
      onFocus={(e) => (e.target.style.borderColor = DATA)}
      onBlur={(e) => (e.target.style.borderColor = LINE)}
    />
  );
}

function Toggle({ checked, onChange, label, color }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: color, width: 14, height: 14 }} />
      <span style={{ fontFamily: sans, fontSize: 11, color: checked ? TEXT : DIM }}>{label}</span>
    </label>
  );
}

function IconBtn({ onClick, children, danger }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent",
      border: `1px solid ${danger ? DANGER : LINE}`,
      color: danger ? DANGER : DIM,
      borderRadius: 4,
      width: 24, height: 24,
      fontFamily: mono, fontSize: 13,
      cursor: "pointer",
      lineHeight: "1",
    }}>{children}</button>
  );
}

const defaultNode = (segLen = 60) => ({
  id: nextId(), segLen, branchLen: 70, powerTap: true,
});

const defaultFork = (label) => ({
  id: nextId(), label, branchLen: 60, powerTap: true, hasData: true, dataSource: "chain",
});

// deterministic pseudo-random 0..1 per index, stable across re-renders
function seededRandom(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// multiplier for node i of n: base->tip taper plus organic jitter
function growthMultiplier(i, n, taper, jitter) {
  const posFrac = n > 1 ? i / (n - 1) : 0; // 0 = base (near driver), 1 = tip
  const base = 1 + taper * (1 - 2 * posFrac); // base end scaled up, tip end scaled down
  const j = jitter * (seededRandom(i) * 2 - 1);
  return Math.max(0.15, base * (1 + j));
}

function Slider({ label, value, onChange, min, max, step, format }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: TEXT }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: DATA, width: "100%" }} />
    </label>
  );
}

// ---------- vertical stem diagram ----------
function segPx(mm) {
  return Math.max(34, Math.min(110, mm * 1.05 + 22));
}
function branchPx(mm) {
  return Math.max(30, Math.min(100, mm * 0.8 + 18));
}

function VerticalDiagram({ nodes, leadIn, forkEnabled, forkDistance, forkA, forkB }) {
  const width = 420;
  const jog = 26;
  const centerX = width / 2;
  const marginBottom = 60;
  const marginTop = 40;

  // build core points bottom -> top
  const pts = [];
  let y = 0; // will offset later
  let x = centerX;
  pts.push({ x, y, kind: "driver" });

  // lead-in (straight, not a bend)
  y -= segPx(leadIn);
  pts.push({ x, y, kind: "node", node: nodes[0], segLenLabel: leadIn, i: 0 });

  for (let i = 1; i < nodes.length; i++) {
    x = centerX + (i % 2 === 0 ? jog : -jog);
    y -= segPx(nodes[i].segLen);
    pts.push({ x, y, kind: "node", node: nodes[i], segLenLabel: nodes[i].segLen, i });
  }

  let forkPoint = null;
  if (forkEnabled && nodes.length > 0) {
    const lastPt = pts[pts.length - 1];
    const fy = lastPt.y - segPx(forkDistance);
    forkPoint = { x: centerX, y: fy };
  }

  const topY = forkPoint ? forkPoint.y - branchPx(Math.max(forkA.branchLen, forkB.branchLen)) - 30
    : (pts[pts.length - 1].y - branchPx(nodes[nodes.length - 1]?.branchLen || 60) - 30);

  const totalHeight = marginBottom + (pts[0].y - topY) + marginTop;
  const offsetY = marginBottom - topY; // shift so drawing sits within [0, totalHeight]

  const T = (p) => ({ x: p.x, y: p.y + offsetY });

  const corePath = pts.map((p) => T(p)).map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${totalHeight}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* driver box */}
      {(() => {
        const d = T(pts[0]);
        return (
          <g>
            <rect x={d.x - 22} y={d.y - 14} width="44" height="28" rx="3" fill={PANEL} stroke={LINE} />
            <text x={d.x} y={d.y + 4} textAnchor="middle" fontFamily={mono} fontSize="9" fill={DIM}>DRIVER</text>
          </g>
        );
      })()}

      {/* core polyline (structural) */}
      <polyline points={corePath} fill="none" stroke={CORE} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {/* data line running alongside core, offset */}
      <polyline
        points={pts.map((p) => { const t = T(p); return `${t.x + 6},${t.y}`; }).join(" ")}
        fill="none" stroke={DATA} strokeWidth="1.6" strokeDasharray="4 3" strokeLinejoin="round"
      />

      {/* segment length labels */}
      {pts.slice(1).map((p, idx) => {
        const prev = T(pts[idx]);
        const cur = T(p);
        const mx = (prev.x + cur.x) / 2;
        const my = (prev.y + cur.y) / 2;
        return (
          <text key={idx} x={mx - 20} y={my} fontFamily={mono} fontSize="8.5" fill={DIM}>
            {p.segLenLabel}mm
          </text>
        );
      })}

      {/* nodes + branches */}
      {pts.slice(1).map((p) => {
        const n = p.node;
        const t = T(p);
        const dir = t.x >= centerX ? 1 : -1;
        const bLen = branchPx(n.branchLen);
        const flowerX = t.x + dir * bLen * 0.8;
        const flowerY = t.y - bLen;
        return (
          <g key={p.i}>
            <circle cx={t.x} cy={t.y} r="4" fill={BG} stroke={CORE} strokeWidth="2" />
            {n.powerTap && (
              <line x1={t.x} y1={t.y} x2={flowerX} y2={flowerY} stroke={POWER} strokeWidth="2" opacity="0.9" />
            )}
            <line x1={t.x + dir * 3} y1={t.y} x2={flowerX + dir * 3} y2={flowerY}
              stroke={DATA} strokeWidth="1.4" strokeDasharray="3 2" opacity="0.9" />
            <circle cx={flowerX} cy={flowerY} r="13" fill="#1A2433" stroke={POWER} strokeWidth="1.4" />
            <text x={flowerX} y={flowerY + 3} textAnchor="middle" fontFamily={mono} fontSize="9" fill={TEXT}>
              {p.i + 1}
            </text>
            <text x={flowerX + dir * 18} y={flowerY + 3} textAnchor={dir > 0 ? "start" : "end"}
              fontFamily={mono} fontSize="8" fill={DIM}>
              {n.branchLen}mm
            </text>
          </g>
        );
      })}

      {/* fork */}
      {forkPoint && (() => {
        const lastT = T(pts[pts.length - 1]);
        const fp = { x: forkPoint.x, y: forkPoint.y + offsetY };
        const els = [];
        els.push(
          <line key="stem" x1={lastT.x} y1={lastT.y} x2={fp.x} y2={fp.y} stroke={CORE} strokeWidth="5" strokeLinecap="round" />
        );
        els.push(
          <line key="stemdata" x1={lastT.x + 6} y1={lastT.y} x2={fp.x + 6} y2={fp.y}
            stroke={DATA} strokeWidth="1.6" strokeDasharray="4 3" />
        );
        els.push(<circle key="fpc" cx={fp.x} cy={fp.y} r="4" fill={BG} stroke={CORE} strokeWidth="2" />);
        els.push(
          <text key="fplabel" x={fp.x - 20} y={(lastT.y + fp.y) / 2} fontFamily={mono} fontSize="8.5" fill={DIM}>
            {forkDistance}mm
          </text>
        );

        [["A", forkA, -1], ["B", forkB, 1]].forEach(([label, f, dir]) => {
          const bLen = branchPx(f.branchLen);
          const fx = fp.x + dir * bLen * 0.85;
          const fy = fp.y - bLen;
          if (f.powerTap) {
            els.push(<line key={`p${label}`} x1={fp.x} y1={fp.y} x2={fx} y2={fy}
              stroke={POWER} strokeWidth="2" opacity="0.9" />);
          }
          if (f.hasData) {
            els.push(<line key={`d${label}`} x1={fp.x + dir * 3} y1={fp.y} x2={fx + dir * 3} y2={fy}
              stroke={DATA} strokeWidth="1.4" strokeDasharray="3 2" opacity="0.9" />);
          }
          els.push(
            <circle key={`c${label}`} cx={fx} cy={fy} r="13" fill="#1A2433"
              stroke={f.powerTap ? POWER : DIM} strokeWidth="1.4" strokeDasharray={f.powerTap ? "0" : "3 2"} />
          );
          els.push(
            <text key={`t${label}`} x={fx} y={fy + 3} textAnchor="middle" fontFamily={mono} fontSize="9" fill={TEXT}>
              {label}
            </text>
          );
          if (label === "B" && f.dataSource === "sibling") {
            const aFx = fp.x - branchPx(forkA.branchLen) * 0.85;
            const aFy = fp.y - branchPx(forkA.branchLen);
            els.push(
              <path key="sib" d={`M ${aFx} ${aFy + 14} Q ${fp.x} ${Math.min(aFy, fy) - 10} ${fx} ${fy + 14}`}
                fill="none" stroke={DATA} strokeWidth="1.4" />
            );
          }
        });
        return <g>{els}</g>;
      })()}
    </svg>
  );
}

function Row({ label, qty, length, color, note }) {
  if (qty <= 0) return null;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 56px 90px",
      alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${LINE}`,
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
          <span style={{ fontFamily: sans, fontSize: 13, color: TEXT }}>{label}</span>
        </div>
        {note && <div style={{ fontFamily: sans, fontSize: 11, color: DIM, marginTop: 2, paddingLeft: 16 }}>{note}</div>}
      </div>
      <div style={{ fontFamily: mono, fontSize: 13, color: DIM, textAlign: "right" }}>×{qty}</div>
      <div style={{ fontFamily: mono, fontSize: 14, color: TEXT, textAlign: "right" }}>{length.toFixed(0)} mm</div>
    </div>
  );
}

export default function HarnessCalculatorV3() {
  const [nodes, setNodes] = useState([
    defaultNode(0), defaultNode(55), defaultNode(48), defaultNode(62),
  ]);
  const [slack, setSlack] = useState(8);
  const [leadIn, setLeadIn] = useState(50);

  const [forkEnabled, setForkEnabled] = useState(true);
  const [forkDistance, setForkDistance] = useState(40);
  const [forkGap, setForkGap] = useState(6);
  const [forkA, setForkA] = useState(defaultFork("A"));
  const [forkB, setForkB] = useState({ ...defaultFork("B"), powerTap: false, dataSource: "sibling" });

  const [taper, setTaper] = useState(0);
  const [jitter, setJitter] = useState(0);

  const multipliers = useMemo(
    () => nodes.map((_, i) => growthMultiplier(i, nodes.length, taper, jitter)),
    [nodes.length, taper, jitter]
  );
  const scaledNodes = useMemo(
    () => nodes.map((n, i) => ({
      ...n,
      segLen: i === 0 ? n.segLen : n.segLen * multipliers[i],
      branchLen: n.branchLen * multipliers[i],
    })),
    [nodes, multipliers]
  );
  const tipMult = nodes.length > 0 ? multipliers[multipliers.length - 1] : 1;
  const scaledForkDistance = forkDistance * tipMult;
  const scaledForkA = { ...forkA, branchLen: forkA.branchLen * tipMult };
  const scaledForkB = { ...forkB, branchLen: forkB.branchLen * tipMult };

  const updateNode = (id, patch) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const addNode = () => setNodes((ns) => [...ns, defaultNode(50)]);
  const removeNode = (id) => setNodes((ns) => (ns.length > 1 ? ns.filter((n) => n.id !== id) : ns));
  const setStemCount = (count) => {
    const n = Math.max(1, Math.round(count));
    setNodes((ns) => {
      if (n === ns.length) return ns;
      if (n < ns.length) return ns.slice(0, n);
      const added = Array.from({ length: n - ns.length }, () => defaultNode(50));
      return [...ns, ...added];
    });
  };

  const rows = useMemo(() => {
    const out = [];
    scaledNodes.forEach((n, i) => {
      if (n.powerTap) {
        out.push({ label: `Power tap — stem ${i + 1} (pwr + gnd)`, qty: 2, length: n.branchLen + slack, color: POWER });
      }
    });
    if (scaledNodes.length > 0) {
      out.push({ label: "Data lead-in — driver → stem 1 (send + return)", qty: 2, length: leadIn + scaledNodes[0].branchLen + slack, color: DATA });
    }
    for (let i = 0; i < scaledNodes.length - 1; i++) {
      const a = scaledNodes[i], b = scaledNodes[i + 1];
      out.push({ label: `Data link — stem ${i + 1} → stem ${i + 2} (send + return)`, qty: 2, length: a.branchLen + b.segLen + b.branchLen + slack, color: DATA });
    }
    if (forkEnabled && scaledNodes.length > 0) {
      const last = scaledNodes[scaledNodes.length - 1];
      if (scaledForkA.powerTap) out.push({ label: "Power tap — fork A (pwr + gnd)", qty: 2, length: scaledForkA.branchLen + slack, color: POWER });
      if (scaledForkB.powerTap) out.push({ label: "Power tap — fork B (pwr + gnd)", qty: 2, length: scaledForkB.branchLen + slack, color: POWER });
      if (scaledForkA.hasData && scaledForkA.dataSource === "chain") {
        out.push({ label: "Data link — stem N → fork A (send + return)", qty: 2, length: last.branchLen + scaledForkDistance + scaledForkA.branchLen + slack, color: DATA });
      }
      if (scaledForkB.hasData) {
        if (scaledForkB.dataSource === "chain") {
          out.push({ label: "Data link — stem N → fork B (send + return)", qty: 2, length: last.branchLen + scaledForkDistance + scaledForkB.branchLen + slack, color: DATA, note: !scaledForkB.powerTap ? "data only — no power tap" : undefined });
        } else {
          out.push({ label: "Data link — fork A → fork B (send + return)", qty: 2, length: scaledForkA.branchLen + forkGap + scaledForkB.branchLen + slack, color: DATA, note: !scaledForkB.powerTap ? "data only — no power tap" : undefined });
        }
      }
    }
    return out;
  }, [scaledNodes, slack, leadIn, forkEnabled, scaledForkDistance, forkGap, scaledForkA, scaledForkB]);

  const totalPieces = rows.reduce((s, r) => s + r.qty, 0);
  const totalLength = rows.reduce((s, r) => s + r.qty * r.length, 0);
  const powerTotal = rows.filter((r) => r.color === POWER).reduce((s, r) => s + r.qty * r.length, 0);
  const dataTotal = rows.filter((r) => r.color === DATA).reduce((s, r) => s + r.qty * r.length, 0);

  return (
    <div style={{ background: BG, minHeight: "100%", padding: "24px 18px 40px", fontFamily: sans }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: DATA, letterSpacing: 1.5, marginBottom: 6 }}>
            GLOWFLORA HOME — HARNESS PLANNER
          </div>
          <h1 style={{ fontFamily: sans, fontSize: 21, fontWeight: 600, color: TEXT, margin: 0 }}>
            Stem wiring cut-length calculator
          </h1>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, alignItems: "start" }}>
          {/* diagram, sticky left column */}
          <div style={{
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8,
            padding: "18px 14px", position: "sticky", top: 12,
          }}>
            <VerticalDiagram nodes={scaledNodes} leadIn={leadIn} forkEnabled={forkEnabled}
              forkDistance={scaledForkDistance} forkA={scaledForkA} forkB={scaledForkB} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 18, height: 4, background: CORE, display: "inline-block", borderRadius: 2 }} />
                <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>core (14AWG + pwr bus)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 18, height: 2, background: POWER, display: "inline-block" }} />
                <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>power tap</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={DATA} strokeWidth="2" strokeDasharray="3 2" /></svg>
                <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>data</span>
              </div>
            </div>
          </div>

          {/* right column: controls + cut list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 11, color: DIM, letterSpacing: 1 }}>CORE BENDS / STEMS</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}># stems</span>
                    <NumField width={48} value={nodes.length} min={1}
                      onChange={setStemCount} />
                  </label>
                  <IconBtn onClick={addNode}>+</IconBtn>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 70px 70px 70px 24px", gap: 8, marginBottom: 6 }}>
                <span />
                <span />
                <span style={{ fontFamily: sans, fontSize: 10, color: DIM }}>seg mm</span>
                <span style={{ fontFamily: sans, fontSize: 10, color: DIM }}>branch mm</span>
                <span style={{ fontFamily: sans, fontSize: 10, color: DIM }}>power</span>
                <span />
              </div>

              {nodes.map((n, i) => (
                <div key={n.id} style={{
                  display: "grid", gridTemplateColumns: "18px 1fr 70px 70px 70px 24px",
                  gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${LINE}`,
                }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: DIM }}>{i + 1}</span>
                  <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>
                    {i === 0 ? "from driver" : `from stem ${i}`}
                  </span>
                  <NumField width={60} value={i === 0 ? 0 : n.segLen} step={5}
                    onChange={(v) => updateNode(n.id, { segLen: v })} />
                  <NumField width={60} value={n.branchLen} step={5}
                    onChange={(v) => updateNode(n.id, { branchLen: v })} />
                  <input type="checkbox" checked={n.powerTap}
                    onChange={(e) => updateNode(n.id, { powerTap: e.target.checked })}
                    style={{ accentColor: POWER, width: 15, height: 15 }} />
                  <IconBtn danger onClick={() => removeNode(n.id)}>×</IconBtn>
                </div>
              ))}

              <div style={{ display: "flex", gap: 16, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
                <Slider label="Base → tip scaling" value={taper} min={0} max={0.8} step={0.05}
                  onChange={setTaper} format={(v) => `${v.toFixed(2)}`} />
                <Slider label="Irregularity" value={jitter} min={0} max={0.4} step={0.02}
                  onChange={setJitter} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
              {(taper > 0 || jitter > 0) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {multipliers.map((m, i) => (
                    <span key={i} style={{ fontFamily: mono, fontSize: 10, color: DIM, background: "#0D1420", border: `1px solid ${LINE}`, borderRadius: 3, padding: "2px 6px" }}>
                      stem {i + 1} ×{m.toFixed(2)}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 20, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>joint slack (mm)</span>
                  <NumField width={60} value={slack} onChange={setSlack} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>driver lead-in (mm)</span>
                  <NumField width={60} value={leadIn} onChange={setLeadIn} />
                </label>
              </div>

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
                <Toggle checked={forkEnabled} onChange={setForkEnabled} label="Fork at tip (two stems from last position)" color={DATA} />
                {forkEnabled && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>distance to fork point (mm)</span>
                      <NumField width={60} value={forkDistance} step={5} onChange={setForkDistance} />
                    </label>

                    {[["A", forkA, setForkA], ["B", forkB, setForkB]].map(([label, f, setF]) => (
                      <div key={label} style={{ background: "#0D1420", border: `1px solid ${LINE}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
                        <div style={{ fontFamily: mono, fontSize: 11, color: TEXT, marginBottom: 8 }}>Fork {label}</div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontFamily: sans, fontSize: 10, color: DIM }}>branch mm</span>
                            <NumField width={56} value={f.branchLen} step={5} onChange={(v) => setF({ ...f, branchLen: v })} />
                          </label>
                          <Toggle checked={f.powerTap} onChange={(v) => setF({ ...f, powerTap: v })} label="power" color={POWER} />
                          <Toggle checked={f.hasData} onChange={(v) => setF({ ...f, hasData: v })} label="data" color={DATA} />
                          {f.hasData && (
                            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <span style={{ fontFamily: sans, fontSize: 10, color: DIM }}>data from</span>
                              <select value={f.dataSource} onChange={(e) => setF({ ...f, dataSource: e.target.value })}
                                style={{ background: "#0D1420", border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, fontFamily: mono, fontSize: 12, padding: "5px 6px" }}>
                                <option value="chain">core chain</option>
                                <option value="sibling">other fork</option>
                              </select>
                            </label>
                          )}
                        </div>
                      </div>
                    ))}

                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: sans, fontSize: 11, color: DIM }}>gap between fork bases (mm)</span>
                      <NumField width={56} value={forkGap} onChange={setForkGap} />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 18 }}>
              <div style={{ fontFamily: mono, fontSize: 11, color: DIM, letterSpacing: 1, marginBottom: 8 }}>PRECUT LIST</div>
              {rows.map((r, i) => <Row key={i} {...r} />)}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 14 }}>
                <div style={{ fontFamily: sans, fontSize: 12, color: DIM }}>{totalPieces} pieces total</div>
                <div style={{ fontFamily: mono, fontSize: 14, color: TEXT, fontWeight: 600 }}>{(totalLength / 1000).toFixed(2)} m</div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: POWER }}>power {(powerTotal / 1000).toFixed(2)} m</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: DATA }}>data {(dataTotal / 1000).toFixed(2)} m</span>
              </div>
              <p style={{ fontFamily: sans, fontSize: 11, color: DIM, marginTop: 14, lineHeight: 1.6 }}>
                Each row is a pair — power counts pwr + gnd, data counts send + return.
                Diagram segment/branch spacing is proportional but clamped for readability, not exact scale.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

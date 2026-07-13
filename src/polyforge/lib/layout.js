// Shared geometry helpers for net rendering and export.
//
// All inputs are in normalized-edge-length units (the unfolder's output);
// the caller scales to millimeters by multiplying by edgeLengthMm.

export function centroid2D(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Mounting hole positions per face, in normalized units. Caller scales.
//
// 'center'  → one hole at the face centroid
// 'corners' → one hole per face vertex, inset toward the centroid by
//             `marginMm`. We do the inset in mm and convert back to
//             normalized units via edgeLengthMm so the margin is a real
//             physical clearance regardless of edge length.
export function mountingHolePositions(face2D, params, edgeLengthMm) {
  if (!params || !params.enabled) return [];
  const c = centroid2D(face2D);
  if (params.position === 'center') return [c];
  const insetUnits = (params.marginMm || 0) / Math.max(edgeLengthMm, 0.001);
  return face2D.map(([x, y]) => {
    const dx = c[0] - x, dy = c[1] - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const t = Math.min(insetUnits / d, 0.45); // clamp so it never crosses the centroid
    return [x + dx * t, y + dy * t];
  });
}

// Apply the panel shape (face / circle / hexagon) to a face's 2D
// polygon and return a tagged outline ready to render or export.
//
// 'face'    → original polygon, optionally inset and/or rounded at
//             the corners. cornerRadius is in normalized units.
// 'circle'  → inscribed circle, scaled by panel.scale. Returned as
//             { kind: 'circle', cx, cy, r } so the renderer can use
//             a real circle primitive instead of a many-sided polygon.
// 'hexagon' → regular 6-gon inscribed in the face's inradius.
export function panelOutline(face2D, panel, edgeLengthMm) {
  const c = centroid2D(face2D);
  const inradius = inradiusOf(face2D, c);
  const insetUnits = (panel?.insetMm || 0) / Math.max(edgeLengthMm, 0.001);
  const shape = panel?.shape || 'face';

  if (shape === 'circle') {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    return { kind: 'circle', cx: c[0], cy: c[1], r };
  }

  if (shape === 'hexagon') {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    });
    return { kind: 'polygon', points: pts, cornerRadius: 0 };
  }

  // 'face' — same shape as the original polygon, inset and/or rounded.
  const inset = insetPolygon(face2D, c, insetUnits);
  const cornerRadius = (panel?.cornerRadiusMm || 0) / Math.max(edgeLengthMm, 0.001);
  return { kind: 'polygon', points: inset, cornerRadius };
}

// Largest circle that fits inside a (convex) polygon centered on c —
// the perpendicular distance from c to the nearest edge.
function inradiusOf(poly, c) {
  let r = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const d = Math.abs(dy * c[0] - dx * c[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d < r) r = d;
  }
  return r;
}

// Pull each vertex of `poly` toward `c` until the boundary moves
// inward by `inset` units. Approximate but good enough for the small
// insets users actually need; switch to a proper polygon offset
// (e.g. Clipper) if anyone ever asks for a 0.5×-edge inset.
function insetPolygon(poly, c, inset) {
  if (inset <= 0) return poly.map(p => [p[0], p[1]]);
  return poly.map(([x, y]) => {
    const dx = c[0] - x, dy = c[1] - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const t = Math.min(inset / d, 0.45);
    return [x + dx * t, y + dy * t];
  });
}

// Trace count carried by every bridge in the spanning tree, given the
// LED's wire count. Each data signal needs to travel down into the
// subtree (DIN/CIN) AND back out as the next-LED feeder (DOUT/COUT),
// so trace count = 2 × data signals + 2 power rails.
//
//   3-wire WS2812 (VCC, DIN, GND):           VCC + GND + DIN + DOUT       = 4
//   4-wire APA102 (VCC, GND, CIN, DIN):      VCC + GND + CIN+COUT + DIN+DOUT = 6
export function bridgeTraceCount(wireCount) {
  return Math.max(2, 2 * (wireCount || 3) - 2);
}

// Bridge width in mm sized exactly for the traces it carries:
// N traces at traceWidth, (N-1) clearance gaps between them, and
// edgeMargin on each side. Returns 0 when N=0.
export function computeBridgeWidthMm(traceCount, designRules) {
  if (traceCount <= 0) return 0;
  const tw = designRules?.traceWidthMm ?? 0.25;
  const cl = designRules?.clearanceMm   ?? 0.2;
  const em = designRules?.edgeMarginMm  ?? 0.5;
  return traceCount * tw + (traceCount - 1) * cl + 2 * em;
}

// Centerline of a bridge from cA to cB, in normalized units.
//
// 'straight' → two points.
// 's-curve'  → tessellated cubic Bézier whose control points are
//              offset laterally in opposite directions, producing a
//              serpentine. The extra material length lets the hinge
//              wrap a tighter bend radius without straining copper —
//              standard practice for dynamic flex sections.
export function bridgeCenterline(cA, cB, style, ampUnits) {
  if (style !== 's-curve' || ampUnits <= 0) return [cA, cB];
  const dx = cB[0] - cA[0], dy = cB[1] - cA[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  // Control points at 1/3 and 2/3 along the axis, offset to opposite
  // sides — classic S. Amplitude is the lateral control offset.
  const p0 = cA;
  const p1 = [cA[0] + ux * len / 3 + nx * ampUnits, cA[1] + uy * len / 3 + ny * ampUnits];
  const p2 = [cA[0] + ux * 2 * len / 3 - nx * ampUnits, cA[1] + uy * 2 * len / 3 - ny * ampUnits];
  const p3 = cB;
  const SEGS = 24;
  const pts = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS, s = 1 - t;
    pts.push([
      s*s*s*p0[0] + 3*s*s*t*p1[0] + 3*s*t*t*p2[0] + t*t*t*p3[0],
      s*s*s*p0[1] + 3*s*s*t*p1[1] + 3*s*t*t*p2[1] + t*t*t*p3[1],
    ]);
  }
  return pts;
}

// Offset a polyline laterally by `off` using averaged per-point
// normals. Good enough for the gentle curvature of an S-bridge
// (curvature radius >> offset).
export function offsetPolyline(pts, off) {
  const n = pts.length;
  if (n < 2) return pts.map(p => [p[0], p[1]]);
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    normals.push([-dy / l, dx / l]);
  }
  return pts.map((p, i) => [p[0] + normals[i][0] * off, p[1] + normals[i][1] * off]);
}

// Gap-aware bridge centerline between two adjacent faces, in
// normalized units. Straight bridges are just centroid → centroid.
// For S-curve bridges, the serpentine is confined to the GAP between
// the two panel boundaries — that's the only stretch free to flex, so
// spreading the curve across the whole span (most of it bonded to
// rigid panel) would waste the amplitude where it does nothing.
export function gapAwareCenterline(net, e, panel, edgeLengthMm) {
  const fA = net.faces[e.faceA];
  const fB = net.faces[e.faceB];
  const cA = centroid2D(fA.polygon2D);
  const cB = centroid2D(fB.polygon2D);
  const cfg = panel?.bridge || {};
  if (cfg.style !== 's-curve' || !(cfg.curveAmplitudeMm > 0)) return [cA, cB];

  const shapeA = panelOutline(fA.polygon2D, panel, edgeLengthMm);
  const shapeB = panelOutline(fB.polygon2D, panel, edgeLengthMm);
  const N = 160;
  const line = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    return [cA[0] + (cB[0] - cA[0]) * t, cA[1] + (cB[1] - cA[1]) * t];
  });
  let exitA = 0;
  for (let i = 0; i < N; i++) {
    if (insidePanelShape(line[i], shapeA)) exitA = i; else break;
  }
  let entryB = N - 1;
  for (let i = N - 1; i >= 0; i--) {
    if (insidePanelShape(line[i], shapeB)) entryB = i; else break;
  }
  if (entryB - exitA < 2) return [cA, cB]; // panels touch — no gap to shape

  const ampUnits = cfg.curveAmplitudeMm / Math.max(edgeLengthMm, 0.001);
  const s = bridgeCenterline(line[exitA], line[entryB], 's-curve', ampUnits);
  return [cA, ...s, cB];
}

// Flex bridges connecting adjacent panels across each fold edge.
//
// The bridge is a strip running from face A's centroid to face B's
// centroid (crossing the fold edge at its midpoint), `widthMm` wide.
// Anchoring the ends at the panel CENTROIDS — which every panel
// shape contains — guarantees the strip penetrates both panels no
// matter how far the panel boundary is inset (inset polygon,
// inscribed circle, inscribed hexagon). The panel/board union at
// export absorbs the buried portion; only the span between the two
// panel boundaries survives as visible bridge.
//
// style 's-curve' swaps the straight centerline through the panel
// gap for a serpentine (see gapAwareCenterline) — the outline is
// built by offsetting the tessellated curve ±width/2, so the strip
// keeps constant width along the S.
//
// Takes the whole net (faces + foldEdges) since it needs centroids.
export function bridgesForNet(net, panel, widthMm, edgeLengthMm) {
  const cfg = panel?.bridge;
  if (!cfg || !cfg.enabled || widthMm <= 0) return [];
  const wUnits = widthMm / Math.max(edgeLengthMm, 0.001);
  const out = [];
  for (const e of net.foldEdges) {
    const fA = net.faces[e.faceA];
    const fB = net.faces[e.faceB];
    if (!fA || !fB) continue;
    const cA = centroid2D(fA.polygon2D);
    const cB = centroid2D(fB.polygon2D);
    const dx = cB[0] - cA[0], dy = cB[1] - cA[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;       // along the bridge axis
    const nx = -uy, ny = ux;                  // across the bridge (trace lanes)
    const half = wUnits / 2;
    const center = gapAwareCenterline(net, e, panel, edgeLengthMm);
    const left  = offsetPolyline(center, half);
    const right = offsetPolyline(center, -half);
    const corners = [...left, ...right.reverse()];
    out.push({
      points: corners,
      centerline: center,
      faceA: e.faceA, faceB: e.faceB,
      midpoint: [(cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2],
      axis: [ux, uy],
      across: [nx, ny],
      endA: cA,
      endB: cB,
      length: len,
      width: wUnits,
    });
  }
  return out;
}

// Point-in-shape test for a panelOutline result (normalized units).
export function insidePanelShape(pt, shape) {
  if (shape.kind === 'circle') {
    return Math.hypot(pt[0] - shape.cx, pt[1] - shape.cy) <= shape.r + 1e-12;
  }
  let inside = false;
  const pts = shape.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Resample a polyline to n roughly-equidistant points.
function resamplePolyline(pts, n) {
  if (pts.length < 2) return pts;
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
    segLen.push(l); total += l;
  }
  if (total <= 0) return pts;
  const out = [pts[0]];
  let seg = 0, segStart = 0;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < segLen.length - 1 && segStart + segLen[seg] < target) {
      segStart += segLen[seg]; seg++;
    }
    const t = segLen[seg] > 0 ? (target - segStart) / segLen[seg] : 0;
    out.push([
      pts[seg][0] + (pts[seg+1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg+1][1] - pts[seg][1]) * t,
    ]);
  }
  return out;
}

// Simulate the fold of every bridge and check flex bend radius.
//
// Physical model: at full fold the two panels meet at the polyhedron's
// dihedral angle, so the bridge material must bend through
// θ = π − dihedral. Only the FREE span — the stretch of centerline
// between the two panel boundaries — can bend; the ends are bonded to
// rigid panels. Approximating the bend as a uniform circular arc, the
// neutral-axis bend radius is
//
//     r = freePathLength / θ
//
// which must be ≥ the flex stack's minimum bend radius
// (designRules.minBendRadiusMm; flex vendors typically quote 6–10 ×
// stack thickness for static bends).
//
// The free path length is measured along the actual centerline, so an
// S-curve bridge — whose serpentine path is longer than the straight
// gap — earns a proportionally larger bend radius. That is the whole
// reason the S-curve pattern exists.
export function bridgeFoldStats({ net, panel, wireCount, designRules, edgeLengthMm, dihedralDeg }) {
  const tc = bridgeTraceCount(wireCount);
  const widthMm = computeBridgeWidthMm(tc, designRules);
  const bridges = bridgesForNet(net, panel, widthMm, edgeLengthMm);
  const theta = Math.PI - (dihedralDeg * Math.PI) / 180;
  const minReq = designRules?.minBendRadiusMm ?? 3;

  const stats = [];
  for (const b of bridges) {
    const shapeA = panelOutline(net.faces[b.faceA].polygon2D, panel, edgeLengthMm);
    const shapeB = panelOutline(net.faces[b.faceB].polygon2D, panel, edgeLengthMm);
    const line = resamplePolyline(b.centerline, 240);

    // Walk from the A end: the free span starts where the centerline
    // leaves panel A and ends where it enters panel B.
    let exitA = 0;
    for (let i = 0; i < line.length; i++) {
      if (insidePanelShape(line[i], shapeA)) exitA = i; else break;
    }
    let entryB = line.length - 1;
    for (let i = line.length - 1; i >= 0; i--) {
      if (insidePanelShape(line[i], shapeB)) entryB = i; else break;
    }

    let freePathUnits = 0;
    for (let i = Math.max(1, exitA + 1); i <= Math.min(entryB, line.length - 1); i++) {
      freePathUnits += Math.hypot(line[i][0]-line[i-1][0], line[i][1]-line[i-1][1]);
    }
    const gapUnits = entryB > exitA
      ? Math.hypot(line[entryB][0]-line[exitA][0], line[entryB][1]-line[exitA][1])
      : 0;

    const freePathMm = freePathUnits * edgeLengthMm;
    const gapMm = gapUnits * edgeLengthMm;
    const bendRadiusMm = theta > 1e-9 ? freePathMm / theta : Infinity;

    stats.push({
      faceA: b.faceA,
      faceB: b.faceB,
      gapMm,
      freePathMm,
      bendRadiusMm,
      ok: bendRadiusMm >= minReq,
    });
  }

  const worst = stats.length
    ? stats.reduce((w, s) => (s.bendRadiusMm < w.bendRadiusMm ? s : w))
    : null;
  const passCount = stats.filter(s => s.ok).length;

  return {
    foldAngleDeg: (theta * 180) / Math.PI,
    minReqMm: minReq,
    bridgeWidthMm: widthMm,
    stats,
    worst,
    passCount,
    total: stats.length,
    allPass: stats.length > 0 && passCount === stats.length,
  };
}

// DFS walk of the spanning tree. Returns the sequence of face
// indices visited in order, so consecutive entries are always
// connected by a fold edge (a physical bridge). Backtracking shows
// up as repeated face indices — useful when reasoning about which
// bridges actually carry the data line.
export function chainWalkFromConnector(net, connectorFaceIdx) {
  const adj = new Map();
  for (const e of net.foldEdges) {
    if (!adj.has(e.faceA)) adj.set(e.faceA, []);
    if (!adj.has(e.faceB)) adj.set(e.faceB, []);
    adj.get(e.faceA).push(e.faceB);
    adj.get(e.faceB).push(e.faceA);
  }
  const visited = new Set();
  const walk = [];
  function dfs(fi) {
    if (visited.has(fi) || !net.faces[fi]) return;
    visited.add(fi);
    walk.push(fi);
    for (const n of adj.get(fi) || []) {
      if (!visited.has(n)) {
        dfs(n);
        walk.push(fi); // backtrack
      }
    }
  }
  dfs(connectorFaceIdx);
  return walk;
}

// Chain order: unique DFS visit order from the connector. Position
// 0 is the LED nearest the connector; the last face is the chain
// terminator (DOUT dangles or wraps to a test pad). Consecutive
// entries are always one fold-edge bridge apart, so this is the
// order in which the data line physically passes through faces.
export function chainOrderFromConnector(net, connectorFaceIdx) {
  const walk = chainWalkFromConnector(net, connectorFaceIdx);
  const seen = new Set();
  const order = [];
  for (const fi of walk) {
    if (seen.has(fi)) continue;
    seen.add(fi);
    order.push(fi);
  }
  for (let i = 0; i < net.faces.length; i++) {
    if (net.faces[i] && !seen.has(i)) order.push(i);
  }
  return order;
}

// Plan copper routing: returns a list of trace polylines in mm.
// Each entry is { signal, points: [[x,y], ...], color }. Signals are
// laid out as parallel lanes through every bridge — VCC and GND on
// the outer lanes (always carried), DIN/DOUT (and CIN/COUT for 4-wire
// LEDs) on the inner lanes. Through any given bridge, the lanes share
// the same physical width so all bridges in the net are uniform.
//
// The data line snake-walks the spanning tree DFS-style from the
// connector. Each LED's DIN connects to its DOUT internally; we
// represent that as a tiny stub inside the LED footprint.
//
// Coordinates are in mm with Y-down (KiCad / screen convention).
export function planRouting({
  net, connectorFaceIdx, led, ledsPerFace,
  connector, panel, wireCount, designRules,
  edgeLengthMm,
}) {
  const tc = bridgeTraceCount(wireCount);
  const widthMm = computeBridgeWidthMm(tc, designRules);
  if (!panel?.bridge?.enabled || !led || ledsPerFace <= 0) return { traces: [], widthMm };

  // Lane offsets across the bridge width, centered on the fold edge.
  // For N traces with trace width tw and clearance cl, lane k sits at:
  //   y = -((N-1)/2 - k) * pitch
  // where pitch = tw + cl.
  const tw = designRules?.traceWidthMm ?? 0.25;
  const cl = designRules?.clearanceMm ?? 0.2;
  const pitch = tw + cl;
  const lane = (k) => (k - (tc - 1) / 2) * pitch;

  // Signal → lane index. Convention: outer lanes for power, inner
  // lanes for data round-trip.
  //   3-wire: VCC=0, DIN=1, DOUT=2, GND=3
  //   4-wire: VCC=0, CIN=1, DIN=2, DOUT=3, COUT=4, GND=5
  const signals = wireCount === 4
    ? ['VCC', 'CIN', 'DIN', 'DOUT', 'COUT', 'GND']
    : ['VCC', 'DIN', 'DOUT', 'GND'];
  const laneOf = (sig) => signals.indexOf(sig);
  const color = {
    VCC:  '#e23b3b', GND:  '#222222',
    DIN:  '#3a7bd5', DOUT: '#3fbf7f',
    CIN:  '#7b5cfa', COUT: '#ff6b35',
  };

  const chain = chainOrderFromConnector(net, connectorFaceIdx);
  // Map from face index → chain index, so we can look up LED positions
  // in order.
  const chainIdxByFace = new Map();
  chain.forEach((fi, i) => chainIdxByFace.set(fi, i));

  // Per-face LED positions in mm.
  const ledsByFace = new Map();
  for (const fi of chain) {
    const face = net.faces[fi];
    if (!face) continue;
    const pts = ledPositions(face.polygon2D, led, ledsPerFace, edgeLengthMm);
    ledsByFace.set(fi, pts.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]));
  }

  // Per-bridge, per-signal lane POLYLINES in mm, stored A→B. For a
  // straight bridge this is two points; for an S-curve bridge the
  // lane follows the gap-confined serpentine at a constant lateral
  // offset, so the preview and exports carry copper that actually
  // fits the strip.
  const bridgeLanePath = new Map(); // key: `${fA}-${fB}/${sig}` → [[x,y], ...] A→B
  for (const e of net.foldEdges) {
    const fA = net.faces[e.faceA];
    const fB = net.faces[e.faceB];
    if (!fA || !fB) continue;
    // Centerline in normalized units, then scale to mm with Y-flip.
    const center = gapAwareCenterline(net, e, panel, edgeLengthMm)
      .map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
    for (const sig of signals) {
      const off = lane(laneOf(sig));
      bridgeLanePath.set(`${e.faceA}-${e.faceB}/${sig}`, offsetPolyline(center, off));
    }
  }

  // Fetch the lane polyline for a signal crossing prev→fi, oriented
  // in travel direction.
  function lanePathAcross(prevFace, toFace, sig) {
    const key = bridgeKey(net, prevFace, toFace, sig);
    if (!key) return [];
    const path = bridgeLanePath.get(`${key.id}/${sig}`) || [];
    return key.fromSide === 'A' ? path : [...path].reverse();
  }

  // Build traces per signal. Power rails (VCC, GND) walk every
  // spanning-tree edge — visit each face, drop in at one bridge and
  // out at every other neighbor bridge. Easiest is one polyline that
  // walks the DFS tree, picking up the centroid of each face along
  // the way.
  const traces = [];

  // Connector pad locations (mm). For the routing we approximate
  // them as the connector centroid + lane offset perpendicular to a
  // notional connector axis (just use horizontal lane spread).
  const connFace = net.faces[connectorFaceIdx];
  const cnCx = connFace ? centroid2D(connFace.polygon2D)[0] * edgeLengthMm : 0;
  const cnCy = connFace ? -centroid2D(connFace.polygon2D)[1] * edgeLengthMm : 0;

  // Each signal entry point at the connector — a small fan along the
  // pad strip if PAD_ONLY, otherwise just the connector centroid.
  function connEntryPoint(sig) {
    const idx = signals.indexOf(sig);
    const spread = (signals.length - 1) * pitch;
    const startX = cnCx - spread / 2;
    return [startX + idx * pitch, cnCy];
  }

  function pushPolyline(sig, points) {
    if (points.length < 2) return;
    traces.push({ signal: sig, color: color[sig] || '#888', points });
  }

  // Power: build a DFS walk of face centroids — each face is touched,
  // and the polyline backtracks through bridges so it physically
  // matches the routable copper.
  const walk = chainWalkFromConnector(net, connectorFaceIdx);
  function powerPolyline(sig) {
    const pts = [connEntryPoint(sig)];
    let prev = connectorFaceIdx;
    for (const fi of walk) {
      if (fi === prev) continue;
      pts.push(...lanePathAcross(prev, fi, sig));
      const face = net.faces[fi];
      if (face) {
        const c = centroid2D(face.polygon2D);
        pts.push([c[0] * edgeLengthMm, -c[1] * edgeLengthMm]);
      }
      prev = fi;
    }
    pushPolyline(sig, pts);
  }
  powerPolyline('VCC');
  powerPolyline('GND');

  // Data line: connector → LED1 DIN → LED1 DOUT → LED2 DIN → ...
  // The visual is one polyline that hops between LED centroids in
  // chain order, going through bridges in between. We treat DIN as
  // the "data going in" lane and DOUT as the "data coming out" lane;
  // between two LEDs in chain order they meet at the bridge midpoint.
  function dataPolyline(inSig, outSig) {
    const pts = [connEntryPoint(inSig)];
    let prevFace = connectorFaceIdx;
    let prevLedPt = null;
    for (let i = 0; i < chain.length; i++) {
      const fi = chain[i];
      const ledsHere = ledsByFace.get(fi) || [];
      // Walk from the previous face's last LED to this face's first
      // LED via a bridge if they're different faces.
      if (fi !== prevFace) {
        // Leave on the outbound lane, arrive on the inbound lane —
        // switch lanes at the bridge midpoint.
        const out = lanePathAcross(prevFace, fi, outSig);
        const inn = lanePathAcross(prevFace, fi, inSig);
        const half = Math.floor(out.length / 2);
        pts.push(...out.slice(0, half), ...inn.slice(half));
      }
      // Chain through every LED on this face.
      for (const led of ledsHere) {
        pts.push(led); // DIN at LED
        // Within-face: DOUT also at LED for the schematic preview.
        // KiCad emits this as two distinct pads on the footprint.
      }
      prevFace = fi;
      prevLedPt = ledsHere[ledsHere.length - 1] || prevLedPt;
    }
    pushPolyline(inSig, pts);
  }
  dataPolyline('DIN', 'DOUT');
  if (wireCount === 4) dataPolyline('CIN', 'COUT');

  return { traces, widthMm };
}

// Resolve the bridge between two adjacent faces and return its key
// plus which side is which face's view.
function bridgeKey(net, fA, fB, _sig) {
  for (const e of net.foldEdges) {
    if (e.faceA === fA && e.faceB === fB) return { id: `${fA}-${fB}`, fromSide: 'A', toSide: 'B' };
    if (e.faceA === fB && e.faceB === fA) return { id: `${fB}-${fA}`, fromSide: 'B', toSide: 'A' };
  }
  return null;
}

// LED positions per face, in normalized units. Single LED → centroid;
// multiple LEDs → ring around the centroid sized by LED body so they
// don't overlap.
export function ledPositions(face2D, ledFootprint, ledsPerFace, edgeLengthMm) {
  if (!ledFootprint || ledsPerFace <= 0) return [];
  const c = centroid2D(face2D);
  if (ledsPerFace === 1) return [c];
  const rMm = Math.max(ledFootprint.body.w, ledFootprint.body.h) * 0.9;
  const rUnits = rMm / Math.max(edgeLengthMm, 0.001);
  return Array.from({ length: ledsPerFace }, (_, i) => {
    const a = (2 * Math.PI * i) / ledsPerFace - Math.PI / 2;
    return [c[0] + Math.cos(a) * rUnits, c[1] + Math.sin(a) * rUnits];
  });
}

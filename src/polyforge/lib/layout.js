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

// Flex bridges connecting adjacent panels along each fold edge.
// Each bridge is a 4-point closed rectangle in normalized units,
// centered on the fold edge, length = (edgeLen - 2*marginMm),
// width = the precomputed `widthMm` (caller derives it from the
// trace requirement). Oriented so the long axis lies along the
// fold edge direction.
export function bridgesForNet(foldEdges, panel, widthMm, edgeLengthMm) {
  const cfg = panel?.bridge;
  if (!cfg || !cfg.enabled || widthMm <= 0) return [];
  const wUnits = widthMm / Math.max(edgeLengthMm, 0.001);
  const mUnits = (cfg.marginMm || 0) / Math.max(edgeLengthMm, 0.001);
  const out = [];
  for (const e of foldEdges) {
    const [x0, y0] = e.a0;
    const [x1, y1] = e.a1;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 2 * mUnits) continue; // too short — skip
    const ux = dx / len, uy = dy / len;       // along the edge
    const nx = -uy, ny = ux;                  // perpendicular
    const half = wUnits / 2;
    const sx = x0 + ux * mUnits, sy = y0 + uy * mUnits;
    const ex = x1 - ux * mUnits, ey = y1 - uy * mUnits;
    const corners = [
      [sx + nx * half, sy + ny * half],
      [ex + nx * half, ey + ny * half],
      [ex - nx * half, ey - ny * half],
      [sx - nx * half, sy - ny * half],
    ];
    out.push({
      points: corners,
      faceA: e.faceA, faceB: e.faceB,
      midpoint: [(sx + ex) / 2, (sy + ey) / 2],
      length: len - 2 * mUnits,
      width: wUnits,
    });
  }
  return out;
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

  // Bridge entry/exit lane points in mm. For each bridge between
  // faceA & faceB, compute the lane positions on each side of the
  // fold edge.
  const bridgeLanePoint = new Map(); // key: `${fA}-${fB}/${sig}/${side}` → [x,y]
  for (const e of net.foldEdges) {
    const a0 = [e.a0[0] * edgeLengthMm, -e.a0[1] * edgeLengthMm];
    const a1 = [e.a1[0] * edgeLengthMm, -e.a1[1] * edgeLengthMm];
    const dx = a1[0] - a0[0], dy = a1[1] - a0[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const mid = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
    for (const sig of signals) {
      const off = lane(laneOf(sig));
      // entry on side A (positive normal) and side B (negative)
      const entryA = [mid[0] + nx * (widthMm / 2) + ux * off, mid[1] + ny * (widthMm / 2) + uy * off];
      const entryB = [mid[0] - nx * (widthMm / 2) + ux * off, mid[1] - ny * (widthMm / 2) + uy * off];
      bridgeLanePoint.set(`${e.faceA}-${e.faceB}/${sig}/A`, entryA);
      bridgeLanePoint.set(`${e.faceA}-${e.faceB}/${sig}/B`, entryB);
    }
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
      const key = bridgeKey(net, prev, fi, sig);
      if (key) {
        pts.push(bridgeLanePoint.get(`${key.id}/${sig}/${key.fromSide}`));
        pts.push(bridgeLanePoint.get(`${key.id}/${sig}/${key.toSide}`));
      }
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
        const key = bridgeKey(net, prevFace, fi, inSig);
        if (key) {
          pts.push(bridgeLanePoint.get(`${key.id}/${outSig}/${key.fromSide}`));
          pts.push(bridgeLanePoint.get(`${key.id}/${inSig}/${key.toSide}`));
        }
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

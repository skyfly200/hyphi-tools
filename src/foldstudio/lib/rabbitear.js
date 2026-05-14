// Flat-foldability validation. Face computation lives in faces.js (was
// rabbit-ear's graph.populate, now self-contained to drop the dep).

export { computeFaces } from './faces.js';

// Two-colorability check: every flat-foldable crease pattern's faces can
// be 2-coloured so that any pair of faces sharing an edge get different
// colours (like a chessboard). Returns { ok, coloring, conflicts } where
// coloring[i] is 0 or 1 per face index, or -1 if disconnected/uncolored.
// conflicts lists pairs of adjacent faces that ended up the same colour.
export function validateTwoColorable(model) {
  const faces = model.faces || [];
  if (!faces.length) return { ok: true, coloring: [], conflicts: [] };

  const edgeKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
  const edgeToFaces = Object.create(null);
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const k = edgeKey(f[i], f[(i + 1) % f.length]);
      (edgeToFaces[k] = edgeToFaces[k] || []).push(fi);
    }
  });

  const adj = faces.map(() => []);
  for (const k in edgeToFaces) {
    const fs = edgeToFaces[k];
    if (fs.length === 2) {
      adj[fs[0]].push(fs[1]);
      adj[fs[1]].push(fs[0]);
    }
  }

  const coloring = new Array(faces.length).fill(-1);
  const conflictPairs = new Set();
  const conflicts = [];
  for (let i = 0; i < faces.length; i++) {
    if (coloring[i] !== -1) continue;
    coloring[i] = 0;
    const queue = [i];
    while (queue.length) {
      const f = queue.shift();
      for (const nb of adj[f]) {
        if (coloring[nb] === -1) {
          coloring[nb] = 1 - coloring[f];
          queue.push(nb);
        } else if (coloring[nb] === coloring[f]) {
          const k = f < nb ? `${f}-${nb}` : `${nb}-${f}`;
          if (!conflictPairs.has(k)) {
            conflictPairs.add(k);
            conflicts.push({ face1: Math.min(f, nb), face2: Math.max(f, nb) });
          }
        }
      }
    }
  }
  return { ok: conflicts.length === 0, coloring, conflicts };
}

// Geometry sanity checks: T-junctions (a vertex sitting on the interior
// of an edge but not splitting it) and coincident lines (duplicate edges
// or collinear segments that overlap). These don't block flat-folding
// but they make face computation and FOLD export ambiguous. Tolerances
// are in paper-units.
export function validateGeometry(model, opts = {}) {
  const tol = opts.tol ?? 1e-4; // ~0.01% of paper width
  const issues = [];

  // T-junctions
  for (let v = 0; v < model.vertices.length; v++) {
    const P = model.vertices[v];
    for (let e = 0; e < model.edges.length; e++) {
      const edge = model.edges[e];
      if (edge.v1 === v || edge.v2 === v) continue;
      const A = model.vertices[edge.v1], B = model.vertices[edge.v2];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2;
      if (t <= tol || t >= 1 - tol) continue;
      const px = A[0] + dx * t, py = A[1] + dy * t;
      if (Math.hypot(P[0] - px, P[1] - py) < tol) {
        issues.push({ kind: 'tjunction', vertex: v, edge: e });
      }
    }
  }

  // Coincident / overlapping edges
  for (let i = 0; i < model.edges.length; i++) {
    const e1 = model.edges[i];
    const A = model.vertices[e1.v1], B = model.vertices[e1.v2];
    const dx1 = B[0] - A[0], dy1 = B[1] - A[1];
    const L1 = Math.hypot(dx1, dy1);
    if (L1 < 1e-9) continue;
    const ux = dx1 / L1, uy = dy1 / L1;
    for (let j = i + 1; j < model.edges.length; j++) {
      const e2 = model.edges[j];
      if ((e1.v1 === e2.v1 && e1.v2 === e2.v2) ||
          (e1.v1 === e2.v2 && e1.v2 === e2.v1)) {
        issues.push({ kind: 'duplicate', edges: [i, j] });
        continue;
      }
      const C = model.vertices[e2.v1], D = model.vertices[e2.v2];
      const dx2 = D[0] - C[0], dy2 = D[1] - C[1];
      const L2 = Math.hypot(dx2, dy2);
      if (L2 < 1e-9) continue;
      // Parallel?
      const cross = (dx1 * dy2 - dy1 * dx2) / (L1 * L2);
      if (Math.abs(cross) > tol) continue;
      // Collinear? Perpendicular distance from C to line AB.
      const perp = Math.abs((C[0] - A[0]) * (-uy) + (C[1] - A[1]) * ux);
      if (perp > tol) continue;
      // Overlap range along AB.
      const tC = ((C[0] - A[0]) * ux + (C[1] - A[1]) * uy) / L1;
      const tD = ((D[0] - A[0]) * ux + (D[1] - A[1]) * uy) / L1;
      const sLo = Math.min(tC, tD), sHi = Math.max(tC, tD);
      const tLo = Math.max(0, sLo), tHi = Math.min(1, sHi);
      if (tHi - tLo > tol) {
        issues.push({ kind: 'overlap', edges: [i, j] });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

// Returns { ok: boolean, vertexIssues: [{ vertex, type, msg }] }
// Maekawa: |#M - #V| === 2 at every interior vertex with all M/V creases.
// Kawasaki: alternating angle sums equal at every flat-foldable interior vertex.
export function validateFlatFoldability(model) {
  const issues = [];
  const adj = Array.from({ length: model.vertices.length }, () => []);
  model.edges.forEach((e, i) => {
    if (e.assignment === 'B' || e.assignment === 'F') return;
    adj[e.v1].push({ other: e.v2, edge: i, a: e.assignment });
    adj[e.v2].push({ other: e.v1, edge: i, a: e.assignment });
  });

  // Identify boundary vertices (touch a B edge)
  const isBoundary = new Array(model.vertices.length).fill(false);
  for (const e of model.edges) if (e.assignment === 'B') {
    isBoundary[e.v1] = true; isBoundary[e.v2] = true;
  }

  for (let v = 0; v < model.vertices.length; v++) {
    if (isBoundary[v]) continue;
    const neigh = adj[v];
    if (neigh.length < 2) continue;
    const allMV = neigh.every(n => n.a === 'M' || n.a === 'V');
    if (!allMV) continue;
    const m = neigh.filter(n => n.a === 'M').length;
    const vN = neigh.filter(n => n.a === 'V').length;
    if (Math.abs(m - vN) !== 2) {
      const diff = Math.abs(m - vN);
      const more = m > vN ? 'mountains' : 'valleys';
      const fewer = m > vN ? 'valleys' : 'mountains';
      issues.push({
        vertex: v,
        type: 'maekawa',
        title: 'Mountain/valley count is off',
        msg: diff === 0
          ? `${m} mountains and ${vN} valleys at this corner. Flat-folding needs them to differ by exactly 2.`
          : `${m} mountains, ${vN} valleys. To fold flat here you need 2 more ${more} than ${fewer} (or 2 more ${fewer} than ${more}); the difference is currently ${diff}.`,
      });
    }
    // Kawasaki: alternating sum of angles between consecutive creases must be equal.
    const P = model.vertices[v];
    const sorted = neigh.map(n => {
      const Q = model.vertices[n.other];
      return { ...n, angle: Math.atan2(Q[1] - P[1], Q[0] - P[0]) };
    }).sort((a, b) => a.angle - b.angle);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[(i + 1) % sorted.length];
      let d = next.angle - sorted[i].angle;
      if (d < 0) d += Math.PI * 2;
      if (i % 2 === 0) s1 += d; else s2 += d;
    }
    if (Math.abs(s1 - s2) > 1e-3) {
      const a = (s1 * 180 / Math.PI).toFixed(1);
      const b = (s2 * 180 / Math.PI).toFixed(1);
      const off = Math.abs(parseFloat(a) - parseFloat(b)).toFixed(1);
      issues.push({
        vertex: v,
        type: 'kawasaki',
        title: 'Angles between creases don\'t balance',
        msg: `Going around this corner, alternating angles between creases must each total 180°. They currently sum to ${a}° and ${b}° — off by ${off}°. Move a crease to rebalance.`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

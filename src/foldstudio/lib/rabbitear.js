// Thin wrapper around rabbit-ear for face computation and validation.
// rabbit-ear's exact API surface varies between versions — we feature-detect.

import ear from 'rabbit-ear';
import { modelToFOLD, foldToModel } from './fold-io.js';

export function computeFaces(model) {
  try {
    const fold = modelToFOLD(model);
    const g = ear.graph?.populate ? ear.graph.populate(fold) : fold;
    if (g.faces_vertices) {
      return g.faces_vertices.map(f => f.slice());
    }
  } catch (_) { /* fall through */ }
  return [];
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
      issues.push({ vertex: v, type: 'maekawa', msg: `Maekawa: |M−V|=${Math.abs(m - vN)} (need 2)` });
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
      issues.push({ vertex: v, type: 'kawasaki', msg: `Kawasaki: ${(s1 * 180 / Math.PI).toFixed(1)}° vs ${(s2 * 180 / Math.PI).toFixed(1)}°` });
    }
  }
  return { ok: issues.length === 0, issues };
}

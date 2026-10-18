// Posed triangle mesh of an assembly, in millimetres, assembly coordinates.
//
// Topology depends only on the assembly (never on the angles), so meshes from
// different configurations share indices — required for shape-key / mesh-cache
// animation. Region meshes are separate vertex groups (sharp folds stay sharp);
// bands are tessellated by material arc length, not by solver sample index.
//
// UVs are MATERIAL coordinates (the flat sheet, normalised to its bounding box), so
// artwork follows the paper through every fold.

import { evaluatePoses } from '../kinematics.js';
import { applyPose, mulVec, unit, cross } from '../math.js';
import { flatTriangles } from '../collision/mesh.js';
import { bandCenterline } from '../bends/circular.js';

const key2 = (x, y) => `${x.toFixed(6)},${y.toFixed(6)}`;

/**
 * @param opts { thickness:true, bandRowsPerSegment:8 }
 * @returns { positions:Float64Array, uvs:Float64Array, indices:Uint32Array, parts:[{id,kind,vertexStart,vertexCount,triStart,triCount}] }
 */
export function buildMesh(compiled, angles, opts = {}) {
  const { thickness = true, bandRowsPerSegment = 8, anchorPose } = opts;
  const poses = evaluatePoses(compiled, angles, anchorPose);
  const pos = [], uv = [], idx = [], parts = [];

  // UV normalisation: flat bounding box of everything
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const widen = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const tris of flatTriangles(compiled).values()) for (const t of tris) for (const p of t) widen(p[0], p[1]);
  for (const c of compiled.connIndex.values()) { const f = compiled.frames.get(c.id); if (f && f.lengthMm > 0) { widen(f.o[0], f.o[1]); widen(f.o[0] + f.v[0] * f.lengthMm, f.o[1] + f.v[1] * f.lengthMm); } }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const uvOf = (x, y) => [(x - minX) / sx, (y - minY) / sy];

  const addV = (p, flatXY) => { pos.push(p[0], p[1], p[2]); uv.push(...uvOf(flatXY[0], flatXY[1])); return pos.length / 3 - 1; };

  // ── regions ──
  for (const r of compiled.regionIndex.values()) {
    const P = poses.get(r.id);
    const t = thickness ? (r.thicknessMm || 0) : 0;
    const off = r.thicknessOffsetMm || 0;
    const n = unit(mulVec(P.R, [0, 0, 1]));
    const vStart = pos.length / 3, tStart = idx.length / 3;
    const map = new Map(); const flatList = [];
    const vid = p => { const k = key2(p[0], p[1]); if (!map.has(k)) { map.set(k, flatList.length); flatList.push([p[0], p[1]]); } return map.get(k); };
    const tris = flatTriangles(compiled).get(r.id).map(tri => tri.map(vid));
    const base = pos.length / 3;
    // top vertices then (if thick) bottom vertices
    const lift = (fp, s) => { const w = applyPose(P, [fp[0], fp[1], 0]); const d = off + s; return [w[0] + n[0] * d, w[1] + n[1] * d, w[2] + n[2] * d]; };
    flatList.forEach(fp => addV(lift(fp, t / 2), fp));
    if (t > 0) flatList.forEach(fp => addV(lift(fp, -t / 2), fp));
    for (const [a, b, c] of tris) idx.push(base + a, base + b, base + c);
    if (t > 0) {
      const m = flatList.length;
      for (const [a, b, c] of tris) idx.push(base + m + a, base + m + c, base + m + b);
      // side walls along boundary edges (edges used by exactly one triangle)
      const count = new Map();
      for (const [a, b, c] of tris) for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u}-${v}` : `${v}-${u}`; count.set(k, (count.get(k) || []).concat([[u, v]])); }
      for (const lst of count.values()) if (lst.length === 1) {
        const [u, v] = lst[0];
        idx.push(base + u, base + m + u, base + m + v, base + u, base + m + v, base + v);
      }
    }
    parts.push({ id: r.id, kind: 'region', vertexStart: vStart, vertexCount: pos.length / 3 - vStart, triStart: tStart, triCount: idx.length / 3 - tStart });
  }

  // ── bands ──
  for (const c of compiled.connIndex.values()) {
    const f = compiled.frames.get(c.id);
    if (!f || !(f.lengthMm > 0)) continue;
    const theta = angles[compiled.varIndex.get(c.id)] ?? 0;
    const per = f.profile ? Math.max(1, bandRowsPerSegment) : bandRowsPerSegment * 2;
    const center = bandCenterline(f.lengthMm, theta, f.profile, per);
    const PA = poses.get(c.a);
    const t = thickness ? (c.thicknessMm || 0) : 0;
    const vStart = pos.length / 3, tStart = idx.length / 3;
    const rows = center.length;
    const z3 = cross(f.u, f.v);
    const world = (a, y, z, flatS) => {
      const loc = [f.o[0] + f.u[0] * a + f.v[0] * y + z3[0] * z, f.o[1] + f.u[1] * a + f.v[1] * y + z3[1] * z, f.o[2] + f.u[2] * a + f.v[2] * y + z3[2] * z];
      return applyPose(PA, loc);
    };
    const layers = t > 0 ? [t / 2, -t / 2] : [0];
    const grid = layers.map(() => []);
    for (let r = 0; r < rows; r++) {
      const [y, z] = center[r];
      const prev = center[Math.max(0, r - 1)], next = center[Math.min(rows - 1, r + 1)];
      let ty = next[0] - prev[0], tz = next[1] - prev[1]; const tl = Math.hypot(ty, tz) || 1; ty /= tl; tz /= tl;
      const ny = -tz, nz = ty;                                   // in-plane normal, +z when flat
      const s = (f.lengthMm * r) / (rows - 1);
      layers.forEach((d, li) => {
        const row = [];
        for (const a of [0, f.edgeLen]) {
          const flatXY = [f.o[0] + f.u[0] * a + f.v[0] * s, f.o[1] + f.u[1] * a + f.v[1] * s];
          row.push(addV(world(a, y + ny * d, z + nz * d, s), flatXY));
        }
        grid[li].push(row);
      });
    }
    for (let r = 0; r + 1 < rows; r++) {
      const [a0, a1] = grid[0][r], [b0, b1] = grid[0][r + 1];
      idx.push(a0, a1, b1, a0, b1, b0);
      if (t > 0) {
        const [c0, c1] = grid[1][r], [d0, d1] = grid[1][r + 1];
        idx.push(c0, d1, c1, c0, d0, d1);
        idx.push(a0, b0, d0, a0, d0, c0);            // side walls (u = 0)
        idx.push(a1, c1, d1, a1, d1, b1);            // side walls (u = edgeLen)
      }
    }
    parts.push({ id: c.id, kind: 'band', vertexStart: vStart, vertexCount: pos.length / 3 - vStart, triStart: tStart, triCount: idx.length / 3 - tStart });
  }
  return { positions: Float64Array.from(pos), uvs: Float64Array.from(uv), indices: Uint32Array.from(idx), parts };
}

/** Vertex positions only (same topology as buildMesh) — cheap enough for refinement checks. */
export const meshPositions = (compiled, angles, opts) => buildMesh(compiled, angles, opts).positions;

/** Welded-edge statistics. `manifold` means every edge is shared by exactly two triangles. */
export function meshStats(mesh, tol = 1e-6) {
  const { positions: P, indices: I } = mesh;
  const weld = new Map(); const id = [];
  for (let v = 0; v < P.length / 3; v++) {
    const k = `${Math.round(P[3 * v] / tol)},${Math.round(P[3 * v + 1] / tol)},${Math.round(P[3 * v + 2] / tol)}`;
    if (!weld.has(k)) weld.set(k, weld.size); id.push(weld.get(k));
  }
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[I[t + e]], b = id[I[t + (e + 1) % 3]]; if (a === b) continue;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`; edges.set(k, (edges.get(k) || 0) + 1);
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  return { triangles: I.length / 3, vertices: P.length / 3, boundaryEdges: boundary, nonManifoldEdges: nonManifold, manifold: boundary === 0 && nonManifold === 0 };
}

export function meshBounds(mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.positions[i + k]); hi[k] = Math.max(hi[k], mesh.positions[i + k]); }
  return { min: lo, max: hi, size: hi.map((h, k) => h - lo[k]) };
}

export function vertexNormals(mesh) {
  const { positions: P, indices: I } = mesh;
  const N = new Float64Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = cross(e1, e2);                                    // area-weighted
    for (const v of [a, b, c]) { N[v] += n[0]; N[v + 1] += n[1]; N[v + 2] += n[2]; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return N;
}

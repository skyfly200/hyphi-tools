// Triangulation of flat regions and posing into world space.

import { applyPose } from '../math.js';

const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function pointInTri(p, a, b, c) {
  const d1 = area2(p, a, b), d2 = area2(p, b, c), d3 = area2(p, c, a);
  const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12, pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
  return !(neg && pos);
}

/** Ear-clip a simple polygon into triangles of vertex indices. Falls back to a fan if clipping stalls. */
export function triangulatePolygon(poly) {
  const n = poly.length;
  if (n < 3) return [];
  let idx = poly.map((_, i) => i);
  let a = 0; for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  if (a < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const p0 = poly[i0], p1 = poly[i1], p2 = poly[i2];
      if (area2(p0, p1, p2) <= 1e-12) continue;                       // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const q = poly[j];
        if ((q[0] === p0[0] && q[1] === p0[1]) || (q[0] === p1[0] && q[1] === p1[1]) || (q[0] === p2[0] && q[1] === p2[1])) continue;
        if (pointInTri(q, p0, p1, p2)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) { for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]); idx = []; break; }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

const flatCache = new WeakMap();

/** Flat (material) triangles per region; cached per compiled assembly. */
export function flatTriangles(compiled) {
  let c = flatCache.get(compiled);
  if (c) return c;
  c = new Map();
  for (const r of compiled.regionIndex.values()) {
    const polys = r.polygons && r.polygons.length ? r.polygons : [r.polygon];
    const tris = [];
    for (const poly of polys) for (const t of triangulatePolygon(poly)) tris.push(t.map(i => [poly[i][0], poly[i][1], 0]));
    c.set(r.id, tris);
  }
  flatCache.set(compiled, c);
  return c;
}

/** World-space triangles for every region given its pose. -> [{ region, tri:[p,p,p], flat:[p,p,p] }] */
export function worldTriangles(compiled, poses) {
  const out = [];
  for (const [id, tris] of flatTriangles(compiled)) {
    const P = poses.get(id);
    for (const t of tris) out.push({ region: id, tri: t.map(p => applyPose(P, p)), flat: t });
  }
  return out;
}

export function aabb(tri, margin = 0) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of tri) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - margin); hi[k] = Math.max(hi[k], p[k] + margin); }
  return { lo, hi };
}
export const aabbOverlap = (a, b) => a.lo[0] <= b.hi[0] && a.hi[0] >= b.lo[0] && a.lo[1] <= b.hi[1] && a.hi[1] >= b.lo[1] && a.lo[2] <= b.hi[2] && a.hi[2] >= b.lo[2];

// Triangle–triangle closest-point and proper-crossing tests.

import { sub, add, scale, dot, cross, norm } from '../math.js';

const EPS = 1e-9;

function closestOnSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

/** Closest point on triangle (Ericson, Real-Time Collision Detection). */
export function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(add(a, scale(ab, vb * denom)), scale(ac, vc * denom));
}

/** Closest points between segments p1q1 and p2q2. */
export function closestSegSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-18) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-18 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return [add(p1, scale(d1, s)), add(p2, scale(d2, t))];
}

/** Segment pierces the INTERIOR of triangle (strict). Returns the point or null. */
export function segmentPiercesTriangle(p, q, a, b, c) {
  const d = sub(q, p), e1 = sub(b, a), e2 = sub(c, a);
  const h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < EPS) return null;               // parallel / coplanar: not a proper crossing
  const f = 1 / det, s = sub(p, a), u = f * dot(s, h);
  if (u <= EPS || u >= 1 - EPS) return null;
  const qv = cross(s, e1), v = f * dot(d, qv);
  if (v <= EPS || u + v >= 1 - EPS) return null;
  const t = f * dot(e2, qv);
  if (t <= EPS || t >= 1 - EPS) return null;
  return add(p, scale(d, t));
}

/**
 * @returns { dist:number, a:[x,y,z], b:[x,y,z], crossing:boolean }
 * `crossing` is true only for a proper interpenetration (edge through interior).
 * Touching or coplanar-contact triangles report dist 0 with crossing false.
 */
export function triTriClosest(A, B) {
  for (let i = 0; i < 3; i++) {
    const hit = segmentPiercesTriangle(A[i], A[(i + 1) % 3], B[0], B[1], B[2]);
    if (hit) return { dist: 0, a: hit, b: hit, crossing: true };
    const hit2 = segmentPiercesTriangle(B[i], B[(i + 1) % 3], A[0], A[1], A[2]);
    if (hit2) return { dist: 0, a: hit2, b: hit2, crossing: true };
  }
  let best = { dist: Infinity, a: null, b: null, crossing: false };
  const upd = (pa, pb) => { const d = norm(sub(pa, pb)); if (d < best.dist) best = { dist: d, a: pa, b: pb, crossing: false }; };
  for (let i = 0; i < 3; i++) {
    upd(A[i], closestOnTriangle(A[i], B[0], B[1], B[2]));
    const pb = closestOnTriangle(B[i], A[0], A[1], A[2]); upd(pb, B[i]);
    for (let j = 0; j < 3; j++) { const [pa, pbb] = closestSegSeg(A[i], A[(i + 1) % 3], B[j], B[(j + 1) % 3]); upd(pa, pbb); }
  }
  return best;
}

export function distPointSegment(p, a, b) { return norm(sub(p, closestOnSegment(p, a, b))); }

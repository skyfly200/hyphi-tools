// Geometry primitives for FoldStudio.
// All coords are model-space [x,y]. EPS chosen for unit-square crease patterns.

export const EPS = 1e-6;

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const eq = (a, b, eps = EPS) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (v, s) => [v[0] * s, v[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = v => Math.hypot(v[0], v[1]);
export const norm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };

// Project point P onto infinite line through A,B.
export function projectOnLine(P, A, B) {
  const ab = sub(B, A);
  const t = dot(sub(P, A), ab) / (dot(ab, ab) || 1);
  return add(A, scale(ab, t));
}

// Closest point on segment AB to P (clamped t).
export function closestOnSegment(P, A, B) {
  const ab = sub(B, A);
  const denom = dot(ab, ab) || 1;
  let t = dot(sub(P, A), ab) / denom;
  t = Math.max(0, Math.min(1, t));
  return { point: add(A, scale(ab, t)), t };
}

// Reflect point across infinite line through A,B.
export function reflectAcrossLine(P, A, B) {
  const proj = projectOnLine(P, A, B);
  return [2 * proj[0] - P[0], 2 * proj[1] - P[1]];
}

// Rotate point P around center C by angle (radians).
export function rotateAround(P, C, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = P[0] - C[0], dy = P[1] - C[1];
  return [C[0] + dx * c - dy * s, C[1] + dx * s + dy * c];
}

// Segment-segment intersection. Returns interior point (excluding endpoints
// within EPS) or null. t in (0,1) on each segment.
export function segmentIntersection(A, B, C, D) {
  const r = sub(B, A), s = sub(D, C);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null; // parallel
  const ac = sub(C, A);
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return null;
  return { point: [A[0] + r[0] * t, A[1] + r[1] * t], t, u };
}

// Apply 2x3 affine matrix [[a,c,e],[b,d,f]] to point.
export const applyMatrix = (m, P) =>
  [m[0] * P[0] + m[2] * P[1] + m[4], m[1] * P[0] + m[3] * P[1] + m[5]];

export const matMul = (A, B) => [
  A[0] * B[0] + A[2] * B[1],
  A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4],
  A[1] * B[4] + A[3] * B[5] + A[5],
];

export const matIdentity = () => [1, 0, 0, 1, 0, 0];
export const matTranslate = (tx, ty) => [1, 0, 0, 1, tx, ty];
export const matRotate = a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
export const matScale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];

// Rotation around a center.
export const matRotateAround = (a, cx, cy) =>
  matMul(matMul(matTranslate(cx, cy), matRotate(a)), matTranslate(-cx, -cy));

// Reflection across infinite line through A,B as affine matrix.
export function matReflectLine(A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  // Reflection across unit-direction u: R = 2 u u^T - I
  const a = 2 * ux * ux - 1;
  const b = 2 * ux * uy;
  const c = 2 * ux * uy;
  const d = 2 * uy * uy - 1;
  // Translate so line passes through origin, reflect, translate back.
  const e = A[0] - (a * A[0] + c * A[1]);
  const f = A[1] - (b * A[0] + d * A[1]);
  return [a, b, c, d, e, f];
}

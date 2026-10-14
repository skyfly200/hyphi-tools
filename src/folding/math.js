// Small dependency-free 3D helpers. Rigid poses are { R: [9 numbers, row-major], t: [3] }
// mapping flat material coordinates (x, y, 0) into assembly/world space.
// Units: millimetres and radians. Right-handed coordinates.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => norm(sub(a, b));
export function unit(a) { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export const IDENTITY_R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const identityPose = () => ({ R: IDENTITY_R.slice(), t: [0, 0, 0] });

export function mulMat(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  }
  return C;
}
export const transposeMat = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export function mulVec(A, v) {
  return [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ];
}

// Columns are the basis vectors.
export const basisMat = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];

// Rotation about the local x axis by angle a (right-handed).
export function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function applyPose(P, p) {
  const r = mulVec(P.R, p);
  return [r[0] + P.t[0], r[1] + P.t[1], r[2] + P.t[2]];
}
// A ∘ B : apply B first, then A.
export function composePose(A, B) {
  const r = mulVec(A.R, B.t);
  return { R: mulMat(A.R, B.R), t: [r[0] + A.t[0], r[1] + A.t[1], r[2] + A.t[2]] };
}
export function invertPose(P) {
  const Rt = transposeMat(P.R);
  const r = mulVec(Rt, P.t);
  return { R: Rt, t: [-r[0], -r[1], -r[2]] };
}

export const deg = r => (r * 180) / Math.PI;
export const rad = d => (d * Math.PI) / 180;

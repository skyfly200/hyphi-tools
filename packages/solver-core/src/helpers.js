// Ready-made constraint builders for 2D / 3D geometric systems (sketch-style design tools).
// Variables are named `${point}.x`, `${point}.y` (and `.z`). Each helper returns a constraint spec
// for ConstraintSystem.addConstraint().

export const pt2 = (v, p) => [v.get(`${p}.x`), v.get(`${p}.y`)];
export const pt3 = (v, p) => [v.get(`${p}.x`), v.get(`${p}.y`), v.get(`${p}.z`)];

/** Declare 2D points as variables. */
export function addPoints2D(sys, points) {
  for (const [name, [x, y]] of Object.entries(points)) { sys.addVariable(`${name}.x`, x); sys.addVariable(`${name}.y`, y); }
}
export function addPoints3D(sys, points) {
  for (const [name, [x, y, z]] of Object.entries(points)) { sys.addVariable(`${name}.x`, x); sys.addVariable(`${name}.y`, y); sys.addVariable(`${name}.z`, z); }
}

export const distance2D = (id, a, b, d, o = {}) => ({ id, group: 'structural', unit: 'mm', tolerance: 1e-6, ...o,
  residual: v => { const p = pt2(v, a), q = pt2(v, b); return Math.hypot(p[0] - q[0], p[1] - q[1]) - d; } });
export const distance3D = (id, a, b, d, o = {}) => ({ id, group: 'structural', unit: 'mm', tolerance: 1e-6, ...o,
  residual: v => { const p = pt3(v, a), q = pt3(v, b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - d; } });
/** Pin a point to a position (structural by default; pass { group: 'user' } for a draggable target). */
export const fixed2D = (id, a, [x, y], o = {}) => ({ id, group: 'structural', unit: 'mm', tolerance: 1e-6, ...o, residual: v => [v.get(`${a}.x`) - x, v.get(`${a}.y`) - y] });
export const fixed3D = (id, a, [x, y, z], o = {}) => ({ id, group: 'structural', unit: 'mm', tolerance: 1e-6, ...o, residual: v => [v.get(`${a}.x`) - x, v.get(`${a}.y`) - y, v.get(`${a}.z`) - z] });
export const coincident2D = (id, a, b, o = {}) => ({ id, group: 'structural', unit: 'mm', tolerance: 1e-6, ...o, residual: v => { const p = pt2(v, a), q = pt2(v, b); return [p[0] - q[0], p[1] - q[1]]; } });
/** Angle at `b` between rays b→a and b→c, in radians. */
export const angle2D = (id, a, b, c, radians, o = {}) => ({ id, group: 'user', unit: 'rad', tolerance: 1e-6, ...o,
  residual: v => { const A = pt2(v, a), B = pt2(v, b), C = pt2(v, c);
    const u = [A[0] - B[0], A[1] - B[1]], w = [C[0] - B[0], C[1] - B[1]];
    const d = Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) - radians;
    return Math.atan2(Math.sin(d), Math.cos(d)); } });
export const parallel2D = (id, a, b, c, d, o = {}) => ({ id, group: 'structural', unit: '', tolerance: 1e-6, ...o,
  residual: v => { const A = pt2(v, a), B = pt2(v, b), C = pt2(v, c), D = pt2(v, d);
    const u = [B[0] - A[0], B[1] - A[1]], w = [D[0] - C[0], D[1] - C[1]];
    return (u[0] * w[1] - u[1] * w[0]) / (Math.hypot(...u) * Math.hypot(...w) || 1); } });
/** One-sided: keep dist(a,b) >= min (a `limit`). */
export const minDistance2D = (id, a, b, min, o = {}) => ({ id, group: 'limit', unit: 'mm', ...o,
  residual: v => { const p = pt2(v, a), q = pt2(v, b); return Math.max(0, min - Math.hypot(p[0] - q[0], p[1] - q[1])); } });

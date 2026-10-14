// Levenberg–Marquardt for min ½‖r(x)‖². Dependency-free, replaceable backend.
//
// Each step solves the damped least-squares problem
//     min ‖ [J; √λ·I] δ + [r; 0] ‖
// with Householder QR (never the normal equations JᵀJ + λI, which squares the
// condition number). Jacobians are finite-difference for now.

/** Least squares via Householder QR. A is an array of rows (mutated). Returns { x, rdiag }. */
export function lsSolve(A, b) {
  const m = A.length, n = A[0].length;
  const rdiag = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let nrm = 0;
    for (let i = k; i < m; i++) nrm = Math.hypot(nrm, A[i][k]);
    if (nrm === 0) { rdiag[k] = 0; continue; }
    if (A[k][k] < 0) nrm = -nrm;
    for (let i = k; i < m; i++) A[i][k] /= nrm;
    A[k][k] += 1;
    for (let j = k + 1; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += A[i][k] * A[i][j];
      s = -s / A[k][k];
      for (let i = k; i < m; i++) A[i][j] += s * A[i][k];
    }
    let s = 0;
    for (let i = k; i < m; i++) s += A[i][k] * b[i];
    s = -s / A[k][k];
    for (let i = k; i < m; i++) b[i] += s * A[i][k];
    rdiag[k] = -nrm;
  }
  const x = new Float64Array(n);
  const maxR = Math.max(...rdiag.map(Math.abs), 0);
  for (let k = n - 1; k >= 0; k--) {
    if (Math.abs(rdiag[k]) <= 1e-12 * maxR || rdiag[k] === 0) { x[k] = 0; continue; } // rank-deficient: minimum-norm-ish
    let s = b[k];
    for (let j = k + 1; j < n; j++) s -= A[k][j] * x[j];
    x[k] = s / rdiag[k];
  }
  return { x, rdiag };
}

export function numericJacobian(fn, x, r0, h = 1e-7) {
  const n = x.length, m = r0.length;
  const J = Array.from({ length: m }, () => new Float64Array(n));
  const xp = Float64Array.from(x);
  for (let j = 0; j < n; j++) {
    const step = h * Math.max(1, Math.abs(x[j]));
    xp[j] = x[j] + step;
    const r1 = fn(xp);
    xp[j] = x[j];
    for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / step;
  }
  return J;
}

/** Numerical rank from the R diagonal of a QR of the bare Jacobian. */
export function numericalRank(J, relTol = 1e-8) {
  if (!J.length || !J[0].length) return 0;
  const { rdiag } = lsSolve(J.map(row => Array.from(row)), new Float64Array(J.length));
  const mx = Math.max(...rdiag.map(Math.abs), 0);
  if (mx === 0) return 0;
  return rdiag.filter(d => Math.abs(d) > relTol * mx).length;
}

/**
 * @param fn (x:Float64Array) => number[]  residual vector (fixed length)
 * @param x0 initial guess
 * @param opts { maxIterations, costTol, stepTol, deadlineMs, shouldCancel }
 */
export function levenbergMarquardt(fn, x0, opts = {}) {
  const { maxIterations = 100, costTol = 1e-24, stepTol = 1e-13, deadlineMs = Infinity, shouldCancel } = opts;
  const n = x0.length;
  let x = Float64Array.from(x0);
  let r = fn(x);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3, iterations = 0, status = 'iterationLimit';
  const t0 = Date.now();
  if (n === 0) return { x, cost, residuals: r, iterations: 0, status: 'converged' };
  for (; iterations < maxIterations; iterations++) {
    if (cost < costTol) { status = 'converged'; break; }
    if (shouldCancel?.()) { status = 'cancelled'; break; }
    if (Date.now() - t0 > deadlineMs) { status = 'timeLimit'; break; }
    const J = numericJacobian(fn, x, r);
    let improved = false, tiny = false;
    for (let tries = 0; tries < 12; tries++) {
      const A = J.map(row => Array.from(row));
      const sl = Math.sqrt(lambda);
      for (let k = 0; k < n; k++) { const row = new Array(n).fill(0); row[k] = sl; A.push(row); }
      const b = new Float64Array(A.length);
      for (let i = 0; i < r.length; i++) b[i] = -r[i];
      const { x: d } = lsSolve(A, b);
      let dn = 0; for (const v of d) dn = Math.max(dn, Math.abs(v));
      const xn = Float64Array.from(x, (v, i) => v + d[i]);
      const rn = fn(xn);
      const cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; r = rn; tiny = dn < stepTol; cost = cn; lambda = Math.max(lambda / 3, 1e-12); improved = true; break; }
      lambda *= 4;
      if (dn < stepTol) { tiny = true; break; }
    }
    if (!improved || tiny) { status = cost < 1e-16 ? 'converged' : 'stalled'; iterations++; break; }
  }
  if (iterations >= maxIterations && cost < 1e-16) status = 'converged';
  return { x, cost, residuals: r, iterations, status };
}

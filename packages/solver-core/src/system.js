// A domain-agnostic constraint system.
//
//   const sys = new ConstraintSystem();
//   sys.addVariable('x', 0); sys.addVariable('y', 0);
//   sys.addConstraint({ id: 'unit-circle', group: 'structural', unit: 'mm', tolerance: 1e-6,
//                       residual: v => Math.hypot(v.get('x'), v.get('y')) - 1 });
//   sys.addConstraint({ id: 'x=0.6', group: 'user', residual: v => v.get('x') - 0.6 });
//   const r = sys.solve();   // r.status === 'converged', r.values.y ≈ 0.8
//
// Four constraint groups are kept SEPARATE and weighted so that one can never excuse
// another:
//   structural  must hold (closure, rigidity, equations of the model). Weighted heavily.
//   user        targets the caller drives toward. When they conflict with structure they lose,
//               and the solver says so (status 'incompatibleTargets').
//   limit       one-sided: residual is the (non-negative) EXCESS over a bound. Reported as warnings.
//   soft        preferences (stay near the starting point, smoothness). Never excuse anything.
// Residuals are returned in PHYSICAL units; `scale` normalises them for the numerics and
// `tolerance` (same units) is what validation checks. A low total objective is never taken as proof
// of validity: every constraint is re-checked against its own tolerance.

import { levenbergMarquardt, numericJacobian, numericalRank } from './levenberg-marquardt.js';

export const GROUPS = Object.freeze(['structural', 'user', 'limit', 'soft']);
export const DEFAULT_GROUP_WEIGHTS = Object.freeze({ structural: 1000, user: 1, limit: 1, soft: 1e-3 });

/** Read access to the variable vector, handed to residual functions. */
export class Vars {
  constructor(system, values) { this.values = values; this._index = system._index; }
  get(name) { const i = this._index.get(name); if (i === undefined) throw new Error(`unknown variable ${name}`); return this.values[i]; }
  at(i) { return this.values[i]; }
}

export class ConstraintSystem {
  /**
   * @param {object} [opts]
   * @param {Partial<typeof DEFAULT_GROUP_WEIGHTS>} [opts.weights]
   * @param {number} [opts.preferInitial] weight of the implicit "stay near the starting point" preference (default 1e-4, 0 disables).
   *   It biases a solution by about weight² × the distance moved, so keep it well below your tolerances;
   *   it only matters in the null space of under-constrained systems.
   */
  constructor(opts = {}) {
    this.weights = { ...DEFAULT_GROUP_WEIGHTS, ...(opts.weights || {}) };
    this.preferInitial = opts.preferInitial ?? 1e-4;
    this.names = []; this._index = new Map(); this.vars = [];
    this.constraints = [];
    this._context = null;
  }

  /** @returns {number} the variable's index */
  addVariable(name, initial = 0, { scale = 1, min, max, unit = '' } = {}) {
    if (this._index.has(name)) throw new Error(`duplicate variable ${name}`);
    this._index.set(name, this.names.length); this.names.push(name);
    this.vars.push({ name, initial, scale, min, max, unit });
    return this.names.length - 1;
  }
  addVariables(names, initial = 0, opts) { return names.map((n, i) => this.addVariable(n, Array.isArray(initial) ? initial[i] : initial, opts)); }
  index(name) { return this._index.get(name); }
  get size() { return this.names.length; }

  /**
   * Compute shared derived data ONCE per evaluation (e.g. forward kinematics) and hand it to every
   * residual as its second argument.
   * @param {(vars: Vars) => any} fn
   */
  setContext(fn) { this._context = fn; return this; }

  /**
   * @param {object} c
   * @param {string} c.id
   * @param {'structural'|'user'|'limit'|'soft'} [c.group='user']
   * @param {(vars: Vars, ctx: any) => number|number[]} c.residual physical units; limit residuals return the excess (>= 0)
   * @param {number} [c.scale=1] normaliser for the numerics (typically a characteristic length / angle)
   * @param {number} [c.weight=1] extra weight within its group
   * @param {number} [c.tolerance] acceptance threshold in the residual's own units
   * @param {string} [c.unit]
   * @param {any} [c.meta] opaque data carried through to results
   */
  addConstraint(c) {
    if (!c.id) throw new Error('constraint needs an id');
    if (this.constraints.some(x => x.id === c.id)) throw new Error(`duplicate constraint ${c.id}`);
    const group = c.group || 'user';
    if (!GROUPS.includes(group)) throw new Error(`unknown group ${group}`);
    this.constraints.push({ scale: 1, weight: 1, tolerance: group === 'limit' ? 1e-9 : 1e-6, unit: '', ...c, group });
    return this;
  }
  removeConstraint(id) { this.constraints = this.constraints.filter(c => c.id !== id); return this; }
  clearGroup(group) { this.constraints = this.constraints.filter(c => c.group !== group); return this; }
  setVariable(name, patch) { Object.assign(this.vars[this._index.get(name)], patch); return this; }

  _evaluate(x) {
    const v = new Vars(this, x);
    const ctx = this._context ? this._context(v) : undefined;
    return this.constraints.map(c => { const r = c.residual(v, ctx); return Array.isArray(r) ? r : [r]; });
  }

  /** The values of every variable by name. */
  valuesOf(x) { return Object.fromEntries(this.names.map((n, i) => [n, x[i]])); }

  /**
   * @param {object} [req]
   * @param {Float64Array|number[]|Record<string, number>} [req.initial] start point (defaults to each variable's `initial`)
   * @param {object} [req.options] { maxIterations, deadlineMs, shouldCancel, tolerances: { [id|group]: number } }
   */
  solve(req = {}) {
    const t0 = Date.now();
    const n = this.size, opts = req.options || {};
    const init = this._startVector(req.initial);
    const tolFor = c => opts.tolerances?.[c.id] ?? opts.tolerances?.[c.group] ?? c.tolerance;
    const wg = this.weights;

    const objective = x => {
      const groups = this._evaluate(x);
      const r = [];
      this.constraints.forEach((c, k) => { const w = wg[c.group] * c.weight / c.scale; for (const v of groups[k]) r.push(w * v); });
      for (let i = 0; i < n; i++) {
        const V = this.vars[i];
        if (this.preferInitial) r.push((this.preferInitial * (x[i] - init[i])) / V.scale);
        if (Number.isFinite(V.min) && x[i] < V.min) r.push(wg.limit * (V.min - x[i]) / V.scale);
        if (Number.isFinite(V.max) && x[i] > V.max) r.push(wg.limit * (x[i] - V.max) / V.scale);
      }
      return r;
    };

    const res = levenbergMarquardt(objective, init, { maxIterations: opts.maxIterations ?? 120, deadlineMs: opts.deadlineMs, shouldCancel: opts.shouldCancel });
    return this._report(res, init, tolFor, t0);
  }

  _startVector(initial) {
    const x = Float64Array.from(this.vars, v => v.initial);
    if (!initial) return x;
    if (Array.isArray(initial) || ArrayBuffer.isView(initial)) { initial.forEach((v, i) => { x[i] = v; }); return x; }
    for (const [k, v] of Object.entries(initial)) { const i = this._index.get(k); if (i !== undefined) x[i] = v; }
    return x;
  }

  _report(res, init, tolFor, t0) {
    const n = this.size;
    const groups = this._evaluate(res.x);
    const perConstraint = this.constraints.map((c, k) => {
      const tol = tolFor(c);
      const max = groups[k].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      return { id: c.id, group: c.group, unit: c.unit, maxError: max, tolerance: tol, ok: max <= tol, residual: groups[k], meta: c.meta };
    });
    const by = g => perConstraint.filter(p => p.group === g);
    const groupMax = Object.fromEntries(GROUPS.map(g => [g, by(g).reduce((m, p) => Math.max(m, p.maxError), 0)]));
    const structuralOk = by('structural').every(p => p.ok);
    const userOk = by('user').every(p => p.ok);

    const warnings = [];
    const limits = by('limit').filter(p => !p.ok);
    if (limits.length) warnings.push({ code: 'limitViolation', message: 'a limit is exceeded', constraints: limits.map(p => p.id), maxExcess: Math.max(...limits.map(p => p.maxError)) });
    // Rank of the bare structural+user Jacobian (no soft rows): fewer than n means free degrees of freedom.
    const bare = x => { const g = this._evaluate(x); const r = []; this.constraints.forEach((c, k) => { if (c.group === 'structural' || c.group === 'user') for (const v of g[k]) r.push(v / c.scale); }); return r; };
    const rb = bare(res.x);
    const rank = rb.length && n ? numericalRank(numericJacobian(bare, res.x, rb)) : 0;
    if (rank < n) warnings.push({ code: 'underconstrained', message: `${n - rank} free degree(s) of freedom held near the starting point`, rank, variables: n });

    let status;
    if (res.status === 'cancelled') status = 'cancelled';
    else if (structuralOk && userOk) status = 'converged';
    else if (res.status === 'iterationLimit' || res.status === 'timeLimit') status = 'iterationLimit';
    else status = structuralOk ? 'incompatibleTargets' : 'singularConfiguration';

    // Largest user-target violations relative to their tolerance — NOT a minimal conflicting set.
    const worst = by('user').slice().sort((a, b) => b.maxError / (b.tolerance || 1) - a.maxError / (a.tolerance || 1)).slice(0, 5)
      .map(p => ({ id: p.id, error: p.maxError, unit: p.unit, tolerance: p.tolerance, meta: p.meta }));

    return {
      status, valid: structuralOk, targetsMet: userOk,
      iterations: res.iterations, elapsedMs: Date.now() - t0,
      x: res.x, values: this.valuesOf(res.x),
      constraints: perConstraint, groupMax, warnings, worst, cost: res.cost,
    };
  }
}

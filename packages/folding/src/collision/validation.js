// Collision, clearance, sections and measurements on solved configurations.
// Results always state HOW they were checked (method, resolution, tolerances):
// passing discrete frames never proves a collision-free path.

import { evaluatePoses } from '../kinematics.js';
import { applyPose, dist, sub, dot, norm, scale, add, unit } from '../math.js';
import { worldTriangles, aabb, aabbOverlap } from './mesh.js';
import { triTriClosest, distPointSegment } from './narrowphase.js';

export const DEFAULT_COLLISION = Object.freeze({ thicknessAware: false, toleranceMm: 1e-6, hingeExclusionMm: null });

function hingeSegments(compiled, poses) {
  const segs = new Map(); // pair key -> [{a,b,exclusion}]
  for (const c of compiled.connIndex.values()) {
    if (!c.edge) continue;
    const key = [c.a, c.b].sort().join('|');
    const P = poses.get(c.a);
    const p0 = applyPose(P, [c.edge.p0[0], c.edge.p0[1], 0]), p1 = applyPose(P, [c.edge.p1[0], c.edge.p1[1], 0]);
    if (!segs.has(key)) segs.set(key, []);
    segs.get(key).push({ a: p0, b: p1, width: c.widthMm || 0, band: c.lengthMm || 0 });
  }
  return segs;
}

/**
 * @param compiled compileAssembly() output
 * @param poses    Map regionId -> pose
 * @param options  { thicknessAware, toleranceMm, hingeExclusionMm }
 * Intersect mode (default): only proper interpenetration is a collision; layers may touch.
 * Thickness-aware: midsurfaces closer than (tA+tB)/2 are collisions, except within the
 *   hinge exclusion zone of directly connected regions. Adjacent regions are NOT excluded
 *   wholesale — they can still collide away from their shared hinge.
 */
export function checkCollisions(compiled, poses, options = {}) {
  const opt = { ...DEFAULT_COLLISION, ...options };
  const tris = worldTriangles(compiled, poses);
  const hinges = hingeSegments(compiled, poses);
  const thick = id => compiled.regionIndex.get(id).thicknessMm || 0;
  const boxes = tris.map(t => aabb(t.tri, opt.thicknessAware ? (thick(t.region)) : opt.toleranceMm));
  const hits = new Map();
  let narrowChecks = 0;
  for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
    const A = tris[i], B = tris[j];
    if (A.region === B.region) continue;
    if (!aabbOverlap(boxes[i], boxes[j])) continue;
    narrowChecks++;
    const key = [A.region, B.region].sort().join('|');
    const r = triTriClosest(A.tri, B.tri);
    let flagged = false, clearance = 0;
    if (opt.thicknessAware) {
      clearance = (thick(A.region) + thick(B.region)) / 2;
      flagged = r.crossing || r.dist < clearance - opt.toleranceMm;
    } else flagged = r.crossing;
    if (!flagged) continue;
    const segs = hinges.get(key);
    if (segs && !r.crossing) {
      const mid = scale(add(r.a, r.b), 0.5);
      const excl = opt.hingeExclusionMm ?? Math.max(...segs.map(s => Math.max(s.width, s.band)), thick(A.region) + thick(B.region));
      if (segs.some(s => distPointSegment(mid, s.a, s.b) <= excl + opt.toleranceMm)) continue;
    }
    const prev = hits.get(key);
    const d = r.crossing ? -1 : r.dist;
    if (!prev || d < prev.penetrationScore) hits.set(key, { regions: key.split('|'), distanceMm: r.dist, requiredMm: clearance, crossing: r.crossing, point: scale(add(r.a, r.b), 0.5), penetrationScore: d });
  }
  const collisions = [...hits.values()].map(({ penetrationScore, ...h }) => h);
  return {
    collisionStatus: collisions.length ? 'collisionDetected' : 'checked',
    collisions,
    method: { kind: 'discrete', mode: opt.thicknessAware ? 'thicknessAware' : 'intersect', toleranceMm: opt.toleranceMm, narrowPhaseTests: narrowChecks },
  };
}

function maxDisplacement(compiled, posesA, posesB) {
  let m = 0;
  for (const r of compiled.regionIndex.values()) for (const p of r.polygon) {
    m = Math.max(m, dist(applyPose(posesA.get(r.id), [p[0], p[1], 0]), applyPose(posesB.get(r.id), [p[0], p[1], 0])));
  }
  return m;
}

/**
 * Swept check between accepted samples. Tree mechanisms refine by angle interpolation
 * (exact FK) until no vertex moves more than maxStepMm between checked configurations.
 * Mechanisms with closed loops cannot be interpolated in angle space, so they are
 * checked at the supplied samples only and reported as such.
 */
export function checkPath(compiled, samples, options = {}) {
  const { maxStepMm = 2, maxDepth = 8, ...colOpt } = options;
  const hasLoops = compiled.closureConnIds.length > 0;
  const poseOf = a => evaluatePoses(compiled, a);
  let checked = 0, firstCollision = null;
  const test = (angles, progress) => {
    checked++;
    const r = checkCollisions(compiled, poseOf(angles), colOpt);
    if (r.collisions.length && !firstCollision) firstCollision = { progress, angles, collisions: r.collisions };
    return r.collisions.length === 0;
  };
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  test(samples[0], 0);
  for (let k = 0; k + 1 < samples.length && !firstCollision; k++) {
    const a = samples[k], b = samples[k + 1];
    const refine = (a0, b0, t0, t1, depth) => {
      if (firstCollision) return;
      const dsp = maxDisplacement(compiled, poseOf(a0), poseOf(b0));
      if (!hasLoops && dsp > maxStepMm && depth < maxDepth) {
        const tm = (t0 + t1) / 2, mid = lerp(a0, b0, 0.5);
        refine(a0, mid, t0, tm, depth + 1);
        if (!firstCollision) { test(mid, (k + tm) / (samples.length - 1)); refine(mid, b0, tm, t1, depth + 1); }
      }
    };
    refine(a, b, 0, 1, 0);
    if (!firstCollision) test(b, (k + 1) / (samples.length - 1));
  }
  return {
    collisionStatus: firstCollision ? 'collisionDetected' : 'checked',
    collisionFree: !firstCollision,
    firstCollision,
    method: { kind: hasLoops ? 'discrete-samples' : 'adaptive-interpolation', maxStepMm: hasLoops ? null : maxStepMm, configurationsChecked: checked, note: 'passing discrete configurations does not guarantee a collision-free path' },
  };
}

// ── sections, envelope, measurement ────────────────────────────────────────
/** Intersection of all region triangles with a plane -> segments grouped by region. */
export function sectionSegments(compiled, poses, plane) {
  const n = unit(plane.normal), o = plane.origin;
  const out = [];
  for (const t of worldTriangles(compiled, poses)) {
    const d = t.tri.map(p => dot(sub(p, o), n));
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if ((d[i] < 0 && d[j] > 0) || (d[i] > 0 && d[j] < 0)) pts.push(add(t.tri[i], scale(sub(t.tri[j], t.tri[i]), d[i] / (d[i] - d[j]))));
      else if (d[i] === 0) pts.push(t.tri[i]);
    }
    const uniq = pts.filter((p, i) => pts.findIndex(q => dist(p, q) < 1e-9) === i);
    if (uniq.length === 2) out.push({ region: t.region, a: uniq[0], b: uniq[1] });
  }
  return out;
}

/** Join section segments into polylines (per region). */
export function chainSegments(segs, tol = 1e-6) {
  const byRegion = new Map();
  for (const s of segs) { if (!byRegion.has(s.region)) byRegion.set(s.region, []); byRegion.get(s.region).push([s.a, s.b]); }
  const chains = [];
  for (const [region, list] of byRegion) {
    const rest = list.slice();
    while (rest.length) {
      let chain = rest.pop().slice();
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < rest.length; i++) {
          const [a, b] = rest[i];
          if (dist(chain.at(-1), a) < tol) { chain.push(b); }
          else if (dist(chain.at(-1), b) < tol) { chain.push(a); }
          else if (dist(chain[0], b) < tol) { chain.unshift(a); }
          else if (dist(chain[0], a) < tol) { chain.unshift(b); }
          else continue;
          rest.splice(i, 1); grew = true; break;
        }
      }
      chains.push({ region, points: chain });
    }
  }
  return chains;
}

export function envelope(compiled, poses) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of worldTriangles(compiled, poses)) for (const p of t.tri) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { min: lo, max: hi, size: hi.map((h, k) => h - lo[k]) };
}

/** Radial extents about an axis. Max radius is exact (convex in each triangle); min radius samples edges and tests axis crossing. */
export function radialExtents(compiled, poses, axisOrigin, axisDir) {
  const u = unit(axisDir);
  const radius = p => { const w = sub(p, axisOrigin); return norm(sub(w, scale(u, dot(w, u)))); };
  let max = 0, min = Infinity, zmin = Infinity, zmax = -Infinity;
  for (const t of worldTriangles(compiled, poses)) {
    for (let i = 0; i < 3; i++) {
      const p = t.tri[i], q = t.tri[(i + 1) % 3];
      max = Math.max(max, radius(p));
      const h = dot(sub(p, axisOrigin), u); zmin = Math.min(zmin, h); zmax = Math.max(zmax, h);
      for (let s = 0; s <= 16; s++) min = Math.min(min, radius(add(p, scale(sub(q, p), s / 16))));
    }
  }
  return { maxRadiusMm: max, minRadiusMm: min, axialMinMm: zmin, axialMaxMm: zmax };
}

/** Distance between two features: { region, local:[x,y] } or { world:[x,y,z] }. */
export function measureFeatures(compiled, poses, f1, f2) {
  const at = f => (f.world ? f.world : applyPose(poses.get(f.region), [f.local[0], f.local[1], 0]));
  const a = at(f1), b = at(f2);
  return { distanceMm: dist(a, b), delta: sub(b, a), from: a, to: b };
}

// ── imported obstacles (housings, bases) ───────────────────────────────────
const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** Obstacle = { id, units, placement: pose|undefined, triangles:[[[x,y,z],[..],[..]],...] } ; units are mandatory. */
export function obstacleTrianglesMm(ob) {
  if (!UNIT_MM[ob.units]) throw new Error(`obstacle ${ob.id}: units must be one of ${Object.keys(UNIT_MM).join(', ')}`);
  const k = UNIT_MM[ob.units];
  return ob.triangles.map(t => t.map(p => {
    const q = [p[0] * k, p[1] * k, p[2] * k];
    return ob.placement ? applyPose(ob.placement, q) : q;
  }));
}

/** Minimum clearance of the assembly from each obstacle; collision if any region pierces it or comes closer than clearanceMm. */
export function checkObstacles(compiled, poses, obstacles, { clearanceMm = 0, searchRadiusMm = 25 } = {}) {
  const tris = worldTriangles(compiled, poses);
  const report = [];
  for (const ob of obstacles) {
    const ot = obstacleTrianglesMm(ob);
    let minD = Infinity, crossing = false, where = null, region = null;
    for (const a of tris) {
      const ba = aabb(a.tri, Math.max(clearanceMm, searchRadiusMm) + 1e-6);
      for (const b of ot) {
        if (!aabbOverlap(ba, aabb(b))) continue;
        const r = triTriClosest(a.tri, b);
        if (r.crossing) crossing = true;
        if (r.dist < minD) { minD = r.dist; where = scale(add(r.a, r.b), 0.5); region = a.region; }
      }
    }
    // minDistanceMm null means farther than searchRadiusMm
    report.push({ obstacle: ob.id, minDistanceMm: minD === Infinity ? null : minD, crossing, region, point: where, violates: crossing || (minD !== Infinity && minD < clearanceMm) });
  }
  return { collisionStatus: report.some(r => r.violates) ? 'collisionDetected' : 'checked', obstacles: report, clearanceMm, searchRadiusMm };
}


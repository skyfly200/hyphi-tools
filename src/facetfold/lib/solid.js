// Printable geometry for a net, built with the manifold kernel (see kernel.js).
// Coordinates are the plate's: x/y in millimetres as laid out by net.js, z up from the bed (z = 0 is the
// outer surface of every panel).

import { panelProfile } from './panel.js';
import { planSnaps, wallPoint, DEFAULT_SNAP } from './snap.js';
import { centroid2, inscribedRadius } from './lighting.js';
import { faceVectors, assessSurface } from './surface.js';

const SEG = 48;
const deg = r => (r * 180) / Math.PI;

/** Rotation (degrees, XYZ order) taking +z to direction d. */
function aimZ(d) {
  const l = Math.hypot(...d), z = Math.max(-1, Math.min(1, d[2] / l));
  return [0, deg(Math.acos(z)), deg(Math.atan2(d[1], d[0]))];
}

export function buildPlate(K, net, features = {}) {
  const { Manifold } = K;
  const { panelThicknessMm: t, hingeThicknessMm: th } = net.params;
  const issues = [];
  const profiles = net.faces.map(f => panelProfile(net, f));
  profiles.forEach(p => issues.push(...p.issues));

  // ── panel bodies ──
  const bodies = new Map();
  net.faces.forEach((f, i) => {
    const p = profiles[i]; if (!p.valid) return;
    const pts = [...p.bottom.map(q => [q[0], q[1], 0]), ...p.top.map(q => [q[0], q[1], t])];
    bodies.set(f.id, Manifold.hull(pts));
  });

  // ── lighting features ──
  const carve = new Map(), addOn = new Map();                    // face id -> [Manifold]
  const push = (m, f, M) => { if (!m.has(f)) m.set(f, []); m.get(f).push(M); };
  const rectSlot = (cx, cy, L, W, angDeg) => Manifold.cube([L, W, t + 0.4], true).rotate([0, 0, angDeg]).translate([cx, cy, t / 2]);
  for (const mt of features.mounts || []) {
    issues.push(...(mt.issues || []));
    const f = net.faces[mt.face], c0 = centroid2(f.outer);
    const e0 = f.outer[1], e00 = f.outer[0], ang = Math.atan2(e0[1] - e00[1], e0[0] - e00[0]);
    const cx = c0[0] + mt.offset[0] * Math.cos(ang) - mt.offset[1] * Math.sin(ang), cy = c0[1] + mt.offset[0] * Math.sin(ang) + mt.offset[1] * Math.cos(ang);
    const top = profiles[mt.face].top;
    if (!top) continue;
    if (mt.type === 'round') {
      const r = mt.diameterMm / 2, R = r + mt.collarWallMm;
      if (R > inscribedRadius(top) - 0.3) { issues.push({ level: 'error', code: 'mountOutside', face: mt.face, message: `face ${mt.face}: the mount collar does not fit inside the panel's inner face` }); continue; }
      push(carve, mt.face, Manifold.cylinder(t + 0.4, r, r, SEG, true).translate([cx, cy, t / 2]));
      const collar = Manifold.cylinder(mt.collarHeightMm + 0.02, R, R, SEG).translate([cx, cy, t - 0.02]).subtract(Manifold.cylinder(mt.collarHeightMm + 1, r, r, SEG).translate([cx, cy, t - 0.5]));
      let withLugs = collar;
      for (let k = 0; k < mt.lugs; k++) {
        const a = (k / mt.lugs) * 2 * Math.PI;
        const lug = Manifold.cube([0.6, 1.0, 0.9], true).translate([r - 0.1, 0, 0]).rotate([0, 0, deg(a)]).translate([cx, cy, t + mt.collarHeightMm - 0.9]);
        withLugs = withLugs.add(lug);
      }
      push(addOn, mt.face, withLugs);
    } else {
      const w = mt.widthMm, h = mt.heightMm, wl = mt.collarWallMm, a = deg(ang);
      push(carve, mt.face, rectSlot(cx, cy, w, h, a));
      const outer = Manifold.cube([w + 2 * wl, h + 2 * wl, mt.collarHeightMm + 0.02], true).rotate([0, 0, a]).translate([cx, cy, t - 0.02 + (mt.collarHeightMm + 0.02) / 2]);
      push(addOn, mt.face, outer.subtract(Manifold.cube([w, h, mt.collarHeightMm + 1], true).rotate([0, 0, a]).translate([cx, cy, t])));
    }
  }
  for (const ts of features.tieSlots || []) {
    const f = net.faces[ts.face], i = f.edges.findIndex(e => e.key === ts.edgeKey); if (i < 0) continue;
    const a = f.outer[i], b = f.outer[(i + 1) % f.outer.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    const d = [dx / l, dy / l], m = [-d[1], d[0]], ang = deg(Math.atan2(d[1], d[0]));
    const mid = [(a[0] + b[0]) / 2 + m[0] * ts.fromEdgeMm, (a[1] + b[1]) / 2 + m[1] * ts.fromEdgeMm];
    for (const sgn of [-1, 1]) push(carve, ts.face, rectSlot(mid[0] + d[0] * sgn * 3, mid[1] + d[1] * sgn * 3, ts.lengthMm, ts.widthMm, ang));
  }

  // ── snap detents ──
  const snapOpts = { ...DEFAULT_SNAP, ...(features.snap || {}) };
  const snaps = planSnaps(net, profiles, snapOpts);
  issues.push(...snaps.issues);
  for (const d of snaps.plan) {
    const A = net.faces[d.bump.face], B = net.faces[d.dimple.face];
    const pa = wallPoint(A, profiles[A.id], d.bump.edge, d.bump.s, d.hz, t), pb = wallPoint(B, profiles[B.id], d.dimple.edge, d.dimple.s, d.hz, t);
    const r = d.r, h = d.h, clr = snapOpts.dimpleClearanceMm;
    const embed = 0.2;
    const bump = Manifold.cylinder(h + embed, r, Math.max(0.15, r - (h + embed)), 24).rotate(aimZ(pa.normal))
      .translate([pa.x - pa.normal[0] * embed, pa.y - pa.normal[1] * embed, pa.z - pa.normal[2] * embed]);
    const inward = pb.normal.map(x => -x);
    const dim = Manifold.cylinder(h + clr + 0.4, r + clr, r + clr, 24).rotate(aimZ(inward))
      .translate([pb.x + pb.normal[0] * 0.1, pb.y + pb.normal[1] * 0.1, pb.z + pb.normal[2] * 0.1]);
    push(addOn, d.bump.face, bump); push(carve, d.dimple.face, dim);
  }

  // ── bed-side surface relief (only where the chosen process can resolve it) ──
  const process = features.process || 'fdm04', surfaces = features.surfaces || {};
  const surfaceReport = [];
  for (const [fidStr, spec] of Object.entries(surfaces)) {
    const fid = Number(fidStr), prof = profiles[fid];
    if (!spec || spec.kind === 'none' || !prof?.valid) continue;
    const depthMm = spec.depthMm ?? Math.min(0.15, spec.pitchMm * 0.2);
    const verdict = assessSurface({ kind: spec.kind, pitchUm: spec.pitchMm * 1000, depthUm: depthMm * 1000, intent: spec.intent }, process);
    surfaceReport.push({ face: fid, process, verdict: verdict.verdict, reasons: verdict.reasons });
    if (verdict.verdict === 'not-printable') { issues.push({ level: 'warning', code: 'surfaceSkipped', face: fid, message: `face ${fid}: surface ${spec.kind} @ ${(spec.pitchMm * 1000).toFixed(0)} µm not built — ${verdict.reasons[0]}` }); continue; }
    const vec = faceVectors(net.faces[fid], prof.bottom, spec);
    const tools = [];
    if (vec.type === 'lines') {
      const hw = ((spec.widthFrac ?? 0.5) * spec.pitchMm) / 2;
      for (const [x0, y0, x1, y1] of vec.segments) {
        const L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.2) continue;
        const nx = -(y1 - y0) / L * hw, ny = (x1 - x0) / L * hw;
        const pts = [];
        for (const [x, y] of [[x0, y0], [x1, y1]]) pts.push([x + nx, y + ny, 0], [x - nx, y - ny, 0], [x + nx, y + ny, -0.1], [x - nx, y - ny, -0.1], [x, y, depthMm]);
        tools.push(Manifold.hull(pts));
      }
    } else if (vec.type === 'dots') {
      for (const [x, y] of vec.points) tools.push(Manifold.cylinder(depthMm + 0.1, vec.radiusMm, 0.01, 10).translate([x, y, -0.1]));
    }
    if (tools.length) { push(carve, fid, Manifold.union(tools)); surfaceReport.at(-1).features = tools.length; }
  }

  // ── assemble panels ──
  const panels = new Map();
  for (const [fid, body] of bodies) {
    let m = body;
    for (const c of carve.get(fid) || []) m = m.subtract(c);
    for (const a of addOn.get(fid) || []) m = m.add(a);
    panels.set(fid, m);
  }

  // ── hinge strips (bottom layer(s), spanning trimmed edge to trimmed edge, with a little overlap) ──
  const endMargin = features.hingeEndMarginMm ?? 0.4, overlap = 0.15;
  const strips = net.hinges.map(h => {
    const P = net.faces[h.parent], C = net.faces[h.child];
    const [va, vb] = h.key.split('-').map(Number);
    const pa = P.outer[P.vertIdx.indexOf(va)], pb = P.outer[P.vertIdx.indexOf(vb)];
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy), d = [dx / L, dy / L], n = h.normal;
    const rangeOf = (prof, face) => {
      const poly = prof.bottom; if (!poly) return null;
      const ia = face.vertIdx.indexOf(va), ib = face.vertIdx.indexOf(vb), o = face.outer[ia];
      // project the trimmed polygon's two corners on this edge onto the ideal edge direction
      const i = face.edges.findIndex(e => e.key === h.key), q0 = poly[i], q1 = poly[(i + 1) % poly.length];
      const toS = q => ((q[0] - o[0]) * d[0] + (q[1] - o[1]) * d[1]);
      const s = [toS(q0), toS(q1)].sort((x, y) => x - y);
      void ib; return s;
    };
    const pr = rangeOf(profiles[P.id], P), cr = rangeOf(profiles[C.id], C);
    if (!pr || !cr) return null;
    // express the child's range in the parent's frame (child's edge runs the opposite way)
    const coa = C.outer[C.vertIdx.indexOf(va)];
    const shift = (coa[0] - pa[0]) * d[0] + (coa[1] - pa[1]) * d[1];
    const cs = cr.map(x => x + shift).sort((x, y) => x - y);
    const s0 = Math.max(pr[0], cs[0]) + endMargin, s1 = Math.min(pr[1], cs[1]) - endMargin;
    if (s1 - s0 < 0.5) { issues.push({ level: 'warning', code: 'hingeTooShort', message: `hinge ${h.key} is too short for a strip` }); return null; }
    const a = h.trimMm, w = net.params.hingeWidthMm;
    const lo = -a - overlap, hi = (w - a) + overlap;                // from just inside the parent to just inside the child
    const corner = (s, u, z) => [pa[0] + d[0] * s + n[0] * u, pa[1] + d[1] * s + n[1] * u, z];
    return Manifold.hull([0, th].flatMap(z => [corner(s0, lo, z), corner(s1, lo, z), corner(s1, hi, z), corner(s0, hi, z)]));
  });
  strips.forEach((s, i) => { if (!s) issues.push({ level: 'error', code: 'noHinge', message: `hinge ${net.hinges[i].key} could not be built` }); });

  // ── one body per connected piece ──
  const components = net.components.map(c => {
    const parts = [];
    for (const fid of c.faces) if (panels.has(fid)) parts.push(panels.get(fid));
    net.hinges.forEach((h, i) => { if (strips[i] && c.faces.includes(h.parent)) parts.push(strips[i]); });
    return Manifold.union(parts);
  });
  return { components, profiles, snaps, issues, panels, strips, surfaceReport };
}

/** Quick facts about a built component: volume, genus, bounding box, manifold status. */
export function describe(m) {
  const b = m.boundingBox();
  return { volumeMm3: m.volume(), surfaceMm2: m.surfaceArea(), genus: m.genus(), status: m.status(),
    min: b.min, max: b.max, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] };
}

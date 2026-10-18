// Snap-fit detents on seams.
//
// A seam is an edge of the solid where two panels meet but are NOT connected by a hinge. Their walls come
// together face to face when the solid closes. Each seam gets 1–3 detents: a small conical bump on one wall
// and a matching dimple (with clearance) in the mating wall. The bump needs to pass the opposing wall, which
// flexes slightly, then seats — a light, repeatable snap. Printing: the bump is a 45° cone, no support needed.
//
// All positions are computed from the IDEAL edge and the wall offsets, so mating positions line up by
// construction; verifySnaps() proves it with the folded poses from the engine.


export const DEFAULT_SNAP = Object.freeze({
  enabled: true,
  bumpRadiusMm: 0.8,
  bumpHeightMm: 0.35,
  dimpleClearanceMm: 0.15,
  spacingMm: 18,           // target distance between detents along a seam
  minEdgeMm: 10,           // seams shorter than this get no detent
  maxPerSeam: 3,
  minPanelThicknessMm: 1.2,
  heightFraction: 0.55,    // where up the wall the detent sits (0 = bed, 1 = inner surface)
});

/** Point on a panel's wall for edge `i`: s along the ideal edge (0..1), hz up the wall (0 bottom … 1 top). */
export function wallPoint(face, profile, i, s, hz, t) {
  const V = face.outer, a = V[i], b = V[(i + 1) % V.length];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
  const m = [-dy / l, dx / l];                                  // inward normal (CCW polygon)
  const e = profile.edges[i];
  const off = e.bottomOffMm + hz * (e.topOffMm - e.bottomOffMm);
  const p = [a[0] + dx * s + m[0] * off, a[1] + dy * s + m[1] * off];
  // outward wall normal in 3D: perpendicular to the wall's edge direction and slope
  const d = [dx / l, dy / l, 0], slope = [m[0] * e.runMm, m[1] * e.runMm, t];
  let N = [d[1] * slope[2] - d[2] * slope[1], d[2] * slope[0] - d[0] * slope[2], d[0] * slope[1] - d[1] * slope[0]];
  const nl = Math.hypot(...N); N = N.map(x => x / nl);
  if (N[0] * m[0] + N[1] * m[1] > 0) N = N.map(x => -x);        // make it point OUT of the panel
  return { x: p[0], y: p[1], z: hz * t, normal: N, edgeLenMm: l };
}

/**
 * Size a detent to the room the wall actually has. The cavity runs perpendicular into the wall, and on a
 * leaning wall it can break through the bottom (outer) face if it is too big or too deep. Returns the largest
 * radius/height (up to the requested ones) that keeps `margin` mm of material around the cavity, or null.
 */
export function fitDetent(wall, t, S, margin = 0.2) {
  const nz = wall.normal[2], sinT = Math.sqrt(Math.max(0, 1 - nz * nz));
  let r = S.bumpRadiusMm;
  for (let k = 0; k < 40; k++, r -= 0.025) {
    if (r < 0.3) return null;
    const h = Math.min(S.bumpHeightMm, 0.45 * r), clr = S.dimpleClearanceMm;
    const rc = r + clr, H = h + clr + 0.2;
    // lowest point of the cavity (far end, down the wall) must stay above the bed by `margin`, and the near
    // end must stay below the top surface by `margin`
    const zFar = wall.z - H * nz - rc * sinT, zNearTop = wall.z + rc * sinT;
    if (zFar >= margin && zNearTop <= t - margin) return { r, h };
  }
  return null;
}

/** Plan detents for every seam: which face carries the bump, which the dimple, and where. */
export function planSnaps(net, profiles, opts = {}) {
  const S = { ...DEFAULT_SNAP, ...opts };
  const t = net.params.panelThicknessMm, issues = [], plan = [];
  if (!S.enabled) return { plan, issues, params: S };
  if (t < S.minPanelThicknessMm) issues.push({ level: 'warning', code: 'snapThin', message: `panel thickness ${t} mm is below ${S.minPanelThicknessMm} mm: snap detents are disabled` });
  else for (const seam of net.seams) {
    const [fa, fb] = seam.faces.map(i => net.faces[i]);
    const ia = fa.edges.findIndex(e => e.key === seam.key), ib = fb.edges.findIndex(e => e.key === seam.key);
    const len = seam.lengthMm;
    if (len < S.minEdgeMm) { issues.push({ level: 'info', code: 'snapSkipped', message: `seam ${seam.key} is ${len.toFixed(1)} mm: no detent` }); continue; }
    const n = Math.max(1, Math.min(S.maxPerSeam, Math.floor(len / S.spacingMm)));
    const bumpFace = fa.id < fb.id ? fa : fb, dimpleFace = bumpFace === fa ? fb : fa;
    const bi = bumpFace === fa ? ia : ib, di = bumpFace === fa ? ib : ia;
    // the two faces traverse the shared edge in opposite directions: s on one is 1−s on the other
    const sameDir = false;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) / n;
      const wall = wallPoint(bumpFace, profiles[bumpFace.id], bi, s, S.heightFraction, t);
      const fit = fitDetent(wall, t, S);
      if (!fit) { issues.push({ level: 'warning', code: 'detentTooBig', message: `seam ${seam.key}: the wall is too shallow for a detent of at least 0.6 mm — increase panel thickness` }); break; }
      if (fit.r < 0.5) issues.push({ level: 'warning', code: 'detentSmall', message: `seam ${seam.key}: the detent shrank to ${(2 * fit.r).toFixed(2)} mm across — below what a 0.4 mm nozzle prints reliably. Use thicker panels.` });
      plan.push({ seam: seam.key, bump: { face: bumpFace.id, edge: bi, s }, dimple: { face: dimpleFace.id, edge: di, s: sameDir ? s : 1 - s }, hz: S.heightFraction, r: fit.r, h: fit.h });
    }
  }
  return { plan, issues, params: S };
}

/**
 * Check the plan in the FOLDED state: for each detent the bump base and the dimple centre must coincide.
 * `posesByFace` maps face id → pose (applyPose-able). Returns the worst misalignment in mm.
 */
export function verifySnaps(net, profiles, plan, applyPose, posesByFace) {
  const t = net.params.panelThicknessMm;
  let worst = 0; const rows = [];
  for (const d of plan) {
    const A = net.faces[d.bump.face], B = net.faces[d.dimple.face];
    const pa = wallPoint(A, profiles[A.id], d.bump.edge, d.bump.s, d.hz, t);
    const pb = wallPoint(B, profiles[B.id], d.dimple.edge, d.dimple.s, d.hz, t);
    // wall points live in each panel's flat frame at height z above its outer surface; fold them with the panel pose
    const wa = applyPose(posesByFace(A.id), [pa.x, pa.y, pa.z]), wb = applyPose(posesByFace(B.id), [pb.x, pb.y, pb.z]);
    const g = Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]);
    worst = Math.max(worst, g); rows.push({ seam: d.seam, misalignMm: g });
  }
  return { worstMisalignMm: worst, rows };
}

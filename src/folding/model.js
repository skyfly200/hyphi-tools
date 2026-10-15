// Assembly model + compile step.
//
// An assembly is plain JSON (no Vue / Three.js / DOM):
// {
//   units: 'mm',
//   anchor: regionId,                       // fixed region (identity pose unless overridden)
//   regions:     [{ id, polygon: [[x,y]..], thicknessMm?, source? }],   // flat material coords, mm
//   connections: [{ id, type, a, b, edge: { p0:[x,y], p1:[x,y] }, lengthMm?, widthMm?,
//                   minAngleDeg?, maxAngleDeg?, source?, meta? }]
// }
// type: 'idealHinge' | 'circularBand' | 'rigidJoin'
//
// `edge` is the shared edge on region A's side. For circularBand the child edge
// is `lengthMm` further along the in-plane normal. Reversing p0/p1 never reverses
// the fold direction: the axis is canonicalised so region B lies on its left.

import { scale, sub, dot, unit, dist } from './math.js';
import { bandPose, bendProfile } from './bends/circular.js';

export const CONNECTION_TYPES = ['idealHinge', 'circularBand', 'segmentedBand', 'rigidJoin'];

const centroid2 = poly => {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
};

/**
 * Validate and prepare an assembly for solving. Pure; safe to call on every edit
 * but only needed when topology or physical geometry changes.
 * @returns {{ ok:boolean, issues:Array, assembly, regionIndex:Map, connIndex:Map, frames:Map,
 *             tree:Array, treeConnIds:Set, closureConnIds:Array, variableConnIds:Array,
 *             varIndex:Map, scaleMm:number, hash:string }}
 */
export function compileAssembly(assembly) {
  const issues = [];
  const err = (code, message, extra = {}) => issues.push({ level: 'error', code, message, ...extra });
  const warn = (code, message, extra = {}) => issues.push({ level: 'warning', code, message, ...extra });

  const regionIndex = new Map();
  for (const r of assembly.regions || []) {
    if (!r.id) { err('invalidTopology', 'region without id'); continue; }
    if (regionIndex.has(r.id)) err('invalidTopology', `duplicate region id ${r.id}`, { id: r.id });
    if (!Array.isArray(r.polygon) || r.polygon.length < 3) err('invalidTopology', `region ${r.id} needs a polygon`, { id: r.id });
    regionIndex.set(r.id, r);
  }
  if (!regionIndex.size) err('invalidTopology', 'assembly has no regions');

  const connIndex = new Map();
  const frames = new Map();
  for (const c of assembly.connections || []) {
    if (!c.id) { err('invalidTopology', 'connection without id'); continue; }
    if (connIndex.has(c.id)) err('invalidTopology', `duplicate connection id ${c.id}`, { id: c.id });
    connIndex.set(c.id, c);
    if (!CONNECTION_TYPES.includes(c.type)) err('invalidTopology', `unknown connection type ${c.type}`, { id: c.id });
    const A = regionIndex.get(c.a), B = regionIndex.get(c.b);
    if (!A || !B) { err('staleReferences', `connection ${c.id} references a missing region`, { id: c.id }); continue; }
    if (c.a === c.b) { err('invalidTopology', `connection ${c.id} joins a region to itself`, { id: c.id }); continue; }
    if (c.type === 'rigidJoin') { frames.set(c.id, null); continue; }
    if (!c.edge || !c.edge.p0 || !c.edge.p1) { err('invalidTopology', `connection ${c.id} needs an edge`, { id: c.id }); continue; }
    const length = dist([...c.edge.p0, 0], [...c.edge.p1, 0]);
    if (length < 1e-9) { err('invalidTopology', `connection ${c.id} has a zero-length edge`, { id: c.id }); continue; }
    const isBand = c.type === 'circularBand' || c.type === 'segmentedBand';
    if (isBand && !(c.lengthMm > 0)) {
      err('invalidTopology', `${c.type} ${c.id} needs lengthMm > 0`, { id: c.id }); continue;
    }
    let profile = null;
    if (c.type === 'segmentedBand') {
      profile = bendProfile(c.profile, c.segments || 8);
      if (profile.length < 2) { err('invalidTopology', `segmentedBand ${c.id} needs >= 2 segments`, { id: c.id }); continue; }
    }
    // Canonical orientation: child region B on the left of u (so +angle = valley).
    let p0 = [c.edge.p0[0], c.edge.p0[1], 0], p1 = [c.edge.p1[0], c.edge.p1[1], 0];
    let u = unit(sub(p1, p0));
    let v = [-u[1], u[0], 0];
    const cb = c.edge.sideB || centroid2(B.polygon); // sideB: a flat point of B adjacent to the edge (non-convex regions)
    const side = dot(sub([cb[0], cb[1], 0], p0), v);
    if (Math.abs(side) < 1e-9) warn('degenerateSide', `connection ${c.id}: child region is on the edge line`, { id: c.id });
    let flipped = false;
    if (side < 0) { u = scale(u, -1); v = scale(v, -1); p0 = p1; flipped = true; }
    frames.set(c.id, { o: p0, u, v, lengthMm: isBand ? c.lengthMm : 0, profile, flipped, edgeLen: length });
  }

  // Spanning tree (BFS from the anchor). Remaining connections close loops.
  const anchor = assembly.anchor && regionIndex.has(assembly.anchor) ? assembly.anchor : [...regionIndex.keys()][0];
  if (assembly.anchor && !regionIndex.has(assembly.anchor)) err('staleReferences', `anchor ${assembly.anchor} not found`);
  const adj = new Map([...regionIndex.keys()].map(k => [k, []]));
  for (const c of connIndex.values()) {
    if (!regionIndex.has(c.a) || !regionIndex.has(c.b) || c.a === c.b) continue;
    adj.get(c.a).push(c); adj.get(c.b).push(c);
  }
  const tree = [];
  const treeConnIds = new Set();
  const seen = new Set([anchor]);
  const queue = [anchor];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of adj.get(cur) || []) {
      if (treeConnIds.has(c.id)) continue;
      const other = c.a === cur ? c.b : c.a;
      if (seen.has(other)) continue;
      seen.add(other); queue.push(other);
      treeConnIds.add(c.id);
      tree.push({ connId: c.id, parent: cur, child: other, reversed: c.b === cur });
    }
  }
  for (const id of regionIndex.keys()) {
    if (!seen.has(id)) err('unanchoredComponent', `region ${id} is not connected to the anchor`, { id });
  }
  const closureConnIds = [...connIndex.values()].filter(c => !treeConnIds.has(c.id) && frames.has(c.id)).map(c => c.id);
  const variableConnIds = [...connIndex.values()].filter(c => c.type !== 'rigidJoin').map(c => c.id);
  const varIndex = new Map(variableConnIds.map((id, i) => [id, i]));

  // Characteristic length for residual normalisation.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of regionIndex.values()) for (const p of r.polygon || []) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const scaleMm = Number.isFinite(maxX) ? Math.max(maxX - minX, maxY - minY, 1e-6) : 1;

  return {
    ok: !issues.some(i => i.level === 'error'),
    issues, assembly, regionIndex, connIndex, frames,
    anchor, tree, treeConnIds, closureConnIds, variableConnIds, varIndex, scaleMm,
    hash: geometryHash(assembly),
  };
}

// Content hash of everything that affects solving (not of authored sequences).
export function geometryHash(assembly) {
  const payload = JSON.stringify({
    u: assembly.units, a: assembly.anchor,
    r: (assembly.regions || []).map(r => [r.id, r.polygon, r.thicknessMm ?? null]),
    c: (assembly.connections || []).map(c => [c.id, c.type, c.a, c.b, c.edge ?? null, c.lengthMm ?? null, c.widthMm ?? null, c.profile ?? null, c.segments ?? null]),
  });
  // FNV-1a 64-bit-ish using two 32-bit lanes; deterministic and dependency-free.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch, 0x85ebca6b) >>> 0;
  }
  return `fnv:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function connectionPose(compiled, connId, theta) {
  const f = compiled.frames.get(connId);
  if (!f) return { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }; // rigidJoin
  return bandPose(f, theta);
}

// Planar slicer. Uses the manifold kernel (the same one FacetFold builds geometry with) to cut each layer and to
// do the polygon booleans/offsets, then plans walls, solid skin and sparse infill per layer.
//
// This is a preview/automation slicer: walls + rectilinear infill, no gap fill, no overhang/bridge handling,
// no seam control, no pressure advance. For a production print use the same profile with an external slicer
// (see `toPrusaIni`, scripts/slice.mjs) and run its G-code through `analyzeGcode`.

import { resolveProfile } from './profile.js';

/** Plain { positions, indices } mesh (e.g. from an STL) -> a manifold (merges duplicate vertices). */
export function meshToManifold(K, { positions, indices }) {
  const m = new K.Mesh({ numProp: 3, vertProperties: Float32Array.from(positions), triVerts: Uint32Array.from(indices) });
  m.merge();
  const man = K.Manifold.ofMesh(m);
  if (man.status() !== 'NoError') throw new Error(`mesh is not a closed manifold (${man.status()})`);
  return man;
}

/** Layer stack: z is the layer top, the section is cut at mid-height. */
export function sliceLayers(K, manifold, prof) {
  const p = resolveProfile(prof), bb = manifold.boundingBox(), layers = [];
  let z = bb.min[2];
  for (let i = 0; z < bb.max[2] - 1e-6; i++) {
    const h = Math.min(i === 0 ? p.firstLayerHeightMm : p.layerHeightMm, bb.max[2] - z);
    if (h < 1e-3) break;
    layers.push({ index: i, z: z + h, h, cs: manifold.slice(z + h / 2) });
    z += h;
  }
  return { layers, bbox: { min: bb.min, max: bb.max } };
}

const rot = (pt, c, s) => [pt[0] * c - pt[1] * s, pt[0] * s + pt[1] * c];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Scanline hatch of a polygon set (even-odd). Returns segments [[x0,y0],[x1,y1]] in model space, boustrophedon ordered. */
export function hatch(polygons, spacing, angleRad) {
  const c = Math.cos(-angleRad), s = Math.sin(-angleRad), ci = Math.cos(angleRad), si = Math.sin(angleRad);
  const polys = polygons.map(poly => poly.map(p => rot(p, c, s)));
  let y0 = Infinity, y1 = -Infinity;
  for (const poly of polys) for (const p of poly) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const out = []; let flip = false;
  // lines sit on a global grid so successive layers' infill stacks consistently
  for (let y = Math.ceil(y0 / spacing) * spacing; y <= y1; y += spacing) {
    const xs = [];
    for (const poly of polys) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    const row = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-3) row.push([[xs[i], y], [xs[i + 1], y]]);
    if (flip) { row.reverse(); row.forEach(sg => sg.reverse()); }
    flip = !flip;
    for (const sg of row) out.push(sg.map(q => rot(q, ci, si)));
  }
  return out;
}

const closeLoop = poly => [...poly, poly[0]];

/** Douglas–Peucker on a polyline; a closed path (first = last) is split at its farthest point first. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const d = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return l < 1e-12 ? dist(p, a) : Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / l; };
  const rec = (a, b) => {   // indices, exclusive of the end point
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const v = d(pts[i], pts[a], pts[b]); if (v > md) { md = v; m = i; } }
    return m < 0 ? [pts[a]] : [...rec(a, m), ...rec(m, b)];
  };
  const last = pts.length - 1;
  if (dist(pts[0], pts[last]) < 1e-9) {
    let far = 1, fd = 0; pts.forEach((q, i) => { const v = dist(q, pts[0]); if (v > fd) { fd = v; far = i; } });
    return [...rec(0, far), ...rec(far, last), pts[last]];
  }
  return [...rec(0, last), pts[last]];
}

/** Start a loop at the vertex nearest `from` (shorter travel, and spreads the seam). */
function startNear(loop, from) {
  if (!from) return loop;
  let bi = 0, bd = Infinity;
  loop.forEach((q, i) => { const d = dist(q, from); if (d < bd) { bd = d; bi = i; } });
  return [...loop.slice(bi), ...loop.slice(0, bi)];
}

function orderLoops(loops, from) {
  const left = loops.slice(), out = []; let cur = from;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((l, i) => { const d = cur ? Math.min(...l.map(q => dist(q, cur))) : i; if (d < bd) { bd = d; bi = i; } });
    const l = startNear(left.splice(bi, 1)[0], cur), sl = simplify(closeLoop(l), 0.015); out.push(sl); cur = l[0];
  }
  return out;
}

function orderSegments(segs, from) {
  const left = segs.slice(), out = []; let cur = from;
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false;
    for (let i = 0; i < left.length; i++) {
      const d0 = cur ? dist(left[i][0], cur) : i, d1 = cur ? dist(left[i][1], cur) : Infinity;
      if (d0 < bd) { bd = d0; bi = i; rev = false; }
      if (d1 < bd) { bd = d1; bi = i; rev = true; }
      if (bd < 1e-6) break;
    }
    const sg = left.splice(bi, 1)[0]; if (rev) sg.reverse(); out.push(sg); cur = sg[1];
  }
  return out;
}

/**
 * Plan one layer. `K` = kernel, `layers` = from sliceLayers, `i` = layer index.
 * @returns {{ paths: {type, pts}[], lostAreaMm2: number }} paths are in model space, extrusion order.
 *   lostAreaMm2 = section area narrower than one extrusion width (not printed).
 */
export function planLayer(K, layers, i, prof) {
  const p = resolveProfile(prof), w = p.lineWidthMm, cs = layers[i].cs;
  const paths = []; let from = null;
  if (cs.isEmpty()) return { paths, lostAreaMm2: 0 };

  // wall k is inset w/2 + k·w; print inside-out so the visible outer wall is laid last
  const wallSets = [];
  for (let k = 0; k < p.walls; k++) {
    const ring = cs.offset(-(w / 2 + k * w), 'Round', 2, 12);
    if (ring.isEmpty()) break;
    wallSets.push(ring.toPolygons());
  }
  const outer = cs.offset(-w / 2, 'Round', 2, 12);
  const lost = Math.max(0, cs.area() - (outer.isEmpty() ? 0 : outer.offset(w / 2, 'Round', 2, 12).area()));
  for (let k = wallSets.length - 1; k >= 0; k--) {
    const loops = orderLoops(wallSets[k], from);
    for (const l of loops) paths.push({ type: k === 0 ? 'outer' : 'inner', pts: l });
    if (loops.length) from = loops[loops.length - 1][0];
  }

  if (wallSets.length === p.walls) {
    const region = cs.offset(-(p.walls * w + 0.35 * w), 'Round', 2, 12);
    if (!region.isEmpty()) {
      const cover = dir => {
        let c = null;
        for (let j = 1; j <= (dir > 0 ? p.topLayers : p.bottomLayers); j++) {
          const n = layers[i + dir * j]; if (!n) return cs.subtract(cs);
          c = c ? c.intersect(n.cs) : n.cs;
        }
        return c || cs;
      };
      const exposed = cs.subtract(cover(1)).add(cs.subtract(cover(-1)));
      const solid = exposed.isEmpty() ? exposed : exposed.offset(w, 'Round', 2, 12).intersect(region);
      const sparse = solid.isEmpty() ? region : region.subtract(solid);
      const ang = (i % 2 ? 135 : 45) * Math.PI / 180;
      if (!solid.isEmpty()) for (const sg of orderSegments(hatch(solid.toPolygons(), w * 0.98, ang), from)) { paths.push({ type: 'solid', pts: sg }); from = sg[1]; }
      if (p.infillPct > 0 && !sparse.isEmpty()) {
        for (const sg of orderSegments(hatch(sparse.toPolygons(), w / (p.infillPct / 100), ang), from)) { paths.push({ type: 'sparse', pts: sg }); from = sg[1]; }
      }
    }
  }
  return { paths, lostAreaMm2: lost };
}

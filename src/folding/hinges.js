// Finite-width printed hinges.
//
// An ideal crease has no width; a printed hinge is a thin band of width w and
// thickness t_h between thicker panels. expandHingeWidths() turns each ideal hinge
// that has a `widthMm` into a circularBand of free length w centred on the original
// crease, and trims the panels back by w/2 on each side so the geometry does not
// overlap. Where strips from different creases overlap (vertices) there is no valid
// band geometry: those junctions are reported, never silently thickened.

import polygonClipping from 'polygon-clipping';
import { sub, unit } from './math.js';

const ring = poly => { const r = poly.map(p => [p[0], p[1]]); const f = r[0], l = r.at(-1); if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]); return r; };
const polyArea = mp => mp.reduce((s, poly) => s + poly.reduce((a, rg, i) => {
  let x = 0; for (let k = 0; k + 1 < rg.length; k++) x += rg[k][0] * rg[k + 1][1] - rg[k + 1][0] * rg[k][1];
  return a + (i === 0 ? Math.abs(x) / 2 : -Math.abs(x) / 2);
}, 0), 0);

function stripPolygon(p0, p1, normal, halfWidth) {
  const a = [p0[0] - normal[0] * halfWidth, p0[1] - normal[1] * halfWidth];
  const b = [p1[0] - normal[0] * halfWidth, p1[1] - normal[1] * halfWidth];
  const c = [p1[0] + normal[0] * halfWidth, p1[1] + normal[1] * halfWidth];
  const d = [p0[0] + normal[0] * halfWidth, p0[1] + normal[1] * halfWidth];
  return [a, b, c, d];
}

/**
 * @param assembly   assembly with idealHinge connections carrying widthMm
 * @param opts       { hingeThicknessMm, defaultWidthMm }
 * @returns { assembly, issues, strips }  new assembly (input untouched)
 */
export function expandHingeWidths(assembly, opts = {}) {
  const out = JSON.parse(JSON.stringify(assembly));
  const issues = [];
  const regions = new Map(out.regions.map(r => [r.id, r]));
  const strips = [];
  for (const c of out.connections) {
    const w = c.widthMm ?? opts.defaultWidthMm ?? 0;
    if (c.type !== 'idealHinge' || !(w > 0)) continue;
    const B = regions.get(c.b);
    const p0 = c.edge.p0, p1 = c.edge.p1;
    const u = unit([p1[0] - p0[0], p1[1] - p0[1], 0]);
    let n = [-u[1], u[0]];                                   // normal; make it point toward B
    const side = c.edge.sideB || B.polygon.reduce((s, p) => [s[0] + p[0] / B.polygon.length, s[1] + p[1] / B.polygon.length], [0, 0]);
    if ((side[0] - p0[0]) * n[0] + (side[1] - p0[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const shift = [n[0] * w / 2, n[1] * w / 2];
    // Band starts on A's trimmed edge (crease − w/2) and is w long toward B.
    c.type = 'circularBand';
    c.lengthMm = w;
    c.edge = { p0: sub(p0, shift), p1: sub(p1, shift), sideB: c.edge.sideB };
    c.thicknessMm = opts.hingeThicknessMm ?? c.thicknessMm;
    c.source = { ...(c.source || {}), idealCrease: { p0, p1 } };
    strips.push({ id: c.id, polygon: stripPolygon(p0, p1, n, w / 2), a: c.a, b: c.b });
  }
  // Trim panels so they do not overlap their hinge strips.
  for (const r of out.regions) {
    const mine = strips.filter(s => s.a === r.id || s.b === r.id);
    if (!mine.length) continue;
    const polys = (r.polygons && r.polygons.length ? r.polygons : [r.polygon]).map(p => [ring(p)]);
    let remain = polys;
    for (const s of mine) remain = remain.flatMap(p => polygonClipping.difference(p, [ring(s.polygon)]));
    const parts = remain.flatMap(mp => (Array.isArray(mp[0][0][0]) ? mp : [mp])).map(mp => mp[0].slice(0, -1));
    if (parts.length) { r.polygons = parts; r.polygon = parts[0]; }
    else issues.push({ level: 'error', code: 'hingeConsumesPanel', region: r.id, message: `hinge strips consume all of region ${r.id}` });
  }
  // Overlapping strips -> junction needs explicit geometry.
  for (let i = 0; i < strips.length; i++) for (let j = i + 1; j < strips.length; j++) {
    const ov = polygonClipping.intersection([ring(strips[i].polygon)], [ring(strips[j].polygon)]);
    if (ov.length && polyArea(ov) > 1e-6) {
      issues.push({ level: 'warning', code: 'hingeJunction', hinges: [strips[i].id, strips[j].id], overlapMm2: polyArea(ov),
        message: `hinge bands ${strips[i].id} and ${strips[j].id} overlap; explicit junction geometry is required` });
    }
  }
  return { assembly: out, issues, strips };
}

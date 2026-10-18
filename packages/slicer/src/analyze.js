// Geometry-based nozzle analysis. For a candidate nozzle the extrusion width is w = nozzle × factor, so any part
// of a cross-section narrower than w cannot be printed by a wall and is lost, and anything under 2w gets a
// single line instead of two walls. We measure that with morphological opening: shrink the section by w/2 then
// grow it back; what disappears is the detail that nozzle cannot print.

import { NOZZLES } from './profile.js';

/**
 * @param {object} K kernel   @param {Manifold} manifold   @param {object} opts
 *   nozzles, lineWidthFactor, samples (max layers cut), tolerancePct (area lost that is acceptable)
 * @returns {{ table, recommended, samples }}
 */
export function analyzeNozzles(K, manifold, { nozzles = NOZZLES, lineWidthFactor = 1.125, samples = 40, tolerancePct = 0.5, thinTolerancePct = 8, layerHeightRatio = 0.5, maxLayerHeightMm = Infinity } = {}) {
  const bb = manifold.boundingBox(), zmin = bb.min[2], H = bb.max[2] - zmin;
  const n = Math.max(1, Math.min(samples, Math.ceil(H / 0.05)));
  const sections = [];
  for (let i = 0; i < n; i++) { const cs = manifold.slice(zmin + ((i + 0.5) / n) * H); if (!cs.isEmpty()) sections.push({ z: zmin + ((i + 0.5) / n) * H, cs, area: cs.area() }); }
  const total = sections.reduce((s, x) => s + x.area, 0) || 1;
  const open = (cs, r) => { const a = cs.offset(-r, 'Round', 2, 12); return a.isEmpty() ? 0 : a.offset(r, 'Round', 2, 12).area(); };
  const table = nozzles.map(nz => {
    const w = nz * lineWidthFactor; let lost = 0, thin = 0, worst = { pct: 0, z: null };
    for (const s of sections) {
      const l = Math.max(0, s.area - open(s.cs, w / 2)), t = Math.max(0, s.area - open(s.cs, w));
      lost += l; thin += t;
      if (s.area > 0 && (100 * l) / s.area > worst.pct) worst = { pct: (100 * l) / s.area, z: s.z };
    }
    const layerH = +(nz * layerHeightRatio).toFixed(3);
    return { nozzleMm: nz, lineWidthMm: +w.toFixed(3), layerHeightMm: layerH, lostPct: +((100 * lost) / total).toFixed(3), thinPct: +((100 * thin) / total).toFixed(2), worstLayer: worst.z === null ? null : { zMm: +worst.z.toFixed(2), lostPct: +worst.pct.toFixed(2) },
      layers: Math.ceil(H / layerH), relativeTime: 1 / (nz * layerH) };
  });
  const base = table.reduce((m, r) => Math.min(m, r.relativeTime), Infinity);
  table.forEach(r => { r.relativeTime = +(r.relativeTime / base).toFixed(2); r.layerOk = r.layerHeightMm <= maxLayerHeightMm * 1.25; r.ok = r.lostPct <= tolerancePct && r.layerOk; r.thinWarn = r.thinPct > thinTolerancePct; });
  const ok = table.filter(r => r.ok && !r.thinWarn), pool = ok.length ? ok : table.filter(r => r.ok);
  const recommended = pool.length ? pool.reduce((a, b) => (b.nozzleMm > a.nozzleMm ? b : a)) : table.reduce((a, b) => (b.lostPct < a.lostPct ? b : a));
  const zNote = Number.isFinite(maxLayerHeightMm) ? ` and a layer height within ${maxLayerHeightMm} mm of the thinnest vertical feature` : '';
  const reason = !pool.length ? `no listed nozzle keeps lost detail under ${tolerancePct}%${zNote}; ${recommended.nozzleMm} mm loses the least (${recommended.lostPct}%)` : ok.length
    ? `largest nozzle that loses ≤ ${tolerancePct}% of the section and keeps single-line areas ≤ ${thinTolerancePct}%${zNote}`
    : `largest nozzle that loses ≤ ${tolerancePct}%, but ${recommended.thinPct}% of the section is single-line thin — expect weak walls there`;
  return { table, recommended: { ...recommended, reason }, samples: sections.length, heightMm: H };
}

/** The part of a section a nozzle cannot print, as a CrossSection (for drawing in the viewer). */
export function unprintableRegion(K, cs, nozzleMm, lineWidthFactor = 1.125) {
  const r = (nozzleMm * lineWidthFactor) / 2, a = cs.offset(-r, 'Round', 2, 12);
  return a.isEmpty() ? cs : cs.subtract(a.offset(r, 'Round', 2, 12));
}

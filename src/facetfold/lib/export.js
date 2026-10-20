// Exports and the printability report.

import { exportSTL } from '@hyphi/folding/export';
import { bendStrainEstimate } from '@hyphi/folding/bends/surface';
import { meshOf } from './kernel.js';
import { describe } from './solid.js';
import { buildZip } from '../../lib/zip.js';

/** Binary STL (mm) for one printed piece. */
export function pieceSTL(manifold, name = 'piece') { return exportSTL(meshOf(manifold), { name }); }

// Strain bands for a thin flexure folded ONCE. Indicative only: real limits depend on the filament, print
// temperature, layer adhesion and print direction. PETG is a middle case; PLA and PVB are brittle (assumed, not measured);
// TPU is elastic far beyond what a fold needs. Test a printed hinge before trusting any of these.
export const STRAIN_BANDS_BY_MATERIAL = Object.freeze({
  PETG: { elastic: 0.02, yields: 0.06, cracks: 0.12 },
  PLA: { elastic: 0.01, yields: 0.03, cracks: 0.06 },
  PVB: { elastic: 0.01, yields: 0.03, cracks: 0.06 },
  TPU: { elastic: 0.15, yields: 0.5, cracks: 1.0 },
});
export const bandsFor = material => STRAIN_BANDS_BY_MATERIAL[String(material).startsWith('PETG') ? 'PETG' : material] || STRAIN_BANDS_BY_MATERIAL.PETG;
export const STRAIN_BANDS = STRAIN_BANDS_BY_MATERIAL.PETG;

export function classifyStrain(e, material = 'PETG') {
  const b = bandsFor(material);
  if (e <= b.elastic) return 'elastic';
  if (e <= b.yields) return 'yields-once';
  if (e <= b.cracks) return 'likely-whitens';
  return 'likely-cracks';
}

/** Outer-fibre strain for each hinge: (t_h/2)·κ with κ = φ/w (arc of length w bent through φ). */
export function hingeStrains(net, material = 'PETG') {
  const { hingeThicknessMm: th, hingeWidthMm: w } = net.params;
  return net.hinges.map(h => { const eps = bendStrainEstimate(th, h.phi / w); return { key: h.key, phiDeg: (h.phi * 180) / Math.PI, strain: eps, band: classifyStrain(eps, material) }; });
}

/** Suggest the narrowest hinge width that keeps the worst hinge within a strain limit. */
export function minHingeWidthMm(net, maxStrain, material = 'PETG') {
  maxStrain ??= bandsFor(material).yields;
  const phi = Math.max(...net.hinges.map(h => h.phi));
  return (net.params.hingeThicknessMm / 2) * phi / maxStrain;
}

/**
 * Everything a person needs to decide whether to print: geometry, verification, issues, strain, snaps, surfaces, fit.
 */
export function buildReport(net, verification, plate, { bedMm = [256, 256], process = 'fdm04', material = 'PETG' } = {}) {
  const issues = [...(verification?.issues || []), ...(plate?.issues || [])];
  const strains = hingeStrains(net, material);
  const worst = strains.reduce((m, s) => (s.strain > m.strain ? s : m), { strain: 0 });
  if (worst.band === 'likely-cracks' || worst.band === 'likely-whitens') {
    issues.push({ level: 'warning', code: 'hingeStrain', message: `worst hinge strain ≈ ${(worst.strain * 100).toFixed(0)}% (${worst.band}) at a ${worst.phiDeg.toFixed(0)}° fold. A hinge width of ≥ ${minHingeWidthMm(net, undefined, material).toFixed(1)} mm or a thinner flexure keeps it near the yield zone. Fold once, don't flex repeatedly.` });
  }
  const fit = net.components.map((c, i) => ({ piece: i, widthMm: c.bbox.w, heightMm: c.bbox.h, fits: c.bbox.w <= bedMm[0] && c.bbox.h <= bedMm[1] || c.bbox.w <= bedMm[1] && c.bbox.h <= bedMm[0] }));
  for (const f of fit) if (!f.fits) issues.push({ level: 'error', code: 'bedFit', message: `piece ${f.piece} is ${f.widthMm.toFixed(0)} × ${f.heightMm.toFixed(0)} mm — larger than the ${bedMm[0]} × ${bedMm[1]} mm bed. Cut a hinge (make it a seam) to split the net, or reduce the edge length.` });
  const pieces = plate ? plate.components.map((m, i) => ({ piece: i, ...describe(m) })) : [];
  return {
    params: net.params,
    counts: { faces: net.faces.length, hinges: net.hinges.length, seams: net.seams.length, pieces: net.components.length },
    foldAnglesDeg: [...new Set(net.edges.map(e => +((e.phi * 180) / Math.PI).toFixed(3)))].sort((a, b) => a - b),
    verification: verification ? { ok: verification.ok, maxFaceErrorMm: verification.maxFaceErrorMm, maxSeamGapMm: verification.maxSeamGapMm, closedCollisions: verification.collisions?.length ?? 0, closingPathCollisionFree: verification.pathCollisionFree, method: verification.pathMethod } : null,
    strains, worstHingeStrain: worst, fit, pieces, material,
    snaps: plate ? { detents: plate.snaps.plan.length, params: plate.snaps.params } : null,
    surfaces: plate?.surfaceReport ?? [], process,
    issues,
    disclaimer: 'Geometry and fit are computed; material behaviour (hinge life, snap force, light transmission) is not. Print a test piece. STL output is not asserted print-ready.',
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const hexA = h => `#${h.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)}FF`;

/**
 * 3MF (core spec, millimetres) with one object per colour body, a base-material colour per object, and a
 * Bambu/Orca-style extruder map as best-effort metadata. Returns the zip bytes.
 * Not verified in any slicer from here: check that colours/extruders import as expected.
 * @param bodies [{ piece, color, manifold }]
 * @param palette [{ name, hex }]
 */
export function export3MF(bodies, palette, { name = 'facetfold' } = {}) {
  const used = [...new Set(bodies.map(b => b.color))].sort((a, b) => a - b);
  const slot = new Map(used.map((c, i) => [c, i]));
  let objects = '', items = '', cfg = '';
  bodies.forEach((b, i) => {
    const id = i + 2, m = meshOf(b.manifold), P = m.positions, I = m.indices;
    const verts = []; for (let v = 0; v < P.length; v += 3) verts.push(`<vertex x="${P[v].toFixed(5)}" y="${P[v + 1].toFixed(5)}" z="${P[v + 2].toFixed(5)}"/>`);
    const tris = []; for (let t = 0; t < I.length; t += 3) tris.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>`);
    const nm = `piece${b.piece + 1}-${palette[b.color]?.name ?? 'color' + b.color}`;
    objects += `<object id="${id}" name="${esc(nm)}" type="model" pid="1" pindex="${slot.get(b.color)}"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`;
    items += `<item objectid="${id}"/>`;
    cfg += `<object id="${id}"><metadata key="name" value="${esc(nm)}"/><metadata key="extruder" value="${slot.get(b.color) + 1}"/></object>`;
  });
  const mats = used.map(c => `<base name="${esc(palette[c]?.name ?? 'Color ' + c)}" displaycolor="${hexA(palette[c]?.hex ?? '#cccccc')}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(name)}</metadata><metadata name="Application">hyphi-tools FacetFold</metadata><resources><basematerials id="1">${mats}</basematerials>${objects}</resources><build>${items}</build></model>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    '3D/3dmodel.model': model,
    'Metadata/model_settings.config': `<?xml version="1.0" encoding="UTF-8"?>\n<config>${cfg}</config>`,
  };
  return { bytes: buildZip(files), slots: used.map(c => ({ slot: slot.get(c) + 1, color: c, name: palette[c]?.name, hex: palette[c]?.hex })), objects: bodies.length };
}

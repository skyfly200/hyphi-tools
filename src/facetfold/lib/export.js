// Exports and the printability report.

import { exportSTL } from '@hyphi/folding/export';
import { bendStrainEstimate } from '@hyphi/folding/bends/surface';
import { meshOf } from './kernel.js';
import { describe } from './solid.js';

/** Binary STL (mm) for one printed piece. */
export function pieceSTL(manifold, name = 'piece') { return exportSTL(meshOf(manifold), { name }); }

// Strain bands for a thin PETG-like flexure folded ONCE. Indicative only: real limits depend on the filament,
// print temperature, layer adhesion and print direction. Test a printed hinge before trusting it.
export const STRAIN_BANDS = Object.freeze({ elastic: 0.02, yields: 0.06, cracks: 0.12 });

export function classifyStrain(e) {
  if (e <= STRAIN_BANDS.elastic) return 'elastic';
  if (e <= STRAIN_BANDS.yields) return 'yields-once';
  if (e <= STRAIN_BANDS.cracks) return 'likely-whitens';
  return 'likely-cracks';
}

/** Outer-fibre strain for each hinge: (t_h/2)·κ with κ = φ/w (arc of length w bent through φ). */
export function hingeStrains(net) {
  const { hingeThicknessMm: th, hingeWidthMm: w } = net.params;
  return net.hinges.map(h => { const eps = bendStrainEstimate(th, h.phi / w); return { key: h.key, phiDeg: (h.phi * 180) / Math.PI, strain: eps, band: classifyStrain(eps) }; });
}

/** Suggest the narrowest hinge width that keeps the worst hinge within a strain limit. */
export function minHingeWidthMm(net, maxStrain = STRAIN_BANDS.yields) {
  const phi = Math.max(...net.hinges.map(h => h.phi));
  return (net.params.hingeThicknessMm / 2) * phi / maxStrain;
}

/**
 * Everything a person needs to decide whether to print: geometry, verification, issues, strain, snaps, surfaces, fit.
 */
export function buildReport(net, verification, plate, { bedMm = [256, 256], process = 'fdm04' } = {}) {
  const issues = [...(verification?.issues || []), ...(plate?.issues || [])];
  const strains = hingeStrains(net);
  const worst = strains.reduce((m, s) => (s.strain > m.strain ? s : m), { strain: 0 });
  if (worst.band === 'likely-cracks' || worst.band === 'likely-whitens') {
    issues.push({ level: 'warning', code: 'hingeStrain', message: `worst hinge strain ≈ ${(worst.strain * 100).toFixed(0)}% (${worst.band}) at a ${worst.phiDeg.toFixed(0)}° fold. A hinge width of ≥ ${minHingeWidthMm(net).toFixed(1)} mm or a thinner flexure keeps it near the yield zone. Fold once, don't flex repeatedly.` });
  }
  const fit = net.components.map((c, i) => ({ piece: i, widthMm: c.bbox.w, heightMm: c.bbox.h, fits: c.bbox.w <= bedMm[0] && c.bbox.h <= bedMm[1] || c.bbox.w <= bedMm[1] && c.bbox.h <= bedMm[0] }));
  for (const f of fit) if (!f.fits) issues.push({ level: 'error', code: 'bedFit', message: `piece ${f.piece} is ${f.widthMm.toFixed(0)} × ${f.heightMm.toFixed(0)} mm — larger than the ${bedMm[0]} × ${bedMm[1]} mm bed. Cut a hinge (make it a seam) to split the net, or reduce the edge length.` });
  const pieces = plate ? plate.components.map((m, i) => ({ piece: i, ...describe(m) })) : [];
  return {
    params: net.params,
    counts: { faces: net.faces.length, hinges: net.hinges.length, seams: net.seams.length, pieces: net.components.length },
    foldAnglesDeg: [...new Set(net.edges.map(e => +((e.phi * 180) / Math.PI).toFixed(3)))].sort((a, b) => a - b),
    verification: verification ? { ok: verification.ok, maxFaceErrorMm: verification.maxFaceErrorMm, maxSeamGapMm: verification.maxSeamGapMm, closedCollisions: verification.collisions?.length ?? 0, closingPathCollisionFree: verification.pathCollisionFree, method: verification.pathMethod } : null,
    strains, worstHingeStrain: worst, fit, pieces,
    snaps: plate ? { detents: plate.snaps.plan.length, params: plate.snaps.params } : null,
    surfaces: plate?.surfaceReport ?? [], process,
    issues,
    disclaimer: 'Geometry and fit are computed; material behaviour (hinge life, snap force, light transmission) is not. Print a test piece. STL output is not asserted print-ready.',
  };
}

// Surface representation of a band/petal and distortion diagnostics.
//
// A centreline model cannot show that a wide strip is unstretched across its
// width. This builds the deformed surface of a cylindrical (developable) bend and
// measures how much every grid edge changed length relative to the flat sheet.

import { bandCenterline } from './circular.js';
import { dist } from '../math.js';

/**
 * Grid over a band of width `widthMm` (along the edge direction u) in the band's
 * local frame (x = along u, y = across, z = normal). Returns flat and deformed
 * points, row-major with `nu` columns (along u) and `nv` rows (along the band).
 */
export function bandSurfaceGrid({ lengthMm, widthMm, theta, profile = null, nu = 6, nv = 8 }) {
  const per = Math.max(1, Math.ceil(nv / (profile ? profile.length : 1)));
  const center = bandCenterline(lengthMm, theta, profile, per);
  const rows = center.length;
  const flat = [], bent = [];
  // arc length of the polyline at each row (flat parameter s)
  const s = [0];
  const flatStep = lengthMm / (rows - 1);
  for (let r = 1; r < rows; r++) s.push(r * flatStep);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < nu; c++) {
      const x = (widthMm * c) / (nu - 1);
      flat.push([x, s[r], 0]);
      bent.push([x, center[r][0], center[r][1]]);
    }
  }
  return { flat, bent, nu, nv: rows };
}

/** Relative edge-length change over a grid: longitudinal (along rows) and transverse (along columns). */
export function gridDistortion({ flat, bent, nu, nv }) {
  let lon = 0, tra = 0, lonSum = 0, traSum = 0, nl = 0, nt = 0;
  const at = (r, c) => r * nu + c;
  for (let r = 0; r < nv; r++) for (let c = 0; c < nu; c++) {
    if (r + 1 < nv) {
      const e = Math.abs(dist(bent[at(r, c)], bent[at(r + 1, c)]) / dist(flat[at(r, c)], flat[at(r + 1, c)]) - 1);
      lon = Math.max(lon, e); lonSum += e; nl++;
    }
    if (c + 1 < nu) {
      const e = Math.abs(dist(bent[at(r, c)], bent[at(r, c + 1)]) / dist(flat[at(r, c)], flat[at(r, c + 1)]) - 1);
      tra = Math.max(tra, e); traSum += e; nt++;
    }
  }
  return { maxLongitudinal: lon, maxTransverse: tra, meanLongitudinal: lon ? lonSum / nl : 0, meanTransverse: tra ? traSum / nt : 0 };
}

/** Generic mesh check for any deformed surface: flat vs deformed edge lengths. */
export function meshDistortion(flatPts, bentPts, edges) {
  let max = 0, sum = 0, worst = null;
  for (const [i, j] of edges) {
    const f = dist(flatPts[i], flatPts[j]);
    if (f < 1e-12) continue;
    const e = Math.abs(dist(bentPts[i], bentPts[j]) / f - 1);
    sum += e;
    if (e > max) { max = e; worst = [i, j]; }
  }
  return { max, mean: edges.length ? sum / edges.length : 0, worstEdge: worst };
}

/** First-order outer-fibre strain y/R for a bend (static estimate, not a reliability claim). */
export function bendStrainEstimate(thicknessMm, curvature, neutralOffsetMm = 0) {
  return (thicknessMm / 2 + Math.abs(neutralOffsetMm)) * Math.abs(curvature);
}

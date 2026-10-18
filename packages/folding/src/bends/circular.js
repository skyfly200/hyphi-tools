// Unified fold/bend transform for one connection.
//
// A connection lies along an edge of the parent region A. In flat material
// coordinates that edge passes through `o` with unit direction `u`; `v` is the
// in-plane unit normal pointing from A toward the child region B, and the third
// basis vector is +z. B's own edge sits at v-distance L (the free length of the
// band; L = 0 for an ideal hinge).
//
// The band's neutral surface bends as a circular arc of arc length L and bend
// angle θ about the edge direction u:
//     R = L / |θ|,  end-of-arc offset = (L·sinθ/θ) along v, (L·(1−cosθ)/θ) along z
// and B is rotated rigidly by θ about u. Positive θ is a valley fold (the B side
// rises toward +z), matching the FOLD convention.
//
// Because the transform is *derived from* L and θ, the band length is preserved
// by construction. We never position both panels first and draw an arc between.

import { basisMat, mulMat, mulVec, rotX, transposeMat, add, sub } from '../math.js';

// (1−cosθ)/θ and sinθ/θ with a Taylor series so L→finite and θ→0 stays stable.
export function sinc(t) {
  if (Math.abs(t) < 1e-4) { const t2 = t * t; return 1 - t2 / 6 + (t2 * t2) / 120; }
  return Math.sin(t) / t;
}
export function oneMinusCosOverT(t) {
  if (Math.abs(t) < 1e-4) { const t2 = t * t; return t / 2 - (t * t2) / 24 + (t * t2 * t2) / 720; }
  return (1 - Math.cos(t)) / t;
}

/**
 * Rigid transform F(θ) (flat frame → flat-bent frame) for a connection.
 * @param {{o:number[], u:number[], v:number[], lengthMm:number}} frame o,u,v are 3-vectors
 * @param {number} theta radians
 * @returns {{R:number[], t:number[]}} pose such that F(p) = R p + t
 */
export function bandPose(frame, theta) {
  const { o, u, v } = frame;
  const L = frame.lengthMm || 0;
  const prof = frame.profile; // segmentedBand: per-segment share of θ (sums to 1)
  const z = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const Bm = basisMat(u, v, z);
  const Rl = rotX(theta);
  const M = mulMat(mulMat(Bm, Rl), transposeMat(Bm));
  // local-frame offset of the arc end (relative to B's own edge at v = L):
  //   ℓ' = Rl (ℓ − (0,L,0)) + (0, yEnd, zEnd)
  let yEnd = L * sinc(theta), zEnd = L * oneMinusCosOverT(theta);
  if (prof) ({ y: yEnd, z: zEnd } = segmentedEnd(L, theta, prof));
  const shift = sub([0, yEnd, zEnd], mulVec(Rl, [0, L, 0]));
  const d0 = add(o, mulVec(Bm, shift)); // o + Basis·shift
  const Mo = mulVec(M, o);
  return { R: M, t: sub(d0, Mo) };
}

/** Radius of the neutral-surface arc; Infinity when straight. */
export function bandRadius(lengthMm, theta) {
  return Math.abs(theta) < 1e-12 ? Infinity : lengthMm / Math.abs(theta);
}

/** Straight-line distance between the two ends of the arc (chord). */
export function bandChord(lengthMm, theta) {
  return lengthMm * Math.abs(sinc(theta / 2));
}


/**
 * End point of a segmented band's neutral line in the band's (y, z) plane.
 * Each of the N equal-length segments is itself a circular arc of arc length L/N
 * bending by θ·profile[i]. A uniform profile reproduces the circular band exactly;
 * a non-uniform profile concentrates curvature (e.g. petal tip curl). Total arc
 * length is L for every θ and profile.
 */
export function segmentedEnd(L, theta, profile) {
  const ell = L / profile.length;
  let y = 0, z = 0, alpha = 0;
  for (const w of profile) {
    const phi = theta * w;
    const chord = ell * sinc(phi / 2);
    y += chord * Math.cos(alpha + phi / 2);
    z += chord * Math.sin(alpha + phi / 2);
    alpha += phi;
  }
  return { y, z };
}

/** Normalised per-segment profile from a preset name or explicit weights. */
export function bendProfile(spec, n = 8) {
  let w;
  if (Array.isArray(spec)) w = spec.slice();
  else if (spec === 'tip') w = Array.from({ length: n }, (_, i) => (i + 1));
  else if (spec === 'root') w = Array.from({ length: n }, (_, i) => (n - i));
  else w = new Array(n).fill(1);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map(x => x / sum);
}

/**
 * Sample the neutral line of a band (circular or segmented) as 2D points in the
 * band's (y, z) frame; `perSegment` points per segment. Used for rendering,
 * sections and refinement checks.
 */
export function bandCenterline(L, theta, profile = null, perSegment = 8) {
  const prof = profile || [1];
  const ell = L / prof.length;
  const pts = [[0, 0]];
  let y = 0, z = 0, alpha = 0;
  for (const w of prof) {
    const phi = theta * w;
    for (let k = 1; k <= perSegment; k++) {
      const part = ell / perSegment;
      // integrate arcs of length `part` bending a/perSegment each
      const d = phi / perSegment;
      const chord = part * sinc(d / 2);
      const dirA = alpha + (phi * (k - 1)) / perSegment + d / 2;
      y += chord * Math.cos(dirA); z += chord * Math.sin(dirA);
      pts.push([y, z]);
    }
    alpha += phi;
  }
  return pts;
}

/** Peak curvature (1/mm) of a band at bend angle θ. */
export function bandMaxCurvature(L, theta, profile = null) {
  const prof = profile || [1];
  const ell = L / prof.length;
  return Math.abs(theta) * Math.max(...prof.map(Math.abs)) / ell;
}

/** Largest |θ| a band may take without exceeding 1/minRadius anywhere. */
export function bandAngleLimit(L, minRadiusMm, profile = null) {
  const prof = profile || [1];
  const ell = L / prof.length;
  return ell / (minRadiusMm * Math.max(...prof.map(Math.abs)));
}

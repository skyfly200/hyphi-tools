// Surface treatments for the OUTER (bed-side) face of each panel.
//
// Every face prints outer-side-down, so whatever the first layer touches becomes the visible surface:
//   • a textured build sheet gives a diffuse, frosted skin on translucent PETG;
//   • micro-grooves cut into the first layer(s) give coarse relief (≥ the printer's resolution);
//   • true holographic DIFFRACTION needs groove periods of roughly 0.5–3 µm — far below anything a
//     filament or resin printer can produce — so for that this module produces a vector / heightmap
//     PRESCRIPTION for an imprint master or a film, and tells you plainly what the printer can do.
// Nothing here pretends otherwise: assessSurface() compares the requested feature against a process table.

// ── physics ────────────────────────────────────────────────────────────────
/** Diffraction angle (degrees) of order m for a grating of period `pitchUm`; null if that order is evanescent. */
export function diffractionAngleDeg(pitchUm, lambdaNm, incidentDeg = 0, order = 1) {
  const s = Math.sin((incidentDeg * Math.PI) / 180) + (order * lambdaNm * 1e-3) / pitchUm;
  return Math.abs(s) <= 1 ? (Math.asin(s) * 180) / Math.PI : null;
}

/** Angular spread of the first order between two wavelengths (a measure of visible colour separation). */
export function dispersionDeg(pitchUm, l1 = 450, l2 = 650, incidentDeg = 0) {
  const a = diffractionAngleDeg(pitchUm, l1, incidentDeg), b = diffractionAngleDeg(pitchUm, l2, incidentDeg);
  return a === null || b === null ? null : Math.abs(b - a);
}

/** The coarsest period that still separates colours by at least `minSpreadDeg` (default 5°) at normal incidence. */
export function maxPitchForDispersionUm(minSpreadDeg = 5) {
  let lo = 0.66, hi = 50;                              // below 0.65 µm the 650 nm first order is evanescent
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, d = dispersionDeg(mid); if (d !== null && d >= minSpreadDeg) lo = mid; else hi = mid; }
  return lo;
}

// ── processes ──────────────────────────────────────────────────────────────
export const PROCESSES = Object.freeze({
  fdm04:  { id: 'fdm04',  label: 'FDM, 0.4 mm nozzle',        minPitchUm: 800,  minDepthUm: 100, canCarry: 'relief', note: 'Lines are as wide as the nozzle (~0.4 mm); first layer ~0.2 mm.' },
  fdm025: { id: 'fdm025', label: 'FDM, 0.25 mm nozzle',       minPitchUm: 500,  minDepthUm: 60,  canCarry: 'relief', note: 'Fine nozzle, 0.05–0.1 mm layers.' },
  msla:   { id: 'msla',   label: 'Resin MSLA (35–50 µm px)',  minPitchUm: 120,  minDepthUm: 25,  canCarry: 'relief', note: 'Pixel-limited; 2–3 pixels per feature.' },
  dlp:    { id: 'dlp',    label: 'Resin DLP (10–30 µm px)',   minPitchUm: 50,   minDepthUm: 10,  canCarry: 'relief', note: 'Best case for printed micro-relief.' },
  bed:    { id: 'bed',    label: 'Textured build sheet',      minPitchUm: 100,  minDepthUm: 5,   canCarry: 'stochastic', note: 'Imprints the sheet\'s own random grain (≈ 50–300 µm). Cannot carry a designed pattern.' },
  master: { id: 'master', label: 'Imprint master / film',     minPitchUm: 0.3,  minDepthUm: 0.1, canCarry: 'grating', note: 'Nanoimprint, nickel shim, or holographic film: made outside the printer from this module\'s vector/heightmap.' },
});

/**
 * Compare a requested surface feature with a process.
 * @returns {{ verdict:'printable'|'marginal'|'not-printable', reasons:string[], diffractive:boolean, dispersionDeg:number|null }}
 */
export function assessSurface(spec, processId) {
  const P = PROCESSES[processId];
  if (!P) throw new Error(`unknown process ${processId}`);
  const reasons = [];
  let verdict = 'printable';
  const dispersion = dispersionDeg(spec.pitchUm);
  const diffractive = dispersion !== null && dispersion >= 5;
  if (P.canCarry === 'stochastic' && spec.kind !== 'none') { verdict = 'not-printable'; reasons.push(`${P.label}: ${P.note} A designed pattern is ignored.`); }
  if (spec.pitchUm < P.minPitchUm) { verdict = 'not-printable'; reasons.push(`period ${spec.pitchUm} µm is below ${P.label}'s practical minimum of ${P.minPitchUm} µm`); }
  else if (spec.pitchUm < P.minPitchUm * 1.5 && verdict === 'printable') { verdict = 'marginal'; reasons.push(`period ${spec.pitchUm} µm is within 1.5× of the process limit (${P.minPitchUm} µm)`); }
  if (spec.depthUm !== undefined) {
    if (spec.depthUm < P.minDepthUm) { verdict = 'not-printable'; reasons.push(`depth ${spec.depthUm} µm is below the ${P.minDepthUm} µm resolution`); }
  }
  if (spec.intent === 'diffraction' && !diffractive) {
    verdict = verdict === 'printable' ? 'marginal' : verdict;
    reasons.push(dispersion === null
      ? `period ${spec.pitchUm} µm leaves no propagating first order at visible wavelengths`
      : `period ${spec.pitchUm} µm spreads 450–650 nm by only ${dispersion.toFixed(2)}°: that is a texture, not a visible diffraction grating. Colour separation ≥ 5° needs a period ≲ ${maxPitchForDispersionUm().toFixed(1)} µm.`);
  }
  if (spec.intent === 'diffraction' && processId !== 'master') {
    reasons.push('Visible holographic diffraction cannot be printed directly: export the prescription for a master or film.');
    if (verdict === 'printable') verdict = 'marginal';
  }
  return { verdict, reasons, diffractive, dispersionDeg: dispersion, process: P };
}

// ── patterns ───────────────────────────────────────────────────────────────
export const PATTERNS = ['none', 'linear', 'crosshatch', 'radial', 'concentric', 'chirp', 'hex-dimple', 'stipple'];

const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };

/**
 * A pattern is described in FACE-LOCAL millimetres (origin at the face centroid) by:
 *   spec = { kind, pitchMm, angleDeg=0, widthFrac=0.5, depthMm, pitchEndMm (chirp), seed, margin }
 * depth(x,y) → 0..1 relief fraction; segments()/points() give the vector form.
 */
export function makePattern(spec, polyLocal) {
  const p = spec.pitchMm, a = ((spec.angleDeg || 0) * Math.PI) / 180, w = (spec.widthFrac ?? 0.5) * p;
  const R = Math.max(...polyLocal.map(q => Math.hypot(q[0], q[1])));
  const ux = Math.cos(a), uy = Math.sin(a);                         // across-lines direction
  const tri = (d, half) => Math.max(0, 1 - d / half);               // V profile
  const lin = (x, y, pitch, ang) => { const c = Math.cos(ang), s = Math.sin(ang); const t = x * c + y * s; const m = ((t % pitch) + pitch) % pitch; return Math.min(m, pitch - m); };
  switch (spec.kind) {
    case 'linear': return { type: 'lines', depth: (x, y) => tri(lin(x, y, p, a), w / 2),
      segments: () => { const out = []; for (let k = Math.floor(-R / p); k <= Math.ceil(R / p); k++) { const t = k * p; out.push([ux * t - uy * R, uy * t + ux * R, ux * t + uy * R, uy * t - ux * R]); } return out; } };
    case 'crosshatch': { const A = makePattern({ ...spec, kind: 'linear' }, polyLocal), B = makePattern({ ...spec, kind: 'linear', angleDeg: (spec.angleDeg || 0) + 90 }, polyLocal);
      return { type: 'lines', depth: (x, y) => Math.max(A.depth(x, y), B.depth(x, y)), segments: () => [...A.segments(), ...B.segments()] }; }
    case 'concentric': return { type: 'lines', depth: (x, y) => { const r = Math.hypot(x, y), m = r % p; return tri(Math.min(m, p - m), w / 2); },
      segments: () => { const out = []; for (let r = p; r <= R; r += p) { const n = Math.max(24, Math.ceil((2 * Math.PI * r) / 1.5)); for (let i = 0; i < n; i++) { const t0 = (2 * Math.PI * i) / n, t1 = (2 * Math.PI * (i + 1)) / n; out.push([r * Math.cos(t0), r * Math.sin(t0), r * Math.cos(t1), r * Math.sin(t1)]); } } return out; } };
    case 'radial': { const n = Math.max(6, Math.round((2 * Math.PI * R) / p));
      return { type: 'lines', depth: (x, y) => { const r = Math.hypot(x, y) || 1e-9; const th = Math.atan2(y, x), step = (2 * Math.PI) / n; const m = ((th % step) + step) % step; const d = Math.min(m, step - m) * r; return tri(d, w / 2); },
        segments: () => Array.from({ length: n }, (_, i) => { const t = (2 * Math.PI * i) / n; return [0, 0, R * Math.cos(t), R * Math.sin(t)]; }) }; }
    case 'chirp': { const p1 = spec.pitchEndMm ?? p * 2, L = 2 * R;       // pitch varies linearly across the width
      const posAt = k => { // position of line k when pitch grows linearly: cumulative sum
        let t = -R, n = 0; while (n < k && t < R) { t += p + ((p1 - p) * (t + R)) / L; n++; } return t; };
      const lines = []; { let t = -R; while (t < R) { lines.push(t); t += p + ((p1 - p) * (t + R)) / L; } }
      void posAt;
      return { type: 'lines', depth: (x, y) => { const t = x * ux + y * uy; let best = Infinity, half = w / 2; for (const l of lines) { const d = Math.abs(t - l); if (d < best) { best = d; half = (w / 2) * ((p + ((p1 - p) * (l + R)) / L) / p); } } return tri(best, half); },
        segments: () => lines.map(t => [ux * t - uy * R, uy * t + ux * R, ux * t + uy * R, uy * t - ux * R]) }; }
    case 'hex-dimple': { const pts = []; const dy = (p * Math.sqrt(3)) / 2;
      for (let j = Math.floor(-R / dy) - 1, row = 0; j <= Math.ceil(R / dy) + 1; j++, row++) for (let i = -Math.ceil(R / p) - 1; i <= Math.ceil(R / p) + 1; i++) pts.push([i * p + (((j % 2) + 2) % 2 ? p / 2 : 0), j * dy]);
      const r0 = (spec.dotRadiusMm ?? p * 0.3);
      return { type: 'dots', radiusMm: r0, points: () => pts, depth: (x, y) => { let best = Infinity; for (const q of pts) { const d = Math.hypot(x - q[0], y - q[1]); if (d < best) best = d; } return tri(best, r0); } }; }
    case 'stipple': { const rnd = lcg(spec.seed ?? 1), pts = []; const r0 = (spec.dotRadiusMm ?? p * 0.25);
      for (let y = -R; y <= R; y += p) for (let x = -R; x <= R; x += p) pts.push([x + (rnd() - 0.5) * p * 0.8, y + (rnd() - 0.5) * p * 0.8]);
      return { type: 'dots', radiusMm: r0, points: () => pts, depth: (x, y) => { let best = Infinity; for (const q of pts) { const d = Math.hypot(x - q[0], y - q[1]); if (d < best) best = d; } return tri(best, r0); } }; }
    default: return { type: 'none', depth: () => 0, segments: () => [] };
  }
}

// ── geometry helpers ───────────────────────────────────────────────────────
/** Clip a segment to a convex CCW polygon (Cyrus–Beck). null if nothing remains. */
export function clipSegment(seg, poly) {
  let t0 = 0, t1 = 1; const [x0, y0, x1, y1] = seg, dx = x1 - x0, dy = y1 - y0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], nx = -(b[1] - a[1]), ny = b[0] - a[0];   // inward normal
    const num = (x0 - a[0]) * nx + (y0 - a[1]) * ny, den = dx * nx + dy * ny;
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}
const inside = (p, poly) => { for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false; } return true; };
const shrink = (poly, m) => { const c = poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length], [0, 0]);
  // inset by moving each edge inward by m (convex): use scale about centroid as a safe approximation for small m
  const r = Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]); }));
  const k = Math.max(0.05, (r - m) / r); return poly.map(q => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k]); };

/**
 * Vector form of a face's pattern in PLATE coordinates, clipped to the panel's bottom polygon (inset by `margin`).
 * @returns {{ type, segments?:number[][], points?:number[][], radiusMm?, center:number[] }}
 */
export function faceVectors(face, bottom, spec) {
  const c = face.outer.reduce((s, q) => [s[0] + q[0] / face.outer.length, s[1] + q[1] / face.outer.length], [0, 0]);
  const local = bottom.map(q => [q[0] - c[0], q[1] - c[1]]);
  const clipPoly = shrink(local, spec.margin ?? 0.8);
  const pat = makePattern(spec, local);
  if (pat.type === 'lines') {
    const segs = pat.segments().map(s => clipSegment(s, clipPoly)).filter(s => s && Math.hypot(s[2] - s[0], s[3] - s[1]) > 1e-6)
      .map(s => [s[0] + c[0], s[1] + c[1], s[2] + c[0], s[3] + c[1]]);
    return { type: 'lines', segments: segs, center: c, pattern: pat, local, clipPoly };
  }
  if (pat.type === 'dots') {
    const pts = pat.points().filter(q => inside(q, clipPoly)).map(q => [q[0] + c[0], q[1] + c[1]]);
    return { type: 'dots', points: pts, radiusMm: pat.radiusMm, center: c, pattern: pat, local, clipPoly };
  }
  return { type: 'none', center: c, pattern: pat, local, clipPoly };
}

/** 16-bit binary PGM heightmap of a face's relief (0 = flat, 65535 = full depth); outside the panel = 0. */
export function heightmapPGM(face, bottom, spec, pxPerMm = 50) {
  const v = faceVectors(face, bottom, spec);
  const xs = face.outer.map(q => q[0]), ys = face.outer.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = Math.max(1, Math.ceil((x1 - x0) * pxPerMm)), H = Math.max(1, Math.ceil((y1 - y0) * pxPerMm));
  const head = new TextEncoder().encode(`P5\n${W} ${H}\n65535\n`);
  const out = new Uint8Array(head.length + W * H * 2); out.set(head);
  const dv = new DataView(out.buffer, head.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) / pxPerMm, y = y1 - (j + 0.5) / pxPerMm;                       // image y runs downward
    let val = 0;
    if (inside([x, y], v.clipPoly.map(q => [q[0] + v.center[0], q[1] + v.center[1]]))) val = Math.round(65535 * v.pattern.depth(x - v.center[0], y - v.center[1]));
    dv.setUint16((j * W + i) * 2, val, false);
  }
  return { bytes: out, width: W, height: H, pxPerMm, originMm: [x0, y1], note: 'x right, y up in plate millimetres; origin is the top-left pixel' };
}

/** True-scale SVG of the plate: panel outlines, hinge strips, seams, pattern lines/dots, labels. */
export function plateSvg(net, profiles, surfaces = {}, { showLabels = true } = {}) {
  const all = net.faces.flatMap(f => f.outer);
  const x0 = Math.min(...all.map(p => p[0])) - 5, x1 = Math.max(...all.map(p => p[0])) + 5, y0 = Math.min(...all.map(p => p[1])) - 5, y1 = Math.max(...all.map(p => p[1])) + 5;
  const W = x1 - x0, H = y1 - y0, fy = y => y1 - y + y0;                                     // flip: SVG y runs downward
  const path = poly => poly.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - x0).toFixed(3)},${(fy(p[1]) - y0).toFixed(3)}`).join(' ') + ' Z';
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm" viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}">`,
    `<g fill="none" stroke-linejoin="round">`];
  net.faces.forEach((f, i) => {
    const pr = profiles[i];
    out.push(`<path d="${path(pr.bottom || f.outer)}" stroke="#222" stroke-width="0.15"/>`);
    const spec = surfaces[f.id];
    if (spec && spec.kind !== 'none' && pr.bottom) {
      const v = faceVectors(f, pr.bottom, spec);
      if (v.type === 'lines') for (const s of v.segments) out.push(`<line x1="${(s[0] - x0).toFixed(3)}" y1="${(fy(s[1]) - y0).toFixed(3)}" x2="${(s[2] - x0).toFixed(3)}" y2="${(fy(s[3]) - y0).toFixed(3)}" stroke="#7b5cfa" stroke-width="${Math.max(0.02, (spec.widthFrac ?? 0.5) * spec.pitchMm * 0.5).toFixed(3)}"/>`);
      if (v.type === 'dots') for (const q of v.points) out.push(`<circle cx="${(q[0] - x0).toFixed(3)}" cy="${(fy(q[1]) - y0).toFixed(3)}" r="${v.radiusMm.toFixed(3)}" fill="#7b5cfa" stroke="none"/>`);
    }
    if (showLabels) { const c = f.outer.reduce((s, q) => [s[0] + q[0] / f.outer.length, s[1] + q[1] / f.outer.length], [0, 0]); out.push(`<text x="${(c[0] - x0).toFixed(2)}" y="${(fy(c[1]) - y0).toFixed(2)}" font-size="3" text-anchor="middle" fill="#888" stroke="none">${f.id}</text>`); }
  });
  out.push('</g></svg>');
  return out.join('\n');
}

// Animation bundle for Blender (and any other host):
//   assembly.json       source assembly, units, geometry hash, step instructions, timeline
//   mesh-topology.json  fixed indices / UVs / parts  (topology never changes in a segment)
//   configurations.json solved samples: angles, rigid poses, vertex positions (mm)
//   diagnostics.json    per-sample validation (closure error, interpolation error, collisions)
//
// Samples come from the SOLVER. Vertex interpolation between them is only a display
// aid; adaptive refinement inserts further solved samples until the midpoint error of
// linear interpolation is under `maxInterpErrorMm`.

import { solveConfiguration } from '../solver/backend.js';
import { evaluatePoses, closureResiduals, maxAbs } from '../kinematics.js';
import { buildMesh, meshBounds } from './mesh.js';
import { checkCollisions } from '../collision/validation.js';
import { exportJSON } from './static.js';

/** Re-close a (possibly interpolated) configuration without imposing targets. */
export function projectToClosure(compiled, angles) {
  if (!compiled.closureConnIds.length) return { angles: Array.from(angles), closureMm: 0, ok: true };
  const r = solveConfiguration(compiled, { initial: angles, constraints: [] });
  return { angles: r.angles, closureMm: r.maxClosureErrorMm, ok: r.geometryValid };
}

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * Insert solved samples until the straight-line blend between neighbours stays
 * within maxInterpErrorMm of the solved path. @returns { samples, maxErrorMm, refined }
 */
export function refineSamples(compiled, samples, { maxInterpErrorMm = 0.05, maxDepth = 6, meshOpts } = {}) {
  const pos = a => buildMesh(compiled, a, meshOpts).positions;
  const out = [samples[0]];
  let refined = 0, worst = 0;
  const err = (A, B) => {
    const mid = projectToClosure(compiled, lerp(A.angles, B.angles, 0.5));
    // Deviation of the solved midpoint from the straight chord a linear shape-key blend
    // would follow (per vertex, closest point on the segment). Independent of how the
    // two configurations are parametrised in time.
    const exact = pos(mid.angles), pa = pos(A.angles), pb = pos(B.angles);
    let e = 0;
    for (let i = 0; i < exact.length; i += 3) {
      const dx = pb[i] - pa[i], dy = pb[i + 1] - pa[i + 1], dz = pb[i + 2] - pa[i + 2], l2 = dx * dx + dy * dy + dz * dz;
      const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((exact[i] - pa[i]) * dx + (exact[i + 1] - pa[i + 1]) * dy + (exact[i + 2] - pa[i + 2]) * dz) / l2));
      e = Math.max(e, Math.hypot(exact[i] - (pa[i] + dx * t), exact[i + 1] - (pa[i + 1] + dy * t), exact[i + 2] - (pa[i + 2] + dz * t)));
    }
    return { e, mid };
  };
  const rec = (A, B, depth) => {
    const { e, mid } = err(A, B);
    if (e > maxInterpErrorMm && depth < maxDepth && mid.ok) {
      const M = { progress: (A.progress + B.progress) / 2, angles: mid.angles, validated: true };
      refined++;
      rec(A, M, depth + 1); out.push(M); rec(M, B, depth + 1);
    } else worst = Math.max(worst, e);
  };
  for (let i = 0; i + 1 < samples.length; i++) { rec(samples[i], samples[i + 1], 0); out.push(samples[i + 1]); }
  return { samples: out, maxErrorMm: worst, refined };
}

/**
 * @param compiled   compileAssembly() output
 * @param sequence   solveSequence() result (steps with samples)
 * @param doc        sequence document { steps:[{id,title,notes,durationSeconds}] }
 * @param opts       { fps:24, maxInterpErrorMm, collisions:'intersect'|false, assembly (for assembly.json) }
 */
export function buildAnimationBundle(compiled, sequence, doc, opts = {}) {
  const { fps = 24, maxInterpErrorMm = 0.05, collisions = 'intersect' } = opts;
  const configs = [], diag = [], steps = [];
  const topo = buildMesh(compiled, new Array(compiled.variableConnIds.length).fill(0));
  let frame = 0;
  const startAngles = opts.initialAngles || new Array(compiled.variableConnIds.length).fill(0);
  const record = (id, stepId, progress, angles, f, interp) => {
    const mesh = buildMesh(compiled, angles);
    const poses = evaluatePoses(compiled, angles);
    const closure = maxAbs(closureResiduals(compiled, angles, poses));
    configs.push({
      id, stepId, progress, frame: f, angles: Array.from(angles),
      positions: Array.from(mesh.positions, v => Math.round(v * 1e5) / 1e5),
      rigid: Object.fromEntries([...poses].map(([rid, P]) => [rid, { R: P.R, t: P.t }])),
    });
    const d = { id, maxClosureErrorMm: closure, interpErrorMm: interp ?? null, bounds: meshBounds(mesh) };
    if (collisions) { const c = checkCollisions(compiled, poses); d.collisionStatus = c.collisionStatus; d.collisions = c.collisions.map(h => h.regions); d.collisionMethod = c.method; }
    diag.push(d);
  };
  record('start', null, 0, startAngles, 0, null);
  for (const st of sequence.steps || []) {
    const sd = (doc.steps || []).find(s => s.id === st.stepId) || {};
    const dur = sd.durationSeconds ?? 2;
    const ref = refineSamples(compiled, st.samples, { maxInterpErrorMm });
    const f0 = frame, nFrames = Math.max(1, Math.round(dur * fps));
    ref.samples.forEach((s, i) => { if (i === 0) return; record(`${st.stepId}:${i}`, st.stepId, s.progress, s.angles, f0 + Math.round(s.progress * nFrames), ref.maxErrorMm); });
    frame = f0 + nFrames;
    steps.push({ id: st.stepId, title: sd.title || st.stepId, notes: sd.notes || '', instruction: sd.instruction || '', startFrame: f0, endFrame: frame, refinedSamples: ref.refined });
  }
  return {
    'assembly.json': exportJSON({ format: 'hyphi-folding-bundle', version: 1, units: 'mm', geometryHash: compiled.hash, fps, assembly: opts.assembly || compiled.assembly, steps }),
    'mesh-topology.json': exportJSON({ vertexCount: topo.positions.length / 3, indices: Array.from(topo.indices), uvs: Array.from(topo.uvs, v => Math.round(v * 1e6) / 1e6), parts: topo.parts }),
    'configurations.json': exportJSON({ units: 'mm', configurations: configs }),
    'diagnostics.json': exportJSON({ maxInterpErrorMmTarget: maxInterpErrorMm, validation: diag }),
  };
}

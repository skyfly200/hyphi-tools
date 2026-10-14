// Folding recipe: authored steps + validation + deterministic replay.
// Instructions (what the author intends) are stored separately from solved
// configurations (what actually happened).

import { solveStepContinuation } from './solver/continuation.js';
import { rad } from './math.js';

export const SEQUENCE_VERSION = 1;
export const CONTROL_MODES = ['drive', 'hold', 'free'];
export const EASINGS = ['linear', 'smoothstep', 'easeInOut'];

/**
 * Check a `foldform:` sequence document against a compiled assembly.
 * Rejects unresolved references, incompatible control quantities and ambiguous
 * duplicate controls (spec §9.3).
 * @param doc { steps:[], groups:[], geometryHash? }
 */
export function validateSequence(doc, compiled) {
  const issues = [];
  const err = (code, message, extra = {}) => issues.push({ level: 'error', code, message, ...extra });
  const warn = (code, message, extra = {}) => issues.push({ level: 'warning', code, message, ...extra });
  const groups = new Map((doc.groups || []).map(g => [g.id, g]));
  if (doc.geometryHash && compiled.hash !== doc.geometryHash) {
    warn('staleGeometry', 'design geometry changed since this sequence was authored; solved configurations are stale');
  }
  for (const g of doc.groups || []) {
    for (const id of g.connectionIds || []) if (!compiled.connIndex.has(id)) err('staleReferences', `group ${g.id} references missing connection ${id}`, { group: g.id, id });
  }
  const stepIds = new Set();
  for (const step of doc.steps || []) {
    if (!step.id) { err('invalidStep', 'step without id'); continue; }
    if (stepIds.has(step.id)) err('invalidStep', `duplicate step id ${step.id}`, { step: step.id });
    stepIds.add(step.id);
    if (step.defaultConnectionMode && !CONTROL_MODES.includes(step.defaultConnectionMode)) err('invalidStep', `unknown defaultConnectionMode ${step.defaultConnectionMode}`, { step: step.id });
    if (step.defaultConnectionMode === 'hold') warn('defaultHold', `step ${step.id} holds every unlisted connection; this can lock a coupled mechanism`, { step: step.id });
    if (step.easing && !EASINGS.includes(step.easing)) err('invalidStep', `unknown easing ${step.easing}`, { step: step.id });
    if (step.anchors) for (const a of step.anchors) if (!compiled.regionIndex.has(a.regionId)) err('staleReferences', `step ${step.id} anchors missing region ${a.regionId}`, { step: step.id });
    const seen = new Map();
    for (const ctl of step.controls || []) {
      if (!CONTROL_MODES.includes(ctl.mode)) err('invalidControl', `unknown mode ${ctl.mode}`, { step: step.id });
      if (ctl.mode === 'drive' && (ctl.quantity ?? 'angle') !== 'angle') err('invalidControl', `quantity ${ctl.quantity} is not supported for drive`, { step: step.id });
      if (ctl.mode === 'drive' && !Number.isFinite(ctl.toDegrees)) err('invalidControl', 'drive control needs a numeric toDegrees', { step: step.id });
      let ids = [];
      if (ctl.target?.groupId) {
        const g = groups.get(ctl.target.groupId);
        if (!g) err('staleReferences', `step ${step.id} references missing group ${ctl.target.groupId}`, { step: step.id });
        else ids = g.connectionIds || [];
      } else if (ctl.target?.connectionId) {
        if (!compiled.varIndex.has(ctl.target.connectionId)) err('staleReferences', `step ${step.id} references missing connection ${ctl.target.connectionId}`, { step: step.id });
        else ids = [ctl.target.connectionId];
      } else err('invalidControl', 'control needs target.groupId or target.connectionId', { step: step.id });
      for (const id of ids) {
        if (seen.has(id)) err('ambiguousControls', `connection ${id} is controlled twice in step ${step.id}`, { step: step.id, id });
        seen.set(id, ctl);
      }
    }
  }
  return { ok: !issues.some(i => i.level === 'error'), issues };
}

/** Resolve groups so a step becomes { controls:[{connIds, mode, toRad}], ... } for the solver. */
export function resolveStep(step, doc, compiled) {
  const groups = new Map((doc.groups || []).map(g => [g.id, g]));
  const controls = [];
  const listed = new Set();
  for (const ctl of step.controls || []) {
    const connIds = ctl.target?.groupId ? (groups.get(ctl.target.groupId)?.connectionIds || []) : [ctl.target?.connectionId];
    connIds.forEach(id => listed.add(id));
    controls.push({ connIds, mode: ctl.mode, toRad: ctl.mode === 'drive' ? rad(ctl.toDegrees) : undefined });
  }
  if (step.defaultConnectionMode === 'hold') {
    controls.push({ connIds: compiled.variableConnIds.filter(id => !listed.has(id)), mode: 'hold' });
  }
  return { controls, easing: step.easing, guides: step.guides };
}

/**
 * Replay a whole sequence deterministically. Each step starts from the previous
 * step's final configuration (or `initialAngles`). Stops at the first failing step.
 * @param cache optional Map for sample reuse (invalidated by key: geometry hash + step + start)
 */
export function solveSequence(compiled, doc, { initialAngles, options = {}, cache } = {}) {
  const v = validateSequence(doc, compiled);
  if (!v.ok) return { status: 'invalidSequence', issues: v.issues, steps: [] };
  let angles = Array.from(initialAngles ?? new Array(compiled.variableConnIds.length).fill(0));
  const out = [];
  for (const step of doc.steps || []) {
    const key = stepCacheKey(compiled, step, angles, doc);
    let res = cache?.get(key);
    const fromCache = !!res;
    if (!res) {
      res = solveStepContinuation(compiled, angles, resolveStep(step, doc, compiled), options);
      if (cache && res.completed) cache.set(key, res);
    }
    out.push({ stepId: step.id, fromCache, ...res });
    if (!res.completed) return { status: res.status, failedStep: step.id, steps: out, issues: v.issues };
    angles = res.samples[res.samples.length - 1].angles;
  }
  return { status: 'converged', steps: out, finalAngles: angles, issues: v.issues };
}

// Anything that can change a solve is in the key; camera/display state is not.
export function stepCacheKey(compiled, step, startAngles, doc) {
  return JSON.stringify([compiled.hash, step, doc.groups || [], startAngles.map(a => Math.round(a * 1e9))]);
}

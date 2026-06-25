// PolyForge "patch" save/load. A patch is the full parameter snapshot
// needed to regenerate a fixture — polyhedron choice, edge length, LED +
// connector selection, design rules, panel shape. Patches are stored in
// localStorage (a named library) and can be exported / imported as JSON
// so users can share fixtures across machines.

const KEY = 'polyforge.patches.v1';
const PATCH_VERSION = 1;

export function listPatches() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw);
    return Object.keys(obj).sort();
  } catch { return []; }
}

export function loadPatch(name) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj[name] || null;
  } catch { return null; }
}

export function savePatch(name, patch) {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[name] = { ...patch, _version: PATCH_VERSION, _savedAt: name };
    localStorage.setItem(KEY, JSON.stringify(obj));
    return true;
  } catch { return false; }
}

export function deletePatch(name) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    delete obj[name];
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {}
}

export function exportPatchJSON(patch) {
  return JSON.stringify({ kind: 'polyforge.patch', version: PATCH_VERSION, ...patch }, null, 2);
}

export function parsePatchJSON(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.kind !== 'polyforge.patch') {
    throw new Error('Not a PolyForge patch file.');
  }
  return obj;
}

// localStorage-backed persistence for FoldForm projects.
// One JSON object per name → { savedAt, project: {...} }.

const KEY = 'foldform.projects.v1';

function safeParse(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

export function listFoldFormProjects() {
  const all = safeParse(localStorage.getItem(KEY), {});
  return Object.entries(all)
    .map(([name, p]) => ({ name, savedAt: p.savedAt }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function saveFoldFormProject(name, project) {
  if (!name) throw new Error('project name required');
  const all = safeParse(localStorage.getItem(KEY), {});
  all[name] = { savedAt: Date.now(), project };
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function loadFoldFormProject(name) {
  const all = safeParse(localStorage.getItem(KEY), {});
  return all[name]?.project || null;
}

export function deleteFoldFormProject(name) {
  const all = safeParse(localStorage.getItem(KEY), {});
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function renameFoldFormProject(oldName, newName) {
  if (!newName || oldName === newName) return false;
  const all = safeParse(localStorage.getItem(KEY), {});
  if (!all[oldName] || all[newName]) return false;
  all[newName] = all[oldName];
  delete all[oldName];
  localStorage.setItem(KEY, JSON.stringify(all));
  return true;
}

// localStorage-backed persistence for FoldStudio preferences and projects.

const PREFS_KEY = 'foldstudio.prefs.v1';
const PROJECTS_KEY = 'foldstudio.projects.v1';

function safeParse(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

export function loadPrefs() {
  return safeParse(localStorage.getItem(PREFS_KEY), null);
}

export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export function listProjects() {
  const all = safeParse(localStorage.getItem(PROJECTS_KEY), {});
  return Object.entries(all)
    .map(([name, p]) => ({ name, savedAt: p.savedAt }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function saveProject(name, model) {
  if (!name) throw new Error('project name required');
  const all = safeParse(localStorage.getItem(PROJECTS_KEY), {});
  all[name] = { savedAt: Date.now(), model };
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
}

export function loadProject(name) {
  const all = safeParse(localStorage.getItem(PROJECTS_KEY), {});
  return all[name]?.model || null;
}

export function deleteProject(name) {
  const all = safeParse(localStorage.getItem(PROJECTS_KEY), {});
  delete all[name];
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
}

export function renameProject(oldName, newName) {
  if (!newName || oldName === newName) return false;
  const all = safeParse(localStorage.getItem(PROJECTS_KEY), {});
  if (!all[oldName]) return false;
  if (all[newName]) return false; // refuse to clobber an existing project
  all[newName] = all[oldName];
  delete all[oldName];
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
  return true;
}

// Hand off a FOLD pattern between tools via sessionStorage so a click on
// "Open in <tool>" navigates with the current design.
//
// Producers call set(fold). Consumers call take() once on mount and load it.

const KEY = 'hyphi.foldHandoff.v1';

export function setHandoff(fold) {
  try { sessionStorage.setItem(KEY, JSON.stringify(fold)); } catch {}
}

export function takeHandoff() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

export function peekHandoff() {
  try { return !!sessionStorage.getItem(KEY); } catch { return false; }
}

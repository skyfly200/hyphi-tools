// Hand off a FOLD pattern between tools via sessionStorage so a click on
// "Open in <tool>" navigates with the current design.
//
// Producer:   setHandoff(fold, { name })
// Consumer:   takeHandoff() → { fold, name } | null

const KEY = 'hyphi.foldHandoff.v1';

export function setHandoff(fold, meta = {}) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ fold, name: meta.name || '' }));
  } catch {}
}

export function takeHandoff() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw);
    // Legacy payloads were just the FOLD object — keep loading those.
    if (parsed && parsed.fold) return parsed;
    return { fold: parsed, name: '' };
  } catch { return null; }
}

export function peekHandoff() {
  try { return !!sessionStorage.getItem(KEY); } catch { return false; }
}

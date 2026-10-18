// Multi-colour printing.
//
// Every panel prints at the same layers, so colours cannot be separated by height: each colour becomes its own
// BODY, all in the same plate coordinates, and the slicer assigns each body an extruder / AMS slot. Bodies are made
// DISJOINT (no overlapping volumes), which is what multi-material slicing wants.
//
// A hinge strip bridges two panels that may differ in colour. By default it takes its parent panel's colour; or give
// all hinges one dedicated material slot (e.g. a flexible filament).

export const DEFAULT_PALETTE = Object.freeze([
  { name: 'White',  hex: '#f2f2f2' }, { name: 'Red',   hex: '#d9372a' }, { name: 'Blue',  hex: '#2a62d9' }, { name: 'Amber', hex: '#f0a020' },
  { name: 'Green',  hex: '#2fa05a' }, { name: 'Violet', hex: '#8a4fd0' }, { name: 'Black', hex: '#1c1c20' }, { name: 'Teal',  hex: '#1fb5b0' },
]);

/** face id -> set of neighbouring face ids (faces sharing an edge of the solid). */
export function faceAdjacency(net) {
  const adj = net.faces.map(() => new Set());
  for (const e of net.edges) { const [a, b] = e.faces; adj[a].add(b); adj[b].add(a); }
  return adj;
}

/**
 * Colour the faces so that adjacent faces differ, using at most `k` colours (DSATUR heuristic).
 * @returns {{ colors:number[], used:number, ok:boolean }} ok=false when the heuristic needed more than k
 */
export function colorAdjacent(net, k) {
  const adj = faceAdjacency(net), n = net.faces.length, col = new Array(n).fill(-1);
  for (let step = 0; step < n; step++) {
    let best = -1, bestSat = -1, bestDeg = -1;
    for (let v = 0; v < n; v++) {
      if (col[v] >= 0) continue;
      const sat = new Set([...adj[v]].map(u => col[u]).filter(c => c >= 0)).size;
      if (sat > bestSat || (sat === bestSat && adj[v].size > bestDeg)) { best = v; bestSat = sat; bestDeg = adj[v].size; }
    }
    const taken = new Set([...adj[best]].map(u => col[u]));
    let c = 0; while (taken.has(c)) c++;
    col[best] = c;
  }
  const used = Math.max(...col) + 1;
  // fold any colour index ≥ k back into range if the heuristic overshot (marks ok = false)
  const colors = col.map(c => (c < k ? c : c % k));
  return { colors, used, ok: used <= k };
}

/**
 * @param net
 * @param spec { mode:'single'|'each'|'adjacent'|'manual', count:number, manual?:{[face]:number} }
 * @returns {{ colors:number[], count:number, issues:Array }}
 */
export function assignColors(net, spec = {}) {
  const { mode = 'single', count = 2, manual = {} } = spec, n = net.faces.length, issues = [];
  let colors;
  if (mode === 'each') colors = net.faces.map((_, i) => i % count);
  else if (mode === 'adjacent') {
    const r = colorAdjacent(net, count); colors = r.colors;
    if (!r.ok) issues.push({ level: 'warning', code: 'colorsNotEnough', message: `${count} colours cannot keep every pair of neighbouring faces different on this solid (needs ${r.used}); some neighbours share a colour.` });
  } else if (mode === 'manual') colors = net.faces.map((_, i) => Math.min(count - 1, Math.max(0, manual[i] ?? 0)));
  else colors = new Array(n).fill(0);
  return { colors, count: Math.max(1, count), issues };
}

/** Colour slot a hinge strip is printed in. */
export function hingeColor(net, hinge, colors, hingeMode) {
  if (hingeMode === 'parent' || hingeMode === undefined) return colors[hinge.parent];
  if (hingeMode === 'child') return colors[hinge.child];
  return hingeMode.slot;                       // { slot: n } — a dedicated material
}

/**
 * Rough print-time cost of colour changes. Every layer of the panel stack contains every colour, so each layer needs
 * (colours present − 1) changes; the hinge layers add their own. Indicative only: real purge depends on the slicer.
 */
export function colorChangeEstimate(net, colors, hingeSlots, { layerMm = 0.2 } = {}) {
  const t = net.params.panelThicknessMm, layers = Math.max(1, Math.round(t / layerMm));
  const present = new Set([...colors, ...hingeSlots]);
  return { colorsUsed: present.size, layers, changes: Math.max(0, present.size - 1) * layers };
}

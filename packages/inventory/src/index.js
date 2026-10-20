// Inventory as a ledger. Parts (a printable design + version + material), assemblies (a bill of materials of parts and
// sub-assemblies) and filament spools are definitions; everything that changes counts is an event (printed, assembled,
// scrapped, adjusted, used filament). Stock is computed from the events, so it is auditable, merges cleanly between
// devices, and works with any storage that can load/save one JSON document.

export const DENSITY_G_CM3 = Object.freeze({ PLA: 1.24, PETG: 1.27, 'PETG-translucent': 1.27, TPU: 1.21, PVB: 1.08 });
export const filamentGrams = (filamentMm, material = 'PLA', diameterMm = 1.75) => +(filamentMm * Math.PI * (diameterMm / 2) ** 2 / 1000 * (DENSITY_G_CM3[material] || 1.24)).toFixed(2);

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
const empty = () => ({ version: 1, parts: {}, assemblies: {}, spools: {}, events: [] });

/** Stable short hash of a design's parameters, so a changed design is a different part version. */
export function designHash(obj) {
  const s = JSON.stringify(obj, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Counts per part and per assembly from the ledger. */
export function stockOf(state) {
  const parts = {}, assemblies = {};
  const add = (m, id, n) => { m[id] = (m[id] || 0) + n; };
  for (const e of state.events) {
    if (e.type === 'printed' && e.ok !== false) add(parts, e.partId, e.qty);
    else if (e.type === 'assembled') { for (const [pid, q] of Object.entries(e.consumed || {})) add(parts, pid, -q); for (const [aid, q] of Object.entries(e.consumedAssemblies || {})) add(assemblies, aid, -q); add(assemblies, e.assemblyId, e.qty); }
    else if (e.type === 'scrapped') add(e.assemblyId ? assemblies : parts, e.assemblyId || e.partId, -e.qty);
    else if (e.type === 'adjusted') add(e.assemblyId ? assemblies : parts, e.assemblyId || e.partId, e.qty);
    else if (e.type === 'shipped') add(e.assemblyId ? assemblies : parts, e.assemblyId || e.partId, -e.qty);
  }
  return { parts, assemblies };
}

/** Failed prints and the filament they used, per part. */
export function failureStats(state) {
  const out = {};
  for (const e of state.events) if (e.type === 'printed') { const s = (out[e.partId] ||= { ok: 0, failed: 0, grams: 0 }); if (e.ok === false) s.failed += e.qty; else s.ok += e.qty; s.grams += e.grams || 0; }
  for (const s of Object.values(out)) s.failRate = s.ok + s.failed ? +(s.failed / (s.ok + s.failed)).toFixed(3) : 0;
  return out;
}

/** Flat part requirements for `qty` of an assembly (sub-assemblies expanded). Throws on a cycle or an unknown id. */
export function explodeBom(state, assemblyId, qty = 1, seen = []) {
  const a = state.assemblies[assemblyId]; if (!a) throw new Error(`unknown assembly ${assemblyId}`);
  if (seen.includes(assemblyId)) throw new Error(`assembly cycle: ${[...seen, assemblyId].map(i => state.assemblies[i]?.name || i).join(' → ')}`);
  const need = {};
  for (const l of a.bom) {
    if (l.partId) { if (!state.parts[l.partId]) throw new Error(`assembly "${a.name}" uses unknown part ${l.partId}`); need[l.partId] = (need[l.partId] || 0) + l.qty * qty; }
    else if (l.assemblyId) for (const [pid, q] of Object.entries(explodeBom(state, l.assemblyId, l.qty * qty, [...seen, assemblyId]))) need[pid] = (need[pid] || 0) + q;
  }
  return need;
}

/** What is missing to build `qty` of an assembly from the parts on hand (finished sub-assemblies are not counted; plan them as assemblies). */
export function shortages(state, assemblyId, qty = 1) {
  const need = explodeBom(state, assemblyId, qty), have = stockOf(state).parts, out = [];
  for (const [pid, n] of Object.entries(need)) { const h = Math.max(0, have[pid] || 0); if (h < n) out.push({ partId: pid, name: state.parts[pid].name, need: n, have: h, short: n - h }); }
  return out;
}

/** How many complete assemblies the parts on hand allow. */
export function buildable(state, assemblyId) {
  const per = explodeBom(state, assemblyId, 1), have = stockOf(state).parts;
  const ratios = Object.entries(per).map(([pid, n]) => Math.floor(Math.max(0, have[pid] || 0) / n));
  return ratios.length ? Math.min(...ratios) : 0;
}

/** Print queue for `qty` assemblies: parts still to print, with filament grams from each part's recorded weight. */
export function printPlan(state, assemblyId, qty = 1) {
  const items = shortages(state, assemblyId, qty).map(s => { const p = state.parts[s.partId]; return { partId: s.partId, name: p.name, qty: s.short, gramsEach: p.gramsEach ?? null, grams: p.gramsEach != null ? +(p.gramsEach * s.short).toFixed(1) : null, material: p.material, color: p.color }; });
  const byFilament = {}; for (const i of items) if (i.grams != null) { const k = `${i.material}${i.color ? ` ${i.color}` : ''}`; byFilament[k] = +((byFilament[k] || 0) + i.grams).toFixed(1); }
  return { items, byFilament, complete: items.length === 0 };
}

/** Low-stock report against each part's reorder level. */
export function lowStock(state) {
  const have = stockOf(state).parts;
  return Object.values(state.parts).filter(p => p.reorderLevel != null && (have[p.id] || 0) <= p.reorderLevel).map(p => ({ partId: p.id, name: p.name, have: have[p.id] || 0, reorderLevel: p.reorderLevel }));
}

/**
 * Inventory bound to a storage adapter: { load(): Promise<state|null>, save(state): Promise<void> }.
 * Every mutating call validates, appends to the ledger and saves.
 */
export async function createInventory(store) {
  let state = (await store.load()) || empty();
  const save = () => store.save(state);
  const ev = (e) => { const x = { id: uid('ev'), at: new Date().toISOString(), ...e }; state.events.push(x); return x; };
  const needPart = id => { if (!state.parts[id]) throw new Error(`unknown part ${id}`); return state.parts[id]; };
  const posInt = (n, what = 'quantity') => { if (!Number.isInteger(n) || n <= 0) throw new Error(`${what} must be a positive whole number`); return n; };
  const api = {
    get state() { return state; },
    stock: () => stockOf(state),
    /** Add or update a part. A part with the same designId+hash is the same part version. */
    async definePart({ name, designId, params, material = 'PLA', color = '', profile = '', gramsEach = null, reorderLevel = null, notes = '' }) {
      if (!name) throw new Error('part needs a name');
      const hash = params ? designHash(params) : null;
      const same = Object.values(state.parts).find(p => designId && p.designId === designId && p.hash === hash && p.material === material && p.color === color);
      const p = same || { id: uid('part'), createdAt: new Date().toISOString() };
      Object.assign(p, { name, designId: designId || null, hash, params: params || null, material, color, profile, gramsEach, reorderLevel, notes });
      state.parts[p.id] = p; await save(); return p;
    },
    async defineAssembly({ name, bom, notes = '' }) {
      if (!name) throw new Error('assembly needs a name');
      for (const l of bom) { posInt(l.qty, 'BOM quantity'); if (!!l.partId === !!l.assemblyId) throw new Error('each BOM line needs exactly one of partId / assemblyId'); if (l.partId) needPart(l.partId); else if (!state.assemblies[l.assemblyId]) throw new Error(`unknown assembly ${l.assemblyId}`); }
      const a = { id: uid('asm'), name, bom, notes, createdAt: new Date().toISOString() }; state.assemblies[a.id] = a;
      try { explodeBom(state, a.id); } catch (e) { delete state.assemblies[a.id]; throw e; }
      await save(); return a;
    },
    async addSpool({ material, color = '', brand = '', grams = 1000 }) { const s = { id: uid('spool'), material, color, brand, startG: grams, usedG: 0 }; state.spools[s.id] = s; await save(); return s; },
    /** Record a finished print (ok:false = a failure that still used filament). */
    async recordPrint(partId, qty = 1, { ok = true, printer = '', spoolId = null, grams = null } = {}) {
      const p = needPart(partId); posInt(qty);
      const used = grams ?? (p.gramsEach != null ? +(p.gramsEach * qty).toFixed(2) : 0);
      if (spoolId) { const s = state.spools[spoolId]; if (!s) throw new Error(`unknown spool ${spoolId}`); s.usedG = +(s.usedG + used).toFixed(2); }
      const e = ev({ type: 'printed', partId, qty, ok, printer, spoolId, grams: used }); await save(); return e;
    },
    /** Consume parts (and sub-assemblies) per the BOM and add finished assemblies. Refuses if parts are short. */
    async assemble(assemblyId, qty = 1) {
      posInt(qty); const a = state.assemblies[assemblyId]; if (!a) throw new Error(`unknown assembly ${assemblyId}`);
      const have = stockOf(state), consumed = {}, consumedAssemblies = {};
      for (const l of a.bom) { const n = l.qty * qty; if (l.partId) { consumed[l.partId] = (consumed[l.partId] || 0) + n; if ((have.parts[l.partId] || 0) < consumed[l.partId]) throw new Error(`not enough ${state.parts[l.partId].name}: need ${consumed[l.partId]}, have ${have.parts[l.partId] || 0}`); }
        else { consumedAssemblies[l.assemblyId] = (consumedAssemblies[l.assemblyId] || 0) + n; if ((have.assemblies[l.assemblyId] || 0) < consumedAssemblies[l.assemblyId]) throw new Error(`not enough ${state.assemblies[l.assemblyId].name}: need ${consumedAssemblies[l.assemblyId]}, have ${have.assemblies[l.assemblyId] || 0}`); } }
      const e = ev({ type: 'assembled', assemblyId, qty, consumed, consumedAssemblies }); await save(); return e;
    },
    async scrap({ partId, assemblyId, qty = 1, reason = '' }) {
      posInt(qty); const have = stockOf(state), onHand = partId ? have.parts[partId] || 0 : have.assemblies[assemblyId] || 0;
      if (qty > onHand) throw new Error(`cannot scrap ${qty}; only ${onHand} on hand`);
      const e = ev({ type: 'scrapped', partId, assemblyId, qty, reason }); await save(); return e;
    },
    async ship({ partId, assemblyId, qty = 1, to = '' }) { posInt(qty); const have = stockOf(state), n = partId ? have.parts[partId] || 0 : have.assemblies[assemblyId] || 0; if (qty > n) throw new Error(`cannot ship ${qty}; only ${n} on hand`); const e = ev({ type: 'shipped', partId, assemblyId, qty, to }); await save(); return e; },
    /** Stock-take correction (positive or negative). */
    async adjust({ partId, assemblyId, qty, reason = 'stock-take' }) { if (!Number.isInteger(qty) || qty === 0) throw new Error('adjustment must be a non-zero whole number'); const e = ev({ type: 'adjusted', partId, assemblyId, qty, reason }); await save(); return e; },
    shortages: (id, q) => shortages(state, id, q), buildable: id => buildable(state, id), plan: (id, q) => printPlan(state, id, q), lowStock: () => lowStock(state), failures: () => failureStats(state),
    spoolRemaining: id => { const s = state.spools[id]; return s ? +(s.startG - s.usedG).toFixed(1) : null; },
    exportJSON: () => JSON.stringify(state, null, 1),
    async importJSON(text) { const j = JSON.parse(text); if (j.version !== 1 || !j.parts || !j.assemblies || !Array.isArray(j.events)) throw new Error('not an inventory export'); state = j; await save(); },
  };
  return api;
}

export const createMemoryStore = (initial = null) => { let s = initial; return { load: async () => (s ? JSON.parse(JSON.stringify(s)) : null), save: async st => { s = JSON.parse(JSON.stringify(st)); } }; };
/** Browser storage (this browser only). Safe when storage is blocked: loads empty and keeps working in memory. */
export const createLocalStorageStore = (key = 'hyphi.inventory') => ({
  load: async () => { try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; } },
  save: async st => { try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* storage unavailable */ } },
});

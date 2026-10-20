import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInventory, createMemoryStore, designHash, filamentGrams, stockOf, explodeBom } from '../src/index.js';
import { createFileStore } from '../src/file-store.js';

async function lamp() {
  const inv = await createInventory(createMemoryStore());
  const shade = await inv.definePart({ name: 'Icosa shade', designId: 'facetfold:icosahedron', params: { edgeLengthMm: 60 }, material: 'PETG', gramsEach: 18.5, reorderLevel: 1 });
  const cap = await inv.definePart({ name: 'Vertex cap', designId: 'facetfold:cap', params: { d: 8 }, material: 'PLA', gramsEach: 2 });
  const lampA = await inv.defineAssembly({ name: 'Lamp', bom: [{ partId: shade.id, qty: 1 }, { partId: cap.id, qty: 3 }] });
  return { inv, shade, cap, lampA };
}

test('stock comes from the ledger: prints add, failed prints do not, assembling consumes parts', async () => {
  const { inv, shade, cap, lampA } = await lamp();
  await inv.recordPrint(shade.id, 2); await inv.recordPrint(shade.id, 1, { ok: false }); await inv.recordPrint(cap.id, 5);
  assert.deepEqual(inv.stock().parts, { [shade.id]: 2, [cap.id]: 5 });
  assert.equal(inv.buildable(lampA.id), 1);                               // 5 caps / 3 per lamp
  await inv.assemble(lampA.id, 1);
  assert.deepEqual(inv.stock(), { parts: { [shade.id]: 1, [cap.id]: 2 }, assemblies: { [lampA.id]: 1 } });
  await assert.rejects(() => inv.assemble(lampA.id, 1), /not enough Vertex cap: need 3, have 2/);
  assert.equal(inv.failures()[shade.id].failRate, 0.333);
});

test('shortages and print plan: what to print for N assemblies, with filament by material', async () => {
  const { inv, shade, cap, lampA } = await lamp();
  await inv.recordPrint(shade.id, 1); await inv.recordPrint(cap.id, 4);
  const s = inv.shortages(lampA.id, 3);
  assert.deepEqual(s.map(x => [x.name, x.need, x.have, x.short]).sort(), [['Icosa shade', 3, 1, 2], ['Vertex cap', 9, 4, 5]]);
  const plan = inv.plan(lampA.id, 3);
  assert.equal(plan.byFilament.PETG, 37); assert.equal(plan.byFilament.PLA, 10); assert.equal(plan.complete, false);
  assert.equal(inv.plan(lampA.id, 1).complete, true);             // 1 shade + 4 caps already cover one lamp
});

test('nested assemblies explode recursively; cycles and unknown parts are rejected', async () => {
  const { inv, shade, cap, lampA } = await lamp();
  const set = await inv.defineAssembly({ name: 'Pair', bom: [{ assemblyId: lampA.id, qty: 2 }, { partId: cap.id, qty: 1 }] });
  assert.deepEqual(explodeBom(inv.state, set.id, 1), { [shade.id]: 2, [cap.id]: 7 });
  await assert.rejects(() => inv.defineAssembly({ name: 'X', bom: [{ partId: 'nope', qty: 1 }] }), /unknown part/);
  await assert.rejects(() => inv.defineAssembly({ name: 'X', bom: [{ partId: shade.id, qty: 0 }] }), /positive whole/);
  await assert.rejects(() => inv.defineAssembly({ name: 'X', bom: [{ partId: shade.id, assemblyId: lampA.id, qty: 1 }] }), /exactly one/);
  inv.state.assemblies[lampA.id].bom.push({ assemblyId: set.id, qty: 1 });     // force a cycle
  assert.throws(() => explodeBom(inv.state, set.id), /cycle/);
});

test('scrap/ship/adjust cannot take stock below zero; low-stock and spools track usage', async () => {
  const { inv, shade } = await lamp();
  const sp = await inv.addSpool({ material: 'PETG', color: 'clear', grams: 1000 });
  await inv.recordPrint(shade.id, 2, { spoolId: sp.id, printer: 'A1 mini' });
  assert.equal(inv.spoolRemaining(sp.id), 963);
  await assert.rejects(() => inv.scrap({ partId: shade.id, qty: 3 }), /only 2 on hand/);
  await inv.scrap({ partId: shade.id, qty: 1, reason: 'cracked hinge' });
  assert.deepEqual(inv.lowStock().map(x => x.name), ['Icosa shade']);                 // 1 on hand <= reorder level 1
  await inv.ship({ partId: shade.id, qty: 1, to: 'customer' }); assert.equal(inv.stock().parts[shade.id], 0);
  await inv.adjust({ partId: shade.id, qty: 4 }); assert.equal(inv.stock().parts[shade.id], 4);
  await assert.rejects(() => inv.adjust({ partId: shade.id, qty: 0 }), /non-zero/);
  await assert.rejects(() => inv.recordPrint(shade.id, 1.5), /whole number/);
});

test('the same design + parameters is the same part version; a changed parameter is a new part', async () => {
  const inv = await createInventory(createMemoryStore());
  const a = await inv.definePart({ name: 'Cube', designId: 'facetfold:cube', params: { edge: 40, hinge: { w: 0.75, t: 0.1 } } });
  const b = await inv.definePart({ name: 'Cube (renamed)', designId: 'facetfold:cube', params: { hinge: { t: 0.1, w: 0.75 }, edge: 40 } });
  const c = await inv.definePart({ name: 'Cube', designId: 'facetfold:cube', params: { edge: 50, hinge: { w: 0.75, t: 0.1 } } });
  assert.equal(a.id, b.id); assert.equal(b.name, 'Cube (renamed)'); assert.notEqual(a.id, c.id);
  assert.equal(designHash({ x: 1, y: 2 }), designHash({ y: 2, x: 1 }));
});

test('filament grams from extruded length (1.75 mm, PLA/PETG/TPU)', () => {
  assert.equal(filamentGrams(1000, 'PLA'), 2.98); assert.ok(filamentGrams(1000, 'PETG') > filamentGrams(1000, 'PLA')); assert.ok(filamentGrams(1000, 'PVB') < filamentGrams(1000, 'PLA'));
});

test('storage: JSON file survives a reload and export/import round-trips; corrupt imports are refused', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'inv-')), 'inv.json');
  const a = await createInventory(createFileStore(path)); const p = await a.definePart({ name: 'P', designId: 'd', params: {} }); await a.recordPrint(p.id, 3);
  const b = await createInventory(createFileStore(path)); assert.equal(b.stock().parts[p.id], 3);
  const c = await createInventory(createMemoryStore()); await c.importJSON(b.exportJSON()); assert.equal(stockOf(c.state).parts[p.id], 3);
  await assert.rejects(() => c.importJSON('{"version":2}'), /not an inventory export/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldToModel } from '../../src/foldstudio/lib/fold-io.js';
import { ensureIds, cloneModel } from '../../src/foldstudio/lib/model.js';
import { foldStudioToAssembly, compileAssembly, solveSequence, evaluatePoses, deg, targetConnectionIds, validateSequence } from '../../src/folding/index.js';
import { lilyPreset } from '../../src/folding/presets/lily.js';
import { checkCollisions, envelope } from '../../src/folding/collision/validation.js';

const model = () => foldToModel(JSON.parse(readFileSync(new URL('./fixtures/lily.fold', import.meta.url), 'utf8')));
function setup() {
  const m = ensureIds(cloneModel(model()));
  const p = lilyPreset(m);
  const r = foldStudioToAssembly(m, { sheetMm: 100, classification: p.classification });
  const c = compileAssembly(r.assembly);
  const groups = p.groups.map(g => ({ id: g.id, name: g.name, connectionIds: g.creaseIds.flatMap(id => r.groups[id] || []) }));
  return { m, p, r, c, doc: { groups, steps: p.steps } };
}

test('lily preset encodes the designer decisions', () => {
  const { p, r, c } = setup();
  assert.deepEqual(p.summary, { midlines: 8, mainDiagonals: 8, guideFolds: 8, guideJoins: 24 });
  assert.equal(r.issues.filter(i => i.code === 'ambiguousEdge').length, 0);
  assert.ok(c.ok, JSON.stringify(c.issues));
  assert.equal(r.assembly.regions.length, 24);
  assert.equal(r.assembly.connections.length, 40);
});

test('phase 1: single symmetric 1-DOF branch, matches the verified numbers', () => {
  const { c, doc, p } = setup();
  assert.ok(validateSequence(doc, c).ok, JSON.stringify(validateSequence(doc, c).issues));
  const res = solveSequence(c, doc);
  assert.equal(res.status, 'converged', JSON.stringify(res.steps.at(-1)?.failure));
  const A = res.finalAngles;
  const mags = c.variableConnIds.map((id, i) => [id, deg(A[i])]);
  const g = Object.fromEntries(doc.groups.map(x => [x.id, new Set(x.connectionIds)]));
  for (const [id, a] of mags) {
    if (g['lily-midlines'].has(id)) assert.ok(Math.abs(a - 40) < 0.1, `midline ${id} ${a}`);
    else if (g['lily-guide-folds'].has(id)) assert.ok(Math.abs(a) < 0.1, `held crease ${id} ${a}`);
    else if (g['lily-main-diagonals'].has(id)) assert.ok(Math.abs(Math.abs(a) - 92.2) < 0.5, `diagonal ${id} ${a}`);
    else assert.ok(Math.abs(a) < 1, `outer crease ${id} should stay flat, got ${a}`);   // the 16 outer diagonals
  }
  // diagonals fold as mountains (negative), midlines as valleys (positive)
  assert.ok([...g['lily-main-diagonals']].every(id => deg(A[c.varIndex.get(id)]) < 0));
  assert.ok(p.summary.mainDiagonals === 8);
});

test('phase 1 end pose is a clean tent: no interpenetration, plausible envelope', () => {
  const { c, doc } = setup();
  const res = solveSequence(c, doc);
  const poses = evaluatePoses(c, res.finalAngles);
  assert.equal(checkCollisions(c, poses).collisions.length, 0);
  const s = envelope(c, poses).size;
  assert.ok(s.every(v => v < 125) && Math.max(...s) > 60, `envelope ${s}`);
});

test('every sampled configuration along the step stays closed', () => {
  const { c, doc } = setup();
  const res = solveSequence(c, doc);
  assert.ok(res.steps[0].samples.length >= 8);
  assert.ok(res.steps[0].samples.every(s => s.validated));
});

test('fully collapsed preliminary base is reached at midline = 90°', () => {
  const { c, doc } = setup();
  doc.steps[0].controls[0].toDegrees = 90;
  const res = solveSequence(c, doc);
  assert.equal(res.status, 'converged', JSON.stringify(res.steps.at(-1)?.failure));
  const diag = doc.groups.find(g => g.id === 'lily-main-diagonals').connectionIds;
  assert.ok(diag.every(id => Math.abs(Math.abs(deg(res.finalAngles[c.varIndex.get(id)])) - 180) < 1));
});

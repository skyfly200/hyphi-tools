import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyModel, cloneModel, ensureIds, addEdgeWithSplits, cleanupRedundant, creaseIdOf, History, deleteEdges,
} from '../../src/foldstudio/lib/model.js';
import { modelToFOLD, foldToModel } from '../../src/foldstudio/lib/fold-io.js';

function base() { return ensureIds(emptyModel()); }

test('legacy models upgrade in place and IDs are unique and never reused', () => {
  const m = emptyModel();
  assert.equal(m.edges[0].id, undefined);
  ensureIds(m);
  assert.equal(new Set(m.edges.map(e => e.id)).size, 4);
  assert.equal(m.vertexIds.length, 4);
  const seq = m.idSeq;
  deleteEdges(m, [0]);
  addEdgeWithSplits(m, [0, 0], [1, 0], 'B');
  assert.ok(m.idSeq > seq);
});

test('splitting a crease preserves metadata and logical crease ID', () => {
  const m = base();
  addEdgeWithSplits(m, [0, 0.5], [1, 0.5], 'M');
  const mid = m.edges.find(e => e.assignment === 'M');
  mid.foldAngle = -90;
  const logical = creaseIdOf(m, mid);
  // A crossing crease splits the horizontal one at (0.5, 0.5).
  addEdgeWithSplits(m, [0.5, 0], [0.5, 1], 'V');
  const parts = m.edges.filter(e => creaseIdOf(m, e) === logical);
  assert.equal(parts.length, 2);
  assert.ok(parts.every(e => e.foldAngle === -90 && e.assignment === 'M'));
  assert.equal(new Set(parts.map(e => e.id)).size, 2);
  assert.equal(m.vertexIds.length, m.vertices.length);
});

test('merging collinear edges keeps a resolvable logical ID via aliases', () => {
  const m = base();
  addEdgeWithSplits(m, [0, 0.5], [0.5, 0.5], 'M');
  addEdgeWithSplits(m, [0.5, 0.5], [1, 0.5], 'M');
  const [a, b] = m.edges.filter(e => e.assignment === 'M');
  const ca = creaseIdOf(m, a), cb = creaseIdOf(m, b);
  assert.notEqual(ca, cb);
  const removed = cleanupRedundant(m);
  assert.ok(removed >= 1);
  const merged = m.edges.filter(e => e.assignment === 'M');
  assert.equal(merged.length, 1);
  // Both old logical IDs still resolve to the surviving crease.
  assert.equal(creaseIdOf(m, { crease: ca }), creaseIdOf(m, merged[0]));
  assert.equal(creaseIdOf(m, { crease: cb }), creaseIdOf(m, merged[0]));
});

test('undo/redo restores IDs and attached folding metadata', () => {
  const m = base();
  m.foldform = { version: 1, steps: [{ id: 's1' }] };
  const h = new History(m);
  const next = cloneModel(m);
  addEdgeWithSplits(next, [0, 0.5], [1, 0.5], 'V');
  next.foldform.steps.push({ id: 's2' });
  h.push(next);
  const back = h.undo();
  assert.equal(back.foldform.steps.length, 1);
  assert.deepEqual(back.edges.map(e => e.id), m.edges.map(e => e.id));
  const fwd = h.redo();
  assert.equal(fwd.foldform.steps.length, 2);
  assert.ok(fwd.edges.some(e => e.assignment === 'V'));
});

test('FOLD export/import round-trips IDs, aliases and foldform:* extensions', () => {
  const m = base();
  addEdgeWithSplits(m, [0, 0.5], [1, 0.5], 'M');
  m.foldform = { version: 1, units: 'mm', steps: [{ id: 's1', title: 'Open' }], groups: [{ id: 'g', connectionIds: ['x'] }] };
  const fold = modelToFOLD(m, { ids: true });
  assert.equal(fold['foldform:version'], 1);
  const back = foldToModel(JSON.parse(JSON.stringify(fold)));
  assert.deepEqual(back.edges.map(e => e.id), m.edges.map(e => e.id));
  assert.deepEqual(back.vertexIds, m.vertexIds);
  assert.deepEqual(back.foldform, m.foldform);
  // Files exported without IDs still import.
  const plain = foldToModel(modelToFOLD(m, { ids: false }));
  assert.equal(plain.edges.length, m.edges.length);
});

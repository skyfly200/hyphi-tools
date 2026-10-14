// Persistence helpers: carry the folding recipe inside / alongside a FoldStudio
// model so it survives save, load, undo and FOLD export (as `foldform:*` keys).

import { SEQUENCE_VERSION } from './sequence.js';

export function emptyFoldform(units = 'mm') {
  return { version: SEQUENCE_VERSION, units, physical: {}, groups: [], steps: [], configurations: [] };
}

export function attachSequence(model, foldform) {
  model.foldform = JSON.parse(JSON.stringify(foldform));
  return model;
}

/** Throws on a document written by a newer, incompatible schema. */
export function readFoldform(model) {
  const f = model.foldform;
  if (!f) return null;
  if (typeof f.version === 'number' && f.version > SEQUENCE_VERSION) {
    throw new Error(`foldform:version ${f.version} is newer than supported (${SEQUENCE_VERSION})`);
  }
  return { ...emptyFoldform(f.units), ...f };
}

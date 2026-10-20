// Node JSON-file storage (atomic write). Good for a local server or a shared folder.
import { readFile, writeFile, rename } from 'node:fs/promises';

export const createFileStore = path => ({
  load: async () => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
  save: async state => { const tmp = `${path}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(state, null, 1)); await rename(tmp, path); },
});

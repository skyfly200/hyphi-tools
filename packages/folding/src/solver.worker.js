// Web Worker entry. Created with:
//   new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' })
import { createSolverService } from './worker-core.js';

const service = createSolverService();
self.onmessage = e => { service.handle(e.data, msg => self.postMessage(msg)); };

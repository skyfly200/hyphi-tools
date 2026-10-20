#!/usr/bin/env node
// Run the hosted slicing server.
//   SLICER_API_KEYS=key1,key2 PORT=8787 node scripts/slice-server.mjs
// Env: SLICER_API_KEYS (comma list, required unless SLICER_ALLOW_ANON=1), PORT, HOST (default 0.0.0.0 in a container,
// 127.0.0.1 otherwise), SLICER_CORS_ORIGINS (comma list or *), SLICER_CONCURRENCY, SLICER_JOB_TIMEOUT_S, PRUSA_SLICER, ORCA_SLICER (paths to the CLIs),
// ORCA_XVFB=1 (wrap Orca in `xvfb-run -a`), ORCA_BASE_DIR (dir with machine.json/process.json/filament.json exported from your Orca).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createSlicingServer } from '@hyphi/slicer/server';

const env = process.env, list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const dir = new URL('../slicer-profiles/', import.meta.url), profiles = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))) : [];
const bases = {};
if (env.ORCA_BASE_DIR) for (const k of ['machine', 'process', 'filament']) { const f = new URL(`${k}.json`, `file://${env.ORCA_BASE_DIR.replace(/\/?$/, '/')}`); if (existsSync(f)) bases[k] = JSON.parse(readFileSync(f, 'utf8')); }
const s = createSlicingServer({
  apiKeys: list(env.SLICER_API_KEYS), allowAnonymous: env.SLICER_ALLOW_ANON === '1', corsOrigins: list(env.SLICER_CORS_ORIGINS), profiles,
  concurrency: +env.SLICER_CONCURRENCY || 2, jobTimeoutMs: (+env.SLICER_JOB_TIMEOUT_S || 300) * 1000, prusaPath: env.PRUSA_SLICER || null,
  orca: env.ORCA_SLICER ? { path: env.ORCA_SLICER, wrapper: env.ORCA_XVFB === '1' ? ['xvfb-run', '-a'] : undefined, bases } : null,
});
const host = env.HOST || (env.CONTAINER ? '0.0.0.0' : '127.0.0.1');
const { port } = await s.listen(+env.PORT || 8787, host);
console.log(`slicing server on http://${host}:${port}  engines: ${s.engines.join(', ')}  auth: ${env.SLICER_ALLOW_ANON === '1' ? 'OPEN (development only)' : 'API key'}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.close().then(() => process.exit(0)));

// Run an external slicer CLI (PrusaSlicer or OrcaSlicer) on an STL with a @hyphi/slicer profile and return its G-code.
// Node only. Arguments are passed as an array (no shell); every run gets its own temp directory (and, for Orca, its own
// --datadir, because concurrent Orca processes sharing one config directory can overwrite each other).

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toPrusaIni, toOrcaProfiles } from '../profile.js';

/**
 * @param {'prusa'|'orca'} engine
 * @param {{ stl: Uint8Array, profile: object, config: { path: string, wrapper?: string[], bases?: object }, timeoutMs?: number, onChild?: (child)=>void }} job
 */
export async function runExternalSlicer(engine, { stl, profile, config, timeoutMs = 300000, onChild }) {
  const dir = await mkdtemp(join(tmpdir(), `slice-${engine}-`));
  try {
    const stlPath = join(dir, 'in.stl'), outDir = join(dir, 'out'); await writeFile(stlPath, stl); await mkdir(outDir);
    let cmd = [config.path], args;
    if (engine === 'prusa') {
      const ini = join(dir, 'profile.ini'), out = join(outDir, 'out.gcode'); await writeFile(ini, toPrusaIni(profile));
      args = ['--export-gcode', '--load', ini, '--output', out, stlPath];
    } else {
      const { machine, process, filament } = toOrcaProfiles(profile, config.bases || {}), files = { machine: join(dir, 'machine.json'), process: join(dir, 'process.json'), filament: join(dir, 'filament.json') };
      await Promise.all([['machine', machine], ['process', process], ['filament', filament]].map(([k, v]) => writeFile(files[k], JSON.stringify(v))));
      args = ['--datadir', join(dir, 'datadir'), '--slice', '0', '--load-settings', `${files.machine};${files.process}`, '--load-filaments', files.filament, '--outputdir', outDir, stlPath];
    }
    if (config.wrapper?.length) { args = [...cmd, ...args]; cmd = config.wrapper; }
    await new Promise((resolve, reject) => {
      const c = spawn(cmd[0], [...cmd.slice(1), ...args], { stdio: ['ignore', 'ignore', 'pipe'], cwd: dir }); onChild?.(c);
      let err = ''; c.stderr.on('data', d => { err = (err + d).slice(-2000); });
      const t = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('external slicer timed out')); }, timeoutMs);
      c.on('error', e => { clearTimeout(t); reject(e); });
      c.on('exit', (code, sig) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`${engine} slicer failed (${code ?? sig}): ${err.trim().split('\n').pop() || 'no output'}`)); });
    });
    const files = (await readdir(outDir).catch(() => [])).filter(f => /\.(gcode|gco)$/i.test(f)).sort();
    if (!files.length) throw new Error(`${engine} slicer finished but produced no G-code`);
    return await readFile(join(outDir, files[0]), 'utf8');
  } finally { rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

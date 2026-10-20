#!/usr/bin/env node
// Recover a slicing profile from a G-code, or a slicer project / G-code 3MF you already know works.
//   node scripts/import-settings.mjs good-print.gcode [--out slicer-profiles/my-good-petg.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { importProfile } from '@hyphi/slicer';

const file = process.argv[2], oi = process.argv.indexOf('--out');
if (!file) { console.error('usage: import-settings.mjs file.(gcode|3mf) [--out profile.json]'); process.exit(2); }
const bytes = new Uint8Array(readFileSync(file)), zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
const r = await importProfile(zip ? bytes : new TextDecoder().decode(bytes), file.split('/').pop());
console.error(`source: ${r.source} (${r.from})`);
for (const f of r.found) console.error(`  ${f.key} = ${f.value}   <- ${f.from}`);
r.notes.forEach(n => console.error(`note: ${n}`));
if (r.measured) console.error(`measured: ${JSON.stringify(r.measured)}`);
const out = JSON.stringify(r.profile, null, 2);
if (oi > 0) { writeFileSync(process.argv[oi + 1], out + '\n'); console.error(`wrote ${process.argv[oi + 1]}`); } else console.log(out);

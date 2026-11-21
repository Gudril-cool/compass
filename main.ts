// Compass — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot (--input <file|dir>, default /input), prices every
// rankable protocol that records no token against its nearest tokenized twins
// (lib/model.ts), and writes the run to the output directory
// (MAKEFUN_OUTPUT_DIR, or /output in the grader's container):
//
//   board.json    the ranked board the gate reads
//   data.js       the same board, shaped for the dashboard
//   dashboard/    the static, fully offline page
//   screenshots/  the three screenshots handed in with it
//   dossier.json  buildDossier's summary of the dashboard and screenshots
//
// The output directory is cleared before each run, so two runs on the same
// snapshot write byte-identical bytes and never inherit stale files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> (or --name=<value>) out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`compass: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`compass: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Clear the output directory's contents before writing, per the entry's
// determinism rule. The directory itself is never removed: in the grader's
// container /output is a mounted volume, and removing a mount point throws
// (that is what failed this entry's first server run — clearing only the
// contents achieves the same clean slate everywhere).
if (existsSync(out)) {
  for (const name of readdirSync(out)) rmSync(join(out, name), { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`compass: screenshots/ holds ${shots.length} images: hand in 3\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`compass: screenshots/${name}: bad image name\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `compass: ${snapshot.protocols.length} protocols, ${radar.peer_size} tokenized peers, ${board.length} rows ranked (${radar.early_size} outside the watchlist, ${radar.fallback_size} priced by category fallback)\n` +
    `compass: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json under ${out}\n`,
);

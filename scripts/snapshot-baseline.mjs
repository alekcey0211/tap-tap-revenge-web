import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASELINE_COMMIT = '8a55780aaa62cd1bf0e95e6ba4023b5ef1bbea96';
export const SCENARIOS = ['perfect', 'revenge', 'mistakes'];
export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function replayChart(Game, chart, scenario) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  const game = new Game(chart);
  const actions = chart.flatMap((note, index) => {
    if (scenario === 'mistakes' && index % 11 === 0) return [];
    const offset = scenario === 'mistakes' && index % 7 === 0 ? -0.06 : 0;
    const earlyRelease = scenario === 'mistakes' && index % 5 === 0 && note.duration > 0 ? 0.15 : 0;
    return [{ t: note.time + offset, lane: note.lane, down: true },
      { t: note.time + (note.duration || 0.035) - earlyRelease, lane: note.lane, down: false }];
  }).sort((a, b) => a.t - b.t || Number(a.down) - Number(b.down));
  for (const action of actions) {
    if (action.down) game.press(action.lane, action.t);
    else game.release(action.lane, action.t);
    if (scenario === 'revenge' && game.revengeReady) game.activateRevenge(action.t);
  }
  return game.finish();
}

export async function createBaseline(repository) {
  const git = args => execFileSync('git', args, { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  const actual = git(['rev-parse', 'v0.1.0^{commit}']).toString().trim();
  if (actual !== BASELINE_COMMIT) throw new Error('v0.1.0 no longer points to the verified baseline');
  const readBaseline = path => git(['show', `${BASELINE_COMMIT}:${path}`]);
  const directory = await mkdtemp(join(tmpdir(), 'tap-tap-baseline-'));
  try {
    const engine = readBaseline('dist/engine.js');
    const enginePath = join(directory, 'engine.mjs');
    await writeFile(enginePath, engine);
    const { Game } = await import(pathToFileURL(enginePath).href);
    const catalogData = readBaseline('dist/assets/catalog.json');
    const catalog = JSON.parse(catalogData);
    const charts = [];
    for (const song of catalog) {
      for (const level of Object.keys(song.levels)) {
        const path = `dist/assets/tracks/${song.id}/${level}.json`;
        const data = readBaseline(path);
        const chart = JSON.parse(data);
        charts.push({ path, sha256: sha256(data), results: Object.fromEntries(
          SCENARIOS.map(scenario => [scenario, replayChart(Game, chart, scenario)])) });
      }
    }
    return { commit: BASELINE_COMMIT, engineSha256: sha256(engine), catalogSha256: sha256(catalogData), charts };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const baseline = await createBaseline(root);
  await mkdir(join(root, 'output'), { recursive: true });
  const destination = join(root, 'output/baseline-v0.1.0.json');
  await writeFile(destination, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline from ${baseline.commit}: ${baseline.charts.length} charts → ${destination}`);
}

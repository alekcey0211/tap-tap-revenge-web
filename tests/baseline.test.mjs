import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game } from '../dist/engine.js';
import { BASELINE_COMMIT, replayChart, sha256 } from '../scripts/snapshot-baseline.mjs';

const baseline = JSON.parse(await readFile(new URL('./fixtures/baseline-v0.1.0.json', import.meta.url)));

test('baseline identifies the verified version and archived source catalog', async () => {
  assert.equal(baseline.commit, BASELINE_COMMIT);
  assert.equal(baseline.charts.length, 13);
  assert.equal(new Set(baseline.charts.map(chart => chart.path)).size, 13);
  const original = await readFile(new URL('./fixtures/catalog-v0.1.0.json', import.meta.url));
  assert.equal(sha256(original), baseline.catalogSha256);
});

for (const entry of baseline.charts) {
  test(`${entry.path}: source data and all baseline scenarios`, async () => {
    const data = await readFile(new URL(`./fixtures/legacy-charts/${entry.path.replace('dist/assets/tracks/', '')}`, import.meta.url));
    assert.equal(sha256(data), entry.sha256);
    const chart = JSON.parse(data);
    assert.deepEqual(Object.keys(entry.results), ['perfect', 'revenge', 'mistakes']);
    for (const [scenario, expected] of Object.entries(entry.results)) {
      assert.deepEqual(replayChart(Game, chart, scenario), expected, scenario);
    }
  });
}

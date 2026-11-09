import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game, pathPosition, HIT_WINDOW, TRAVEL } from '../dist/engine.js';
const note = (time, lane = 0, duration = 0) => ({ time, lane, duration, shake: false });
test('timing boundaries and independent simultaneous lanes', () => {
  for (const error of [-HIT_WINDOW, -.14, -.09, -.045, 0, .045, .09, .14, HIT_WINDOW]) {
    const game = new Game([note(1)]);
    assert.ok(game.press(0, 1 + error)); assert.equal(game.hits, 1); assert.equal(game.misses, 0);
  }
  const game = new Game([note(1), note(1, 1), note(1, 2)]);
  for (let lane = 0; lane < 3; lane++) game.press(lane, 1);
  assert.equal(game.hits, 3); assert.equal(game.accuracy, 100);
});
test('miss, wrong lane and key repeat never consume upcoming notes', () => {
  const game = new Game([note(1), note(2)]);
  game.press(1, 1); assert.equal(game.hits, 0);
  game.press(0, 1); game.press(0, 2); assert.equal(game.hits, 1);
  game.update(2.181); assert.equal(game.misses, 1); assert.equal(game.streak, 0);
  assert.equal(game.accuracy, 50);
});
test('hold completion and early release', () => {
  const game = new Game([note(1, 0, 2)]);
  game.press(0, 1); game.update(3); game.release(0, 3);
  assert.equal(game.score, 150); assert.equal(game.brokenHolds, 0);
  const broken = new Game([note(1, 0, 2)]);
  broken.press(0, 1); broken.release(0, 2); broken.update(4);
  assert.equal(broken.brokenHolds, 1); assert.equal(broken.score, 100);
  assert.equal(broken.streak, 0);
});
test('multipliers at 20, 30, 40 and revenge at 50; reset on a miss', () => {
  const game = new Game(Array.from({ length: 51 }, (_, i) => note(i + 1)));
  for (let i = 1; i <= 50; i++) {
    game.press(0, i); game.release(0, i + .01);
    if ([20, 30, 40].includes(i)) assert.equal(game.multiplier(i), i / 10);
  }
  assert.equal(game.revengeReady, true); assert.equal(game.activateRevenge(50.1), true);
  assert.equal(game.multiplier(50.1), 8); assert.equal(game.activateRevenge(50.2), false);
  game.update(51.2); assert.equal(game.multiplier(51.2), 1);
});
test('paths and travel times reproduce the Lua theme', async () => {
  const paths = JSON.parse(await readFile(new URL('../dist/assets/paths.json', import.meta.url)));
  assert.deepEqual(pathPosition(paths, 0, 0), [295, 53]);
  assert.deepEqual(pathPosition(paths, 0, 1), [54, 422]);
  assert.deepEqual(pathPosition(paths, 2, 1), [266, 422]);
  assert.deepEqual(TRAVEL, { 1: 2.7, 2: 2.15, 3: 1.8, 4: 1.4 });
});
const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
for (const song of catalog) {
  for (const [level, summary] of Object.entries(song.levels)) {
    test(`${song.title} / ${level}: real chart integrity and complete autoplay`, async () => {
      const chart = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
      assert.equal(chart.length, summary.notes);
      for (const [i, n] of chart.entries()) {
        assert.ok(n.lane >= 0 && n.lane <= 2); assert.ok(n.time >= 0 && n.time < song.duration);
        assert.ok(n.duration >= 0 && n.time + n.duration < song.duration);
        if (i) assert.ok(chart[i - 1].time <= n.time);
      }
      const game = new Game(chart);
      const actions = chart.flatMap(n => [{ t: n.time, lane: n.lane, down: true }, { t: n.time + (n.duration || .035), lane: n.lane, down: false }])
        .sort((a, b) => a.t - b.t || Number(a.down) - Number(b.down));
      for (const a of actions) {
        if (a.down) game.press(a.lane, a.t); else game.release(a.lane, a.t);
      }
      const result = game.finish();
      assert.equal(result.hits, chart.length); assert.equal(result.misses, 0);
      assert.equal(result.brokenHolds, 0); assert.equal(result.accuracy, 100);
      assert.equal(result.strays, 0);
    });
  }
}

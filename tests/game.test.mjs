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
  for (const [level, summary] of Object.entries(song.levels)) for (const automaticRevenge of [false, true]) {
    test(`${song.title} / ${level}: real chart integrity and complete autoplay (${automaticRevenge ? 'auto' : 'legacy'})`, async () => {
      const chart = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
      assert.equal(chart.length, summary.notes);
      for (const [i, n] of chart.entries()) {
        assert.ok(n.lane >= 0 && n.lane <= 2); assert.ok(n.time >= 0 && n.time < song.duration);
        assert.ok(n.duration >= 0 && n.time + n.duration < song.duration);
        if (i) assert.ok(chart[i - 1].time <= n.time);
      }
      const game = new Game(chart, { automaticRevenge });
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

test('automatic x8 begins at 50 heads, has no timer and never requires activation', () => {
  const game = new Game(Array.from({ length: 51 }, (_, i) => note(i + 1)), { automaticRevenge: true });
  for (let i = 1; i <= 49; i++) { game.press(0, i); game.release(0, i + .01); }
  assert.equal(game.multiplier(49), 4);
  const before = game.score;
  game.press(0, 50); game.release(0, 50.01);
  assert.equal(game.score - before, 400, '50th head uses the pre-hit multiplier, like the other thresholds');
  assert.equal(game.multiplier(50), 8); assert.equal(game.revengeReady, false);
  assert.equal(game.activateRevenge(50), false);
  game.press(0, 51); game.release(0, 51.01);
  assert.equal(game.score - before, 1200);
  game.update(500); assert.equal(game.multiplier(500), 8, 'no remaining notes and no error: bonus does not expire');
});

for (const failure of ['miss', 'stray', 'broken']) test(`automatic x8 resets on ${failure}, then can be earned again`, () => {
  const chart = Array.from({ length: 50 }, (_, i) => note(i + 1));
  if (failure !== 'stray') chart.push(note(51, 0, failure === 'broken' ? 2 : 0));
  chart.push(...Array.from({ length: 50 }, (_, i) => note(60 + i)));
  const game = new Game(chart, { automaticRevenge: true });
  for (let i = 1; i <= 50; i++) { game.press(0, i); game.release(0, i + .01); }
  if (failure === 'miss') game.update(51.2);
  else if (failure === 'stray') { game.press(1, 51); game.release(1, 51.01); }
  else { game.press(0, 51); game.release(0, 51.5); }
  assert.equal(game.multiplier(52), 1);
  for (let i = 60; i < 110; i++) { game.press(0, i); game.release(0, i + .01); }
  assert.equal(game.multiplier(110), 8);
});

test('automatic ×16 begins at 100 heads, persists and resets on a stray', () => {
  const game = new Game(Array.from({ length: 102 }, (_, i) => note(i + 1)), { automaticRevenge: true });
  for (let i = 1; i <= 99; i++) { game.press(0, i); game.release(0, i); }
  assert.equal(game.multiplier(99), 8);
  const before = game.score;
  game.press(0, 100); game.release(0, 100);
  assert.equal(game.score - before, 800, 'threshold head uses preceding multiplier');
  assert.equal(game.multiplier(100), 16);
  game.press(0, 101); game.release(0, 101);
  assert.equal(game.score - before, 2400);
  game.press(0, 102); game.release(0, 102);
  game.update(500); assert.equal(game.multiplier(500), 16);
  game.press(2, 501); assert.equal(game.multiplier(501), 1);
});

for (const failure of ['miss', 'hold']) test(`×16 resets after ${failure}`, () => {
  const game = new Game([note(1, 0, failure === 'hold' ? 2 : 0)], { automaticRevenge: true });
  game.streak = 100;
  if (failure === 'hold') { game.press(0, 1); game.release(0, 1.1); }
  else game.update(2);
  assert.equal(game.multiplier(2), 1);
});

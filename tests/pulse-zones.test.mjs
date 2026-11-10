import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { choosePulseZones } from '../dist/pulse-zones.js';
import { PULSE_CHARTS, PULSE_COUNTS } from '../dist/phrase-charts.js';
import { PhraseProgress } from '../dist/phrase-progress.js';
import { Game } from '../dist/engine.js';
const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (const song of catalog.filter(song => !song.tutorial)) for (const level of Object.keys(song.levels)) {
  test(`${song.title} / ${level}: random zones have musical bounds, notes and real gaps`, async () => {
    const notes = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
    const original = JSON.stringify(notes), ends = PULSE_CHARTS[song.id], count = PULSE_COUNTS[song.id];
    const grid = new Set([0, ...ends, ...ends.map((end, i) => (end + (ends[i - 1] || 0)) / 2)]);
    const layouts = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      const zones = choosePulseZones(notes, ends, count, random(seed)); layouts.add(JSON.stringify(zones));
      assert.equal(zones.length, count);
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i]; assert.ok(grid.has(zone.start) && grid.has(zone.end));
        assert.ok(zone.end - zone.start >= 6 - 1e-5 && zone.end - zone.start <= 14);
        if (i) assert.ok(zone.start - zones[i - 1].end >= 4 - 1e-6);
        assert.ok(notes.some(note => note.time >= zone.start - 1e-6 && note.time < zone.end - 1e-6));
      }
    }
    assert.ok(layouts.size > 1, 'new attempts do not use a fixed map');
    assert.equal(JSON.stringify(notes), original);
  });
}
test('notes and stray taps outside Pulse zones do not fail later zones; layout stays fixed', () => {
  const game = new Game([{ time: 1, lane: 0, duration: 0 }, { time: 7, lane: 1, duration: 0 }]);
  const pulse = new PhraseProgress(game.notes, [12], [{ start: 6, end: 12 }]);
  assert.equal(pulse.view(0).waiting, true); assert.equal(pulse.view(0).startsIn, 6);
  const layout = pulse.zones(5, 3);
  game.press(2, 2); pulse.recordInput(2, game.strays); game.release(2, 2.01);
  game.press(1, 7); pulse.recordInput(7, game.strays); game.release(1, 7.01);
  game.update(12); pulse.advance(12);
  assert.equal(game.misses, 1); assert.equal(game.strays, 1);
  assert.equal(pulse.finish().captured, 1);
  assert.deepEqual(pulse.zones(5, 3), layout);
});
test('sparse charts finish without random retries or empty rewards', () => {
  assert.deepEqual(choosePulseZones([], [10, 20], 3, () => 0), []);
  const zones = choosePulseZones([{ time: 1 }], [10, 20], 3, () => .99999);
  assert.equal(zones.length, 1);
});

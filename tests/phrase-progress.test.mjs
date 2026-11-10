import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game } from '../dist/engine.js';
import { PhraseProgress, PULSE_RULES } from '../dist/phrase-progress.js';
import { PULSE_CHARTS, PHRASE_VERSION, PULSE_COUNTS } from '../dist/phrase-charts.js';
import { replayChart } from '../scripts/snapshot-baseline.mjs';

const note = (time, lane = 0, duration = 0) => ({ time, lane, duration });
function session(chart, ends = [10]) {
  const game = new Game(chart), pulse = new PhraseProgress(game.notes, ends);
  return { game, pulse, hit(lane, time, release = time + .035) {
    game.press(lane, time); pulse.recordInput(time, game.strays); game.release(lane, release);
  }, advance(time) { game.update(time); pulse.advance(time); } };
}

test('exact 90% passes, below threshold never rounds up; ideal is counted once', () => {
  for (const [offsets, captured, perfect] of [[[0, .06], 1, 0], [[0, .12], 0, 0], [[0, 0], 1, 1]]) {
    const s = session([note(1), note(2)]);
    offsets.forEach((offset, i) => s.hit(0, i + 1 + offset)); s.advance(10);
    const expected = { pulseRules: PULSE_RULES, phraseVersion: PHRASE_VERSION, total: 1, captured, perfect };
    assert.deepEqual(s.pulse.finish(), expected); assert.deepEqual(s.pulse.finish(), expected);
    s.pulse.recordInput(3, 10); s.pulse.advance(Infinity); assert.deepEqual(s.pulse.finish(), expected);
  }
  const chart = Array.from({ length: 201 }, (_, i) => note(1 + i / 1000, i % 3));
  const game = new Game(chart);
  // Public observer also accepts engine-shaped settled notes; 100 Perfect + 101 Great = 89.9502%.
  game.notes.forEach((n, i) => { n.state = 'done'; n.judgment = i < 100 ? 'PERFECT' : 'GREAT'; });
  const pulse = new PhraseProgress(game.notes, [10]); pulse.advance(10);
  assert.ok(pulse.view(10).result.accuracy > 89.95); assert.equal(pulse.finish().captured, 0);
});

test('miss, stray and broken hold each fail independently, earlier awards remain', () => {
  const s = session([note(1), note(11), note(21, 0, 2), note(31)], [10, 20, 30, 40]);
  s.hit(0, 1); s.advance(10);
  s.hit(1, 12); // Miss in phrase 2 plus a stray.
  s.hit(0, 21, 21.3); s.advance(30);
  s.hit(0, 31); s.advance(40);
  assert.deepEqual(s.pulse.finish(), { pulseRules: PULSE_RULES, phraseVersion: PHRASE_VERSION, total: 4, captured: 2, perfect: 2 });
});

test('strays use input intervals, boundary belongs to next, cumulative reports are idempotent', () => {
  const s = session([note(1), note(11)], [10, 20]);
  s.hit(0, 1); s.hit(2, 10); s.pulse.recordInput(10, 1); s.advance(10);
  assert.equal(s.pulse.view(10).result.captured, true);
  s.hit(0, 11); s.advance(20);
  assert.equal(s.pulse.view(20).result.strays, 1); assert.equal(s.pulse.finish().captured, 1);
});

test('held lane repeat/reclaim is not a stray, while a real extra input fails Pulse', () => {
  const s = session([note(1, 0, 4)]);
  s.game.press(0, 1); s.pulse.recordInput(1, s.game.strays);
  s.game.press(0, 2); s.pulse.recordInput(2, s.game.strays);
  s.game.held[0] = false; // Existing pause releases held flags, without breaking a hold.
  s.game.press(0, 3); s.pulse.recordInput(3, s.game.strays);
  s.game.release(0, 5); s.advance(10);
  assert.equal(s.pulse.finish().perfect, 1);
  const extra = session([note(1)]); extra.hit(0, 1); extra.hit(1, 2); extra.advance(10);
  assert.equal(extra.pulse.view(10).result.strays, 1); assert.equal(extra.pulse.finish().captured, 0);
});

test('a hold crossing the boundary belongs to its head; tail and late head window must settle', () => {
  const s = session([note(9, 0, 3), note(10, 1)], [10, 20]);
  s.game.press(0, 9); s.game.press(1, 10); s.game.release(1, 10.01);
  s.advance(10); assert.equal(s.pulse.view(10).result, null); assert.equal(s.pulse.view(10).done, 0);
  s.game.release(0, 11.95); s.advance(12.001); assert.equal(s.pulse.view(12.001).result.perfect, true);
  assert.equal(s.pulse.finish().perfect, 2);
  const late = session([note(9.95)], [10]); late.advance(10);
  assert.equal(late.pulse.view(10).result, null);
  late.hit(0, 10.01); late.advance(10.14);
  assert.equal(late.pulse.view(10.14).result.misses, 0);
});

test('hold break after the boundary fails its own phrase, not the next one', () => {
  const s = session([note(9, 0, 3), note(11, 1)], [10, 20]);
  s.hit(0, 9, 10.2); s.hit(1, 11); s.advance(20);
  assert.equal(s.pulse.finish().captured, 1); assert.equal(s.pulse.finish().perfect, 1);
});

test('observer never mutates Game, empty intervals cannot earn rewards', () => {
  const s = session([note(1)], [10, 20]);
  const before = structuredClone(s.game); s.pulse.advance(11); s.pulse.finish();
  assert.deepEqual(structuredClone(s.game), before);
  assert.equal(s.pulse.finish().total, 1); assert.equal(s.pulse.finish().captured, 0);
  assert.equal(new PhraseProgress([], [10]).view(0), null);
  for (const ends of [[], [0], [NaN], [10, 5], [1]]) assert.throws(() => new PhraseProgress([note(1)], ends));
});

const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
for (const song of catalog.filter(song => !song.tutorial)) {
  for (const level of Object.keys(song.levels)) {
    test(`${song.title} / ${level}: every note has exactly one phrase, all base scenarios unchanged`, async () => {
      const chart = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
      let observed;
      class ObservedGame extends Game {
        constructor(chart) { super(chart); observed = new PhraseProgress(this.notes, PULSE_CHARTS[song.id]); }
        press(lane, time) { const result = super.press(lane, time); observed.recordInput(time, this.strays); observed.advance(time); return result; }
        release(lane, time) { super.release(lane, time); observed.advance(time); }
        finish() { const result = super.finish(); observed.finish(); return result; }
      }
      for (const scenario of ['perfect', 'revenge', 'mistakes']) {
        assert.deepEqual(replayChart(ObservedGame, chart, scenario), replayChart(Game, chart, scenario));
        assert.equal(observed.phrases.length, PULSE_CHARTS[song.id].length);
        assert.equal(new Set(observed.phrases.flatMap(phrase => phrase.notes)).size, chart.length);
        if (scenario !== 'mistakes') assert.equal(observed.finish().perfect, observed.finish().total);
      }
    });
  }
}

test('after the last verdict the outro shows a summary, not a promise of another phrase', () => {
  const s = session([note(1)]); s.hit(0, 1); s.advance(10);
  assert.equal(s.pulse.view(10).recent, true);
  const view = s.pulse.view(12);
  assert.equal(view.finished, true); assert.equal(view.recent, false); assert.equal(view.captured, 1); assert.equal(view.perfect, 1);
});

test('eight of ten Pulse awards can coexist with zero missed notes', () => {
  const s = session(Array.from({ length: 10 }, (_, i) => note(i * 10 + 1)), Array.from({ length: 10 }, (_, i) => (i + 1) * 10));
  for (let i = 0; i < 10; i++) s.hit(0, i * 10 + 1 + ([2, 8].includes(i) ? .06 : 0));
  s.advance(101);
  assert.equal(s.game.misses, 0); assert.equal(s.game.hits, 10);
  assert.equal(s.pulse.finish().captured, 8);
  assert.equal(s.pulse.phrases[2].result.accuracy, 80);
});

test('visible Pulse zones follow musical boundaries, including crossing holds and empty gaps', () => {
  const s = session([note(9, 0, 3), note(11, 1), note(31)], [10, 20, 30, 40]);
  const before = JSON.stringify(s.pulse);
  const zones = s.pulse.zones(9, 2);
  assert.deepEqual(zones, [{ index: 1, start: 0, end: 10 }, { index: 2, start: 10, end: 20 }]);
  assert.deepEqual(s.pulse.zones(9, 2), zones, 'pause freezes the visible sections');
  assert.equal(JSON.stringify(s.pulse), before, 'render data never changes awards or notes');
  assert.deepEqual(s.pulse.zones(10.1, 2), [{ index: 2, start: 10, end: 20 }], 'old hold does not delay the next boundary');
  assert.deepEqual(s.pulse.zones(25, 2), []);
  assert.deepEqual(s.pulse.zones(29, 2), [{ index: 3, start: 30, end: 40 }]);
  assert.deepEqual(s.pulse.zones(41, 2), []);
});

test('random layout requests three zones in short tracks and four or five in longer tracks', () => {
  assert.equal(PHRASE_VERSION, 'random-zones-v1'); assert.equal(PULSE_RULES, 'strict-v1');
  const counts = { 'overdrive-v1': 3, 'neon-circuit-v1': 3,
    '0734D2E4-7693-418B-82F8-C6D88A02A782': 4, 'D0FE6721-1476-45C2-A8BA-0686488282BF': 5,
    'F522698F-40CC-4E05-9164-00CFFF8576B7': 5 };
  assert.deepEqual(PULSE_COUNTS, counts);
});

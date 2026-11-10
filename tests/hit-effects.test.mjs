import test from 'node:test';
import assert from 'node:assert/strict';
import { HitEffects } from '../dist/hit-effects.js';
import { Game } from '../dist/engine.js';
import { mount } from './helpers/ui-harness.mjs';
import { Renderer } from '../dist/renderer.js?v=0.8.1';

const note = { lane: 1, judgment: 'PERFECT' };
test('only successful heads generate bursts; effects use song time and bounded memory', () => {
  const effects = new HitEffects();
  effects.recordHit(null, 1, 1); effects.recordHit({ lane: 0 }, 1, 1);
  assert.equal(effects.frame(1, 1).hits.length, 0);
  effects.recordHit(note, 2, 4); const snapshot = effects.frame(4, 2.1);
  assert.deepEqual(effects.frame(4, 2.1), snapshot, 'paused clock freezes particles and transition');
  assert.equal(effects.frame(4, 1.9).hits.length, 0, 'future hits are not drawn during countdown');
  assert.equal(effects.frame(4, 2.2).hits.length, 1);
  assert.equal(effects.frame(4, 2.61).hits.length, 0);
  for (let i = 0; i < 1000; i++) effects.recordHit(note, 3, 8);
  assert.equal(effects.frame(8, 3).hits.length, 24);
  effects.reset(); assert.deepEqual(effects.frame(1, 0), { multiplier: 1, hits: [], judgments: [null, null, null], transition: null });
  assert.deepEqual(note, { lane: 1, judgment: 'PERFECT' });
});

test('all actual multipliers including x3, Revenge expiry and miss are reflected exactly', () => {
  const game = new Game(Array.from({ length: 70 }, (_, i) => ({ time: i + 1, lane: 0, duration: 0 })));
  const effects = new HitEffects(), seen = new Set();
  for (let i = 1; i <= 50; i++) {
    const hit = game.press(0, i); effects.recordHit(hit, i, game.multiplier(i)); game.release(0, i + .01);
    seen.add(effects.frame(game.multiplier(i), i).multiplier);
  }
  assert.deepEqual([...seen], [1, 2, 3, 4]);
  game.activateRevenge(50);
  const active = effects.frame(game.multiplier(50), 50);
  assert.deepEqual(active.transition, { from: 4, to: 8, time: 50, age: 0 });
  assert.equal(effects.frame(8, 52).transition, null, 'banner does not restart every frame');
  const expired = effects.frame(game.multiplier(65), 65);
  assert.equal(expired.multiplier, 4); assert.equal(expired.transition.from, 8);
  game.update(66);
  assert.equal(effects.frame(game.multiplier(66), 66).multiplier, 1);
});

const pointer = { pointerId: 1, preventDefault() {} };
for (const compatibleAudio of [false, true]) {
  test(`hit effects integrate without extra presses, audio or records (${compatibleAudio ? 'native' : 'Web Audio'})`, async t => {
    const chart = [{ time: 1, lane: 0, duration: 0 }, { time: 3, lane: 1, duration: 5 }];
    const ui = await mount(t, { chart, settings: { compatibleAudio } });
    let renderer;
    const original = Renderer.prototype.render;
    t.mock.method(Renderer.prototype, 'render', function (...args) { renderer = this; return original.apply(this, args); });
    await ui.start();
    function tick(position) { if (compatibleAudio) ui.native.instances.at(-1).currentTime = position; ui.tick(position); }
    tick(1); ui.lanes[0].onpointerdown(pointer);
    ui.lanes[0].onpointerdown({ ...pointer, pointerId: 2 }); // Same held lane, no second judgment.
    assert.equal(renderer.effects.hits.length, 1);
    ui.lanes[0].onpointerup(pointer); ui.lanes[0].onpointerup({ ...pointer, pointerId: 2 });
    ui.lanes[2].onpointerdown(pointer); ui.lanes[2].onpointerup(pointer); // Real stray is not a burst.
    assert.equal(renderer.effects.hits.length, 1);
    tick(3); ui.lanes[1].onpointerdown(pointer);
    await ui.click('pause'); const frozen = structuredClone(renderer.effects);
    ui.tick(1000); assert.deepEqual(structuredClone(renderer.effects), frozen);
    await ui.click('restart');
    assert.equal(renderer.effects.hits.length, 0);
    assert.equal(ui.progress().history.length, 0);
    assert.equal(compatibleAudio ? ui.native.plays.length : ui.audio.starts.length, 2);
    if (compatibleAudio) assert.equal(ui.audio.contexts.length, 0);
  });
}

test('simultaneous judgments stay independent and newer hits replace only their own lane', () => {
  const effects = new HitEffects();
  for (let lane = 0; lane < 3; lane++) effects.recordHit({ lane, judgment: 'PERFECT' }, 1, 1);
  effects.recordHit({ lane: 0, judgment: 'GREAT' }, 1.2, 1);
  const view = effects.frame(1, 1.3);
  assert.deepEqual(view.judgments.map(hit => hit.text), ['GREAT', 'PERFECT', 'PERFECT']);
  assert.equal(effects.frame(1, 1.8).judgments[1], null);
  assert.equal(effects.frame(1, 1.8).judgments[0].text, 'GREAT');
});

test('misses, strays and broken holds get distinct lane feedback, not successful particles', () => {
  const game = new Game([{ time: 1, lane: 0, duration: 0 }, { time: 1.3, lane: 0, duration: 2 }]);
  const effects = new HitEffects();
  effects.recordHit(game.press(0, 1.3), 1.3, 1);
  effects.observeFailures(game, 1.3);
  assert.equal(effects.frame(1, 1.3).judgments[0].text, 'PERFECT', 'older missed note never hides newer hit');
  game.release(0, 1.4); effects.observeFailures(game, 1.4);
  assert.equal(effects.frame(1, 1.4).judgments[0].text, 'СОРВАНО');
  effects.recordJudgment(2, 'МИМО', 1.4, true);
  assert.equal(effects.frame(1, 1.4).judgments[2].failed, true);
  assert.equal(effects.hits.length, 1);
  effects.observeFailures(game, 2.4);
  assert.deepEqual(effects.frame(1, 2.4).judgments, [null, null, null], 'failure does not restart each frame');
  effects.reset(); assert.equal(effects.failures.size, 0);
});

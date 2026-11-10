import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './helpers/ui-harness.mjs';
import { Renderer } from '../dist/renderer.js?v=0.9.0';

test('ambient venue animates at most 20 fps without sound, stops when hidden and respects reduced motion', async t => {
  const ui = await mount(t);
  const draws = [];
  t.mock.method(Renderer.prototype, 'renderBackdrop', (time, reduced) => draws.push({ time, reduced }));
  for (const now of [0, 10, 25, 50, 100]) { ui.native.now = now; ui.tick(0); }
  assert.equal(draws.length, 3); assert.ok(draws[2].time > draws[0].time);
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
  ui.document.hidden = true; ui.native.now = 10000; ui.tick(0); assert.equal(draws.length, 3);
  ui.document.hidden = false; ui.native.now += 50; ui.tick(0);
  assert.ok(draws.at(-1).time - draws[2].time <= .051, 'no catch-up jump after backgrounding');
  await ui.node('motion').onchange({ target: { checked: true } });
  ui.native.now += 50; ui.tick(0); const still = draws.length;
  ui.native.now += 500; ui.tick(0); assert.equal(draws.length, still); assert.equal(draws.at(-1).reduced, true);
  await ui.start(); ui.tick(1); assert.equal(draws.length, still, 'game has its own audio-clock-driven scenery');
  await ui.click('pause'); ui.tick(100); assert.equal(draws.length, still);
});

test('system reduced motion also disables new scenery for an old saved motion preference', async t => {
  const ui = await mount(t, { settings: { motion: false } });
  globalThis.matchMedia = () => ({ matches: true });
  const draws = [];
  t.mock.method(Renderer.prototype, 'renderBackdrop', (time, reduced) => draws.push({ time, reduced }));
  for (const now of [0, 100, 500]) { ui.native.now = now; ui.tick(0); }
  assert.deepEqual(draws, [{ time: 0, reduced: true }]);
});

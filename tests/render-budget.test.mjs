import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderBudget, pixelRatio } from '../prototype/render-budget.js';

for (const hz of [60, 120, 144]) for (const [options, fps] of [
  [{ active: true }, 60], [{ active: false }, 30], [{ active: false, paused: true }, 2],
  [{ active: false, reduced: true }, 2], [{ active: true, reduced: true }, 60],
]) test(`${hz} Hz screen: render budget ${fps} FPS`, () => {
  const budget = new RenderBudget(); let frames = 0;
  for (let frame = 0; frame < hz * 10; frame++) if (budget.take(frame * 1000 / hz, options)) frames++;
  assert.ok(Math.abs(frames / 10 - fps) <= .2, `${frames / 10} FPS`);
});

test('screen changes render immediately; returning from background never catches up in a burst', () => {
  const budget = new RenderBudget();
  assert.ok(budget.take(0, { active: false, paused: true, screen: 'pause' }));
  assert.ok(budget.take(1, { active: true, screen: 'game' }));
  assert.equal(budget.take(2, { active: true, screen: 'game' }), false);
  assert.ok(budget.take(60000, { active: true, screen: 'game' }));
  assert.equal(budget.take(60001, { active: true, screen: 'game' }), false);
});

test('mobile resolution is capped without downsampling low-density displays', () => {
  assert.equal(pixelRatio(3, true), 1.25);
  assert.equal(pixelRatio(2, false), 1.5);
  assert.equal(pixelRatio(1, true), 1);
});

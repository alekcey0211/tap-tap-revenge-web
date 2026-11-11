import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFPS, pixelRatio } from '../prototype/render-budget.js';
import { readFile } from 'node:fs/promises';

test('graphics budgets distinguish mobile gameplay, menus, pause and reduced motion', () => {
  assert.equal(renderFPS({ active: true, coarse: true }), 30);
  assert.equal(renderFPS({ active: true }), 60);
  assert.equal(renderFPS({ active: false, coarse: true }), 12);
  assert.equal(renderFPS({ active: false }), 20);
  assert.equal(renderFPS({ active: false, paused: true }), 1);
  assert.equal(renderFPS({ active: false, reduced: true }), 1);
  assert.equal(renderFPS({ active: true, coarse: true, reduced: true }), 30);
});

test('mobile resolution does not supersample; low-density displays are unchanged', () => {
  assert.equal(pixelRatio(3, true), 1);
  assert.equal(pixelRatio(2, false), 1.5);
  assert.equal(pixelRatio(1, true), 1);
});

test('frame cap is applied before engine begin/endFrame, including visibility changes', async () => {
  const source = await readFile(new URL('../prototype/game-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /engine\.maxFPS = document\.hidden \? 0 : renderFPS/);
  assert.match(source, /document\.addEventListener\('visibilitychange', syncBudget\)/);
  assert.doesNotMatch(source, /budget\.take/);
});

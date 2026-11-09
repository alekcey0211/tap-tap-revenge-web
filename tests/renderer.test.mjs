import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stagePosition, Renderer } from '../dist/renderer.js';
import { pathPosition, Game } from '../dist/engine.js';

const paths = JSON.parse(await readFile(new URL('../dist/assets/paths.json', import.meta.url)));

test('new lanes never cross and preserve baseline vertical travel and hit targets', () => {
  for (let i = 0; i <= 100; i++) {
    const p = i / 100, positions = paths.map((_, lane) => stagePosition(paths, lane, p));
    assert.ok(positions[0][0] < positions[1][0] && positions[1][0] < positions[2][0]);
    for (let lane = 0; lane < 3; lane++) assert.equal(positions[lane][1], pathPosition(paths, lane, p)[1]);
  }
  assert.deepEqual(paths.map((_, lane) => stagePosition(paths, lane, 1)), [[54, 422], [160, 422], [266, 422]]);
});

test('rendering pending notes, holds, countdown and reduced motion does not mutate gameplay', () => {
  const text = [];
  const context = new Proxy({}, { get: (_, name) => name === 'createLinearGradient' ? () => ({ addColorStop() {} })
    : name === 'fillText' ? (...args) => text.push(args) : () => {} });
  const canvas = { clientWidth: 390, clientHeight: 540, getContext: () => context };
  const renderer = new Renderer(canvas, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 2 }, { time: 2, lane: 1, duration: 0 }]);
  game.press(0, 1);
  const before = JSON.stringify(game);
  for (const motion of [false, true]) for (const time of [0, 1, 1.5, 2, 3]) {
    renderer.render(game, time, '1', 100, 0, motion);
    renderer.render(game, time, '1', 100, 3, motion);
  }
  assert.equal(JSON.stringify(game), before);
  assert.ok(text.some(([value, , y]) => value === 'PERFECT' && y > 446), 'feedback stays below rings');
  assert.equal(canvas.height, 540);
});

test('effects keep notes on top, multiplier banners above lanes and reduced motion without sparks', () => {
  const operations = [];
  const context = new Proxy({}, { get: (_, name) => name === 'createLinearGradient' ? () => ({ addColorStop() {} })
    : (...args) => operations.push([name, ...args]) });
  const canvas = { clientWidth: 320, clientHeight: 273, getContext: () => context };
  const renderer = new Renderer(canvas, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 0 }, { time: 1, lane: 1, duration: 2 }, { time: 2, lane: 2, duration: 0 }]);
  game.revengeUntil = 16;
  for (let lane = 0; lane < 2; lane++) renderer.effects.recordHit(game.press(lane, 1), 1, 8);
  const before = JSON.stringify(game);
  renderer.render(game, 1, '1', 100);
  operations.length = 0;
  renderer.render(game, 1.1, '1', 100);
  const animated = operations.length;
  assert.ok(operations.some(([op, text, , y]) => op === 'fillText' && text === '×8' && y < 53));
  assert.ok(operations.some(([op, text, , y]) => op === 'fillText' && text === 'REVENGE' && y < 53));
  const noteFill = operations.findLastIndex(([op]) => op === 'fill');
  const lastBurst = operations.findLastIndex(([op, , y, radius]) => op === 'ellipse' && y === 422 && radius > 31);
  assert.ok(lastBurst < noteFill, 'hit rings drawn before opaque notes');
  operations.length = 0;
  renderer.render(game, 1.1, '1', 100, 0, true);
  assert.ok(operations.length < animated, 'no particle or edge-motion draw calls in reduced motion');
  assert.ok(operations.some(([op, text]) => op === 'fillText' && text === '×8'));
  assert.equal(JSON.stringify(game), before);
});

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
  const context = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name) ? () => ({ addColorStop() {} })
    : name === 'fillText' ? (...args) => text.push(args) : () => {} });
  const canvas = { clientWidth: 390, clientHeight: 540, getContext: () => context };
  const renderer = new Renderer(canvas, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 2 }, { time: 2, lane: 1, duration: 0 }]);
  renderer.effects.recordHit(game.press(0, 1), 1, 1);
  const before = JSON.stringify(game);
  for (const motion of [false, true]) for (const time of [0, 1, 1.5, 2, 3]) {
    renderer.render(game, time, '1', 100, 0, motion);
    renderer.render(game, time, '1', 100, 3, motion);
  }
  assert.equal(JSON.stringify(game), before);
  assert.ok(text.some(([value]) => value === 'PERFECT'), 'successful lane judgment is drawn');
  assert.equal(canvas.height, 540);
});

test('effects keep notes on top, multiplier banners above lanes and reduced motion without sparks', () => {
  const operations = [];
  const context = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name) ? () => ({ addColorStop() {} })
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

test('every lane uses the same circular head with volume, at mobile and desktop sizes', () => {
  for (const [width, height] of [[320, 270], [390, 528], [420, 640]]) {
    for (const reducedMotion of [false, true]) {
      const arcs = [], scales = [], stops = [], translations = [];
      const context = new Proxy({}, { get: (_, name) => {
        if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (name === 'createRadialGradient') return () => ({ addColorStop: (...args) => stops.push(args) });
        if (name === 'arc') return (...args) => arcs.push(args);
        if (name === 'scale') return (...args) => scales.push(args);
        if (name === 'translate') return (...args) => translations.push(args);
        return () => {};
      } });
      const renderer = new Renderer({ clientWidth: width, clientHeight: height, getContext: () => context }, paths);
      const game = new Game([0, 1, 2].map(lane => ({ time: 1, lane, duration: lane === 1 ? 2 : 0 })));
      const before = JSON.stringify(game);
      renderer.render(game, .8, '1', 100, 0, reducedMotion);
      assert.equal(arcs.length, 3);
      for (const arc of arcs) assert.deepEqual(arc, arcs[0], 'all heads are circles of the same radius');
      for (const [x, y] of scales) assert.ok(Math.abs(width / 320 * x - height / 480 * y) < 1e-9, 'uniform physical scale');
      assert.equal(stops.length, 12, 'each sphere has highlight, color and shade');
      const progress = 1 - (1 - .8) / 2.7;
      for (let lane = 0; lane < 3; lane++) assert.deepEqual(translations[lane], stagePosition(paths, lane, progress), 'centers and timing stay unchanged');
      assert.equal(JSON.stringify(game), before);
    }
  }
});

test('lane badges retain readable physical size and stay below targets on short screens', () => {
  for (const [width, height] of [[320, 266], [390, 524]]) {
    const rectangles = [], translations = [], fonts = [];
    const context = new Proxy({}, {
      get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name) ? () => ({ addColorStop() {} })
        : name === 'fillRect' ? (...args) => rectangles.push(args)
          : name === 'translate' ? (...args) => translations.push(args) : () => {},
      set: (_, name, value) => { if (name === 'font') fonts.push(value); return true; },
    });
    const renderer = new Renderer({ clientWidth: width, clientHeight: height, getContext: () => context }, paths);
    for (let lane = 0; lane < 3; lane++) renderer.effects.recordHit({ lane, judgment: 'PERFECT' }, 1, 1);
    renderer.render(new Game([]), 1.2, '4', 100);
    assert.equal(translations.length, 3);
    assert.ok(fonts.every(font => parseFloat(font.split(' ')[1]) >= 11.5));
    for (const [, y] of translations) {
      const badge = rectangles.at(-1), halfHeight = badge[3] / 2;
      assert.ok(y - halfHeight > 446 * height / 480);
      assert.ok(y + halfHeight <= height);
    }
  }
});

test('x8 changes the whole field even with reduced motion and ends on expiry or miss', () => {
  let fill;
  const backgrounds = [];
  const context = new Proxy({}, {
    get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name) ? () => ({ addColorStop() {} })
      : name === 'fillRect' ? (x, y, w, h) => { if (w === 320 && h === 480) backgrounds.push(fill); } : () => {},
    set: (_, name, value) => { if (name === 'fillStyle') fill = value; return true; },
  });
  const renderer = new Renderer({ clientWidth: 320, clientHeight: 270, getContext: () => context }, paths);
  const game = new Game([]); game.streak = 50; game.revengeReady = true;
  renderer.render(game, 0, '4', 100, 0, true);
  game.activateRevenge(0); renderer.render(game, 1, '4', 100, 0, true);
  renderer.render(game, 15, '4', 100, 0, true);
  game.revengeReady = true; game.activateRevenge(15); game.press(0, 16);
  renderer.render(game, 16, '4', 100, 0, true);
  assert.deepEqual(backgrounds, ['#0b071c55', '#4d202433', '#0b071c55', '#0b071c55']);
});

test('x8 lightning is confined to edges, moves with song time and stays static with reduced motion', () => {
  let path = [], bolts = [];
  const context = new Proxy({}, { get: (_, name) => {
    if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ addColorStop() {} });
    if (name === 'beginPath') return () => { path = []; };
    if (name === 'moveTo' || name === 'lineTo') return (x, y) => path.push([x, y]);
    if (name === 'stroke') return () => { if (path.length === 19) bolts.push([...path]); };
    return () => {};
  } });
  const renderer = new Renderer({ clientWidth: 320, clientHeight: 270, getContext: () => context }, paths);
  const game = new Game([], { automaticRevenge: true }); game.streak = 50;
  const draw = (time, reduced) => { bolts = []; renderer.render(game, time, '4', 100, 0, reduced); return bolts; };
  const first = draw(1, false);
  assert.equal(first.length, 4, 'two edges, each with glow and bright core');
  assert.ok(first.flat().every(([x, y]) => (x >= 0 && x <= 18 || x >= 302 && x <= 320) && y >= 66 && y <= 444));
  assert.deepEqual(draw(1, false), first, 'paused song clock freezes lightning');
  assert.notDeepEqual(draw(1.2, false), first);
  assert.deepEqual(draw(1, true), draw(1.2, true));
});

test('a successful round head explodes into particles; stray taps and reduced motion do not', () => {
  const arcs = [];
  const context = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name)
    ? () => ({ addColorStop() {} }) : name === 'arc' ? (...args) => arcs.push(args) : () => {} });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 524, getContext: () => context }, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 0 }]);
  renderer.effects.recordHit(game.press(0, 1), 1, 8);
  renderer.render(game, 1.12, '4', 100);
  assert.equal(arcs.length, 16);
  assert.ok(arcs.every(([, , radius]) => radius > 0 && radius < 4), 'small fragments, not a second note head');
  arcs.length = 0; renderer.render(game, 1.12, '4', 100, 0, true); assert.equal(arcs.length, 0);
  renderer.effects.reset(); renderer.effects.recordHit(game.press(1, 1.2), 1.2, 1);
  renderer.render(game, 1.3, '4', 100); assert.equal(arcs.length, 0);
});

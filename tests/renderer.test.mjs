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

test('stable x8 leaves the concert horizon free after the transition announcement', () => {
  const labels = [];
  const ctx = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name)
    ? () => ({ addColorStop() {} }) : name === 'fillText' ? value => labels.push(value) : () => {} });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => ctx }, paths);
  const game = new Game([], { automaticRevenge: true }); game.streak = 50;
  renderer.render(game, 10, '4', 66); assert.ok(labels.includes('×8'));
  labels.length = 0; renderer.render(game, 12, '4', 66);
  assert.equal(labels.includes('REVENGE'), false);
  assert.equal(labels.includes('×8'), false, 'persistent multiplier is displayed in the HUD, not twice');
  assert.equal(game.streak, 50);
});

test('burst fragments rise from the target without replacing the next circular note', () => {
  const particles = [];
  const ctx = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name)
    ? () => ({ addColorStop() {} }) : name === 'arc' ? (...args) => particles.push(args) : () => {} });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => ctx }, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 0 }]);
  renderer.effects.recordHit(game.press(0, 1), 1, 8);
  renderer.render(game, 1.12, '4', 66);
  assert.equal(particles.length, 16);
  assert.ok(particles.filter(([, y]) => y < 422).length >= 12);
});

test('natural lightning is visible only during actual x8 and disappears on a broken streak', () => {
  const cores = [];
  const ctx = new Proxy({}, {
    get: (target, name) => {
      if (name in target) return target[name];
      if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ addColorStop() {} });
      return name === 'stroke' ? () => { if (target.strokeStyle === '#f6fbff') cores.push(target.globalAlpha); } : () => {};
    },
  });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => ctx }, paths);
  const game = new Game([], { automaticRevenge: true });
  renderer.render(game, 1, '4', 66); assert.equal(cores.length, 0);
  game.streak = 50; renderer.render(game, 1.3, '4', 66); assert.equal(cores.length, 2);
  cores.length = 0; game.press(0, 2); renderer.render(game, 2, '4', 66); assert.equal(cores.length, 0);
});

test('x8 animates concert beams and ornaments without moving the hit targets; reduced motion is static', () => {
  let path = [], fillStyle; const beams = [], rings = [];
  const context = new Proxy({}, {
    get: (_, name) => {
      if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ stops: [], addColorStop(offset, color) { this.stops.push(color); } });
      if (name === 'beginPath') return () => { path = []; };
      if (name === 'moveTo' || name === 'lineTo') return (...point) => path.push(point);
      if (name === 'fill') return () => { if (['#ca83ff', '#74baff'].includes(fillStyle?.stops?.[0])) beams.push([...path]); };
      if (name === 'ellipse') return (...args) => { if (args[2] === 37) rings.push(args); };
      return () => {};
    },
    set: (_, name, value) => { if (name === 'fillStyle') fillStyle = value; return true; },
  });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => context }, paths);
  const game = new Game([{ time: 1, lane: 0, duration: 0 }], { automaticRevenge: true });
  renderer.render(game, 2, '4', 66); assert.equal(beams.length + rings.length, 0);
  game.streak = 50;
  const draw = (time, reduced = false) => { beams.length = 0; rings.length = 0; renderer.render(game, time, '4', 66, 0, reduced); return { beams: structuredClone(beams), rings: structuredClone(rings) }; };
  const first = draw(2);
  assert.equal(first.beams.length, 4); assert.equal(first.rings.length, 9);
  assert.deepEqual(draw(2), first, 'same song time freezes scenery');
  assert.notDeepEqual(draw(2.5).beams, first.beams);
  assert.ok(first.rings.every(([x, y]) => [54, 160, 266].includes(x) && y === 422));
  const still = draw(2, true); assert.equal(still.beams.length, 0);
  assert.deepEqual(draw(8, true), still);
});

test('x8 adds translucent halos without changing note circles, and lights six artwork panels', () => {
  const fills = [], circles = [], scales = [], shifts = []; let path = [];
  const ctx = new Proxy({ globalAlpha: 1 }, { get(target, name) {
    if (name in target) return target[name];
    if (['createLinearGradient', 'createRadialGradient'].includes(name)) return (...args) => ({ args, stops: [], addColorStop(offset, color) { this.stops.push(color); } });
    if (name === 'beginPath') return () => { path = []; };
    if (name === 'moveTo' || name === 'lineTo') return (...point) => path.push(point);
    if (name === 'arc') return (...args) => circles.push(args);
    if (name === 'scale') return (...args) => scales.push(args);
    if (name === 'translate') return (...args) => shifts.push(args);
    if (name === 'fill' || name === 'fillRect') return () => fills.push({ paint: target.fillStyle, alpha: target.globalAlpha, points: [...path] });
    return () => {};
  } });
  const canvas = { clientWidth: 390, clientHeight: 630, getContext: () => ctx };
  const renderer = new Renderer(canvas, paths);
  const game = new Game([{ time: 2.2, lane: 1, duration: 0 }], { automaticRevenge: true });
  const draw = (time, reduced = false) => {
    fills.length = circles.length = scales.length = shifts.length = 0;
    renderer.render(game, time, '4', 66, 0, reduced);
    return { panels: JSON.parse(JSON.stringify(fills.filter(x => x.paint?.stops?.at(-1) === '#ffe4ff'))),
      lamps: fills.filter(x => x.paint?.stops?.[0] === '#effbff').map(x => x.alpha),
      haze: fills.filter(x => x.paint?.stops?.at(-1) === '#956aff00').length,
      halos: fills.filter(x => x.paint?.stops?.[1] === '#c9ff5677'), circles: structuredClone(circles) };
  };
  const normal = draw(2); assert.equal(normal.panels.length + normal.halos.length, 0);
  game.streak = 80;
  const active = draw(2); assert.equal(active.panels.length, 6); assert.equal(active.halos.length, 1);
  assert.equal(active.lamps.length, 33); assert.equal(active.haze, 3);
  assert.deepEqual(draw(2).lamps, active.lamps, 'venue lights freeze with the song clock');
  assert.notDeepEqual(draw(2.1).lamps, active.lamps, 'illumination travels along the arches');
  draw(2);
  assert.deepEqual(active.circles, normal.circles, 'opaque heads retain shape and radius');
  assert.ok(active.panels.every(p => p.points.length === 4));
  assert.ok(scales.some(([x, y]) => x === 320 / 1024 && y === 390 / 630 * 480 / 1024));
  assert.ok(shifts.some(([x, y]) => x === 0 && y === -90 * 1024 / 390));
  const still = draw(2, true);
  assert.equal(still.lamps.length + still.haze, 0, 'no moving venue decorations with reduced motion');
  assert.deepEqual(draw(2.1, true).panels, still.panels);
  canvas.clientWidth = 320; canvas.clientHeight = 270; draw(2);
  assert.ok(scales.some(([x, y]) => x === 320 / 1024 && y === 320 / 270 * 480 / 1024));
  assert.ok(shifts.some(([x, y]) => x === 0 && y === -90 * 1024 / 320));
  game.streak = 0; const ended = draw(2); assert.equal(ended.panels.length + ended.halos.length, 0);
});

test('Pulse zones approach the hit line without labels and remain behind round heads', () => {
  const labels = [], fills = [], boundaries = [], operations = []; let path = [];
  const ctx = new Proxy({}, { get(target, name) {
    if (name in target) return target[name];
    if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ addColorStop() {} });
    if (name === 'beginPath') return () => { path = []; };
    if (name === 'moveTo' || name === 'lineTo') return (...p) => path.push(p);
    if (name === 'fill') return () => { if (['#53e7f406', '#c592ff06'].includes(target.fillStyle)) fills.push([...path]); };
    if (name === 'stroke') return () => {
      if (['#53e7f4', '#c592ff'].includes(target.strokeStyle) && path.length === 2 && path[0][1] === path[1][1]) { boundaries.push([...path]); operations.push('boundary'); }
    };
    if (name === 'fillText') return (...args) => { labels.push(args); operations.push('label'); };
    if (name === 'arc') return () => operations.push('head');
    return () => {};
  } });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => ctx }, paths);
  const game = new Game([{ time: 10, lane: 0, duration: 0 }]);
  const zones = [{ index: 1, start: 0, end: 10 }, { index: 2, start: 10, end: 20 }];
  const draw = (time, reduced = false) => { labels.length = fills.length = boundaries.length = operations.length = 0; renderer.render(game, time, '4', 66, 0, reduced, zones); return { labels: structuredClone(labels), fills: structuredClone(fills), boundaries: structuredClone(boundaries) }; };
  const before = JSON.stringify(game), first = draw(9.5);
  assert.equal(first.fills.length, 2); assert.equal(first.labels.length, 0);
  const boundaryY = stagePosition(paths, 1, 1 - .5 / 1.4)[1];
  assert.equal(first.boundaries[0][0][1], boundaryY);
  assert.ok(operations.indexOf('boundary') < operations.indexOf('head'));
  assert.deepEqual(draw(9.5), first); assert.deepEqual(draw(9.5, true), first);
  assert.notDeepEqual(draw(9.8).fills, first.fills);
  assert.equal(JSON.stringify(game), before);
  labels.length = fills.length = 0; renderer.render(game, 9.5, '4', 66);
  assert.equal(fills.length, 0, 'demo and calibration without Pulse data stay clear');
});

test('lane guides stop before inset targets; target centres and hit areas stay unchanged', () => {
  const guides = [], targets = []; let path = [], ellipse = null;
  const ctx = new Proxy({}, { get(target, name) {
    if (name in target) return target[name];
    if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ stops: [], addColorStop(offset, color) { this.stops.push(color); } });
    if (name === 'beginPath') return () => { path = []; ellipse = null; };
    if (name === 'moveTo' || name === 'lineTo') return (...point) => path.push(point);
    if (name === 'ellipse') return (...args) => { ellipse = args; };
    if (name === 'stroke') return () => { if (path.length > 3 && ['#ff686899', '#c9ff5699', '#49e6ef99'].includes(target.strokeStyle)) guides.push([...path]); };
    if (name === 'fill') return () => { if (ellipse?.[2] === 31 && ellipse?.[3] === 13) targets.push({ centre: ellipse.slice(0, 2), colors: target.fillStyle.stops }); };
    return () => {};
  } });
  const renderer = new Renderer({ clientWidth: 320, clientHeight: 270, getContext: () => ctx }, paths);
  const game = new Game([]), before = JSON.stringify(game);
  renderer.render(game, 0, '4', 66);
  assert.equal(guides.length, 3); assert.ok(guides.every(path => path.at(-1)[1] === 404 && path.every(([, y]) => y <= 404)));
  assert.deepEqual(targets.map(t => t.centre), [[54, 422], [160, 422], [266, 422]]);
  assert.ok(targets.every(t => t.colors.every(color => /^#[0-9a-f]{6}$/.test(color))), 'opaque target interiors');
  assert.equal(JSON.stringify(game), before);
});

test('miss feedback no longer recolors the hit circle; successful feedback remains', () => {
  const rings = []; let ellipse;
  const ctx = new Proxy({}, { get(target, name) {
    if (name in target) return target[name];
    if (['createLinearGradient', 'createRadialGradient'].includes(name)) return () => ({ addColorStop() {} });
    if (name === 'beginPath') return () => { ellipse = null; };
    if (name === 'ellipse') return (...args) => { ellipse = args; };
    if (name === 'stroke') return () => { if (ellipse?.[2] === 31 && ellipse?.[3] === 13) rings.push(target.strokeStyle); };
    return () => {};
  } });
  const renderer = new Renderer({ clientWidth: 390, clientHeight: 630, getContext: () => ctx }, paths);
  const game = new Game([]);
  renderer.render(game, 1, '4', 66); const neutral = [...rings];
  renderer.effects.recordJudgment(0, 'МИМО', 1.1, true); rings.length = 0;
  renderer.render(game, 1.2, '4', 66); assert.deepEqual(rings, neutral);
  renderer.effects.recordHit({ lane: 0, judgment: 'PERFECT' }, 1.3, 1); rings.length = 0;
  renderer.render(game, 1.35, '4', 66); assert.equal(rings[0], '#f3f2ee');
});

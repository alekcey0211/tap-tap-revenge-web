import test from 'node:test';
import assert from 'node:assert/strict';
import { Lightning } from '../dist/lightning.js';
import { TrackRhythm } from '../dist/track-rhythm.js';

function surface() {
  const strokes = []; let path = [];
  const ctx = {
    save() {}, restore() {}, closePath() {}, clip() {},
    beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    createLinearGradient() { return { addColorStop() {} }; },
    stroke() { strokes.push({ points: [...path], alpha: this.globalAlpha, width: this.lineWidth, color: typeof this.strokeStyle === 'string' ? this.strokeStyle : 'gradient' }); },
  };
  const lightning = new Lightning(), rhythm = new TrackRhythm();
  const notes = [{ time: .08 }, { time: 1.28 }, { time: 2.48 }, { time: 3.68 }];
  return (time, reduced = false, impact = 0) => { strokes.length = 0; lightning.render(ctx, rhythm.frame(notes, time), impact, reduced); return structuredClone(strokes); };
}

test('lightning has branching multiscale channels, white cores and tapered fine tips', () => {
  const strokes = surface()(.1);
  assert.equal(strokes.length, 30, 'bounded passes: 3 main-channel layers and 12 forks per side');
  for (let side = 0; side < 2; side++) {
    const group = strokes.slice(side * 15, side * 15 + 15);
    assert.equal(group[2].color, '#f6fbff'); assert.ok(group[2].width < group[1].width);
    const main = group[0].points;
    assert.equal(main.length, 65);
    const lengths = main.slice(1).map((p, i) => Math.hypot(p[0] - main[i][0], p[1] - main[i][1]).toFixed(1));
    assert.ok(new Set(lengths).size > 20, 'no regular sawtooth spacing');
    const nodes = new Set(main.map(p => p.join(',')));
    for (const branch of group.slice(3)) {
      assert.equal(branch.color, 'gradient'); assert.ok(branch.width < group[2].width);
      assert.ok(nodes.has(branch.points[0].join(',')), 'fork attached to a channel, not floating sparks');
      branch.points.forEach(p => nodes.add(p.join(',')));
    }
  }
});

test('channels fade without writhing, then a new discharge gets different geometry', () => {
  const draw = surface(), early = draw(.1), later = draw(.4), next = draw(1.3);
  assert.deepEqual(early.map(s => s.points), later.map(s => s.points));
  assert.ok(later[2].alpha < early[2].alpha);
  assert.notDeepEqual(next[0].points, early[0].points);
  assert.deepEqual(draw(1.3), next, 'paused song clock freezes both channel and intensity');
});

test('all channels stay in tapered side margins and leave targets and note heads clear', () => {
  const draw = surface();
  for (let i = 0; i < 200; i++) {
    const strokes = draw(i * .17, false, 1);
    assert.equal(strokes.length, 30);
    for (const stroke of strokes) for (const [x, y] of stroke.points) {
      const width = 18 + 34 * Math.pow(Math.max(0, (444 - y) / 392), 1.4);
      assert.ok(y >= 52 && y <= 444);
      assert.ok((x >= 0 && x <= width) || (x >= 320 - width && x <= 320));
    }
    assert.ok(strokes.every(s => s.alpha >= 0 && s.alpha <= 1));
  }
});

test('reduced motion keeps the discharge static, including hit intensity, across the whole song', () => {
  const draw = surface(), still = draw(0, true);
  for (const time of [.1, 2, 25, 100]) assert.deepEqual(draw(time, true, 1), still);
});

test('hits strengthen existing channels without creating extra branches or a new shape', () => {
  const draw = surface(), calm = draw(.3), hit = draw(.3, false, 1);
  assert.equal(hit.length, calm.length);
  assert.deepEqual(hit.map(s => s.points), calm.map(s => s.points));
  assert.ok(hit[2].alpha > calm[2].alpha);
});

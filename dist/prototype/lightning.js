// Seeded branching channels: geometry holds still during a discharge, then fades.
// All time comes from the song clock. No timers, global randomness or game state.
const edgeWidth = y => 18 + 34 * Math.pow(Math.max(0, (444 - y) / 392), 1.4);
function bound(x, y) {
  const span = edgeWidth(y) - 4, offset = ((x - 2) % (span * 2) + span * 2) % (span * 2);
  return 2 + (offset > span ? span * 2 - offset : offset);
}
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function channel(start, end, depth, spread, rand) {
  if (!depth) return [start, end];
  const y = (start[1] + end[1]) / 2 + (rand() - .5) * (end[1] - start[1]) * .3;
  const x = bound((start[0] + end[0]) / 2 + (rand() - .5) * spread, y);
  const middle = [x, y];
  return [...channel(start, middle, depth - 1, spread * .68, rand).slice(0, -1),
    ...channel(middle, end, depth - 1, spread * .68, rand)];
}
function discharge(seed) {
  const rand = random(seed), main = channel([8 + rand() * 24, 56], [4 + rand() * 10, 442], 6, 50, rand);
  const branches = [];
  for (let i = 0; i < 8; i++) {
    const start = main[5 + Math.floor(rand() * 48)];
    const y = Math.min(442, start[1] + 25 + rand() * 70);
    const end = [bound(start[0] + (i % 2 ? -1 : 1) * (12 + rand() * 26), y), y];
    const points = channel(start, end, 4, 13, rand);
    branches.push({ points, strength: .4 + rand() * .35 });
    if (i % 2 === 0) {
      const fork = points[6 + Math.floor(rand() * 5)], tipY = Math.min(442, fork[1] + 12 + rand() * 24);
      branches.push({ points: channel(fork, [bound(fork[0] + (rand() - .5) * 35, tipY), tipY], 3, 7, rand), strength: .25 });
    }
  }
  return { main, branches };
}
function trace(c, points, side) {
  c.beginPath();
  points.forEach(([x, y], i) => { const px = side ? 320 - x : x; if (i) c.lineTo(px, y); else c.moveTo(px, y); });
}

export class Lightning {
  constructor() { this.bolts = [null, null]; }
  render(c, rhythm, impact, reducedMotion) {
    for (let side = 0; side < 2; side++) {
      const cycle = reducedMotion ? 0 : Math.max(0, rhythm.index);
      if (this.bolts[side]?.cycle !== cycle) this.bolts[side] = { cycle, ...discharge(731 + cycle * 7919 + side * 65537) };
      const bolt = this.bolts[side];
      const strength = reducedMotion ? .55 : Math.min(1, .2 + rhythm.pulse * .95 + Math.max(0, Math.min(1, impact)) * .12);
      c.save();
      // The safe margin narrows near the targets. Bloom cannot wash over notes.
      c.beginPath(); c.moveTo(side ? 320 : 0, 52);
      for (let y = 52; y <= 444; y += 28) c.lineTo(side ? 320 - edgeWidth(y) : edgeWidth(y), y);
      c.lineTo(side ? 320 : 0, 444); c.closePath(); c.clip();
      c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
      trace(c, bolt.main, side);
      c.globalAlpha = strength * .45; c.strokeStyle = '#7065ff'; c.lineWidth = 7;
      c.shadowColor = '#596dff'; c.shadowBlur = reducedMotion ? 0 : 18; c.stroke();
      c.globalAlpha = strength * .75; c.strokeStyle = '#a9caff'; c.lineWidth = 2.3;
      c.shadowBlur = reducedMotion ? 0 : 6; c.stroke();
      c.globalAlpha = strength; c.strokeStyle = '#f6fbff'; c.lineWidth = 1.05; c.shadowBlur = 0; c.stroke();
      for (const branch of bolt.branches) {
        // Fine tips fade along the fork, unlike parallel glowing wires.
        const [x, y] = branch.points[0], tip = branch.points.at(-1);
        const gradient = c.createLinearGradient(side ? 320 - x : x, y, side ? 320 - tip[0] : tip[0], tip[1]);
        gradient.addColorStop(0, '#e7f4ff'); gradient.addColorStop(.65, '#8ea6ff'); gradient.addColorStop(1, '#6478ff00');
        trace(c, branch.points, side);
        c.strokeStyle = gradient; c.globalAlpha = strength * branch.strength;
        c.lineWidth = .35 + branch.strength * .6; c.shadowColor = '#7593ff'; c.shadowBlur = reducedMotion ? 0 : 4; c.stroke();
      }
      c.restore();
    }
  }
}

import { TrackRhythm } from './track-rhythm.js?v=0.8.1';
import { Lightning } from './lightning.js?v=0.8.1';
import { HitEffects } from './hit-effects.js';
import { formatNumber } from './format.js?v=0.3.0';
import { pathPosition, TRAVEL } from './engine.js';

const COLORS = ['#ff6868', '#c9ff56', '#49e6ef'];
const HIGHLIGHTS = ['#ffe3dc', '#f6ffda', '#ddfdff'];
const SHADOWS = ['#852d40', '#486d20', '#175c83'];

// Preserve the original vertical travel and hit line; uncross the lanes visually.
export function stagePosition(paths, lane, progress) {
  const [, y] = pathPosition(paths, lane, progress);
  const depth = (y - 53) / (422 - 53);
  return [160 + (lane - 1) * (14 + 92 * depth), y];
}

export class Renderer {
  constructor(canvas, paths) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.paths = paths;
    this.effects = new HitEffects();
    this.lightning = new Lightning();
    this.rhythm = new TrackRhythm();
  }
  text(text, x, y, size = 12, color = '#f3f2ee') {
    const c = this.ctx;
    c.font = `700 ${size}px Onest, -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = color;
    c.fillText(text, x, y);
  }
  renderNote(lane, radius, reducedMotion, energy = 0) {
    const c = this.ctx;
    if (energy) {
      // A transparent halo, not a larger head: the opaque circle stays unchanged.
      const halo = c.createRadialGradient(0, 0, radius * .75, 0, 0, radius * 1.8);
      halo.addColorStop(0, COLORS[lane] + '00');
      halo.addColorStop(.3, COLORS[lane] + '77');
      halo.addColorStop(1, COLORS[lane] + '00');
      c.beginPath(); c.ellipse(0, 0, radius * 1.8, radius * 1.8, 0, 0, Math.PI * 2);
      c.save(); c.globalAlpha *= energy; c.fillStyle = halo; c.fill(); c.restore();
    }
    // The caller uses a uniform screen scale: circles stay circular on short screens.
    c.beginPath(); c.ellipse(0, radius * .14, radius, radius * .92, 0, 0, Math.PI * 2);
    c.fillStyle = '#00000050'; c.fill();
    const surface = c.createRadialGradient(-radius * .32, -radius * .4, radius * .03,
      radius * .12, radius * .2, radius * 1.2);
    surface.addColorStop(0, HIGHLIGHTS[lane]);
    surface.addColorStop(.3, COLORS[lane]);
    surface.addColorStop(.7, COLORS[lane]);
    surface.addColorStop(1, SHADOWS[lane]);
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fillStyle = surface; c.shadowColor = COLORS[lane]; c.shadowBlur = reducedMotion ? 0 : 16;
    c.fill(); c.shadowBlur = 0;
    c.strokeStyle = '#ffffff99'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.ellipse(-radius * .25, -radius * .36, radius * .32, radius * .15, -.5, 0, Math.PI * 2);
    c.fillStyle = '#ffffff55'; c.fill();
  }
  renderStage(time, revenge, reducedMotion, pulse = 0) {
    const c = this.ctx;
    // A single dark runway with luminous rails, not a flat grid over the venue.
    const floor = c.createLinearGradient(160, 53, 160, 448);
    floor.addColorStop(0, '#080d2300'); floor.addColorStop(.2, revenge ? '#25145266' : '#080d2355'); floor.addColorStop(1, revenge ? '#111332e6' : '#080b20dd');
    c.beginPath(); c.moveTo(132, 53); c.lineTo(188, 53); c.lineTo(320, 448); c.lineTo(0, 448); c.closePath();
    c.fillStyle = floor; c.fill();
    for (const side of [0, 1]) {
      c.beginPath(); c.moveTo(side ? 188 : 132, 53); c.lineTo(side ? 318 : 2, 448);
      c.strokeStyle = side ? '#75ddff' : '#ca81ff'; c.lineWidth = revenge ? 2.8 : 1.5;
      c.shadowColor = c.strokeStyle; c.shadowBlur = reducedMotion ? 0 : revenge ? 16 + pulse * 8 : 12; c.stroke();
      c.shadowBlur = 0;
      c.beginPath(); c.moveTo(side ? 192 : 128, 53); c.lineTo(side ? 320 : 0, 420);
      c.strokeStyle = side ? '#4791d955' : '#a34eda55'; c.lineWidth = 4; c.stroke();
      if (revenge) {
        // Segmented circuitry lives beside the rails, never across the note lanes.
        for (let i = 0; i < 9; i++) {
          const phase = reducedMotion ? i / 9 : (i / 9 + Math.max(0, time) * .35) % 1;
          const depth = phase * phase, y = 60 + depth * 365, x = 132 * (1 - depth);
          const inward = side ? -1 : 1, edge = side ? 320 - x : x;
          const length = 5 + depth * 12;
          c.beginPath(); c.moveTo(edge, y); c.lineTo(edge + inward * (3 + depth * 4), y + length * .4);
          c.lineTo(edge + inward * (3 + depth * 4), y + length);
          c.strokeStyle = side ? '#a5f6ff' : '#e4b5ff'; c.lineWidth = 1 + depth;
          c.globalAlpha = reducedMotion ? .65 : .45 + pulse * .45;
          c.shadowColor = c.strokeStyle; c.shadowBlur = reducedMotion ? 0 : 7; c.stroke();
        }
        c.globalAlpha = 1; c.shadowBlur = 0;
      }
    }
    // Small moving edge lights convey speed without drawing stripes across the notes.
    if (!reducedMotion) for (let i = 0; i < 6; i++) {
      const depth = ((i / 6 + Math.max(0, time) * .1) % 1) ** 2;
      const y = 53 + depth * 360, x = 132 * (1 - depth);
      c.strokeStyle = revenge ? '#ffb87988' : '#ba9cfa55'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 4, y + 10);
      c.moveTo(320 - x, y); c.lineTo(324 - x, y + 10); c.stroke();
    }
  }
  renderJudgments(effects, width, height, dpr, reducedMotion) {
    const c = this.ctx;
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = width / dpr, h = height / dpr;
    const badgeHeight = Math.min(24, h * 30 / 480);
    for (const hit of effects.judgments) {
      if (!hit) continue;
      const x = (54 + hit.lane * 106) * w / 320, y = h * 464 / 480;
      const badgeWidth = Math.min(100, w / 3 - 10);
      c.globalAlpha = hit.age < .5 || reducedMotion ? 1 : (.75 - hit.age) / .25;
      const pop = reducedMotion ? 1 : 1 + .12 * Math.max(0, 1 - hit.age / .12);
      c.save(); c.translate(x, y); c.scale(pop, pop);
      c.fillStyle = '#10091c99';
      c.fillRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight);
      const color = hit.failed ? '#ff9298' : hit.text === 'PERFECT' ? '#fff2ce' : '#a6f6ff';
      c.shadowColor = hit.failed ? '#ff405d' : hit.text === 'PERFECT' ? '#ff8d36' : '#2ae6ff';
      c.shadowBlur = reducedMotion ? 0 : 8;
      this.text(hit.text, 0, 4, Math.min(13, badgeHeight * .7), color);
      c.shadowBlur = 0;
      c.restore();
    }
    c.restore();
  }
  renderEnergy(effects, reducedMotion, time, rhythm) {
    if (effects.multiplier !== 8) return;
    const c = this.ctx;
    const impact = reducedMotion ? 0 : Math.max(0, ...effects.hits.map(hit => 1 - hit.age / .6));
    this.renderConcertLights(time, rhythm.pulse, reducedMotion);
    this.lightning.render(c, rhythm, impact, reducedMotion);
  }

  renderVenue(time, pulse, reducedMotion) {
    const c = this.ctx;
    c.save();
    // Match concert.jpg's 1024px artwork and CSS background: 100% width, -90px top.
    // This mapping stays aligned on both tall and short phone playfields.
    c.scale(320 / 1024, this.canvas.clientWidth / this.canvas.clientHeight * 480 / 1024);
    c.translate(0, -90 * 1024 / this.canvas.clientWidth);
    c.globalCompositeOperation = 'screen';
    const panels = [
      [[51, 192], [82, 207], [79, 350], [47, 350]],
      [[156, 94], [201, 117], [197, 369], [150, 367]],
      [[246, 263], [265, 272], [263, 350], [244, 350]],
    ];
    for (const side of [0, 1]) for (let i = 0; i < panels.length; i++) {
      const points = panels[i], color = i === 1 ? '#6aefff' : '#d77aff';
      const light = c.createLinearGradient(0, points[0][1], 0, points[2][1]);
      light.addColorStop(0, color + '55'); light.addColorStop(.65, color);
      light.addColorStop(1, '#ffe4ff');
      c.beginPath();
      points.forEach(([x, y], n) => { const px = side ? 1024 - x : x; if (n) c.lineTo(px, y); else c.moveTo(px, y); });
      c.closePath(); c.fillStyle = light;
      const sweep = .5 + .5 * Math.sin(time * 2.2 - i * 1.1 - side * 1.8);
      c.globalAlpha = reducedMotion ? .3 : .16 + pulse * .3 + sweep * .2;
      c.shadowColor = color; c.shadowBlur = reducedMotion ? 0 : 12;
      c.fill(); c.strokeStyle = color; c.lineWidth = 1.5; c.stroke();
    }
    c.shadowBlur = 0;
    if (!reducedMotion) {
      // Stationary fixtures brighten in travelling waves along the actual arches.
      // Animate illumination, not the camera or the gameplay coordinate system.
      for (const [arch, [rx, ry]] of [[332, 318], [218, 238], [164, 152]].entries()) {
        for (let lamp = 0; lamp < 11; lamp++) {
          const angle = Math.PI + (lamp + .5) / 11 * Math.PI;
          const x = 512 + Math.cos(angle) * rx, y = 350 + Math.sin(angle) * ry;
          const wave = Math.pow(.5 + .5 * Math.cos(lamp * .6 - time * 2.8 + arch * 1.4), 4);
          const glow = c.createRadialGradient(x, y, 0, x, y, 20);
          glow.addColorStop(0, '#effbff'); glow.addColorStop(.16, arch % 2 ? '#73edff' : '#d48aff');
          glow.addColorStop(1, '#936aff00');
          c.globalAlpha = .12 + wave * (.55 + pulse * .25); c.fillStyle = glow;
          c.fillRect(x - 20, y - 20, 40, 40);
        }
      }
      // Low translucent haze drifts over the distant stage, behind the runway.
      for (let i = 0; i < 3; i++) {
        const x = 512 + Math.sin(time * .5 + i * 2.1) * 95;
        const y = 337 + Math.sin(time * .7 + i) * 9;
        c.save(); c.translate(x, y); c.scale(1, .25);
        const haze = c.createRadialGradient(0, 0, 0, 0, 0, 160);
        haze.addColorStop(0, i % 2 ? '#55caff' : '#d77aff'); haze.addColorStop(1, '#956aff00');
        c.globalAlpha = .1 + pulse * .09; c.fillStyle = haze; c.fillRect(-160, -160, 320, 320);
        c.restore();
      }
    }
    c.restore();
  }
  renderConcertLights(time, pulse, reducedMotion) {
    if (reducedMotion) return;
    const c = this.ctx;
    c.save(); c.beginPath(); c.rect(0, 45, 320, 395); c.clip();
    c.globalCompositeOperation = 'screen';
    const halo = c.createRadialGradient(160, 68, 5, 160, 68, 150);
    halo.addColorStop(0, '#ba7cff'); halo.addColorStop(.3, '#723cff77'); halo.addColorStop(1, '#723cff00');
    c.globalAlpha = .14 + pulse * .14; c.fillStyle = halo; c.fillRect(10, 45, 300, 180);
    for (let i = 0; i < 4; i++) {
      const source = i % 2 ? 280 : 40;
      const destination = 160 + Math.sin(time * .65 + i * 1.7) * 130;
      const beam = c.createLinearGradient(source, 52, destination, 440);
      beam.addColorStop(0, i % 2 ? '#ca83ff' : '#74baff');
      beam.addColorStop(.6, i % 2 ? '#9b5aff88' : '#528eff88'); beam.addColorStop(1, '#496aff00');
      c.globalAlpha = .07 + pulse * .07; c.fillStyle = beam;
      c.beginPath(); c.moveTo(source - 2, 52); c.lineTo(source + 2, 52);
      c.lineTo(destination + 38, 440); c.lineTo(destination - 38, 440); c.closePath(); c.fill();
    }
    c.restore();
  }
  renderHits(effects, reducedMotion) {
    const c = this.ctx;
    for (const hit of effects.hits) {
      const [x] = stagePosition(this.paths, hit.lane, 1);
      const perfect = hit.judgment === 'PERFECT';
      const power = hit.multiplier === 8 ? 1 : hit.multiplier >= 4 ? .65 : .35;
      const progress = hit.age / .6;
      c.globalAlpha = (1 - progress) * (perfect ? .95 : .65);
      c.strokeStyle = perfect ? '#f3ffe0' : COLORS[hit.lane];
      c.lineWidth = perfect ? 4 : 3;
      if (hit.age < .2) {
        c.globalAlpha = reducedMotion ? .45 : .7 * (1 - hit.age / .2);
        c.fillStyle = perfect ? '#efffd5' : COLORS[hit.lane];
        c.beginPath(); c.ellipse(x, 422, 30, 23, 0, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = (1 - progress) * .95;
      const radius = reducedMotion ? 34 : 29 + (12 + power * 6) * Math.sqrt(progress);
      c.beginPath(); c.ellipse(x, 422, radius, radius * .72, 0, 0, Math.PI * 2); c.stroke();
      if (reducedMotion) continue;
      const sparks = perfect ? hit.multiplier === 8 ? 16 : 12 : 8;
      c.strokeStyle = COLORS[hit.lane]; c.lineWidth = perfect ? 2 : 1;
      for (let i = 0; i < sparks; i++) {
        const spread = .5 + .5 * Math.sin(i * 9.17 + hit.lane * 2.3);
        const angle = i * Math.PI * 2 / sparks + hit.lane * .4 + Math.sin(i * 2.39) * .18;
        const distance = (8 + Math.sqrt(progress) * (42 + power * 18)) * (.55 + spread * .45);
        const length = (perfect ? 8 : 5) * (1 - progress);
        c.beginPath();
        c.moveTo(x + Math.cos(angle) * distance, 422 - Math.abs(Math.sin(angle)) * distance * 1.45 + progress * progress * 24);
        c.lineTo(x + Math.cos(angle) * (distance + length), 422 - Math.abs(Math.sin(angle)) * (distance + length) * 1.45 + progress * progress * 24);
        c.stroke();
        const particleRadius = (perfect ? 3.5 : 2.5) * (.55 + spread * .45) * (1 - progress);
        c.beginPath();
        c.arc(x + Math.cos(angle) * distance, 422 - Math.abs(Math.sin(angle)) * distance * 1.45 + progress * progress * 24,
          particleRadius, 0, Math.PI * 2);
        c.fillStyle = i % 3 === 0 ? '#f5ffe9' : COLORS[hit.lane]; c.fill();
      }
    }
    c.globalAlpha = 1;
  }
  renderMultiplier(effects, reducedMotion) {
    const { transition, multiplier } = effects;
    if (!transition) return;
    const c = this.ctx;
    const rising = transition && transition.to > transition.from;
    const swell = !reducedMotion && rising ? Math.sin(Math.min(1, transition.age / .3) * Math.PI) : 0;
    const color = multiplier === 8 ? '#ffc78b' : rising ? '#49e6ef' : '#b5b5b0';
    // The banner stays above y=53, where note travel starts.
    if (transition) {
      c.globalAlpha = reducedMotion ? 1 : Math.min(1, (1.1 - transition.age) / .25);
      this.text(`×${formatNumber(multiplier)}`, 160, 28, 27 + swell * 6, color);
      this.text(multiplier === 8 ? 'REVENGE' : rising ? 'МНОЖИТЕЛЬ ВЫРОС' : 'МНОЖИТЕЛЬ СНИЖЕН', 160, 44, 9, color);
    }
    c.globalAlpha = 1;
  }
  renderPulseZones(zones, time, difficulty) {
    const c = this.ctx, travel = TRAVEL[difficulty];
    const position = stamp => stagePosition(this.paths, 1, 1 - (stamp - time) / travel)[1];
    const edge = y => 132 - (y - 53) / 395 * 130;
    c.save();
    // These are musical sections, not hit windows. Notes are drawn on top later.
    for (const zone of zones) {
      const top = Math.max(53, position(zone.end)), bottom = Math.min(422, position(zone.start));
      if (top >= bottom) continue;
      const color = zone.index % 2 ? '#53e7f4' : '#c592ff';
      c.beginPath(); c.moveTo(edge(top), top); c.lineTo(320 - edge(top), top);
      c.lineTo(320 - edge(bottom), bottom); c.lineTo(edge(bottom), bottom); c.closePath();
      c.fillStyle = color + '06'; c.fill();
      // Broad colored gutters mark the entire section outside the playable runway.
      for (const side of [0, 1]) {
        const inner = y => side ? 326 - edge(y) : edge(y) - 6;
        const outer = side ? 320 : 0;
        c.beginPath(); c.moveTo(outer, top); c.lineTo(inner(top), top);
        c.lineTo(inner(bottom), bottom); c.lineTo(outer, bottom); c.closePath();
        c.fillStyle = color + '42'; c.fill();
        c.beginPath(); c.moveTo(inner(top), top); c.lineTo(inner(bottom), bottom);
        c.strokeStyle = color + 'cc'; c.lineWidth = 2; c.stroke();
      }
      const boundaries = [zone.start];
      if (!zones.some(next => next.start === zone.end)) boundaries.push(zone.end);
      for (const stamp of boundaries) {
        if (stamp < time || stamp > time + travel) continue;
        const y = position(stamp), left = edge(y);
        c.beginPath(); c.moveTo(left, y); c.lineTo(320 - left, y);
        c.strokeStyle = color; c.lineWidth = 1.5; c.stroke();
      }
    }
    c.restore();
  }
  render(game, time, difficulty, duration, countdown = 0, reducedMotion = false, pulseZones = []) {
    const c = this.ctx;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (!width || !height) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    c.setTransform(width / 320, 0, 0, height / 480, 0, 0);
    c.clearRect(0, 0, 320, 480);
    const effects = this.effects.frame(game.multiplier(time), time);
    const revenge = effects.multiplier === 8;
    c.fillStyle = revenge ? '#4d202433' : '#0b071c55'; c.fillRect(0, 0, 320, 480);
    const rhythm = revenge ? this.rhythm.frame(game.notes, time) : { index: -1, age: Infinity, pulse: 0 };
    if (revenge) this.renderVenue(time, rhythm.pulse, reducedMotion);
    this.renderStage(time, revenge, reducedMotion, rhythm.pulse);
    this.renderPulseZones(pulseZones, time, difficulty);
    this.renderEnergy(effects, reducedMotion, time, rhythm);
    for (let lane = 0; lane < 3; lane++) {
      const [x] = stagePosition(this.paths, lane, 1);
      const glow = c.createLinearGradient(160, 53, x, 422);
      glow.addColorStop(0, COLORS[lane] + '00');
      glow.addColorStop(1, COLORS[lane] + (revenge ? '18' : '0c'));
      c.beginPath(); c.moveTo(160 + (lane - 1) * 14, 53);
      c.lineTo(x - 34, 448); c.lineTo(x + 34, 448); c.closePath();
      c.fillStyle = glow; c.fill();
      c.beginPath();
      for (let i = 0; i <= 36; i++) {
        const [px, py] = stagePosition(this.paths, lane, i / 36);
        if (py >= 404) {
          c.lineTo(160 + (lane - 1) * (14 + 92 * (404 - 53) / 369), 404);
          break;
        }
        if (!i) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.strokeStyle = COLORS[lane] + '99'; c.lineWidth = revenge ? 1.6 : 1; c.shadowColor = COLORS[lane]; c.shadowBlur = reducedMotion ? 0 : 6; c.stroke(); c.shadowBlur = 0;
      const judgment = effects.judgments[lane];
      const active = !judgment?.failed && (game.held[lane] || (judgment && judgment.age < .18));
      // An opaque inset keeps lane lines out of the target; the hit centre is unchanged.
      c.beginPath(); c.ellipse(x, 426, 34, 15, 0, 0, Math.PI * 2);
      c.fillStyle = '#030413cc'; c.fill();
      c.beginPath(); c.ellipse(x, 422, 34, 16, 0, 0, Math.PI * 2);
      c.strokeStyle = COLORS[lane] + '66'; c.lineWidth = 1.5; c.stroke();
      const inset = c.createLinearGradient(x, 409, x, 435);
      inset.addColorStop(0, '#24213e'); inset.addColorStop(.45, '#090b1d'); inset.addColorStop(1, '#151c32');
      c.beginPath(); c.ellipse(x, 422, 31, 13, 0, 0, Math.PI * 2);
      c.fillStyle = inset; c.fill();
      c.strokeStyle = active ? '#f3f2ee' : COLORS[lane]; c.lineWidth = active ? 3 : 2;
      c.shadowColor = COLORS[lane]; c.shadowBlur = reducedMotion ? 0 : active ? 22 : 10;
      c.stroke(); c.shadowBlur = 0;
      c.beginPath(); c.ellipse(x, 422, 28, 10, 0, Math.PI * 1.12, Math.PI * 1.88);
      c.strokeStyle = active ? '#ffffff' : COLORS[lane] + '99'; c.lineWidth = active ? 2 : 1; c.stroke();
      if (revenge) {
        const turn = reducedMotion ? 0 : time * 1.3;
        c.strokeStyle = COLORS[lane]; c.lineWidth = 1.4;
        c.globalAlpha = reducedMotion ? .65 : .5 + rhythm.pulse * .4;
        c.shadowColor = COLORS[lane]; c.shadowBlur = reducedMotion ? 0 : 9;
        for (let part = 0; part < 3; part++) {
          const angle = turn + part * Math.PI * 2 / 3;
          c.beginPath(); c.ellipse(x, 422, 37, 18, 0, angle, angle + 1.1); c.stroke();
        }
        c.globalAlpha = 1; c.shadowBlur = 0;
      }
    }
    this.renderHits(effects, reducedMotion);
    const travel = TRAVEL[difficulty];
    const noteScale = Math.min(width / 320, height / 480);
    for (const note of game.notes) {
      if (!['pending', 'holding'].includes(note.state)) continue;
      const progress = 1 - (note.time - time) / travel;
      const tailProgress = 1 - (note.time + note.duration - time) / travel;
      if (progress < 0 || (progress > 1.15 && note.state !== 'holding')) continue;
      const [x, y] = stagePosition(this.paths, note.lane, progress);
      c.globalAlpha = Math.min(1, Math.max(0, (progress - .1) / .05));
      const color = COLORS[note.lane];
      if (note.duration > 0) {
        const lower = Math.max(0, tailProgress), upper = Math.min(progress, 1);
        if (lower <= upper) {
          c.beginPath();
          for (let i = 0; i <= 30; i++) {
            const [px, py] = stagePosition(this.paths, note.lane, lower + (upper - lower) * i / 30);
            if (!i) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.strokeStyle = color + '99'; c.lineWidth = note.state === 'holding' ? 14 : 10;
          c.lineCap = 'round'; c.stroke();
          c.strokeStyle = color; c.lineWidth = 2; c.stroke();
        }
      }
      const radius = 32 * (.08 + .67 * (1 - Math.cos(Math.min(1, progress) * Math.PI / 2)));
      c.save(); c.translate(x, y);
      c.scale(noteScale * 320 / width, noteScale * 480 / height);
      this.renderNote(note.lane, radius, reducedMotion, revenge ? (reducedMotion ? .55 : .55 + rhythm.pulse * .45) : 0);
      c.restore();
      c.globalAlpha = 1;
    }
    this.renderJudgments(effects, width, height, dpr, reducedMotion);
    this.renderMultiplier(effects, reducedMotion);
    if (countdown > 0) {
      c.fillStyle = '#101113cc'; c.fillRect(0, 0, 320, 480);
      this.text(formatNumber(Math.ceil(countdown)), 160, 247, 64, '#c9ff56');
      this.text('ПРИГОТОВЬСЯ', 160, 278, 12);
    }
  }
}

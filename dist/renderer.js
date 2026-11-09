import { pathPosition, TRAVEL } from './engine.js';

const COLORS = ['#ff6868', '#c9ff56', '#49e6ef'];

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
  }
  text(text, x, y, size = 12, color = '#f3f2ee') {
    const c = this.ctx;
    c.font = `700 ${size}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
    c.textAlign = 'center';
    c.fillStyle = color;
    c.fillText(text, x, y);
  }
  noteShape(lane, x, y, radius) {
    const c = this.ctx;
    c.beginPath();
    if (lane === 1) {
      c.moveTo(x, y - radius); c.lineTo(x + radius, y);
      c.lineTo(x, y + radius); c.lineTo(x - radius, y); c.closePath();
    } else c.ellipse(x, y, radius, radius * .72, 0, 0, Math.PI * 2);
  }
  render(game, time, difficulty, duration, countdown = 0, reducedMotion = false) {
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
    c.fillStyle = '#101113'; c.fillRect(0, 0, 320, 480);
    const revenge = time < game.revengeUntil;
    for (let lane = 0; lane < 3; lane++) {
      const [x] = stagePosition(this.paths, lane, 1);
      const glow = c.createLinearGradient(160, 53, x, 422);
      glow.addColorStop(0, COLORS[lane] + '00');
      glow.addColorStop(1, COLORS[lane] + (revenge ? '33' : '16'));
      c.beginPath(); c.moveTo(160 + (lane - 1) * 14, 53);
      c.lineTo(x - 34, 448); c.lineTo(x + 34, 448); c.closePath();
      c.fillStyle = glow; c.fill();
      c.beginPath();
      for (let i = 0; i <= 36; i++) {
        const [px, py] = stagePosition(this.paths, lane, i / 36);
        if (!i) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.strokeStyle = COLORS[lane] + '80'; c.lineWidth = 1.2; c.stroke();
      c.beginPath(); c.ellipse(x, 422, 31, 24, 0, 0, Math.PI * 2);
      c.fillStyle = COLORS[lane] + '12'; c.fill();
      const age = time - game.flashes[lane];
      const active = game.held[lane] || (age >= 0 && age < .18);
      c.strokeStyle = active ? '#f3f2ee' : COLORS[lane]; c.lineWidth = active ? 4 : 3;
      c.shadowColor = COLORS[lane]; c.shadowBlur = reducedMotion ? 0 : active ? 22 : 10;
      c.stroke(); c.shadowBlur = 0;
    }
    const travel = TRAVEL[difficulty];
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
      this.noteShape(note.lane, x, y, radius);
      c.fillStyle = color; c.shadowColor = color; c.shadowBlur = reducedMotion ? 0 : 12;
      c.fill(); c.shadowBlur = 0;
      c.strokeStyle = '#ffffffcc'; c.lineWidth = 1.3; c.stroke();
      c.globalAlpha = 1;
    }
    // Feedback is below the hit targets, outside the note travel area.
    if (game.feedback && time - game.feedback.time < .6) {
      const f = game.feedback;
      c.globalAlpha = reducedMotion ? 1 : Math.min(1, (.6 - (time - f.time)) * 4);
      this.text(f.text, 160, 472, 17, f.text === 'PERFECT' ? '#c9ff56' : f.color);
      c.globalAlpha = 1;
    }
    if (countdown > 0) {
      c.fillStyle = '#101113cc'; c.fillRect(0, 0, 320, 480);
      this.text(Math.ceil(countdown), 160, 247, 64, '#c9ff56');
      this.text('ПРИГОТОВЬСЯ', 160, 278, 12);
    }
  }
}

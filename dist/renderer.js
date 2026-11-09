import { pathPosition, TRAVEL } from './engine.js';
const COLORS = ['#ff4d47', '#50ff60', '#48caff'];
export class Renderer {
  constructor(canvas, images, paths) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.images = images;
    this.paths = paths;
  }
  image(name, x, y, width, height) { this.ctx.drawImage(this.images[name], x, y, width, height); }
  sprite(name, sx, sy, sw, sh, x, y, w, h) { this.ctx.drawImage(this.images[name], sx, sy, sw, sh, x, y, w, h); }
  text(text, x, y, size = 12, color = '#fff', align = 'center') {
    const c = this.ctx;
    c.font = `bold ${size}px Arial, sans-serif`;
    c.textAlign = align;
    c.fillStyle = color;
    c.shadowColor = '#000'; c.shadowBlur = 4;
    c.fillText(text, x, y); c.shadowBlur = 0;
  }
  render(game, time, difficulty, duration, countdown = 0, reducedMotion = false) {
    const c = this.ctx;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const size = Math.round(this.canvas.clientWidth * dpr);
    if (size > 0 && this.canvas.width !== size) { this.canvas.width = size; this.canvas.height = Math.round(size * 1.5); }
    c.setTransform(this.canvas.width / 320, 0, 0, this.canvas.height / 480, 0, 0);
    c.clearRect(0, 0, 320, 480);
    c.fillStyle = '#000'; c.fillRect(0, 0, 320, 480);
    const revenge = time < game.revengeUntil;
    c.save(); c.translate(160, 210);
    if (!reducedMotion) c.rotate(time * 0.017);
    this.image(revenge ? 'space-revenge.jpg' : 'space.jpg', -240, -240, 480, 480);
    c.restore();
    this.image(revenge ? 'background-revenge.png' : 'background.png', 0, 0, 320, 480);
    const travel = TRAVEL[difficulty];
    for (const note of game.notes) {
      if (!['pending', 'holding'].includes(note.state)) continue;
      const progress = 1 - (note.time - time) / travel;
      const tailProgress = 1 - (note.time + note.duration - time) / travel;
      if (progress < 0 || (progress > 1.15 && note.state !== 'holding')) continue;
      const [x, y] = pathPosition(this.paths, note.lane, progress);
      if (note.duration > 0) {
        c.beginPath();
        const lower = Math.max(0, tailProgress), upper = Math.min(progress, 1);
        for (let i = 0; i <= 30; i++) {
          const p = lower + (upper - lower) * i / 30;
          const [px, py] = pathPosition(this.paths, note.lane, p);
          if (!i) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.strokeStyle = COLORS[note.lane]; c.lineWidth = note.state === 'holding' ? 9 : 6;
        c.shadowColor = COLORS[note.lane]; c.shadowBlur = 10; c.stroke();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); c.shadowBlur = 0;
      }
      const scale = 0.08 + 0.67 * (1 - Math.cos(Math.min(1, progress) * Math.PI / 2));
      const diameter = 64 * scale;
      c.globalAlpha = Math.min(1, Math.max(0, (progress - 0.1) / 0.05));
      this.sprite('parts.png', (note.lane + (revenge ? 3 : 0)) * 64, note.shake ? 64 : 0, 64, 64,
        x - diameter / 2, y - diameter / 2, diameter, diameter);
      c.globalAlpha = 1;
    }
    for (let lane = 0; lane < 3; lane++) {
      const age = time - game.flashes[lane];
      if (game.held[lane] || (age >= 0 && age < 0.22)) {
        const [x] = this.paths[lane].at(-1);
        c.save(); c.globalCompositeOperation = 'lighter';
        c.globalAlpha = game.held[lane] ? 0.9 : 1 - age / 0.22;
        this.sprite('parts.png', lane * 128, 128, 128, 128, x - 53, 366, 106, 106);
        c.restore();
      }
    }
    this.sprite('HUD.png', 0, 0, 322, 46, 0, 0, 320, 46);
    this.text(game.score.toLocaleString('en-US'), 160, 24, 20);
    this.text(game.streak, 23, 25, 15, '#82e5ff');
    this.text(`${game.multiplier(time)}×`, 291, 68, 17, revenge ? '#fff47e' : '#82e5ff');
    this.text(`${Math.round(game.accuracy)}%`, 289, 24, 12);
    const completion = Math.min(1, Math.max(0, time / duration));
    this.image('progressBall.png', 68 + completion * 181, 34, 6, 6);
    if (game.streak > 1) {
      this.text(game.streak, 160, 173, 31, revenge ? '#fff47e' : '#fff');
      this.text('STREAK', 160, 190, 10, '#9eacba');
    }
    if (game.feedback && time - game.feedback.time < 0.6) {
      const f = game.feedback;
      c.globalAlpha = Math.min(1, (0.6 - (time - f.time)) * 4);
      this.text(f.text, 160, 250, 23, f.color); c.globalAlpha = 1;
    }
    if (countdown > 0) {
      c.fillStyle = '#0006'; c.fillRect(0, 46, 320, 350);
      this.text(Math.ceil(countdown), 160, 255, 70, '#85e6ff');
      this.text('GET READY', 160, 283, 13);
    }
    ['D', 'F', 'J'].forEach((key, lane) => this.text(key, this.paths[lane].at(-1)[0], 469, 11, '#b5c4d2'));
  }
}

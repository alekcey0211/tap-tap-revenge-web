import { Game } from '../dist/engine.js';

// Reuse the live game's judgment rules, but never its persistence or audio ownership.
export class PlaySession {
  constructor(chart, { demo = false, onHit = () => {} } = {}) {
    this.game = new Game(chart, { automaticRevenge: true });
    this.demo = demo; this.onHit = onHit; this.inputs = new Map(); this.cursor = 0; this.graceUntil = -Infinity;
  }
  advance(time) {
    if (this.demo) {
      while (this.cursor < this.game.notes.length && this.game.notes[this.cursor].time <= time) {
        const note = this.game.notes[this.cursor++];
        this.game.update(note.time);
        if (!this.game.lanes[note.lane].some(item => item.state === 'holding')) this.game.release(note.lane, note.time);
        const hit = this.game.press(note.lane, note.time);
        if (hit) this.onHit(hit, note.time);
        if (!note.duration) this.game.release(note.lane, note.time);
      }
    } else if (time > this.graceUntil) {
      for (let lane = 0; lane < 3; lane++) if (!this.game.held[lane]) this.game.release(lane, time);
    }
    this.game.update(time);
  }
  press(lane, source, time) {
    if (this.demo || this.inputs.has(source) || ![0, 1, 2].includes(lane)) return;
    const held = [...this.inputs.values()].includes(lane);
    this.inputs.set(source, lane);
    if (held) return;
    const note = this.game.press(lane, time);
    if (note) this.onHit(note, time);
    return note;
  }
  release(source, time) {
    if (!this.inputs.has(source)) return;
    const lane = this.inputs.get(source); this.inputs.delete(source);
    if (![...this.inputs.values()].includes(lane)) this.game.release(lane, time);
  }
  suspend() { this.inputs.clear(); this.game.held.fill(false); }
  resume(time) { this.graceUntil = time + .3; }
  finish() { this.inputs.clear(); this.game.held.fill(false); return this.game.finish(); }
}

// Timing windows and point values are a web approximation, not a native engine port.
export const HIT_WINDOW = 0.18;
export const TRAVEL = { 1: 2.15, 2: 1.8, 3: 1.4 };
export const WINDOWS = [[0.045, 'PERFECT', 100], [0.09, 'GREAT', 80], [0.14, 'GOOD', 50], [HIT_WINDOW, 'OK', 20]];

export class Game {
  // Manual mode remains available for archived v1 replay/baseline checks, not in the current UI.
  constructor(chart, { automaticRevenge = false } = {}) {
    this.automaticRevenge = automaticRevenge;
    this.notes = chart.map((note, index) => ({ ...note, index, state: 'pending' }));
    this.lanes = [0, 1, 2].map(lane => this.notes.filter(note => note.lane === lane));
    this.held = [false, false, false];
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.hits = 0;
    this.misses = 0;
    this.strays = 0;
    this.brokenHolds = 0;
    this.weight = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, OK: 0 };
    this.revengeReady = false;
    this.revengeUntil = -Infinity;
    this.feedback = null;
    this.flashes = [-Infinity, -Infinity, -Infinity];
    this.errors = [];
  }
  multiplier(time) {
    if (this.automaticRevenge && this.streak >= 100) return 16;
    if (this.automaticRevenge ? this.streak >= 50 : time < this.revengeUntil) return 8;
    return this.streak >= 40 ? 4 : this.streak >= 30 ? 3 : this.streak >= 20 ? 2 : 1;
  }
  breakStreak() {
    this.streak = 0;
    this.revengeReady = false;
    this.revengeUntil = -Infinity;
  }
  update(time) {
    for (const note of this.notes) {
      if (note.state === 'pending' && time > note.time + HIT_WINDOW + 1e-8) {
        note.state = 'miss';
        this.misses++;
        this.breakStreak();
        this.feedback = { text: 'MISS', time, color: '#ff625d' };
      }
      if (note.state === 'holding' && time >= note.time + note.duration) {
        note.state = 'done';
        this.score += 50 * this.multiplier(time);
      }
    }
  }
  press(lane, time) {
    this.update(time);
    if (this.held[lane]) return null;
    this.held[lane] = true;
    this.flashes[lane] = time;
    if (this.lanes[lane].some(note => note.state === 'holding')) return null;
    const note = this.lanes[lane].find(note => note.state === 'pending' && Math.abs(note.time - time) <= HIT_WINDOW + 1e-8);
    if (!note) {
      this.strays++;
      this.breakStreak();
      this.feedback = { text: 'MISS', time, color: '#ff625d' };
      return null;
    }
    const error = time - note.time;
    const [, label, points] = WINDOWS.find(([window]) => Math.abs(error) <= window + 1e-8);
    note.state = note.duration > 0 ? 'holding' : 'done';
    note.judgment = label;
    this.score += points * this.multiplier(time);
    this.hits++;
    this.weight += points;
    this.counts[label]++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (!this.automaticRevenge && this.streak >= 50 && time >= this.revengeUntil) this.revengeReady = true;
    this.errors.push(error);
    this.feedback = { text: label, time, color: label === 'PERFECT' ? '#68dfff' : '#dfffdb' };
    return note;
  }
  release(lane, time) {
    this.update(time);
    this.held[lane] = false;
    for (const note of this.lanes[lane]) {
      if (note.state === 'holding') {
        // Allow a small release tolerance; completion is awarded only once.
        if (time >= note.time + note.duration - 0.08) {
          note.state = 'done';
          this.score += 50 * this.multiplier(time);
        } else {
          note.state = 'broken';
          this.brokenHolds++;
          this.breakStreak();
          this.feedback = { text: 'HOLD LOST', time, color: '#ff625d' };
        }
      }
    }
  }
  activateRevenge(time) {
    if (this.automaticRevenge || !this.revengeReady || time < this.revengeUntil) return false;
    this.revengeReady = false;
    this.revengeUntil = time + 15;
    return true;
  }
  get accuracy() {
    return this.hits + this.misses ? this.weight / (this.hits + this.misses) : 100;
  }
  finish() {
    this.update(Infinity);
    return { score: this.score, accuracy: this.accuracy, hits: this.hits, misses: this.misses,
      bestStreak: this.bestStreak, brokenHolds: this.brokenHolds, strays: this.strays, counts: { ...this.counts } };
  }
}

export function pathPosition(paths, lane, progress) {
  const points = paths[lane];
  const value = Math.min(1, Math.max(0, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(value));
  const fraction = value - index;
  return points[index].map((coordinate, axis) => coordinate + (points[index + 1][axis] - coordinate) * fraction);
}

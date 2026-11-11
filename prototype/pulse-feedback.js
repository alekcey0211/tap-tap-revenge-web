// Consume the authoritative Pulse result once. Lifetimes follow the song clock,
// so pausing cannot lose a celebration or replay it after resuming.
export class PulseFeedback {
  constructor() { this.reset(); }
  reset() { this.seen = new Set(); this.current = null; }
  frame(view, time) {
    if (view?.recent && view.result && !this.seen.has(view.index)) {
      this.seen.add(view.index);
      if (view.result.perfect) this.current = { index: view.index, total: view.total, born: time };
    }
    if (!this.current) return null;
    const age = time - this.current.born;
    if (age < 0 || age >= 1.6) { this.current = null; return null; }
    return { ...this.current, age, opacity: Math.min(1, (1.6 - age) / .5) };
  }
}

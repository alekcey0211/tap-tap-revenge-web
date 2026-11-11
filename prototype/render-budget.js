// Only visual work is throttled. Input, game judgments and audio retain their own clocks.
export const pixelRatio = (ratio, coarse) => Math.min(ratio || 1, coarse ? 1.25 : 1.5);

export class RenderBudget {
  next = -Infinity;
  mode = '';
  take(now, { active, paused = false, reduced = false, screen = '' }) {
    const fps = active ? 60 : paused || reduced ? 2 : 30;
    const mode = `${screen}:${fps}`;
    if (mode !== this.mode) { this.next = now; this.mode = mode; }
    if (now + .5 < this.next) return false;
    const interval = 1000 / fps;
    this.next = now - this.next >= interval ? now + interval : this.next + interval;
    return true;
  }
}

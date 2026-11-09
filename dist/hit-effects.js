import { HIT_WINDOW } from './engine.js';

// Visual state only. All lifetimes use the existing song clock, never wall time.
export class HitEffects {
  constructor() { this.reset(); }
  reset() {
    this.hits = []; this.multiplier = 1; this.transition = null;
    this.judgments = [null, null, null]; this.failures = new Set();
  }
  recordJudgment(lane, text, time, failed = false) {
    if (this.judgments[lane]?.time > time) return;
    this.judgments[lane] = { lane, text, time, failed };
  }
  observeFailures(game, time) {
    for (const note of game.notes) {
      if (!['miss', 'broken'].includes(note.state) || this.failures.has(note.index)) continue;
      this.failures.add(note.index);
      this.recordJudgment(note.lane, note.state === 'miss' ? 'МИМО' : 'СОРВАНО',
        note.state === 'miss' ? note.time + HIT_WINDOW : time, true);
    }
  }
  recordHit(note, time, multiplier) {
    if (!note?.judgment) return; // Strays, repeats and hold reclaims are not successful hits.
    this.recordJudgment(note.lane, note.judgment, time);
    this.hits.push({ lane: note.lane, judgment: note.judgment, time, multiplier });
    if (this.hits.length > 24) this.hits.splice(0, this.hits.length - 24);
  }
  frame(multiplier, time) {
    if (multiplier !== this.multiplier) {
      this.transition = { from: this.multiplier, to: multiplier, time };
      this.multiplier = multiplier;
    }
    this.hits = this.hits.filter(hit => time - hit.time < .6);
    const hits = this.hits.filter(hit => time >= hit.time).map(hit => ({ ...hit, age: time - hit.time }));
    const judgments = this.judgments.map(hit => hit && time >= hit.time && time - hit.time < .75
      ? { ...hit, age: time - hit.time } : null);
    const age = this.transition ? time - this.transition.time : Infinity;
    return { multiplier, hits, judgments, transition: age >= 0 && age < 1.1 ? { ...this.transition, age } : null };
  }
}

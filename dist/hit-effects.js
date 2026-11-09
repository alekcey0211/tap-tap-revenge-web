// Visual state only. All lifetimes use the existing song clock, never wall time.
export class HitEffects {
  constructor() { this.reset(); }
  reset() { this.hits = []; this.multiplier = 1; this.transition = null; }
  recordHit(note, time, multiplier) {
    if (!note?.judgment) return; // Strays, repeats and hold reclaims are not successful hits.
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
    const age = this.transition ? time - this.transition.time : Infinity;
    return { multiplier, hits, transition: age >= 0 && age < 1.1 ? { ...this.transition, age } : null };
  }
}

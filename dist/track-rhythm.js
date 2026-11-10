// Visual accents use authored note times, so native audio needs no analyser/context.
export class TrackRhythm {
  constructor() { this.notes = null; this.times = []; }
  frame(notes, time) {
    if (notes !== this.notes) {
      this.notes = notes; this.times = [];
      const sorted = [...new Set(notes.map(note => note.time))].sort((a, b) => a - b);
      for (const beat of sorted) {
        // Chords are one accent. Very dense runs do not become an edge strobe.
        if (!this.times.length || beat - this.times.at(-1) >= .18) this.times.push(beat);
      }
    }
    let low = 0, high = this.times.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.times[middle] <= time) low = middle + 1; else high = middle;
    }
    const index = low - 1, age = index < 0 ? Infinity : time - this.times[index];
    return { index, age, pulse: Math.exp(-Math.max(0, age) * 9) };
  }
}

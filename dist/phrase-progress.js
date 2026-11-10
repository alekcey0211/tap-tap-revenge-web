import { HIT_WINDOW, WINDOWS } from './engine.js';
import { PHRASE_VERSION } from './phrase-charts.js?v=0.8.2';
export const PULSE_RULES = 'strict-v1';
const weights = Object.fromEntries(WINDOWS.map(([, label, points]) => [label, points]));
const epsilon = 1e-6;

// Read-only observer of Game notes: never writes engine state, clocks or score.
export class PhraseProgress {
  constructor(notes, ends, zones = null) {
    if (!Array.isArray(ends) || !ends.length || ends.some((end, i) => !Number.isFinite(end) || end <= (ends[i - 1] || 0))) throw new Error('Invalid Pulse boundaries');
    if (notes.some(note => note.time < 0 || note.time >= ends.at(-1) - epsilon)) throw new Error('Pulse chart outside boundaries');
    const ranges = zones ?? ends.map((end, index) => ({ start: ends[index - 1] || 0, end }));
    if (ranges.some(({ start, end }, i) => !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || end > ends.at(-1) || i > 0 && start < ranges[i - 1].end)) throw new Error('Invalid Pulse zones');
    this.phrases = ranges.map(({ start, end }) => ({ start, end, notes: [], strays: 0, result: null }));
    for (const note of notes) this.phrases.find(phrase => note.time >= phrase.start - epsilon && note.time < phrase.end - epsilon)?.notes.push(note);
    this.phrases = this.phrases.filter(phrase => phrase.notes.length);
    for (const phrase of this.phrases) phrase.settleAt = Math.max(phrase.end,
      ...phrase.notes.map(note => note.time + Math.max(note.duration || 0, HIT_WINDOW) + epsilon));
    this.lastStrays = 0;
    this.closed = false;
  }
  recordInput(time, totalStrays) {
    if (this.closed || !Number.isSafeInteger(totalStrays) || totalStrays < this.lastStrays) return;
    const extra = totalStrays - this.lastStrays;
    this.lastStrays = totalStrays;
    const phrase = this.phrases.find(item => time >= item.start - epsilon && time < item.end - epsilon);
    if (phrase && !phrase.result) phrase.strays += extra;
  }
  advance(time) {
    if (this.closed) return;
    for (const phrase of this.phrases) {
      if (phrase.result || time < phrase.settleAt) continue;
      const weight = phrase.notes.reduce((sum, note) => sum + (weights[note.judgment] || 0), 0);
      const misses = phrase.notes.filter(note => !note.judgment).length;
      const broken = phrase.notes.filter(note => note.state === 'broken' || note.state === 'holding').length;
      const captured = !misses && !broken && !phrase.strays && weight >= 90 * phrase.notes.length;
      phrase.result = { accuracy: weight / phrase.notes.length, misses, broken, strays: phrase.strays,
        captured: Boolean(captured), perfect: Boolean(captured && phrase.notes.every(note => note.judgment === 'PERFECT')) };
    }
  }
  view(time) {
    const completed = this.phrases.filter(phrase => phrase.result && time >= phrase.settleAt && time < phrase.settleAt + 1.2).at(-1);
    const current = this.phrases.find(phrase => !phrase.result) || this.phrases.at(-1);
    const phrase = completed || current;
    if (!phrase) return null;
    return { index: this.phrases.indexOf(phrase) + 1, total: this.phrases.length, notes: phrase.notes.length,
      waiting: !completed && !phrase.result && time < phrase.start, startsIn: Math.max(0, phrase.start - time),
      done: phrase.notes.filter(note => ['done', 'miss', 'broken'].includes(note.state)).length,
      result: phrase.result, recent: Boolean(completed), finished: this.phrases.every(item => item.result),
      captured: this.phrases.filter(item => item.result?.captured).length,
      perfect: this.phrases.filter(item => item.result?.perfect).length };
  }
  zones(time, lookahead) {
    // Musical boundaries, not settleAt: a held tail can finish in the next zone.
    return this.phrases.flatMap(({ start, end }, index) => end >= time && start <= time + lookahead
      ? [{ index: index + 1, start, end }] : []);
  }
  finish() {
    this.advance(Infinity);
    this.closed = true;
    return { pulseRules: PULSE_RULES, phraseVersion: PHRASE_VERSION, total: this.phrases.length,
      captured: this.phrases.filter(phrase => phrase.result.captured).length,
      perfect: this.phrases.filter(phrase => phrase.result.perfect).length };
  }
}

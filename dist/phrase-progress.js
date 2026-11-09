import { HIT_WINDOW, WINDOWS } from './engine.js';
import { PHRASE_VERSION } from './phrase-charts.js';
export const PULSE_RULES = 'strict-v1';
const weights = Object.fromEntries(WINDOWS.map(([, label, points]) => [label, points]));
const epsilon = 1e-6;

// Read-only observer of Game notes: never writes engine state, clocks or score.
export class PhraseProgress {
  constructor(notes, ends) {
    if (!Array.isArray(ends) || !ends.length || ends.some((end, i) => !Number.isFinite(end) || end <= (ends[i - 1] || 0))) throw new Error('Invalid Pulse boundaries');
    if (notes.some(note => note.time < 0 || note.time >= ends.at(-1) - epsilon)) throw new Error('Pulse chart outside boundaries');
    this.phrases = ends.map((end, index) => ({ start: ends[index - 1] || 0, end, notes: [], strays: 0, result: null }));
    for (const note of notes) this.phrases.find(phrase => note.time < phrase.end - epsilon).notes.push(note);
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
    const current = this.phrases.find(phrase => !phrase.result && time < phrase.settleAt) || this.phrases.at(-1);
    const phrase = completed || current;
    if (!phrase) return null;
    return { index: this.phrases.indexOf(phrase) + 1, total: this.phrases.length, notes: phrase.notes.length,
      done: phrase.notes.filter(note => ['done', 'miss', 'broken'].includes(note.state)).length,
      result: phrase.result, recent: Boolean(completed), finished: this.phrases.every(item => item.result),
      captured: this.phrases.filter(item => item.result?.captured).length,
      perfect: this.phrases.filter(item => item.result?.perfect).length };
  }
  finish() {
    this.advance(Infinity);
    this.closed = true;
    return { pulseRules: PULSE_RULES, phraseVersion: PHRASE_VERSION, total: this.phrases.length,
      captured: this.phrases.filter(phrase => phrase.result.captured).length,
      perfect: this.phrases.filter(phrase => phrase.result.perfect).length };
  }
}

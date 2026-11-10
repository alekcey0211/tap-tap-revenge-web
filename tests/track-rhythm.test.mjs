import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackRhythm } from '../dist/track-rhythm.js';

test('visual accents follow irregular chart timestamps, never an independent periodic timer', () => {
  const rhythm = new TrackRhythm(), notes = [{ time: .1 }, { time: .43 }, { time: 1.17 }];
  assert.equal(rhythm.frame(notes, 0).pulse, 0);
  for (const note of notes) assert.equal(rhythm.frame(notes, note.time).pulse, 1);
  const gap = rhythm.frame(notes, 1);
  assert.equal(gap.index, 1); assert.ok(gap.pulse < .01);
  assert.equal(rhythm.frame(notes, 1.17).index, 2);
});

test('chords share one accent and dense rolls are grouped without inventing beats', () => {
  const notes = Array.from({ length: 12 }, (_, i) => ({ time: i * .05 }));
  notes.push({ time: .2 }, { time: .2 });
  const rhythm = new TrackRhythm();
  assert.equal(rhythm.frame(notes, .1).index, 0);
  assert.equal(rhythm.frame(notes, .2).index, 1);
  assert.equal(rhythm.frame(notes, .4).index, 2);
  assert.equal(rhythm.frame(notes, .2).pulse, 1);
});

test('holds and judgments do not create extra beats; pause, seeking and new songs are deterministic', () => {
  const rhythm = new TrackRhythm(), notes = [{ time: 1, duration: 5, state: 'pending' }, { time: 2.1, duration: 0 }];
  const before = JSON.stringify(notes), frame = rhythm.frame(notes, 2.15);
  assert.deepEqual(rhythm.frame(notes, 2.15), frame);
  assert.equal(JSON.stringify(notes), before);
  notes[0].state = 'miss'; assert.deepEqual(rhythm.frame(notes, 2.15), frame);
  assert.equal(rhythm.frame(notes, 6).index, 1, 'hold tail is not a new musical accent');
  assert.equal(rhythm.frame(notes, 1).index, 0, 'seeking backwards');
  assert.equal(rhythm.frame([{ time: 10 }], 2.15).pulse, 0, 'new track does not retain the old rhythm');
});

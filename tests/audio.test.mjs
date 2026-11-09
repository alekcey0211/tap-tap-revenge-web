import test from 'node:test';
import assert from 'node:assert/strict';
import { SongAudio } from '../dist/audio.js';
class FakeContext {
  currentTime = 10;
  destination = {};
  createBufferSource() {
    return { connect: node => node, disconnect() {}, stop() {}, start(at, offset) { this.started = { at, offset }; } };
  }
  createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
}
test('countdown, music clock, pause and resume preserve the exact song position', () => {
  const audio = new SongAudio(); audio.context = new FakeContext();
  audio.play({ duration: 100 });
  assert.equal(audio.countdown, 3); assert.equal(audio.position, 0);
  audio.context.currentTime = 18.25;
  assert.equal(audio.countdown, 0); assert.equal(audio.position, 5.25);
  assert.equal(audio.pause(), 5.25);
  audio.context.currentTime = 50;
  assert.equal(audio.position, 5.25);
  audio.play({ duration: 100 }, 5.25, 2);
  assert.deepEqual(audio.source.started, { at: 52, offset: 5.25 });
  audio.context.currentTime = 51; assert.equal(audio.position, 5.25);
  audio.context.currentTime = 53; assert.equal(audio.position, 6.25);
});
test('pausing during countdown does not skip the intro', () => {
  const audio = new SongAudio(); audio.context = new FakeContext();
  audio.play({ duration: 100 }); audio.context.currentTime = 11;
  assert.equal(audio.pause(), 0); assert.equal(audio.position, 0);
});

for (const support of ['supported', 'unavailable', 'rejected']) {
  test(`unlock requests iOS music playback and resumes audio: ${support}`, async () => {
    const originals = ['navigator', 'AudioContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    const calls = [];
    const audioSession = {};
    Object.defineProperty(audioSession, 'type', { set(value) {
      calls.push(value);
      if (support === 'rejected') throw new Error('Unsupported session type');
    } });
    try {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: support === 'unavailable' ? {} : { audioSession } });
      Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
        constructor() { calls.push('create'); }
        resume() { calls.push('resume'); return Promise.resolve(); }
      } });
      const audio = new SongAudio();
      const ready = audio.unlock();
      // All activation-sensitive calls happen before the first await.
      assert.deepEqual(calls, support === 'unavailable' ? ['create', 'resume'] : ['playback', 'create', 'resume']);
      await ready;
      await audio.unlock();
      assert.equal(calls.filter(call => call === 'create').length, 1);
      assert.equal(calls.filter(call => call === 'resume').length, 2);
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
}

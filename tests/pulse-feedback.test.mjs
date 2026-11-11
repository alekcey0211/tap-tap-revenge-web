import test from 'node:test';
import assert from 'node:assert/strict';
import { PulseFeedback } from '../prototype/pulse-feedback.js';
const perfect = index => ({ index, total: 3, recent: true, result: { captured: true, perfect: true } });

test('only a newly completed perfect Pulse triggers a celebration', () => {
  const effect = new PulseFeedback();
  assert.equal(effect.frame(null, 1), null);
  assert.equal(effect.frame({ ...perfect(1), recent: false }, 2), null);
  assert.equal(effect.frame({ ...perfect(1), result: { captured: true, perfect: false } }, 3), null);
  const event = effect.frame(perfect(2), 10);
  assert.equal(event.index, 2); assert.equal(event.age, 0); assert.equal(event.opacity, 1);
  assert.ok(effect.frame(perfect(2), 11.3).opacity < 1);
  assert.equal(effect.frame(perfect(2), 12), null);
  assert.equal(effect.frame(perfect(2), 13), null);
  assert.equal(effect.frame(perfect(3), 14).age, 0);
});

test('pause preserves the song-time effect; reset allows a new attempt', () => {
  const effect = new PulseFeedback();
  const first = effect.frame(perfect(1), 10);
  assert.deepEqual(effect.frame(perfect(1), 10), first);
  assert.equal(effect.frame(null, 12), null);
  effect.reset();
  assert.equal(effect.frame(perfect(1), 20).born, 20);
});

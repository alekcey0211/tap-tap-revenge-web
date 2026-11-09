import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaSongAudio } from '../dist/media-audio.js';
import { deferred } from './helpers/ui-harness.mjs';

function setup(t) {
  let now = 0;
  const media = { currentTime: 0, duration: 20, ended: false, paused: true, readyState: 4, seeking: false,
    plays: 0, loads: 0, gate: null, failure: null,
    addEventListener(name, fn) { this['on' + name] = fn; },
    play() { this.plays++; this.paused = false; return this.failure ? Promise.reject(this.failure) : this.gate?.promise || Promise.resolve(); },
    pause() { this.paused = true; }, removeAttribute(name) { delete this[name]; }, load() { this.loads++; },
  };
  const revoked = [];
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const audio = new MediaSongAudio(() => media, () => now);
  const track = { blob: new Blob(['music'], { type: 'audio/mp4' }), duration: 20 };
  t.after(() => audio.dispose());
  return { media, audio, track, revoked, time: value => { now = value; } };
}

test('native play is synchronous, fulfilled before reporting success, and uses device volume', async t => {
  const { audio, media, track } = setup(t);
  media.gate = deferred();
  const started = audio.play(track);
  assert.equal(media.plays, 1);
  assert.equal(media.muted, false);
  assert.equal(media.volume, 1);
  audio.setVolume(0);
  assert.equal(media.volume, 1);
  media.gate.resolve(); assert.equal(await started, true);
  assert.equal(audio.countdown, 0);
});

test('notes follow media time, not wall time, including buffering and seeking', async t => {
  const { audio, media, track, time } = setup(t);
  await audio.play(track); media.currentTime = 4;
  time(90000); assert.equal(audio.position, 4);
  media.readyState = 2; assert.equal(audio.waiting, true);
  time(120000); assert.equal(audio.position, 4);
  media.readyState = 4; media.seeking = true; assert.equal(audio.waiting, true);
  media.seeking = false; assert.equal(audio.waiting, false);
  media.currentTime = 5; assert.equal(audio.position, 5);
});

test('pause and resume preserve position and detect external interruption', async t => {
  const { audio, media, track } = setup(t);
  await audio.play(track); media.currentTime = 8;
  assert.equal(audio.pause(), 8); assert.equal(media.paused, true);
  assert.equal(audio.interrupted, false); assert.equal(audio.position, 8);
  await audio.play(track, 8); assert.equal(media.currentTime, 8);
  assert.equal(audio.interrupted, false);
  media.paused = true; assert.equal(audio.interrupted, true);
});

test('end-of-track tail can finish delayed notes and resume without replaying music', async t => {
  const { audio, media, track, time } = setup(t);
  await audio.play(track); media.currentTime = 20; media.ended = true; media.paused = true;
  assert.equal(audio.interrupted, false); assert.equal(audio.position, 20);
  time(400); assert.equal(audio.pause(), 20.4);
  time(2000); await audio.play(track, 20.4);
  assert.equal(media.plays, 1); assert.equal(audio.interrupted, false);
  time(2500); assert.equal(audio.position, 20.9);
});

test('rejection stops playback and retry remains possible', async t => {
  const { audio, media, track } = setup(t);
  media.failure = new Error('NotAllowedError');
  await assert.rejects(audio.play(track), /NotAllowed/);
  assert.equal(media.paused, true); assert.equal(audio.active, false);
  media.failure = null; await audio.play(track);
  assert.equal(audio.active, true);
});

test('cancelled play cannot be reported as started or stop newer playback on late rejection', async t => {
  const { audio, media, track } = setup(t);
  const gate = deferred(); media.gate = gate;
  const old = audio.play(track); audio.stop();
  media.gate = null; await audio.play(track, 2);
  gate.reject(new Error('old')); await assert.rejects(old, /old/);
  assert.equal(media.paused, false); assert.equal(audio.position, 2);
  media.gate = deferred(); const canceled = audio.play(track); audio.stop();
  media.gate.resolve(); assert.equal(await canceled, false);
});

test('replacing and disposing tracks releases blob URLs and media source', async t => {
  const { audio, media, track, revoked } = setup(t);
  await audio.play(track); const first = media.src;
  await audio.play({ ...track }); assert.deepEqual(revoked, [first]);
  const second = media.src; audio.dispose();
  assert.deepEqual(revoked, [first, second]); assert.equal(media.src, undefined);
  assert.equal(audio.active, false); audio.dispose(); assert.equal(revoked.length, 2);
});

test('load fetches an audio blob without decoding and propagates HTTP errors', async t => {
  const { audio, track } = setup(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, blob: async () => track.blob }));
  assert.deepEqual(await audio.load('song.m4a', 20), track);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(audio.load('missing.m4a', 20), /загрузить/);
  await assert.rejects(audio.load('song.m4a', 0), /duration/);
});

test('synchronous media failure leaves no active playback', async t => {
  const { audio, media, track } = setup(t);
  media.play = () => { throw new Error('synchronous play'); };
  await assert.rejects(audio.play(track), /synchronous/);
  assert.equal(audio.active, false); assert.equal(media.paused, true);
});

test('native pause/error events notify immediately, but own pauses and natural end do not', async t => {
  const { audio, media, track } = setup(t); let interrupts = 0;
  audio.oninterrupt = () => { interrupts++; audio.pause(); };
  await audio.play(track); media.currentTime = 6;
  media.paused = true; media.onpause();
  assert.equal(interrupts, 1); assert.equal(audio.position, 6);
  media.onpause(); assert.equal(interrupts, 1);
  await audio.play(track, 6);
  media.onpause(); // A queued pause event from stop(), delivered after play().
  assert.equal(interrupts, 1);
  media.error = { code: 2 }; media.onerror();
  assert.equal(interrupts, 2); assert.equal(audio.position, 6);
  media.error = null; await audio.play(track, 6);
  media.ended = true; media.paused = true; media.onpause();
  assert.equal(interrupts, 2);
});

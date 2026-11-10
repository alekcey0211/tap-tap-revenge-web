import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chooseBackend } from '../prototype/backend.js';
import { Transport } from '../prototype/transport.js';

function player() { return { position: 0, interrupted: false, starts: [], stops: 0,
  play(track, offset) { this.starts.push({ track, offset }); this.position = offset; return this.gate || Promise.resolve(); },
  stop() { this.stops++; }, dispose() {},
}; }
const track = { duration: 90 };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; };

for (const failure of ['unsupported', 'support-error', 'init-error', 'forced']) test(`prototype falls back to WebGL: ${failure}`, async () => {
  let gpu = 0, gl = 0;
  const result = await chooseBackend({ preference: failure === 'forced' ? 'webgl' : 'auto',
    supported: async () => { if (failure === 'support-error') throw new Error(); return failure !== 'unsupported'; },
    webgpu: async () => { gpu++; throw new Error('GPU initialization'); },
    webgl: async () => { gl++; return { name: 'WebGL 2' }; },
  });
  assert.equal(result.name, 'WebGL 2'); assert.equal(gl, 1); assert.equal(gpu, failure === 'init-error' ? 1 : 0);
  assert.equal(result.fallback, failure !== 'forced');
});

test('prototype selects WebGPU without creating another renderer', async () => {
  const result = await chooseBackend({ supported: async () => true, webgpu: async () => ({ name: 'WebGPU' }), webgl: () => assert.fail('unexpected fallback') });
  assert.equal(result.name, 'WebGPU'); assert.equal(result.fallback, false);
});

test('prototype reports total renderer failure, never pretending WebGL exists', async () => {
  await assert.rejects(chooseBackend({ supported: async () => false, webgl: async () => { throw new Error('no context'); } }), /no context/);
});

test('prototype calls native play synchronously and follows media time rather than wall time', async () => {
  const p = player(), t = new Transport(p, () => 500); t.setTrack(track);
  const starting = t.play(true); assert.equal(p.starts.length, 1); await starting;
  p.position = 4; assert.equal(t.position, 4);
  t.pause(); p.position = 90; assert.equal(t.position, 4);
  assert.equal(p.starts.length, 1); await t.play(true); assert.equal(p.starts.at(-1).offset, 4);
});

test('prototype silent demo never creates media playback, pause freezes its clock', async () => {
  const p = player(); let now = 1; const t = new Transport(p, () => now); t.setTrack(track);
  await t.play(false); now = 7; assert.equal(t.position, 6);
  t.pause(); now = 100; assert.equal(t.position, 6); assert.equal(p.starts.length, 0);
  await t.play(false); now = 102; assert.equal(t.position, 8); assert.equal(p.starts.length, 0);
});

test('prototype background pause cancels pending native play and never autoresumes', async () => {
  const p = player(), t = new Transport(p); t.setTrack(track); const gate = deferred(); p.gate = gate.promise;
  const starting = t.play(true); p.position = .4; t.pause(); gate.resolve(); await starting;
  assert.equal(t.state, 'paused'); assert.equal(t.position, .4); assert.equal(p.starts.length, 1);
});

test('prototype ends once, restarts explicitly and does not let late play replace a new track', async () => {
  const p = player(), t = new Transport(p); t.setTrack(track); await t.play(true);
  p.position = 91; t.update(); assert.equal(t.state, 'ended'); assert.equal(t.position, 90);
  await t.play(true); assert.equal(p.starts.at(-1).offset, 0);
  t.pause(); const gate = deferred(); p.gate = gate.promise; const starting = t.play(true);
  const next = { duration: 60 }; t.setTrack(next); gate.resolve(); await starting;
  assert.equal(t.state, 'ready'); assert.equal(t.track, next); assert.equal(t.position, 0);
});

test('prototype audio rejection and interruption leave an explicit retry state', async () => {
  const p = player(), t = new Transport(p); t.setTrack(track); p.gate = Promise.reject(new Error('not allowed'));
  await assert.rejects(t.play(true), /not allowed/); assert.equal(t.state, 'paused');
  p.gate = null; await t.play(true); p.interrupted = true; t.update(); assert.equal(t.state, 'paused');
});

test('prototype bundle matches checked-in source and pinned dependency metadata', async () => {
  const meta = JSON.parse(await readFile(new URL('../dist/prototype/build.json', import.meta.url)));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [name, expected] of Object.entries(meta.sources)) assert.equal(hash(await readFile(new URL('../prototype/' + name, import.meta.url))), expected, name + ': rebuild prototype');
  assert.equal(hash(await readFile(new URL('../dist/prototype/stage.js', import.meta.url))), meta.bundle);
  const pkg = JSON.parse(await readFile(new URL('../prototype/package.json', import.meta.url)));
  assert.equal(pkg.dependencies['@babylonjs/core'], meta.babylon);
});

test('prototype is isolated from main entry, save data, audio context and offline precache', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const main = await read('dist/app.js') + await read('dist/index.html');
  assert.doesNotMatch(main, /prototype\/|babylon/i);
  const app = await read('prototype/app.js'), transport = await read('prototype/transport.js');
  assert.doesNotMatch(app + transport, /localStorage|sessionStorage|indexedDB|recordAttempt|AudioContext|serviceWorker/);
  assert.match(app, /audioEngine: false/);
  assert.match(app, /import \{ MediaSongAudio \} from '\.\.\/dist\/media-audio\.js'/);
  const manifest = JSON.parse((await read('dist/offline-assets.js')).split(' = ')[1].replace(/;\s*$/, ''));
  assert.ok(manifest.shell.every(file => !file.path.startsWith('prototype/')));
  const html = await read('dist/prototype/index.html');
  assert.doesNotMatch(html, /https:\/\/|unsafe-inline|unsafe-eval/);
  assert.match(html, /href="\.\.\/#\/"/);
});

const { PlaySession } = await import('../prototype/session.js');
const note = (time, lane = 0, duration = 0) => ({ time, lane, duration });

test('manual prototype never hits automatically, misses expire after the original window', () => {
  let effects = 0; const s = new PlaySession([note(1)], { onHit: () => effects++ });
  s.advance(1); assert.equal(s.game.hits, 0); assert.equal(s.game.notes[0].state, 'pending');
  s.advance(1.181); assert.equal(s.game.misses, 1); assert.equal(effects, 0);
});

test('manual taps use original judgment boundaries and trigger one effect per hit', () => {
  for (const [error, judgment] of [[0, 'PERFECT'], [.045, 'PERFECT'], [.09, 'GREAT'], [.14, 'GOOD'], [.18, 'OK']]) {
    const effects = [], s = new PlaySession([note(1)], { onHit: (...hit) => effects.push(hit) });
    s.press(0, 'finger', 1 + error); s.press(0, 'finger', 1 + error); s.release('finger', 1 + error);
    assert.equal(s.game.notes[0].judgment, judgment); assert.equal(effects.length, 1); assert.equal(s.game.strays, 0);
  }
});

test('manual wrong lane and early taps break combo but never consume a future note', () => {
  const s = new PlaySession([note(1), note(2)]);
  s.press(0, 'a', 1); s.release('a', 1);
  s.press(1, 'b', 2); s.release('b', 2);
  assert.equal(s.game.streak, 0); assert.equal(s.game.notes[1].state, 'pending');
  s.press(0, 'c', 2); assert.equal(s.game.hits, 2); assert.equal(s.game.strays, 1);
});

test('manual simultaneous fingers independently hit all three lanes', () => {
  const s = new PlaySession([note(1, 0), note(1, 1), note(1, 2)]);
  for (let lane = 0; lane < 3; lane++) s.press(lane, `pointer:${lane}`, 1);
  assert.equal(s.game.hits, 3); assert.equal(s.game.streak, 3);
  for (let lane = 0; lane < 3; lane++) s.release(`pointer:${lane}`, 1.1);
  assert.deepEqual(s.game.held, [false, false, false]);
});

test('duplicate finger or keyboard on one lane cannot double-score or prematurely release hold', () => {
  const s = new PlaySession([note(1, 0, 1)]);
  s.press(0, 'a', 1); s.press(0, 'b', 1); s.release('a', 1.1);
  assert.equal(s.game.hits, 1); assert.equal(s.game.held[0], true);
  s.advance(2); s.release('b', 2); s.release('b', 2);
  assert.equal(s.game.brokenHolds, 0); assert.equal(s.game.score, 150);
});

test('cancelled finger releases the lane and early release breaks a hold', () => {
  const s = new PlaySession([note(1, 0, 1)]);
  s.press(0, 'pointer', 1); s.release('pointer', 1.2);
  assert.equal(s.game.notes[0].state, 'broken'); assert.equal(s.game.streak, 0);
  assert.equal(s.game.brokenHolds, 1); assert.equal(s.inputs.size, 0);
});

test('pause clears inputs without breaking a hold; resume allows re-grabbing', () => {
  const s = new PlaySession([note(1, 0, 2)]);
  s.press(0, 'a', 1); s.suspend(); s.resume(1.2); s.advance(1.3);
  assert.equal(s.game.notes[0].state, 'holding'); assert.equal(s.inputs.size, 0);
  s.press(0, 'b', 1.4); s.advance(3); s.release('b', 3);
  assert.equal(s.game.hits, 1); assert.equal(s.game.brokenHolds, 0); assert.equal(s.game.score, 150);
});

test('resume does not silently hold an abandoned long note forever', () => {
  const s = new PlaySession([note(1, 0, 2)]);
  s.press(0, 'a', 1); s.suspend(); s.resume(1.2); s.advance(1.51);
  assert.equal(s.game.brokenHolds, 1); assert.equal(s.game.notes[0].state, 'broken');
});

test('autodemo handles chords and holds without accepting manual score input', () => {
  const s = new PlaySession([note(1, 0, .5), note(1, 1), note(1.7, 0)], { demo: true });
  s.press(2, 'user', .1); s.advance(1); s.advance(1.6); s.advance(2);
  assert.equal(s.game.hits, 3); assert.equal(s.game.strays, 0); assert.equal(s.game.brokenHolds, 0);
  assert.equal(s.game.score, 350);
});

test('manual score multiplier reaches x8 through combo, not the visual switch', () => {
  const s = new PlaySession(Array.from({ length: 51 }, (_, i) => note(i + 1)));
  for (let i = 1; i <= 51; i++) { s.press(0, 'a', i); s.release('a', i); }
  assert.equal(s.game.multiplier(51), 8);
  s.press(2, 'wrong', 51.1); assert.equal(s.game.multiplier(51.1), 1);
});

test('finishing and creating another run neither mutates the chart nor reuses results', () => {
  const chart = [note(1), note(2)], s = new PlaySession(chart);
  s.press(0, 'a', 1); s.release('a', 1); const result = s.finish();
  assert.equal(result.hits, 1); assert.equal(result.misses, 1);
  assert.equal(chart[0].state, undefined);
  const next = new PlaySession(chart); assert.equal(next.game.score, 0); assert.equal(next.game.misses, 0);
});

test('autodemo completes every current song and difficulty, including long notes', async () => {
  const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
  for (const track of catalog.filter(track => !track.tutorial)) for (let level = 1; level <= 4; level++) {
    const chart = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${track.id}/${level}.json`, import.meta.url)));
    const session = new PlaySession(chart, { demo: true });
    for (let time = 0; time < track.duration; time += 1 / 30) session.advance(time);
    const result = session.finish();
    assert.equal(result.hits, chart.length, `${track.id}/${level}`);
    assert.equal(result.misses + result.strays + result.brokenHolds, 0);
  }
});

const { laneWidths } = await import('../prototype/input-regions.js');
test('full game touch lanes follow projected ring centers on short and tall screens', () => {
  for (const [width, centers] of [[320, [109, 160, 211]], [390, [112, 195, 278]], [418, [120, 209, 298]]]) {
    const widths = laneWidths(centers.map(x => ({ x })), width);
    assert.equal(widths.reduce((sum, value) => sum + value, 0), width);
    let left = 0;
    widths.forEach((size, lane) => { assert.ok(centers[lane] > left && centers[lane] < left + size); left += size; });
    assert.ok(widths.every(size => size >= 44));
  }
});

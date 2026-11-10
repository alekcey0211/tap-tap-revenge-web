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
  assert.match(app, /import \{ MediaSongAudio \} from '\.\.\/media-audio\.js\?v=0\.3\.1'/);
  const manifest = JSON.parse((await read('dist/offline-assets.js')).split(' = ')[1].replace(/;\s*$/, ''));
  assert.ok(manifest.shell.every(file => !file.path.startsWith('prototype/')));
  const html = await read('dist/prototype/index.html');
  assert.doesNotMatch(html, /https:\/\/|unsafe-inline|unsafe-eval/);
  assert.match(html, /href="\.\.\/#\/"/);
});

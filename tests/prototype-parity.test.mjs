import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mountWorker, FakeCaches } from './helpers/sw-harness.mjs';
import * as stableSave from '../dist/storage.js';
import * as labSave from '../dist/prototype/storage.js';

const root = new URL('../dist/prototype/', import.meta.url);
const read = (path, base = root) => readFile(new URL(path, base), 'utf8');
const stable = new URL('../dist/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse((await read('offline-assets.js')).split(' = ')[1].replace(/;\s*$/, ''));
const scope = 'https://example.test/tap-tap-revenge-web/prototype/';

test('full prototype uses the exact working application with only renderer integration and version changed', async () => {
  const expected = (await read('app.js', stable)).replace("'./renderer.js?v=0.9.0'", "'./babylon-renderer.js?v=0.5.1'").replace("const APP_VERSION = '0.10.4';", "const APP_VERSION = '0.5.1-babylon';").replace('pulse?.zones(time, TRAVEL[run.level]));', 'pulse?.zones(time, TRAVEL[run.level]), { songId: run.song.id, position });');
  assert.equal(await read('app.js'), expected);
  for (const name of ['audio.js', 'media-audio.js', 'routing.js', 'progress.js', 'format.js', 'temporal.js', 'phrase-progress.js', 'pulse-view.js', 'pulse-zones.js', 'phrase-charts.js', 'offline-view.js', 'offline.js', 'sw.js']) {
    assert.equal(await read(name), await read(name, stable), name);
  }
});

test('every stable screen/control is retained exactly once in the full prototype', async () => {
  const main = await read('index.html', stable), prototype = await read('index.html');
  const ids = text => [...text.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const current = ids(prototype);
  assert.equal(current.length, new Set(current).size);
  for (const id of ids(main)) assert.ok(current.includes(id), id);
  assert.match(prototype, /game-bootstrap\.js\?v=0\.5\.1/);
  assert.match(prototype, /href="lab.html"/);
  assert.match(prototype, /TAP<span>BEAT<\/span>/);
  assert.match(prototype, /Тапай в бит/);
});

test('prototype storage isolates progress, resets chart revision, and retains compatible audio default', async () => {
  const withoutLegacy = source => source.replace(/function legacy\(storage, defaults\) \{[\s\S]*?(?=function resetLegacyPulse)/, '');
  const expectedStorage = (await read('storage.js', stable)).replaceAll('ttr-web-', 'ttr-babylon-').replace('compatibleAudio: false', 'compatibleAudio: true')
    .replace('ttr-babylon-save-v1', 'ttr-babylon-save-v2').replace("CHART_VERSION = 'original-v1'", "CHART_VERSION = 'neon-three-v1'");
  assert.equal(withoutLegacy(await read('storage.js')), withoutLegacy(expectedStorage));
  const original = new Map([
    [stableSave.SAVE_KEY, stableSave.exportProgress(stableSave.DEFAULT_SETTINGS, { records: [], history: [] })],
    ['ttr-web-records', '{"do-not-touch":true}'], ['ttr-web-settings', '{"volume":17}'],
  ]);
  const values = new Map(original), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = labSave.loadSave(storage);
  assert.equal(state.settings.compatibleAudio, true); assert.equal(state.settings.volume, 75);
  const progress = labSave.recordAttempt(state.progress, { songId: 'warehouse-echoes-v1', level: '1', playedAt: '2026-11-10T12:00:00Z', id: crypto.randomUUID(), result: { score: 100, accuracy: 100, bestStreak: 1 } });
  labSave.saveProgress(storage, progress, state.settings);
  assert.equal(labSave.loadSave(storage).progress.history.length, 1);
  labSave.importProgress(storage, labSave.exportProgress(state.settings, progress));
  for (const [key, value] of original) assert.equal(values.get(key), value, key);
  assert.notEqual(labSave.SAVE_KEY, stableSave.SAVE_KEY);
});

test('full build metadata tracks working sources and the actual renderer bundle', async () => {
  const meta = JSON.parse(await read('build.json'));
  for (const [path, expected] of Object.entries(meta.mainSources)) assert.equal(hash(await readFile(new URL(path, stable))), expected, path);
  assert.equal(meta.renderer, hash(await readFile(new URL('babylon-renderer.js', root))));
});

test('prototype offline manifest covers full UI, Babylon, lab and selected-track files with exact hashes', async () => {
  for (const path of ['index.html', 'app.js', 'babylon-renderer.js', 'game-bootstrap.js', 'babylon.css', 'lab.html', 'stage.js', 'storage.js']) assert.ok(manifest.shell.some(file => file.path === path), path);
  for (const file of [...manifest.shell, ...Object.values(manifest.tracks).flatMap(track => track.files)]) {
    const data = await readFile(new URL(file.path, root));
    assert.equal(data.length, file.bytes, file.path); assert.equal(hash(data), file.hash, file.path);
  }
  assert.equal(manifest.version, '0.5.1-babylon');
  const pwa = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(pwa.scope, './'); assert.equal(pwa.start_url, './'); assert.equal(pwa.short_name, 'Tapbeat');
});

test('prototype can cache full shell and song; its update/removal cannot delete main game caches', async () => {
  const caches = new FakeCaches();
  const main = await mountWorker({ caches });
  await main.lifecycle('install');
  const id = 'warehouse-echoes-v1'; await main.message('download', id);
  const mainNames = await caches.keys();
  const lab = await mountWorker({ root, scope, caches });
  await lab.lifecycle('install'); await lab.message('download', id);
  lab.offline(true);
  for (const path of ['index.html', 'app.js', 'babylon-renderer.js', 'assets/tracks/' + id + '/audio.m4a']) {
    assert.equal((await lab.request(path)).status, 200, path);
  }
  const next = await mountWorker({ root, scope, caches, assets: { ...manifest, version: 'next-prototype' } });
  await next.lifecycle('install'); await next.lifecycle('activate'); await next.message('remove', id);
  for (const name of mainNames) assert.ok((await caches.keys()).includes(name), name);
  assert.equal((await main.message('state', id)).result.state, 'ready');
  assert.equal(lab.request('../app.js'), undefined);
});

test('prototype keeps a viewport-sized scrolling venue without a sticky utility header', async () => {
  const html = await read('index.html'), css = await read('babylon.css');
  assert.match(html, /class="babylon-background"[^>]*><div class="babylon-viewport"><canvas/);
  assert.match(css, /\.babylon-viewport \{ position: sticky; top: 0; height: 100svh;/);
  assert.match(css, /body\[data-utility='true'\] \.appbar \{ position: relative; top: auto; background: transparent;/);
  assert.doesNotMatch(css, /height: min\(100svh, 900px\)/);
});

test('prototype mobile field uses the dynamic viewport with HUD and legible time overlaid', async () => {
  const css = await read('babylon.css');
  assert.match(css, /#game-screen \{ height: 100dvh; min-height: 0;/);
  assert.match(css, /#game-screen \.playfield \{ position: absolute; inset: 0;/);
  assert.match(css, /#game-screen #time \{ font-size: 16px;/);
  assert.match(css, /padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /#game-screen \.touch-lanes \{ bottom: 0;/);
});

test('interface backdrop blurs only the decorative venue, not the playable canvas or UI', async () => {
  const css = await read('babylon.css');
  const overlay = css.match(/\.babylon-viewport::after \{([^}]+)\}/)[1];
  assert.match(overlay, /backdrop-filter: blur\(8px\)/);
  assert.match(overlay, /-webkit-backdrop-filter: blur\(8px\)/);
  assert.match(css, /body\[data-screen='game-screen'\] \.babylon-background \{ visibility: hidden;/);
  assert.doesNotMatch(css.match(/\.babylon-surface \{([^}]+)\}/)[1], /filter:/);
});

test('song and calibration controls have no legacy dark panel over the shared venue', async () => {
  assert.match(await read('babylon.css'), /\.song-controls \{ background: none; \}/);
});

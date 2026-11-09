import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountWorker, FakeCaches } from './helpers/sw-harness.mjs';

const first = worker => Object.keys(worker.assets.tracks)[0];

test('whole shell installs atomically, and navigations and versioned modules work offline under Pages scope', async () => {
  const sw = await mountWorker(); await sw.lifecycle('install'); sw.offline(true);
  for (const path of ['./', './?from=home', 'index.html?check=1', 'app.js?v=0.5.0', 'phrase-progress.js', 'phrase-charts.js', 'pulse-view.js', 'hit-effects.js', 'vendor/temporal-0.5.1.js']) {
    const response = await sw.request(path, { mode: path.startsWith('./') || path.startsWith('index') ? 'navigate' : 'cors' });
    assert.equal(response.status, 200, path); assert.ok((await response.text()).length > 0);
  }
});

test('failed shell install keeps the previous shell and unrelated origin caches intact', async () => {
  const caches = new FakeCaches();
  await caches.open('tap-tap:/tap-tap-revenge-web/:shell:old'); await caches.open('other-app');
  const sw = await mountWorker({ caches }); sw.fail('style.css');
  await assert.rejects(sw.lifecycle('install'));
  assert.deepEqual(await caches.keys(), ['tap-tap:/tap-tap-revenge-web/:shell:old', 'other-app']);
});

test('mixed release files cannot install or leak into an old offline shell', async () => {
  const sw = await mountWorker(); sw.mismatch('app.js');
  await assert.rejects(sw.lifecycle('install'), /version/);
  assert.equal((await sw.caches.keys()).length, 0);
  const response = await sw.request('app.js?v=0.4.0');
  assert.equal(response.status, 503);
});

test('selected track is ready only with music, artwork and every chart; all can be read offline', async () => {
  const sw = await mountWorker(); const id = first(sw);
  assert.equal((await sw.message('state', id)).result.state, 'missing');
  assert.equal((await sw.message('download', id)).result.state, 'ready');
  const files = sw.assets.tracks[id].files;
  assert.ok(files.some(file => file.path.endsWith('audio.m4a')));
  assert.equal(files.filter(file => file.path.endsWith('.json')).length, 4);
  sw.offline(true);
  for (const file of files.filter(file => !file.path.endsWith('.png'))) {
    const response = await sw.request(file.path);
    assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, file.bytes);
  }
  const other = Object.keys(sw.assets.tracks).find(value => value !== id);
  assert.equal((await sw.request(sw.assets.tracks[other].files[0].path)).status, 503);
});

for (const failure of ['network', 'quota', 'version']) {
  test(`partial ${failure} download is not advertised as ready and can be retried`, async () => {
    const sw = await mountWorker(); const id = first(sw), file = sw.assets.tracks[id].files[1].path;
    if (failure === 'network') sw.fail(file);
    if (failure === 'quota') sw.caches.quota = true;
    if (failure === 'version') sw.mismatch(file);
    assert.ok((await sw.message('download', id)).error);
    assert.equal((await sw.message('state', id)).result.state, 'missing');
    sw.fail(null); sw.mismatch(null); sw.caches.quota = false;
    assert.equal((await sw.message('download', id)).result.state, 'ready');
  });
}

test('eviction and a crash halfway through download are detected, with repair and explicit removal', async () => {
  const sw = await mountWorker(); const id = first(sw);
  await sw.message('download', id);
  const name = (await sw.caches.keys())[0], cache = await sw.caches.open(name);
  await cache.delete(new URL(sw.assets.tracks[id].files[0].path, sw.scope).href);
  assert.equal((await sw.message('state', id)).result.state, 'partial');
  assert.equal((await sw.message('download', id)).result.state, 'ready');
  assert.equal((await sw.message('remove', id)).result.state, 'missing');
  await sw.message('download', id); await sw.caches.delete(name);
  assert.equal((await sw.message('state', id)).result.state, 'missing');
});

test('requests from two windows serialize download and remove without resurrecting a deleted track', async () => {
  const sw = await mountWorker(); const id = first(sw);
  const downloading = sw.message('download', id, sw.scope + '?window=1');
  const removing = sw.message('remove', id, sw.scope + '?window=2');
  assert.equal((await downloading).result.state, 'ready');
  assert.equal((await removing).result.state, 'missing');
  assert.equal((await sw.message('state', id)).result.state, 'missing');
});

test('unknown files, API, cross-origin and non-GET requests bypass the worker; foreign clients cannot mutate', async () => {
  const sw = await mountWorker();
  for (const path of ['api/generate', '../other/app.js', 'https://other.test/app.js', 'sw.js']) assert.equal(sw.request(path), undefined);
  assert.equal(sw.request('app.js', { method: 'POST' }), undefined);
  assert.equal(await sw.message('download', first(sw), 'https://other.test/'), undefined);
  assert.equal(await sw.message('download', '__proto__'), undefined);
  assert.equal((await sw.caches.keys()).length, 0);
});

test('update install leaves old clients caches untouched; natural activation preserves downloaded tracks', async () => {
  const caches = new FakeCaches(), old = await mountWorker({ caches });
  await old.lifecycle('install'); await old.message('download', first(old));
  const oldNames = await caches.keys(); await caches.open('unrelated');
  const next = await mountWorker({ caches, assets: { ...old.assets, version: 'next-test-version' } });
  await next.lifecycle('install');
  for (const name of oldNames) assert.ok((await caches.keys()).includes(name));
  old.offline(true);
  assert.equal((await old.request('app.js')).status, 200);
  await next.lifecycle('activate'); // Browser dispatches only after the last old client closes.
  assert.equal((await next.message('state', first(next))).result.state, 'ready');
  assert.ok((await caches.keys()).includes('unrelated'));
  assert.ok(!(await caches.keys()).some(name => name.includes(':shell:0.4.0:')));
  const code = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /skipWaiting\s*\(|clients\.claim\s*\(/);
});

test('reinstalling identical assets offline does not erase the working cache', async () => {
  const caches = new FakeCaches(), old = await mountWorker({ caches }); await old.lifecycle('install');
  const same = await mountWorker({ caches }); same.offline(true); await same.lifecycle('install');
  assert.equal((await same.request('app.js')).status, 200);
  assert.equal(same.requests.length, 0);
});

test('Neon Circuit downloads as a complete independent bundle and works offline', async () => {
  const sw = await mountWorker(), id = 'neon-circuit-v1';
  assert.equal((await sw.message('download', id)).result.state, 'ready');
  assert.equal(sw.assets.tracks[id].files.length, 6);
  sw.offline(true);
  for (const file of sw.assets.tracks[id].files) {
    const response = await sw.request(file.path);
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, file.bytes);
  }
});

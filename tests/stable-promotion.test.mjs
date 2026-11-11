import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mountWorker, FakeCaches } from './helpers/sw-harness.mjs';
import * as save from '../release/storage.js';
import * as prototypeSave from '../dist/prototype/storage.js';
import * as oldSave from '../dist/storage.js';

const root = new URL('../release/', import.meta.url);
const prototype = new URL('../dist/prototype/', import.meta.url);
const read = (path, base = root) => readFile(new URL(path, base), 'utf8');
const hash = data => createHash('sha256').update(data).digest('hex');
const assets = JSON.parse((await read('offline-assets.js')).split(' = ')[1].replace(/;\s*$/, ''));
const version = JSON.parse(await read('../package.json')).version;
const id = 'warehouse-echoes-v1';
const storage = entries => {
  const values = new Map(entries);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('stable release promotes the accepted engine, audio, renderer and maps unchanged', async () => {
  for (const path of ['audio.js', 'media-audio.js', 'engine.js', 'routing.js', 'offline.js', 'babylon-renderer.js', 'babylon.css', 'assets/catalog.json']) {
    assert.equal(await read(path), await read(path, prototype), path);
  }
  const expected = (await read('app.js', prototype)).replaceAll('0.6.1-babylon', version).replaceAll('v=0.6.1', `v=${version}`);
  assert.equal(await read('app.js'), expected);
  assert.equal(await read('game-bootstrap.js'), (await read('game-bootstrap.js', prototype)).replaceAll('0.6.1-babylon', version).replaceAll('v=0.6.1', `v=${version}`));
  for (const track of Object.values(assets.tracks)) for (const file of track.files) {
    assert.deepEqual(await readFile(new URL(file.path, root)), await readFile(new URL(file.path, prototype)));
  }
});

test('stable identity, URLs, version and verified shell are consistent', async () => {
  const html = await read('index.html');
  assert.match(html, /<title>Tapbeat<\/title>/);
  assert.doesNotMatch(html, /STAGE LAB|Stage Lab|Рабочая версия|Рабочая игра|перезагрузи прототип|href="\.\.\//);
  assert.ok(html.includes(`game-bootstrap.js?v=${version}`));
  assert.equal(assets.version, version);
  for (const file of assets.shell) {
    const bytes = await readFile(new URL(file.path, root));
    assert.equal(hash(bytes), file.hash, file.path); assert.equal(bytes.length, file.bytes, file.path);
  }
  const pwa = JSON.parse(await read('manifest.webmanifest')), previous = JSON.parse(await read('../dist/manifest.webmanifest'));
  for (const key of ['id', 'scope', 'start_url']) assert.equal(pwa[key], previous[key]);
  assert.equal(pwa.name, 'Tapbeat');
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== 'offline-assets.js') assert.equal(await read(entry.name), await read(`prototype/${entry.name}`), entry.name);
  }
});

test('prototype saves remain the same; root and old prototype URL share progress', () => {
  assert.equal(save.SAVE_KEY, prototypeSave.SAVE_KEY);
  const progress = prototypeSave.recordAttempt({ records: [], history: [] }, { songId: id, level: '1', playedAt: '2026-11-10T12:00:00Z', id: crypto.randomUUID(), result: { score: 1234, accuracy: 98, bestStreak: 21 } });
  const settings = { ...save.DEFAULT_SETTINGS, compatibleAudio: false, volume: 31, offset: 73 };
  const text = prototypeSave.exportProgress(settings, progress);
  const db = storage([[save.SAVE_KEY, text]]), state = save.loadSave(db);
  assert.deepEqual(state.settings, settings); assert.deepEqual(state.progress, progress);
  assert.equal(db.getItem(save.SAVE_KEY), text);
});

test('first stable launch retains old audio settings without comparing different charts or deleting old saves', () => {
  const settings = { ...oldSave.DEFAULT_SETTINGS, compatibleAudio: true, volume: 28, offset: 37, motion: true };
  const text = oldSave.exportProgress(settings, { records: [], history: [] });
  const db = storage([[oldSave.SAVE_KEY, text]]), state = save.loadSave(db);
  assert.deepEqual(state.settings, settings); assert.equal(db.getItem(oldSave.SAVE_KEY), text);
  assert.equal(state.progress.history.length, 0);
  assert.equal(save.loadSave(storage()).settings.compatibleAudio, true);
  const corrupted = storage([[save.SAVE_KEY, 'damaged'], [oldSave.SAVE_KEY, text]]);
  assert.equal(save.loadSave(corrupted).writable, false); assert.equal(corrupted.getItem(save.SAVE_KEY), 'damaged');
});

test('root PWA upgrade preserves selected old tracks and remaps chart files by hash, offline', async () => {
  const caches = new FakeCaches(), old = await mountWorker({ caches });
  await old.lifecycle('install'); await old.message('download', id);
  const next = await mountWorker({ caches, root });
  await next.lifecycle('install');
  // Waiting install cannot touch the current worker or its audio/chart responses.
  assert.equal((await old.message('state', id)).result.state, 'ready');
  const before = next.requests.length;
  next.offline(true); await next.lifecycle('activate');
  assert.equal(next.requests.length, before, 'migration never downloads music');
  assert.equal((await next.message('state', id)).result.state, 'ready');
  for (const file of assets.tracks[id].files) {
    const response = await next.request(file.path);
    assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.hash, file.path);
  }
  for (const other of Object.keys(assets.tracks).filter(key => key !== id)) assert.equal((await next.message('state', other)).result.state, 'missing');
  assert.equal((await next.request('', { mode: 'navigate' })).status, 200);
  assert.equal((await next.request('babylon-renderer.js?v=1.0.0')).status, 200);
  const later = await mountWorker({ caches, root, assets: { ...assets, version: '1.0.1' } });
  await later.lifecycle('install'); later.offline(true); await later.lifecycle('activate');
  assert.equal((await later.message('state', id)).result.state, 'ready');
});

test('selected prototype downloads can be reused at root without deleting prototype cache', async () => {
  const caches = new FakeCaches(), lab = await mountWorker({ caches, root: prototype, scope: 'https://example.test/tap-tap-revenge-web/prototype/' });
  await lab.message('download', id);
  const previous = await caches.keys(), next = await mountWorker({ caches, root });
  await next.lifecycle('install'); next.offline(true); await next.lifecycle('activate');
  assert.equal((await next.message('state', id)).result.state, 'ready');
  assert.equal((await lab.message('state', id)).result.state, 'ready');
  for (const name of previous) assert.ok((await caches.keys()).includes(name));
});

for (const failure of ['corrupt', 'quota']) test(`migration ${failure} does not destroy the previous offline download`, async () => {
  const caches = new FakeCaches(), old = await mountWorker({ caches });
  await old.message('download', id);
  const previous = await caches.keys(), next = await mountWorker({ caches, root });
  await next.lifecycle('install'); next.offline(true);
  if (failure === 'quota') caches.quota = true;
  else await (await caches.open(previous[0])).put(new URL(`assets/tracks/${id}/audio.m4a`, old.scope).href, new Response('corrupt'));
  await next.lifecycle('activate');
  for (const name of previous) assert.ok((await caches.keys()).includes(name));
  assert.equal((await next.message('state', id)).result.state, 'missing');
});

test('release CI builds Babylon and runs both full test suites before publication', async () => {
  const lock = JSON.parse(await read('../prototype/package-lock.json'));
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved) assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org');
  }
  for (const name of ['checks', 'pages']) {
    const text = await read(`../.github/workflows/${name}.yml`);
    for (const command of ['npm ci --prefix prototype', 'npm run build', 'npm run test:scene', 'npm test']) assert.ok(text.includes(`run: ${command}`));
    assert.ok(text.indexOf('run: npm run build') < text.indexOf('run: npm test'));
  }
  assert.match(await read('../.github/workflows/pages.yml'), /path: release/);
});

test('new chart revision retains old history and audio settings but starts separate records', () => {
  const progress = save.recordAttempt({ records: [], history: [] }, { songId: id, level: '1', chartVersion: 'neon-three-v1',
    playedAt: '2026-11-10T12:00:00Z', id: crypto.randomUUID(), result: { score: 1234, accuracy: 98, bestStreak: 21 } });
  const settings = { ...save.DEFAULT_SETTINGS, offset: 75, volume: 40 };
  const text = save.exportProgress(settings, progress);
  const db = storage([[save.SAVE_KEY, text]]), state = save.loadSave(db);
  assert.deepEqual(state.settings, settings);
  assert.deepEqual(state.progress, progress);
  assert.deepEqual(save.currentRecords(state.progress), {});
  assert.equal(db.getItem(save.SAVE_KEY), text);
});

test('selected offline song gets new maps from the verified shell without redownloading music', async () => {
  const caches = new FakeCaches();
  const next = await mountWorker({ caches, root });
  const oldName = `tap-tap:/tap-tap-revenge-web/:track:${id}:old-chart-revision`;
  const old = await caches.open(oldName);
  for (const file of assets.tracks[id].files) {
    const data = file.path.endsWith('.json') ? 'old chart bytes' : await readFile(new URL(file.path, root));
    await old.put(new URL(file.path, next.scope).href, new Response(data));
  }
  await next.lifecycle('install');
  const requests = next.requests.length;
  next.offline(true); await next.lifecycle('activate');
  assert.equal(next.requests.length, requests);
  assert.equal((await next.message('state', id)).result.state, 'ready');
  for (const file of assets.tracks[id].files) {
    const response = await next.request(file.path);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.hash);
  }
  for (const other of Object.keys(assets.tracks).filter(key => key !== id)) assert.equal((await next.message('state', other)).result.state, 'missing');
});

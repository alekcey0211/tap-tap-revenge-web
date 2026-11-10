import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineLibrary } from '../dist/offline.js?v=0.4.0';
import { mount, deferred } from './helpers/ui-harness.mjs';

function registration() {
  const listeners = {}, installing = { state: 'installing', addEventListener: (name, callback) => { listeners[name] = callback; } };
  const reg = { active: null, waiting: null, installing, updates: 0,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    async update() { this.updates++; },
  };
  return { reg, listeners, installing };
}

test('registration uses app-relative scope, uncached worker updates and waits for natural activation', async () => {
  const { reg, listeners, installing } = registration();
  let changes = 0;
  const library = new OfflineLibrary({ async register(path, options) {
    assert.equal(path, './sw.js'); assert.deepEqual(options, { scope: './', updateViaCache: 'none' }); return reg;
  } });
  await library.register(() => changes++);
  assert.equal(library.available, false);
  installing.state = 'redundant'; listeners.statechange(); assert.equal(library.installFailed, true);
  listeners.updatefound(); assert.equal(library.installFailed, false);
  reg.waiting = installing; reg.active = {};
  assert.equal(library.updateReady, true); assert.equal(library.available, true);
  await library.checkUpdate(); assert.equal(reg.updates, 1); assert.ok(changes >= 3);
});

test('public download, state and remove operations use worker messages and surface quota failures', async () => {
  const library = new OfflineLibrary();
  await assert.rejects(library.getOfflineState('track'), /not-ready/);
  const calls = [];
  library.registration = { active: { postMessage(data, [port]) {
    calls.push(data);
    port.postMessage(data.type === 'download' ? { error: 'quota' } : { result: { state: 'missing', bytes: 0 } });
    port.close();
  } } };
  assert.equal((await library.getOfflineState('track')).state, 'missing');
  await assert.rejects(library.downloadTrack('track'), /quota/);
  assert.equal((await library.removeTrack('track')).state, 'missing');
  assert.deepEqual(calls.map(call => call.type), ['state', 'download', 'remove']);
});

async function offlineUI(t) {
  const records = { track: { score: 500, accuracy: 98 } };
  const states = new Map(); let gate = null, failure = null;
  const reg = { active: {}, waiting: null, installing: null, async update() { reg.waiting = {}; } };
  t.mock.method(OfflineLibrary.prototype, 'register', async function (change) { this.registration = reg; change(); return reg; });
  t.mock.method(OfflineLibrary.prototype, 'getOfflineState', async id => states.get(id) || { state: 'missing', bytes: 0 });
  t.mock.method(OfflineLibrary.prototype, 'downloadTrack', async id => {
    if (gate) await gate.promise;
    if (failure) throw new Error(failure);
    const result = { state: 'ready', bytes: 1.5 * 1024 * 1024 }; states.set(id, result); return result;
  });
  t.mock.method(OfflineLibrary.prototype, 'removeTrack', async id => { states.delete(id); return { state: 'missing', bytes: 0 }; });
  const ui = await mount(t, { settings: { compatibleAudio: true }, records });
  return { ...ui, reg, states, setGate: value => { gate = value; }, setFailure: value => { failure = value; } };
}

test('offline UI downloads selected track, formats size with Intl and removes only downloaded data', async t => {
  const ui = await offlineUI(t); const settings = ui.settings(), progress = ui.progress();
  await ui.openSong(); await ui.click('offline-open'); await Promise.resolve();
  assert.equal(ui.node('offline-download').disabled, false);
  await ui.click('offline-download');
  assert.match(ui.node('offline-state').textContent, /1,5 МБ/);
  assert.equal(ui.node('offline-remove').hidden, false);
  await ui.click('offline-remove');
  assert.match(ui.node('offline-state').textContent, /Не скачан/);
  assert.deepEqual(ui.settings(), settings); assert.deepEqual(ui.progress(), progress);
});

test('partial, quota and pending-download UI do not announce offline readiness', async t => {
  const ui = await offlineUI(t); const id = ui.catalog.find(song => !song.tutorial).id;
  ui.states.set(id, { state: 'partial', bytes: 10 });
  await ui.openSong(); await ui.click('offline-open'); await Promise.resolve();
  assert.match(ui.node('offline-state').textContent, /не завершено/);
  const gate = deferred(); ui.setGate(gate);
  const download = ui.click('offline-download');
  assert.equal(ui.node('offline-download').disabled, true);
  assert.doesNotMatch(ui.node('offline-state').textContent, /Доступен без сети/);
  ui.setFailure('quota'); gate.resolve(); await download;
  assert.match(ui.node('offline-state').textContent, /Не хватает места/);
  assert.equal(ui.node('offline-download').disabled, false);
});

test('update UI asks to close all windows and never restarts the current page', async t => {
  const ui = await offlineUI(t);
  await ui.click('menu-settings'); await ui.click('update-check');
  assert.match(ui.node('update-status').textContent, /закрой все/);
  assert.equal(ui.document.body.dataset.screen, 'settings-screen');
  assert.equal(ui.audio.starts.length, 0); assert.equal(ui.native.plays.length, 0);
});

test('offline registration failure reuses the installed active worker', async () => {
  const { reg } = registration(); reg.active = {}; reg.installing = null;
  const library = new OfflineLibrary({ getRegistration: async () => reg, register: async () => { throw new Error('offline'); } });
  await library.register(); assert.equal(library.available, true);
});

test('retry after a failed first install registers again instead of updating a dead registration', async () => {
  const { reg } = registration(); reg.installing = null; let registrations = 0;
  const library = new OfflineLibrary({ register: async () => { registrations++; return reg; } });
  await library.register(); await library.checkUpdate();
  assert.equal(registrations, 2); assert.equal(reg.updates, 0);
});

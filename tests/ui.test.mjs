import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, recordAttempt, exportProgress } from '../dist/storage.js';
import { mount, deferred } from './helpers/ui-harness.mjs';

test('library shows the running app version matching the entry asset version', async t => {
  const ui = await mount(t);
  const version = ui.node('app-version').textContent;
  assert.match(version, /^v\d+\.\d+\.\d+$/);
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`src="app.js?v=${version.slice(1)}"`));
});

test('library selects all existing tracks and four difficulties; persisted settings survive', async t => {
  const ui = await mount(t, { settings: { volume: 35, offset: 25, motion: true } });
  assert.equal(ui.document.body.dataset.screen, 'menu');
  await ui.click('menu-play');
  assert.equal(ui.node('tracks').children.length, 3);
  assert.equal(ui.node('difficulties').children.length, 4);
  assert.equal(ui.node('volume').value, 35);
  assert.equal(ui.node('offset').value, 25);
  assert.equal(ui.document.body.dataset.reducedMotion, 'true');
  await ui.selectedTrack('Warehouse Echoes').onclick();
  assert.equal(ui.node('hero-title').textContent, 'Warehouse Echoes');
  await ui.node('difficulties').children[3].onclick();
  assert.equal(ui.node('difficulties').children[3].attrs['aria-pressed'], 'true');
  assert.equal(ui.document.activeElement, ui.node('difficulties').children[3]);
});

test('cancelling a pending load cannot start audio or replace the library later', async t => {
  const ui = await mount(t);
  ui.audio.loadGate = deferred();
  const start = ui.openSong();
  await Promise.resolve();
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  await ui.click('home');
  ui.audio.loadGate.resolve();
  await start;
  assert.equal(ui.document.body.dataset.screen, 'library');
  assert.equal(ui.audio.starts.length, 0);
});

test('a cancelled failed load cannot overwrite a newer successful start', async t => {
  const ui = await mount(t);
  const gate = deferred(); ui.audio.loadGate = gate;
  const old = ui.openSong(); await new Promise(setImmediate);
  await ui.click('home');
  ui.audio.loadGate = null;
  await ui.start();
  gate.reject(new Error('stale load'));
  await old;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.audio.starts.length, 1);
});

test('track load failure stays on song detail; retry prepares it without autoplay', async t => {
  const ui = await mount(t);
  ui.audio.loadFailure = true;
  await ui.openSong();
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.node('song-load-retry').hidden, false);
  assert.doesNotMatch(ui.node('song-status').textContent, /test network|npm|APK/);
  ui.audio.loadFailure = false;
  await ui.click('song-load-retry');
  assert.equal(ui.audio.starts.length, 0);
  await ui.click('play');
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('mode-label').textContent, 'Легко');
});

test('initialization failure can be retried without an unusable library button', async t => {
  const ui = await mount(t, { bootFailure: true });
  assert.equal(ui.node('load-cancel').hidden, true);
  assert.equal(ui.node('preparation-track').hidden, true);
  assert.equal(ui.node('preparation').dataset.error, 'true');
  ui.setBootFailure(false);
  await ui.click('load-retry');
  assert.equal(ui.document.body.dataset.screen, 'menu');
});

test('pause and retrying an unlock failure resume the same audio position', async t => {
  const ui = await mount(t);
  await ui.start(); ui.tick(13);
  await ui.click('pause');
  assert.equal(ui.node('pause-screen').hidden, false);
  ui.audio.resumeFailure = true;
  await ui.click('resume');
  assert.equal(ui.node('pause-screen').hidden, false);
  assert.equal(ui.node('pause-error').hidden, false);
  ui.audio.resumeFailure = false; ui.audio.currentTime = 20;
  await ui.click('resume');
  assert.equal(ui.node('pause-screen').hidden, true);
  assert.deepEqual(ui.audio.starts.at(-1), { at: 22, offset: 13 });
});

test('settings calibration opens the tutorial and keyboard focus stays on the song screen', async t => {
  const ui = await mount(t);
  await ui.click('menu-settings');
  assert.equal(ui.node('settings-screen').hidden, false);
  await ui.click('settings-calibration');
  assert.equal(ui.node('settings-screen').hidden, true);
  assert.equal(ui.document.activeElement, ui.node('home'));
  assert.match(ui.node('status').textContent, /среднюю дорожку/);
  await ui.start();
  assert.match(ui.node('mode-label').textContent, /КАЛИБРОВКА/);
  ui.tick(154);
  assert.match(ui.node('score-caption').textContent, /БЕЗ РЕКОРДА/);
  assert.equal(ui.node('apply-calibration').hidden, true);
  assert.deepEqual(ui.records(), {});
});

test('calibration results cannot write records or award a personal full combo', async t => {
  const ui = await mount(t);
  await ui.click('menu-settings'); await ui.click('settings-calibration');
  await ui.start(); ui.tick(154);
  assert.equal(ui.document.body.dataset.screen, 'results');
  assert.match(ui.node('score-caption').textContent, /КАЛИБРОВКА/);
  assert.notEqual(ui.node('result-rating').textContent, 'FULL COMBO');
  assert.equal(ui.node('record-delta').hidden, true);
  assert.deepEqual(ui.records(), {});
  await ui.click('retry');
  assert.match(ui.node('mode-label').textContent, /КАЛИБРОВКА/);
});

test('real play reports delta from the previous record and preserves it on a worse attempt', async t => {
  const ui = await mount(t);
  const song = ui.catalog.find(song => !song.tutorial);
  const key = song.id + ':1';
  // The app and this test read the same original chart; play its first note through input.
  const chart = JSON.parse(await readFile(new URL('../dist/assets/tracks/' + song.id + '/1.json', import.meta.url)));
  await ui.start();
  ui.tick(chart[0].time);
  ui.lanes[chart[0].lane].onclick({ detail: 0 });
  ui.tick(154);
  const saved = ui.records()[key];
  assert.ok(saved.score > 0);
  assert.equal(ui.node('score-caption').dataset.record, 'true');
  assert.equal(ui.node('record-delta').hidden, true);
  assert.equal(ui.node('result-combo').textContent, '1');
  await ui.click('retry'); ui.tick(310);
  assert.equal(ui.node('score-caption').dataset.record, 'false');
  assert.equal(ui.records()[key].score, saved.score);
});

test('record improvement displays the correct delta', async t => {
  const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
  const song = catalog.find(song => !song.tutorial), key = song.id + ':1';
  const progress = recordAttempt({ records: [], history: [] }, { songId: song.id, level: '1',
    result: { score: 10, accuracy: 1 }, id: crypto.randomUUID(), playedAt: '2026-11-09T19:00:00Z' });
  const ui = await mount(t, { saved: JSON.parse(exportProgress(DEFAULT_SETTINGS, progress)) });
  const chart = JSON.parse(await readFile(new URL('../dist/assets/tracks/' + song.id + '/1.json', import.meta.url)));
  await ui.start(); ui.tick(chart[0].time);
  ui.lanes[chart[0].lane].onclick({ detail: 0 }); ui.tick(154);
  assert.equal(ui.node('record-delta').hidden, false);
  assert.equal(ui.node('record-delta').textContent, '+90 к рекорду');
});

test('hiding the page during loading cancels the pending start', async t => {
  const ui = await mount(t);
  ui.audio.loadGate = deferred();
  const start = ui.openSong(); await Promise.resolve();
  ui.document.hidden = true; ui.events.visibilitychange();
  ui.audio.loadGate.resolve(); await start;
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.match(ui.location.hash, /^#\/song\//);
  assert.equal(ui.audio.starts.length, 0);
});

test('calibration uses real hits, offers a correction and never writes a record', async t => {
  const ui = await mount(t);
  await ui.click('settings-open'); await ui.click('settings-calibration');
  const song = ui.catalog.find(song => song.tutorial);
  const chart = JSON.parse(await readFile(new URL('../dist/assets/tracks/' + song.id + '/1.json', import.meta.url)));
  await ui.start();
  for (const note of chart.slice(0, 8)) {
    ui.tick(note.time + .025);
    ui.lanes[note.lane].onclick({ detail: 0 });
  }
  ui.tick(154);
  assert.equal(ui.node('apply-calibration').hidden, false);
  await ui.click('apply-calibration');
  assert.equal(ui.node('offset').value, 25);
  assert.equal(ui.settings().offset, 25);
  assert.deepEqual(ui.records(), {});
});

test('settings edits update the new save and reduced motion', async t => {
  const ui = await mount(t);
  ui.node('volume').oninput({ target: { value: '42' } });
  ui.node('motion').onchange({ target: { checked: true } });
  const target = { value: '999' };
  ui.node('offset').onchange({ target });
  assert.equal(target.value, 500);
  assert.deepEqual(ui.settings(), { compatibleAudio: false, volume: 42, offset: 500, motion: true });
  assert.equal(ui.document.body.dataset.reducedMotion, 'true');
});

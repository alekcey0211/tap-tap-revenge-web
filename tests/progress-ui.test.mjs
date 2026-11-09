import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, deferred } from './helpers/ui-harness.mjs';
import { DEFAULT_SETTINGS, SAVE_KEY, recordAttempt, exportProgress, IMPORT_LIMIT } from '../dist/storage.js';
import { formatPercent } from '../dist/format.js';

const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
const song = catalog.find(item => !item.tutorial);
function snapshot() {
  let progress = { records: [], history: [] };
  for (let i = 0; i < 5; i++) progress = recordAttempt(progress, {
    songId: song.id, level: '1', id: crypto.randomUUID(), playedAt: `2026-11-09T19:0${i}:00Z`,
    result: { score: 1000 + i * 100, accuracy: 90 + i, bestStreak: 40 + i },
  });
  return JSON.parse(exportProgress({ ...DEFAULT_SETTINGS, compatibleAudio: true }, progress));
}
async function chooseFile(ui, text, size = new Blob([text]).size) {
  ui.node('progress-file').files = [{ size, text: async () => text }];
  await ui.node('progress-file').onchange();
}

test('empty progress has clear empty states, navigation and no fake chart data', async t => {
  const ui = await mount(t); await ui.click('progress-open');
  assert.equal(ui.document.body.dataset.screen, 'progress-screen');
  assert.equal(ui.node('screen-title').textContent, 'Прогресс');
  assert.equal(ui.node('record-empty').hidden, false);
  assert.equal(ui.node('accuracy-plot').children.length, 0);
  await ui.click('history-tab'); assert.equal(ui.node('history-empty').hidden, false);
  assert.equal(ui.node('history-reset').hidden, true);
  await ui.click('home'); assert.equal(ui.document.body.dataset.screen, 'library');
});

test('record screen displays best, delta and percent formatting; chart uses only the chosen card', async t => {
  const ui = await mount(t, { saved: snapshot() }); await ui.click('progress-open');
  assert.equal(ui.node('personal-best').hidden, false);
  assert.equal(ui.node('best-score').textContent, new Intl.NumberFormat('ru-RU').format(1400));
  assert.equal(ui.node('best-accuracy').textContent, '94\u00a0%');
  assert.equal(ui.node('best-delta').textContent, '+100 к прошлому рекорду');
  assert.equal(ui.node('accuracy-plot').children[0].children.length, 6);
  ui.node('progress-levels').children[1].onclick();
  assert.equal(ui.node('record-empty').hidden, false); assert.equal(ui.node('accuracy-plot').children.length, 0);
  await ui.click('progress-play'); assert.equal(ui.document.body.dataset.screen, 'library');
  assert.equal(ui.node('difficulties').children[1].attrs['aria-pressed'], 'true');
});

test('history filters attempts by song and level, retains dates and excludes empty filter results', async t => {
  const ui = await mount(t, { saved: snapshot() }); await ui.click('progress-open'); await ui.click('history-tab');
  const rows = () => ui.node('history-list').children.filter(node => node.tagName === 'ARTICLE');
  assert.equal(rows().length, 5);
  assert.equal(rows()[0].children[2].children.at(-1).textContent, `${formatPercent(94)} · Комбо 44`);
  assert.match(rows()[0].children[1].children[1].textContent, /Легко · \d\d:\d\d/);
  ui.node('history-level').value = '4'; ui.node('history-level').onchange();
  assert.equal(rows().length, 0); assert.equal(ui.node('history-reset').hidden, false);
  await ui.click('history-reset'); assert.equal(rows().length, 5);
  ui.node('history-song').value = catalog.find(item => !item.tutorial && item.id !== song.id).id;
  ui.node('history-song').onchange(); assert.equal(rows().length, 0);
});

test('validated file requires confirmation; cancel keeps data; confirm replaces and refreshes settings', async t => {
  const ui = await mount(t); await ui.click('progress-open');
  const original = ui.values.get(SAVE_KEY), imported = JSON.stringify(snapshot());
  await chooseFile(ui, imported);
  assert.equal(ui.node('import-dialog').open, true); assert.equal(ui.values.get(SAVE_KEY), original);
  assert.equal(ui.document.activeElement, ui.node('import-cancel'));
  await ui.click('import-cancel'); assert.equal(ui.values.get(SAVE_KEY), original);
  await chooseFile(ui, imported); await ui.click('import-confirm');
  assert.equal(ui.progress().history.length, 5); assert.equal(ui.node('best-accuracy').textContent, formatPercent(94));
  assert.equal(ui.node('compatible-audio').checked, true); assert.equal(ui.node('volume').disabled, true);
  assert.equal(ui.node('import-dialog').open, false);
  await chooseFile(ui, imported); await ui.click('import-confirm'); assert.equal(ui.progress().history.length, 5);
});

test('bad and oversized imports never show confirmation or replace saves', async t => {
  const ui = await mount(t); await ui.click('progress-open'); const original = ui.values.get(SAVE_KEY);
  await chooseFile(ui, '{'); assert.equal(ui.node('import-dialog').open, false);
  assert.match(ui.node('progress-message').textContent, /повреждён/);
  await chooseFile(ui, '{}', IMPORT_LIMIT + 1); assert.match(ui.node('progress-message').textContent, /512/);
  assert.equal(ui.values.get(SAVE_KEY), original);
});

test('storage error during import preserves UI and disk; retry works without losing pending import', async t => {
  const ui = await mount(t); await ui.click('progress-open'); const original = ui.values.get(SAVE_KEY);
  await chooseFile(ui, JSON.stringify(snapshot())); ui.setStorageFailure(true); await ui.click('import-confirm');
  assert.equal(ui.node('import-error').hidden, false); assert.equal(ui.values.get(SAVE_KEY), original);
  assert.equal(ui.node('record-empty').hidden, false);
  ui.setStorageFailure(false); await ui.click('import-confirm'); assert.equal(ui.progress().history.length, 5);
});

test('leaving progress cancels a pending file read', async t => {
  const ui = await mount(t); await ui.click('progress-open'); const gate = deferred();
  ui.node('progress-file').files = [{ size: 50, text: () => gate.promise }];
  const reading = ui.node('progress-file').onchange(); await ui.click('home');
  gate.resolve(JSON.stringify(snapshot())); await reading;
  assert.equal(ui.node('import-dialog').open, false); assert.equal(ui.document.body.dataset.screen, 'library');
});

test('export prepares the complete save and a Temporal ISO filename, never music', async t => {
  const ui = await mount(t, { saved: snapshot() }); await ui.click('progress-open');
  let blob, revoke;
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test'; });
  t.mock.method(globalThis, 'setTimeout', callback => { revoke = callback; });
  t.mock.method(URL, 'revokeObjectURL', url => assert.equal(url, 'blob:test'));
  await ui.click('progress-export');
  const data = JSON.parse(await blob.text()); assert.equal(data.progress.history.length, 5);
  const link = ui.document.body.children.at(-1); assert.match(link.download, /^tap-tap-progress-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(blob.type, 'application/json'); revoke();
});

test('legacy keys remain unchanged after new results; displayed percentages use Intl everywhere', async t => {
  const ui = await mount(t, { settings: { volume: 75, compatibleAudio: true } });
  const oldSettings = ui.values.get('ttr-web-settings'), oldRecords = ui.values.get('ttr-web-records');
  assert.equal(ui.node('volume-value').value, '75\u00a0%');
  await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 150; media.ended = true; media.paused = true;
  ui.tick(0); ui.native.now = 1000; ui.tick(0);
  assert.equal(ui.progress().history.length, 1); assert.equal(ui.node('result-accuracy').textContent, '0\u00a0%');
  assert.equal(ui.node('result-stats').children[1].textContent, '0\u00a0%');
  assert.equal(ui.values.get('ttr-web-settings'), oldSettings); assert.equal(ui.values.get('ttr-web-records'), oldRecords);
});

test('session-only mode warns and can still display newly completed attempts', async t => {
  const ui = await mount(t, { storageFailure: true, settings: { compatibleAudio: true } });
  await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 150; media.ended = true; media.paused = true;
  ui.tick(0); ui.native.now = 1000; ui.tick(0); await ui.click('back-to-library'); await ui.click('progress-open');
  assert.equal(ui.node('save-warning').hidden, false); assert.equal(ui.node('personal-best').hidden, false);
  await ui.click('history-tab'); assert.equal(ui.node('history-list').children.filter(node => node.tagName === 'ARTICLE').length, 1);
});

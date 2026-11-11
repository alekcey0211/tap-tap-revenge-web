import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { holdingLanes } from '../prototype/hold-feedback.js';
import { TRAVEL } from '../prototype/timing.js';
import { Game, TRAVEL as shippedTravel } from '../dist/prototype/engine.js';
import { LEVELS } from '../dist/prototype/difficulty.js';
import { parseRoute } from '../dist/prototype/routing.js';
import * as save from '../dist/prototype/storage.js';
const root = new URL('../dist/prototype/', import.meta.url), stable = new URL('../dist/', import.meta.url);
const read = (path, base = root) => readFile(new URL(path, base), 'utf8');
const catalog = JSON.parse(await read('assets/catalog.json'));

test('three levels contain exactly original medium/hard/extreme notes and timings', async () => {
  const original = JSON.parse(await read('assets/catalog.json', stable));
  assert.deepEqual(LEVELS, { 1: 'Легко', 2: 'Средне', 3: 'Сложно' });
  assert.deepEqual(TRAVEL, { 1: 1.95, 2: 1.62, 3: 1.26 }); assert.deepEqual(shippedTravel, TRAVEL);
  for (const song of catalog) {
    const source = original.find(item => item.id === song.id);
    assert.deepEqual(Object.keys(song.levels), song.tutorial ? ['1'] : ['1', '2', '3']);
    for (const level of Object.keys(song.levels)) {
      const oldLevel = song.tutorial ? 1 : Number(level) + 1;
      assert.deepEqual(song.levels[level], source.levels[oldLevel]);
      assert.equal(await read(`assets/tracks/${song.id}/${level}.json`), await read(`assets/tracks/${song.id}/${oldLevel}.json`, stable));
    }
    await assert.rejects(stat(new URL(`assets/tracks/${song.id}/4.json`, root)), { code: 'ENOENT' });
  }
  assert.equal(await read('engine.js'), (await read('engine.js', stable)).replace('export const TRAVEL = { 1: 2.7, 2: 2.15, 3: 1.8, 4: 1.4 };', 'export const TRAVEL = { 1: 1.95, 2: 1.62, 3: 1.26 };'));
  assert.equal(await read('difficulty.js'), (await read('difficulty.js', stable)).replace(
    "{ 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' }", "{ 1: 'Легко', 2: 'Средне', 3: 'Сложно' }").replace('step <= 4', 'step <= 3'));
});

test('old fourth-level URL falls back; new third level and calibration remain available', () => {
  const song = catalog.find(song => !song.tutorial);
  assert.equal(parseRoute(`#/song/${song.id}?difficulty=4`, catalog).level, '1');
  assert.equal(parseRoute(`#/song/${song.id}?difficulty=3`, catalog).level, '3');
  assert.equal(parseRoute('#/calibration', catalog).song.tutorial, true);
  assert.equal(parseRoute('#/calibration', catalog).level, '1');
});

test('new prototype resets attempts once but preserves audio and calibration settings', () => {
  const settings = { ...save.DEFAULT_SETTINGS, compatibleAudio: false, offset: 125, volume: 42, motion: true };
  const progress = save.recordAttempt({ records: [], history: [] }, { songId: catalog[0].id, level: '1', id: crypto.randomUUID(), playedAt: '2026-11-10T12:00:00Z', result: { score: 100, accuracy: 100, bestStreak: 1 } });
  const old = save.exportProgress(settings, progress);
  const values = new Map([['ttr-babylon-save-v1', old], ['ttr-web-save-v1', 'untouched']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const current = save.loadSave(storage);
  assert.deepEqual(current.settings, settings);
  assert.deepEqual(current.progress, { records: [], history: [] });
  assert.equal(values.get('ttr-babylon-save-v1'), old); assert.equal(values.get('ttr-web-save-v1'), 'untouched');
  assert.equal(save.CHART_VERSION, 'neon-three-v2');
  save.saveProgress(storage, progress, settings);
  assert.equal(save.loadSave(storage).progress.history.length, 1);
});

test('hold feedback starts only after a hit and stops on release, miss, end or pause', () => {
  const chart = [{ lane: 1, time: 1, duration: 2 }];
  const game = new Game(chart);
  assert.deepEqual(holdingLanes(game.notes, 1, true), [false, false, false]);
  game.press(1, 1);
  assert.deepEqual(holdingLanes(game.notes, 1, true), [false, true, false]);
  assert.deepEqual(holdingLanes(game.notes, 2, false), [false, false, false]);
  game.release(1, 2);
  assert.deepEqual(holdingLanes(game.notes, 2, true), [false, false, false]);
  const full = new Game(chart); full.press(1, 1); full.update(3);
  assert.deepEqual(holdingLanes(full.notes, 3, true), [false, false, false]);
  const miss = new Game(chart); miss.update(2);
  assert.deepEqual(holdingLanes(miss.notes, 2, true), [false, false, false]);
});

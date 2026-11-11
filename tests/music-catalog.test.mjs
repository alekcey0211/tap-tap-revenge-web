import { artwork } from '../dist/artwork.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { mount } from './helpers/ui-harness.mjs';
const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
const songs = catalog.filter(song => !song.tutorial);
const analysis = JSON.parse(await readFile(new URL('../scripts/music/suno-v1.json', import.meta.url)));

test('gallery contains only the three supplied songs; calibration stays separate', async () => {
  assert.deepEqual(songs.map(song => song.title), ['Restless Urban Groove', 'Warehouse Echoes', 'Bouncy Mischievous Groove']);
  assert.equal(catalog.filter(song => song.tutorial).length, 1);
  const dirs = await readdir(new URL('../dist/assets/tracks/', import.meta.url));
  assert.deepEqual(dirs.sort(), catalog.map(song => song.id).sort());
});

for (const song of songs) test(`${song.title}: charts follow measured attacks, covers and music are bundled`, async () => {
  assert.equal(song.artist, 'ezhik0211 · Suno');
  assert.ok(song.duration > 89 && song.duration < 91);
  assert.deepEqual(Object.keys(song.levels), ['1', '2', '3', '4']);
  const source = analysis.tracks.find(track => track.id === song.id);
  const times = [...source.beats, ...source.onsets.map(onset => onset.time)];
  let previous = 0;
  for (const [level, summary] of Object.entries(song.levels)) {
    const notes = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
    assert.equal(notes.length, summary.notes); assert.ok(notes.length > previous); previous = notes.length;
    assert.ok(notes.every(note => note.time >= 2.8 && note.time + note.duration < song.duration));
    assert.ok(notes.every(note => times.some(time => Math.abs(note.time - time) < 1e-6)));
    assert.equal(notes.filter(note => note.duration > 0).length, summary.holds);
    for (let lane = 0; lane < 3; lane++) {
      const line = notes.filter(note => note.lane === lane);
      for (let i = 1; i < line.length; i++) assert.ok(line[i].time - line[i - 1].time - line[i - 1].duration >= .11999);
    }
    for (const time of new Set(notes.map(note => note.time))) assert.ok(notes.filter(note => note.time === time).length <= 2);
  }
  const art = await readFile(new URL('../dist/' + artwork(song), import.meta.url));
  assert.equal(art.subarray(0, 3).toString('hex'), 'ffd8ff');
  const audio = await readFile(new URL(`../dist/assets/tracks/${song.id}/audio.m4a`, import.meta.url));
  assert.equal(audio.subarray(4, 8).toString(), 'ftyp');
});

for (const compatibleAudio of [false, true]) test(`new track can be selected and starts with Pulse (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } });
  await ui.selectedTrack('Restless Urban Groove').onclick();
  assert.equal(ui.node('hero-title').textContent, 'Restless Urban Groove');
  await ui.start();
  ui.tick(0);
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('pulse').hidden, false);
  assert.equal(ui.progress().history.length, 0);
});

for (const { id: songId, title } of songs)
for (const compatibleAudio of [false, true]) test(`ordinary ${title} results include artwork and survive save reload (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } });
  await ui.selectedTrack(title).onclick(); await ui.start();
  if (compatibleAudio) { ui.native.instances[0].currentTime = 151; }
  assert.doesNotThrow(() => ui.tick(200));
  assert.equal(ui.document.body.dataset.screen, 'results');
  assert.equal(ui.node('result-art').src, artwork({ id: songId }));
  assert.equal(ui.node('result-heading').textContent, title);
  assert.equal(ui.progress().history.length, 1);
  const { parseProgress, exportProgress } = await import('../dist/storage.js');
  const restored = parseProgress(exportProgress(ui.settings(), ui.progress()));
  assert.equal(restored.progress.history[0].songId, songId);
  await ui.click('back-to-library'); await ui.click('home'); await ui.click('menu-progress');
  assert.equal(ui.node('personal-best').hidden, false);
});

for (const compatibleAudio of [false, true]) test(`result header Back returns to library, including after settings (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } });
  await ui.selectedTrack(songs[0].title).onclick(); await ui.start();
  if (compatibleAudio) ui.native.instances[0].currentTime = 151;
  ui.tick(200);
  await ui.click('settings-open'); await ui.click('home');
  assert.equal(ui.document.body.dataset.screen, 'results');
  await ui.click('home');
  assert.equal(ui.document.body.dataset.screen, 'library');
  assert.equal(ui.location.hash, '#/library');
});

test('all new charts keep holds on outer lanes and never require a third finger', async () => {
  const previousCounts = [[247, 352, 414], [179, 193, 223], [178, 282, 326]];
  for (const [index, song] of songs.entries()) for (let level = 1; level <= 4; level++) {
    const notes = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song.id}/${level}.json`, import.meta.url)));
    const holds = notes.filter(note => note.duration > 0);
    assert.ok(holds.length >= 5);
    assert.ok(holds.every(note => note.lane !== 1));
    for (const time of new Set(notes.map(note => note.time))) {
      const contacts = notes.filter(note => note.time === time || note.time < time && note.time + note.duration > time);
      assert.ok(contacts.length <= 2, `${song.title}: ${level} / ${time} needs ${contacts.length} fingers`);
    }
    if (level > 1) {
      const increase = notes.length / previousCounts[index][level - 2];
      assert.ok(increase > 1.10 && increase < 1.22, `${song.title}: density ${increase}`);
    }
  }
});

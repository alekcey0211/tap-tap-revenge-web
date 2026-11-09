import { artwork } from '../dist/artwork.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount } from './helpers/ui-harness.mjs';

const id = 'neon-circuit-v1';
test('original track is explicitly synthesized, maps fit its grid and holds never overlap their lane', async () => {
  const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
  const song = catalog.find(song => song.id === id);
  assert.match(song.artist, /программный синтез/); assert.equal(song.duration, 62);
  assert.deepEqual(Object.keys(song.levels), ['1', '2', '3', '4']);
  for (const level of Object.keys(song.levels)) {
    const notes = JSON.parse(await readFile(new URL(`../dist/assets/tracks/${id}/${level}.json`, import.meta.url)));
    assert.equal(notes.length, song.levels[level].notes);
    assert.ok(notes.every(note => note.time >= 3.75 && note.time + note.duration < 60));
    assert.ok(notes.every(note => Math.abs(note.time / (60 / 128 / 2) - Math.round(note.time / (60 / 128 / 2))) < 1e-8));
    for (let lane = 0; lane < 3; lane++) {
      const line = notes.filter(note => note.lane === lane);
      for (let i = 1; i < line.length; i++) assert.ok(line[i].time > line[i - 1].time + line[i - 1].duration);
    }
  }
  const art = await readFile(new URL(`../dist/assets/tracks/${id}/artwork.png`, import.meta.url));
  assert.equal(art.subarray(1, 4).toString(), 'PNG');
});

for (const compatibleAudio of [false, true]) test(`new track can be selected and starts with Pulse (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } });
  await ui.selectedTrack('Neon Circuit').onclick();
  assert.equal(ui.node('hero-title').textContent, 'Neon Circuit');
  await ui.start();
  ui.tick(0);
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('pulse').hidden, false);
  assert.equal(ui.progress().history.length, 0);
});

for (const [songId, title] of [['neon-circuit-v1', 'Neon Circuit'], ['overdrive-v1', 'Overdrive']])
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
  await ui.click('back-to-library'); await ui.click('progress-open');
  assert.equal(ui.node('personal-best').hidden, false);
});

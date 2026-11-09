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
  ui.selectedTrack('Neon Circuit').onclick();
  assert.equal(ui.node('hero-title').textContent, 'Neon Circuit');
  await ui.click('play'); if (compatibleAudio) await ui.click('load-begin');
  ui.tick(0);
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('pulse').hidden, false);
  assert.equal(ui.progress().history.length, 0);
});

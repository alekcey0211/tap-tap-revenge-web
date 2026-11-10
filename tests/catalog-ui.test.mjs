import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './helpers/ui-harness.mjs';
import { formatTime } from '../dist/format.js';
import { artwork } from '../dist/artwork.js';

test('every song card has a separate cover and all information in the right-hand column', async t => {
  const ui = await mount(t); await ui.click('menu-play');
  const songs = ui.catalog.filter(song => !song.tutorial);
  for (const [index, song] of songs.entries()) {
    const card = ui.node('tracks').children[index];
    assert.equal(card.className, 'track');
    assert.equal(card.children.length, 2);
    const [cover, info] = card.children;
    assert.equal(cover.tagName, 'IMG'); assert.equal(cover.src, artwork(song)); assert.equal(cover.alt, '');
    assert.deepEqual(info.children.map(node => node.textContent), [song.title, song.artist, `${formatTime(song.duration)} · ${song.genre}`]);
    await card.onclick(); assert.equal(ui.node('hero-title').textContent, song.title);
    await ui.click('home');
  }
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
  assert.equal(ui.progress().history.length, 0);
});

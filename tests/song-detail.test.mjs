import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount } from './helpers/ui-harness.mjs';
import { DEFAULT_SETTINGS, recordAttempt, exportProgress } from '../dist/storage.js';
import { formatNumber, formatPercent } from '../dist/format.js';

const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
const song = catalog.find(song => !song.tutorial);

test('song detail has no duplicate note count or demo and explains offline saving', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(?:note-count|demo)"/);
  assert.match(html, /id="offline-open"[^>]*>↓ Сохранить для игры офлайн/);
});

for (const score of [0, 1234567]) test(`song record card formats a real score ${score} and follows difficulty`, async t => {
  const progress = recordAttempt({ records: [], history: [] }, {
    songId: song.id, level: '1', id: crypto.randomUUID(), playedAt: '2026-11-10T10:00Z',
    result: { score, accuracy: 98.5, bestStreak: 20 },
  });
  const saved = JSON.parse(exportProgress(DEFAULT_SETTINGS, progress));
  const ui = await mount(t, { saved }); await ui.openSong();
  assert.equal(ui.node('song-best-score').textContent, formatNumber(score));
  assert.equal(ui.node('song-best-accuracy').textContent, `Точность ${formatPercent(98.5)}`);
  assert.equal(ui.node('song-best-score').hidden, false);
  assert.equal(ui.node('song-best-empty').hidden, true);
  assert.equal(ui.node('song-status').textContent, '');
  await ui.node('difficulties').children[1].onclick();
  assert.equal(ui.node('song-best-score').hidden, true);
  assert.equal(ui.node('song-best-empty').hidden, false);
  await ui.node('difficulties').children[0].onclick();
  assert.equal(ui.node('song-best-score').textContent, formatNumber(score));
  assert.deepEqual(ui.progress(), saved.progress);
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, deferred } from './helpers/ui-harness.mjs';

for (const compatibleAudio of [false, true]) {
  test(`catalogue → song → performance has no autoplay or intermediate screen (${compatibleAudio})`, async t => {
    const ui = await mount(t, { settings: { compatibleAudio } });
    assert.equal(ui.node('song-screen').hidden, true);
    assert.equal(ui.node('play').disabled, true);
    assert.equal(ui.node('tracks').children[0].children[1].children[0].textContent, 'Restless Urban Groove');
    await ui.openSong('Restless Urban Groove');
    assert.equal(ui.node('library').hidden, true);
    assert.equal(ui.node('song-screen').hidden, false);
    assert.equal(ui.node('play').disabled, false);
    assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
    if (compatibleAudio) assert.equal(ui.audio.contexts.length, 0);
    await ui.click('play');
    assert.equal(ui.document.body.dataset.screen, 'game-screen');
    assert.equal(ui.node('preparation').hidden, true);
    assert.equal(ui.node('song-screen').inert, true);
    assert.equal(ui.document.activeElement, ui.node('pause'));
    assert.equal(ui.audio.starts.length + ui.native.plays.length, 1);
    if (!compatibleAudio) assert.deepEqual(ui.audio.starts[0], { at: 0, offset: 0 });
    // A child animation must not remove the whole menu early.
    ui.node('song-screen').onanimationend({ target: ui.node('hero-art') });
    assert.equal(ui.node('song-screen').hidden, false);
    ui.node('song-screen').onanimationend({ target: ui.node('song-screen') });
    assert.equal(ui.node('song-screen').hidden, true);
    assert.equal(ui.node('song-screen').inert, true);
    await ui.click('pause'); await ui.click('quit'); await ui.openSong('Warehouse Echoes');
    ui.node('song-screen').onanimationend({ target: ui.node('song-screen') });
    assert.equal(ui.node('song-screen').hidden, false, 'a stale end event cannot hide a new song');
  });

  test(`difficulty changes reuse fetched audio; only the last preparation becomes ready (${compatibleAudio})`, async t => {
    const ui = await mount(t, { settings: { compatibleAudio } });
    const gate = deferred(); ui.audio.loadGate = gate;
    const first = ui.openSong(); await new Promise(setImmediate);
    const last = ui.node('difficulties').children[3].onclick();
    gate.resolve(); await Promise.all([first, last]);
    assert.equal(ui.node('difficulties').children[3].attrs['aria-pressed'], 'true');
    assert.equal(ui.audio.loads.length, 1);
    assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
    await ui.click('play'); assert.equal(ui.node('mode-label').textContent, 'Экстрим');
    await ui.click('pause'); await ui.click('restart');
    assert.equal(ui.audio.loads.length, 1);
    assert.equal(ui.native.plays.length + ui.audio.starts.length, 2);
  });

  test(`reduced motion skips the departing overlay, never sound (${compatibleAudio})`, async t => {
    const ui = await mount(t, { settings: { compatibleAudio, motion: true } });
    await ui.start();
    assert.equal(ui.node('song-screen').hidden, true);
    assert.equal(ui.node('song-screen').inert, true);
    assert.equal(ui.audio.starts.length + ui.native.plays.length, 1);
  });
}

test('OS reduced motion also skips overlay even when an older saved setting is false', async t => {
  const ui = await mount(t, { settings: { motion: false } });
  globalThis.matchMedia = () => ({ matches: true });
  await ui.start(); assert.equal(ui.node('song-screen').hidden, true);
});

test('changing audio mode on the song screen prepares a silent native track before the next gesture', async t => {
  const ui = await mount(t); await ui.openSong();
  await ui.node('compatible-audio').onchange({ target: { checked: true } });
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
  assert.equal(ui.node('play').disabled, false);
  const gate = deferred(); ui.native.gate = gate;
  const playing = ui.click('play');
  assert.equal(ui.native.plays.length, 1, 'native play runs synchronously in the click');
  assert.equal(ui.audio.starts.length, 0);
  ui.tick(20); assert.equal(ui.node('live-score').textContent, '0');
  gate.resolve(); await playing;
});

test('a failed stale song preparation never replaces a different ready selection', async t => {
  const ui = await mount(t);
  const gate = deferred(); ui.audio.loadGate = gate;
  const old = ui.openSong('Restless Urban Groove'); await new Promise(setImmediate);
  ui.audio.loadGate = null; await ui.openSong('Warehouse Echoes');
  gate.reject(new Error('old load')); await old;
  assert.equal(ui.node('play').disabled, false);
  assert.equal(ui.node('hero-title').textContent, 'Warehouse Echoes');
  assert.equal(ui.node('song-load-retry').hidden, true);
  await ui.click('play'); assert.equal(ui.node('now-title').textContent, 'Warehouse Echoes');
});

test('the catalogue does not contain song controls and keeps progress accessible', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const library = html.slice(html.indexOf('<section id="library"'), html.indexOf('<section id="song-screen"'));
  assert.doesNotMatch(library, /id="(?:play|demo|difficulties)"/);
  assert.doesNotMatch(library, /library-nav|catalog-count|progress-open/);
});

test('pause can cancel a pending native start; late failure cannot replace the next performance', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } });
  await ui.openSong();
  const gate = deferred(); ui.native.gate = gate;
  const old = ui.click('play');
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  await ui.click('pause');
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.node('play').disabled, false);
  assert.equal(ui.native.instances[0].paused, true);
  ui.native.gate = null; await ui.click('demo');
  gate.reject(new Error('cancelled playback')); await old;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.native.instances.at(-1).paused, false);
  assert.match(ui.node('mode-label').textContent, /ДЕМО/);
});

for (const mode of ['perfect', 'miss', 'demo']) test(`result celebration uses real full combo only: ${mode}`, async t => {
  const ui = await mount(t, { chart: [{ time: 1, lane: 0, duration: 0 }] });
  await ui.openSong('Restless Urban Groove');
  assert.equal(ui.node('hero-artist').textContent, 'ezhik0211 · Suno');
  await ui.click(mode === 'demo' ? 'demo' : 'play');
  if (mode === 'perfect') { ui.tick(1); ui.lanes[0].onclick({ detail: 0 }); }
  ui.tick(151);
  assert.equal(ui.document.body.dataset.screen, 'results');
  assert.equal(ui.node('results').dataset.fullCombo, String(mode === 'perfect'));
  assert.equal(ui.node('result-artist').textContent, 'ezhik0211 · Suno · Легко');
  assert.equal(ui.progress().history.length, mode === 'demo' ? 0 : 1);
});

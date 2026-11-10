import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, deferred } from './helpers/ui-harness.mjs';

const options = { settings: { compatibleAudio: true, volume: 35 } };

test('compatible setting persists, keeps normal volume and never autoplays after fetching', async t => {
  const ui = await mount(t, options);
  assert.equal(ui.node('compatible-audio').checked, true);
  assert.equal(ui.node('volume').disabled, true);
  await ui.openSong();
  assert.equal(ui.node('play').disabled, false);
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.native.plays.length, 0); assert.equal(ui.audio.starts.length, 0);
  await ui.click('home');
  ui.node('compatible-audio').onchange({ target: { checked: false } });
  assert.equal(ui.node('volume').disabled, false); assert.equal(ui.node('volume').value, 35);
  assert.equal(ui.settings().compatibleAudio, false);
  await ui.start(); assert.equal(ui.audio.starts.length, 1);
});

test('ready click calls native play immediately and shows the stage while waiting without advancing score', async t => {
  const ui = await mount(t, options); await ui.openSong();
  ui.native.gate = deferred(); const started = ui.click('play');
  assert.equal(ui.native.plays.length, 1);
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  ui.native.gate.resolve(); await started;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  ui.native.instances[0].currentTime = 5; ui.tick(1000);
  assert.equal(ui.node('time').textContent, '0:05 / 2:30');
  assert.equal(ui.audio.starts.length, 0);
});

test('native loading and pending playback can be cancelled without resurrecting game', async t => {
  const ui = await mount(t, options);
  ui.audio.loadGate = deferred(); const loading = ui.openSong();
  await ui.click('home'); ui.audio.loadGate.resolve(); await loading;
  assert.equal(ui.document.body.dataset.screen, 'library');
  ui.audio.loadGate = null; await ui.openSong();
  const gate = deferred(); ui.native.gate = gate; const started = ui.click('play');
  ui.events.pagehide();
  ui.native.gate = null; await ui.start();
  gate.reject(new Error('stale')); await started;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('mode-label').textContent, 'Легко');
  assert.equal(ui.native.instances.at(-1).paused, false);
});

test('native play failure offers retry, preserving difficulty', async t => {
  const ui = await mount(t, options);
  await ui.openSong(); await ui.node('difficulties').children[2].onclick();
  ui.native.failure = true; await ui.click('play');
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.match(ui.node('song-status').textContent, /включить звук/);
  assert.equal(ui.node('difficulties').children[2].attrs['aria-pressed'], 'true');
  ui.native.failure = false; await ui.click('play');
  assert.equal(ui.node('mode-label').textContent, 'Сложно');
});

test('native pause/resume uses the exact position and supports retry and interruption', async t => {
  const ui = await mount(t, options); await ui.start();
  const media = ui.native.instances[0]; media.currentTime = 12; ui.tick(12);
  await ui.click('pause'); assert.equal(media.paused, true);
  ui.native.failure = true; await ui.click('resume'); assert.equal(ui.node('pause-error').hidden, false);
  ui.native.failure = false; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 12); assert.equal(ui.node('pause-screen').hidden, true);
  media.currentTime = 15; media.paused = true; ui.tick(15);
  assert.equal(ui.node('pause-screen').hidden, false); assert.equal(ui.node('pause-error').hidden, false);
  await ui.click('resume'); assert.equal(ui.native.plays.at(-1), 15);
});

test('background keeps prepared native song silent and pending resume without a late restart', async t => {
  const ui = await mount(t, options); await ui.openSong();
  ui.document.hidden = true; ui.events.visibilitychange();
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.native.plays.length, 0);
  ui.document.hidden = false; await ui.start();
  const media = ui.native.instances[0]; media.currentTime = 9; await ui.click('pause');
  const gate = deferred(); ui.native.gate = gate; const resuming = ui.click('resume');
  ui.document.hidden = true; ui.events.visibilitychange(); gate.resolve(); await resuming;
  assert.equal(media.paused, true); assert.equal(ui.node('pause-screen').hidden, false);
  ui.native.gate = null; ui.document.hidden = false; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9); assert.equal(ui.node('pause-screen').hidden, true);
});

test('buffering freezes scoring and ignores new presses', async t => {
  const ui = await mount(t, options); await ui.start();
  const media = ui.native.instances[0]; media.currentTime = 3; media.readyState = 2; ui.tick(1000);
  const score = ui.node('game-stats').textContent;
  ui.lanes[0].onclick({ detail: 0 }); ui.tick(9000);
  assert.equal(ui.node('game-stats').textContent, score);
  assert.equal(ui.node('audio-status').textContent, 'Ожидаем звук…');
  assert.equal(ui.node('revenge').tagName, 'DIV');
});

for (const mode of ['play', 'calibration']) {
  test(`native ${mode} reaches results and preserves record rules`, async t => {
    const ui = await mount(t, options);
    if (mode === 'calibration') { await ui.click('settings-open'); await ui.click('settings-calibration'); }
    await ui.start();
    const song = ui.catalog.find(song => Boolean(song.tutorial) === (mode === 'calibration'));
    const chart = JSON.parse(await readFile(new URL('../dist/assets/tracks/' + song.id + '/1.json', import.meta.url)));
    const media = ui.native.instances[0];
    for (const note of chart.slice(0, 8)) {
      media.currentTime = note.time; ui.tick(0); ui.lanes[note.lane].onclick({ detail: 0 });
    }
    media.currentTime = media.duration; media.ended = true; media.paused = true; ui.tick(0);
    ui.native.now = 1000; ui.tick(0);
    assert.equal(ui.document.body.dataset.screen, 'results');
    if (mode === 'play') assert.ok(ui.records()[song.id + ':1'].score > 0);
    else assert.deepEqual(ui.records(), {});
    if (mode === 'calibration') assert.equal(ui.node('apply-calibration').hidden, false);
  });
}

test('hiding the page during native start stops audio even when play resolves late', async t => {
  const ui = await mount(t, options); await ui.openSong();
  const gate = deferred(); ui.native.gate = gate; const started = ui.click('play');
  ui.document.hidden = true; ui.events.visibilitychange(); gate.resolve(); await started;
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.match(ui.location.hash, /^#\/song\//);
  assert.equal(ui.native.instances[0].paused, true);
});

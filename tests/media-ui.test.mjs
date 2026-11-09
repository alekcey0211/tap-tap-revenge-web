import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, deferred } from './helpers/ui-harness.mjs';

const options = { settings: { compatibleAudio: true, volume: 35 } };

test('compatible setting persists, keeps normal volume and never autoplays after fetching', async t => {
  const ui = await mount(t, options);
  assert.equal(ui.node('compatible-audio').checked, true);
  assert.equal(ui.node('volume').disabled, true);
  await ui.click('play');
  assert.equal(ui.node('load-begin').hidden, false);
  assert.equal(ui.document.activeElement, ui.node('load-begin'));
  assert.equal(ui.native.plays.length, 0); assert.equal(ui.audio.starts.length, 0);
  await ui.click('load-cancel');
  ui.node('compatible-audio').onchange({ target: { checked: false } });
  assert.equal(ui.node('volume').disabled, false); assert.equal(ui.node('volume').value, 35);
  assert.equal(ui.settings().compatibleAudio, false);
  await ui.click('play'); assert.equal(ui.audio.starts.length, 1);
});

test('ready click calls native play immediately and waits for its promise before showing game', async t => {
  const ui = await mount(t, options); await ui.click('play');
  ui.native.gate = deferred(); const started = ui.click('load-begin');
  assert.equal(ui.native.plays.length, 1);
  assert.equal(ui.document.body.dataset.screen, 'preparation');
  ui.native.gate.resolve(); await started;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  ui.native.instances[0].currentTime = 5; ui.tick(1000);
  assert.equal(ui.node('time').textContent, '0:05 / 2:30');
  assert.equal(ui.audio.starts.length, 0);
});

test('native loading and pending playback can be cancelled without resurrecting game', async t => {
  const ui = await mount(t, options);
  ui.audio.loadGate = deferred(); const loading = ui.click('play');
  await ui.click('load-cancel'); ui.audio.loadGate.resolve(); await loading;
  assert.equal(ui.document.body.dataset.screen, 'library');
  ui.audio.loadGate = null; await ui.click('play');
  const gate = deferred(); ui.native.gate = gate; const started = ui.click('load-begin');
  await ui.click('load-cancel');
  ui.native.gate = null; await ui.click('demo'); await ui.click('load-begin');
  gate.reject(new Error('stale')); await started;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.match(ui.node('mode-label').textContent, /ДЕМО/);
  assert.equal(ui.native.instances.at(-1).paused, false);
});

test('native play failure offers retry, preserving difficulty and demo', async t => {
  const ui = await mount(t, options);
  ui.node('difficulties').children[2].onclick(); await ui.click('demo');
  ui.native.failure = true; await ui.click('load-begin');
  assert.equal(ui.node('preparation').dataset.error, 'true');
  assert.match(ui.node('preparation-heading').textContent, /включить музыку/);
  ui.native.failure = false; await ui.click('load-retry');
  assert.match(ui.node('preparation-artist').textContent, /Сложно/);
  await ui.click('load-begin'); assert.match(ui.node('mode-label').textContent, /ДЕМО/);
});

test('native pause/resume uses the exact position and supports retry and interruption', async t => {
  const ui = await mount(t, options); await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 12; ui.tick(12);
  await ui.click('pause'); assert.equal(media.paused, true);
  ui.native.failure = true; await ui.click('resume'); assert.equal(ui.node('pause-error').hidden, false);
  ui.native.failure = false; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 12); assert.equal(ui.node('pause-dialog').open, false);
  media.currentTime = 15; media.paused = true; ui.tick(15);
  assert.equal(ui.node('pause-dialog').open, true); assert.equal(ui.node('pause-error').hidden, false);
  await ui.click('resume'); assert.equal(ui.native.plays.at(-1), 15);
});

test('background cancels native ready/start and pending resume without a late restart', async t => {
  const ui = await mount(t, options); await ui.click('play');
  ui.document.hidden = true; ui.events.visibilitychange();
  assert.equal(ui.document.body.dataset.screen, 'library');
  ui.document.hidden = false; await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 9; await ui.click('pause');
  const gate = deferred(); ui.native.gate = gate; const resuming = ui.click('resume');
  ui.document.hidden = true; ui.events.visibilitychange(); gate.resolve(); await resuming;
  assert.equal(media.paused, true); assert.equal(ui.node('pause-dialog').open, true);
  ui.native.gate = null; ui.document.hidden = false; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9); assert.equal(ui.node('pause-dialog').open, false);
});

test('buffering freezes scoring and ignores new presses', async t => {
  const ui = await mount(t, options); await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 3; media.readyState = 2; ui.tick(1000);
  const score = ui.node('game-stats').textContent;
  ui.lanes[0].onclick({ detail: 0 }); ui.tick(9000);
  assert.equal(ui.node('game-stats').textContent, score);
  assert.equal(ui.node('audio-status').textContent, 'Ожидаем звук…');
  assert.equal(ui.node('revenge').disabled, true);
});

for (const mode of ['play', 'demo', 'calibration']) {
  test(`native ${mode} reaches results and preserves record rules`, async t => {
    const ui = await mount(t, options);
    if (mode === 'calibration') await ui.click('calibration');
    await ui.click(mode === 'demo' ? 'demo' : 'play'); await ui.click('load-begin');
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
  const ui = await mount(t, options); await ui.click('play');
  const gate = deferred(); ui.native.gate = gate; const started = ui.click('load-begin');
  ui.document.hidden = true; ui.events.visibilitychange(); gate.resolve(); await started;
  assert.equal(ui.document.body.dataset.screen, 'library');
  assert.equal(ui.native.instances[0].paused, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, deferred } from './helpers/ui-harness.mjs';

const pointer = id => ({ pointerId: id, preventDefault() {} });

for (const compatibleAudio of [false, true]) {
  const mode = compatibleAudio ? 'native' : 'Web Audio';
  async function playing(t, extra = {}) {
    const ui = await mount(t, { settings: { compatibleAudio }, ...extra });
    await ui.start();
    return ui;
  }
  function advance(ui, position) {
    if (compatibleAudio) ui.native.instances.at(-1).currentTime = position;
    ui.tick(position);
  }
  function plays(ui) { return compatibleAudio ? ui.native.plays.length : ui.audio.starts.length; }
  function lastOffset(ui) { return compatibleAudio ? ui.native.plays.at(-1) : ui.audio.starts.at(-1).offset; }

  for (const event of ['visibilitychange', 'blur', 'pagehide']) {
    test(`${mode}: ${event} freezes the session until an explicit resume`, async t => {
      const ui = await playing(t); advance(ui, 7.25);
      const before = ui.node('game-stats').textContent;
      if (event === 'visibilitychange') ui.document.hidden = true;
      ui.events[event](); ui.events[event]();
      assert.equal(ui.node('pause-screen').hidden, false);
      ui.tick(1000);
      assert.equal(ui.node('game-stats').textContent, before);
      assert.equal(ui.node('time').textContent, '0:07 / 2:30');
      if (compatibleAudio) assert.equal(ui.native.instances[0].paused, true);
      ui.document.hidden = false; ui.events.visibilitychange();
      assert.equal(plays(ui), 1); assert.equal(ui.node('pause-screen').hidden, false);
      await ui.click('resume');
      assert.equal(lastOffset(ui), 7.25); assert.equal(plays(ui), 2);
      assert.equal(ui.node('pause-screen').hidden, true);
      assert.equal(ui.settings().compatibleAudio, compatibleAudio);
    });

    test(`${mode}: ${event} cancels loading, late completion never starts music`, async t => {
      const ui = await mount(t, { settings: { compatibleAudio } });
      const gate = deferred(); ui.audio.loadGate = gate;
      const starting = ui.openSong(); await Promise.resolve();
      if (event === 'visibilitychange') ui.document.hidden = true;
      ui.events[event](); gate.resolve(); await starting;
      assert.equal(ui.document.body.dataset.screen, 'song-screen'); assert.equal(plays(ui), 0);
      assert.equal(ui.node('song-load-retry').hidden, false);
      assert.match(ui.location.hash, /^#\/song\//);
    });
  }

  test(`${mode}: hidden page cannot resume or start another track`, async t => {
    const ui = await playing(t); advance(ui, 5); await ui.click('pause');
    ui.document.hidden = true;
    await ui.click('resume'); await ui.click('restart');
    assert.equal(plays(ui), 1);
    ui.document.hidden = false; ui.events.visibilitychange();
    // Restart click in a hidden document must not close the pause screen either.
    assert.equal(ui.node('pause-screen').hidden, false);
  });

  test(`${mode}: interruption is handled immediately without waiting for animation`, async t => {
    const ui = await playing(t); advance(ui, 8);
    if (compatibleAudio) {
      const media = ui.native.instances[0]; media.paused = true; media.onpause();
    } else {
      ui.audio.state = 'interrupted'; ui.audio.contexts[0].onstatechange();
    }
    assert.equal(ui.node('pause-screen').hidden, false);
    assert.equal(ui.node('pause-error').hidden, false);
    await ui.click('resume'); assert.equal(lastOffset(ui), 8);
  });

  test(`${mode}: active holds can be reclaimed after pause without an extra hit`, async t => {
    const ui = await playing(t, { chart: [{ time: 1, lane: 0, duration: 10 }] });
    advance(ui, 1); ui.lanes[0].onpointerdown(pointer(1));
    advance(ui, 2); await ui.click('pause');
    ui.lanes[0].onlostpointercapture(pointer(1));
    await ui.click('resume');
    if (compatibleAudio) ui.native.instances[0].currentTime = 2.1;
    ui.tick(compatibleAudio ? 2.1 : 4.1); // Resume countdown ends at context time 4.
    ui.lanes[0].onpointerdown(pointer(2));
    if (compatibleAudio) ui.native.instances[0].currentTime = 11;
    ui.tick(compatibleAudio ? 11 : 13);
    ui.lanes[0].onpointerup(pointer(2));
    if (compatibleAudio) ui.native.instances[0].currentTime = 151;
    ui.tick(200);
    const result = Object.values(ui.records())[0];
    assert.equal(result.hits, 1); assert.equal(result.brokenHolds, 0); assert.equal(result.strays, 0);
    assert.equal(ui.progress().history[0].pulse.perfect, 1);
  });

  test(`${mode}: unreclaimed hold breaks after resume grace; old pointer cannot keep it held`, async t => {
    const ui = await playing(t, { chart: [{ time: 1, lane: 0, duration: 10 }] });
    advance(ui, 1); ui.lanes[0].onpointerdown(pointer(1));
    advance(ui, 2); await ui.click('pause'); await ui.click('resume');
    if (compatibleAudio) ui.native.instances[0].currentTime = 2.5;
    ui.tick(compatibleAudio ? 2.5 : 4.5);
    if (compatibleAudio) ui.native.instances[0].currentTime = 151;
    ui.tick(200);
    assert.equal(Object.values(ui.records())[0].brokenHolds, 1);
    assert.equal(ui.progress().history[0].pulse.captured, 0);
  });
}

test('native resume interrupted while play is pending preserves the newly reached position', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } });
  await ui.start();
  const media = ui.native.instances[0]; media.currentTime = 9; await ui.click('pause');
  const gate = deferred(); ui.native.gate = gate;
  const resuming = ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9); // Synchronous user-gesture play remains intact.
  media.currentTime = 9.5; ui.events.pagehide(); gate.resolve(); await resuming;
  assert.equal(media.paused, true); assert.equal(ui.node('pause-screen').hidden, false);
  ui.native.gate = null; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9.5);
});

test('Web Audio pending unlock cannot restart a session after pagehide', async t => {
  const ui = await mount(t); await ui.start(); ui.tick(10); await ui.click('pause');
  const gate = deferred(); ui.audio.resumeGate = gate;
  const resuming = ui.click('resume'); ui.events.pagehide(); gate.resolve(); await resuming;
  assert.equal(ui.audio.starts.length, 1); assert.equal(ui.node('pause-screen').hidden, false);
  ui.audio.resumeGate = null; await ui.click('resume');
  assert.equal(ui.audio.starts.at(-1).offset, 10);
});

test('multiple pointers and keyboard on one lane release a hold only when the last source leaves', async t => {
  const ui = await mount(t, { chart: [{ time: 1, lane: 0, duration: 10 }, { time: 1, lane: 1, duration: 10 }] });
  await ui.start(); ui.tick(1);
  ui.lanes[0].onpointerdown(pointer(1)); ui.lanes[0].onpointerdown(pointer(2));
  ui.lanes[1].onpointerdown(pointer(3));
  ui.events.keydown({ code: 'KeyD', target: { tagName: 'BODY' }, preventDefault() {} });
  ui.tick(2);
  ui.lanes[0].onpointercancel(pointer(1)); ui.lanes[0].onlostpointercapture(pointer(1));
  ui.lanes[0].onpointerup(pointer(2));
  ui.tick(11); ui.events.keyup({ code: 'KeyD' }); ui.lanes[1].onpointerup(pointer(3));
  ui.tick(200);
  const result = Object.values(ui.records())[0];
  assert.equal(result.hits, 2); assert.equal(result.brokenHolds, 0); assert.equal(result.strays, 0);
});

test('frozen Web Audio countdown returns to pause, then explicit retry resumes from the same position', async t => {
  const ui = await mount(t); await ui.start(); ui.tick(.2);
  await ui.click('pause'); await ui.click('resume');
  const old = ui.audio.contexts[0], score = ui.node('game-stats').textContent;
  ui.native.now = 1600; ui.tick(.2); // context reports running but its clock has stopped
  assert.equal(ui.node('pause-screen').hidden, false);
  assert.equal(ui.node('pause-error').hidden, false);
  assert.equal(ui.node('resume').disabled, false);
  assert.equal(ui.node('game-stats').textContent, score);
  assert.equal(ui.progress().history.length, 0);
  await ui.click('resume'); assert.equal(old.closed, true); assert.equal(ui.audio.contexts.length, 2);
  assert.ok(Math.abs(ui.audio.starts.at(-1).offset - .2) < 1e-9);
  ui.native.now = 1700; ui.tick(2.3);
  assert.equal(ui.node('pause-screen').hidden, true);
  assert.equal(ui.settings().compatibleAudio, false);
});

test('Web Audio resume timeout restores an enabled pause button; late resolution never starts music', async t => {
  const ui = await mount(t); await ui.start(); ui.tick(6); await ui.click('pause');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred(); ui.audio.resumeGate = gate;
  const pending = ui.click('resume'); t.mock.timers.tick(4000); await pending;
  assert.equal(ui.node('pause-screen').hidden, false); assert.equal(ui.node('resume').disabled, false);
  assert.equal(ui.audio.starts.length, 1);
  ui.audio.resumeGate = null; await ui.click('resume');
  assert.equal(ui.audio.starts.length, 2); assert.equal(ui.audio.starts.at(-1).offset, 6);
  gate.resolve(); await Promise.resolve(); assert.equal(ui.audio.starts.length, 2);
});

for (const compatibleAudio of [false, true]) test(`automatic x8 UI survives pause and resets on a real stray (${compatibleAudio})`, async t => {
  const chart = Array.from({ length: 50 }, (_, i) => ({ time: i + 1, lane: 0, duration: 0 }));
  const ui = await mount(t, { chart, settings: { compatibleAudio } });
  await ui.start();
  for (let i = 1; i <= 50; i++) {
    if (compatibleAudio) ui.native.instances[0].currentTime = i;
    ui.tick(i);
    ui.lanes[0].onclick({ detail: 0 });
  }
  ui.tick(50);
  assert.equal(ui.node('multiplier').textContent, '×8');
  assert.equal(ui.node('revenge').tagName, 'DIV');
  assert.equal(ui.node('game-screen').dataset.energy, 'active');
  assert.equal(ui.node('revenge-label').textContent, '×8');
  await ui.click('pause'); ui.tick(1000); assert.equal(ui.node('multiplier').textContent, '×8');
  await ui.click('resume');
  if (compatibleAudio) ui.native.instances[0].currentTime = 70;
  ui.tick(compatibleAudio ? 70 : 1022);
  assert.equal(ui.node('multiplier').textContent, '×8');
  ui.lanes[1].onclick({ detail: 0 }); ui.tick(compatibleAudio ? 70 : 1022);
  assert.equal(ui.node('multiplier').textContent, '×1');
  assert.equal(ui.node('game-screen').dataset.energy, 'charging');
});

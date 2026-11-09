import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, deferred } from './helpers/ui-harness.mjs';

const pointer = id => ({ pointerId: id, preventDefault() {} });

for (const compatibleAudio of [false, true]) {
  const mode = compatibleAudio ? 'native' : 'Web Audio';
  async function playing(t, extra = {}) {
    const ui = await mount(t, { settings: { compatibleAudio }, ...extra });
    await ui.click('play');
    if (compatibleAudio) await ui.click('load-begin');
    return ui;
  }
  function advance(ui, position) {
    if (compatibleAudio) ui.native.instances.at(-1).currentTime = position;
    ui.tick(compatibleAudio ? position : position + 3);
  }
  function plays(ui) { return compatibleAudio ? ui.native.plays.length : ui.audio.starts.length; }
  function lastOffset(ui) { return compatibleAudio ? ui.native.plays.at(-1) : ui.audio.starts.at(-1).offset; }

  for (const event of ['visibilitychange', 'blur', 'pagehide']) {
    test(`${mode}: ${event} freezes the session until an explicit resume`, async t => {
      const ui = await playing(t); advance(ui, 7.25);
      const before = ui.node('game-stats').textContent;
      if (event === 'visibilitychange') ui.document.hidden = true;
      ui.events[event](); ui.events[event]();
      assert.equal(ui.node('pause-dialog').open, true);
      ui.tick(1000);
      assert.equal(ui.node('game-stats').textContent, before);
      assert.equal(ui.node('time').textContent, '0:07 / 2:30');
      if (compatibleAudio) assert.equal(ui.native.instances[0].paused, true);
      ui.document.hidden = false; ui.events.visibilitychange();
      assert.equal(plays(ui), 1); assert.equal(ui.node('pause-dialog').open, true);
      await ui.click('resume');
      assert.equal(lastOffset(ui), 7.25); assert.equal(plays(ui), 2);
      assert.equal(ui.node('pause-dialog').open, false);
      assert.equal(ui.settings().compatibleAudio, compatibleAudio);
    });

    test(`${mode}: ${event} cancels loading, late completion never starts music`, async t => {
      const ui = await mount(t, { settings: { compatibleAudio } });
      const gate = deferred(); ui.audio.loadGate = gate;
      const starting = ui.click('play'); await Promise.resolve();
      if (event === 'visibilitychange') ui.document.hidden = true;
      ui.events[event](); gate.resolve(); await starting;
      assert.equal(ui.document.body.dataset.screen, 'library'); assert.equal(plays(ui), 0);
    });
  }

  test(`${mode}: hidden page cannot resume or start another track`, async t => {
    const ui = await playing(t); advance(ui, 5); await ui.click('pause');
    ui.document.hidden = true;
    await ui.click('resume'); await ui.click('restart');
    assert.equal(plays(ui), 1);
    ui.document.hidden = false; ui.events.visibilitychange();
    // Restart click in a hidden document must not close the pause dialog either.
    assert.equal(ui.node('pause-dialog').open, true);
  });

  test(`${mode}: interruption is handled immediately without waiting for animation`, async t => {
    const ui = await playing(t); advance(ui, 8);
    if (compatibleAudio) {
      const media = ui.native.instances[0]; media.paused = true; media.onpause();
    } else {
      ui.audio.state = 'interrupted'; ui.audio.contexts[0].onstatechange();
    }
    assert.equal(ui.node('pause-dialog').open, true);
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
    ui.tick(compatibleAudio ? 2.1 : 7.1); // Resume countdown ends at context time 7.
    ui.lanes[0].onpointerdown(pointer(2));
    if (compatibleAudio) ui.native.instances[0].currentTime = 11;
    ui.tick(compatibleAudio ? 11 : 16);
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
    ui.tick(compatibleAudio ? 2.5 : 7.5);
    if (compatibleAudio) ui.native.instances[0].currentTime = 151;
    ui.tick(200);
    assert.equal(Object.values(ui.records())[0].brokenHolds, 1);
    assert.equal(ui.progress().history[0].pulse.captured, 0);
  });
}

test('native resume interrupted while play is pending preserves the newly reached position', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } });
  await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances[0]; media.currentTime = 9; await ui.click('pause');
  const gate = deferred(); ui.native.gate = gate;
  const resuming = ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9); // Synchronous user-gesture play remains intact.
  media.currentTime = 9.5; ui.events.pagehide(); gate.resolve(); await resuming;
  assert.equal(media.paused, true); assert.equal(ui.node('pause-dialog').open, true);
  ui.native.gate = null; await ui.click('resume');
  assert.equal(ui.native.plays.at(-1), 9.5);
});

test('Web Audio pending unlock cannot restart a session after pagehide', async t => {
  const ui = await mount(t); await ui.click('play'); ui.tick(10); await ui.click('pause');
  const gate = deferred(); ui.audio.resumeGate = gate;
  const resuming = ui.click('resume'); ui.events.pagehide(); gate.resolve(); await resuming;
  assert.equal(ui.audio.starts.length, 1); assert.equal(ui.node('pause-dialog').open, true);
  ui.audio.resumeGate = null; await ui.click('resume');
  assert.equal(ui.audio.starts.at(-1).offset, 7);
});

test('multiple pointers and keyboard on one lane release a hold only when the last source leaves', async t => {
  const ui = await mount(t, { chart: [{ time: 1, lane: 0, duration: 10 }, { time: 1, lane: 1, duration: 10 }] });
  await ui.click('play'); ui.tick(4);
  ui.lanes[0].onpointerdown(pointer(1)); ui.lanes[0].onpointerdown(pointer(2));
  ui.lanes[1].onpointerdown(pointer(3));
  ui.events.keydown({ code: 'KeyD', target: { tagName: 'BODY' }, preventDefault() {} });
  ui.tick(5);
  ui.lanes[0].onpointercancel(pointer(1)); ui.lanes[0].onlostpointercapture(pointer(1));
  ui.lanes[0].onpointerup(pointer(2));
  ui.tick(14); ui.events.keyup({ code: 'KeyD' }); ui.lanes[1].onpointerup(pointer(3));
  ui.tick(200);
  const result = Object.values(ui.records())[0];
  assert.equal(result.hits, 2); assert.equal(result.brokenHolds, 0); assert.equal(result.strays, 0);
});

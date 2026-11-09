import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, deferred } from './helpers/ui-harness.mjs';
import { renderPulse } from '../dist/pulse-view.js';
import { formatPercent } from '../dist/format.js';
const pointer = { pointerId: 1, preventDefault() {} };
const chart = [{ time: 1, lane: 0, duration: 0 }, { time: 13, lane: 1, duration: 0 }];
for (const compatibleAudio of [false, true]) {
  test(`Pulse in ${compatibleAudio ? 'compatible' : 'Web Audio'} mode: pause, score, history and retry`, async t => {
    const ui = await mount(t, { settings: { compatibleAudio }, chart });
    await ui.click('play'); if (compatibleAudio) {
      const gate = deferred(); ui.native.gate = gate;
      const begin = ui.click('load-begin');
      assert.equal(ui.native.plays.length, 1, 'play called in gesture before promise resolves');
      assert.equal(ui.audio.contexts.length, 0, 'no AudioContext in compatible mode');
      gate.resolve(); await begin; ui.native.gate = null;
    }
    function advance(position, afterResume = false) {
      if (compatibleAudio) ui.native.instances.at(-1).currentTime = position;
      ui.tick(compatibleAudio ? position : position + (afterResume ? 5 : 3));
    }
    advance(1); ui.lanes[0].onpointerdown(pointer); ui.lanes[0].onpointerup(pointer);
    advance(12); assert.equal(ui.node('pulse').dataset.outcome, 'perfect');
    await ui.click('pause'); const title = ui.node('pulse-title').textContent;
    ui.tick(999); assert.equal(ui.node('pulse-title').textContent, title); assert.equal(ui.progress().history.length, 0);
    // Resume context starts from the current mocked clock. Restore it to pause time.
    ui.audio.currentTime = 15; await ui.click('resume');
    advance(13, true); ui.lanes[1].onpointerdown(pointer); ui.lanes[1].onpointerup(pointer);
    advance(151, true);
    const attempt = ui.progress().history[0];
    assert.equal(attempt.pulse.total, 2); assert.equal(attempt.pulse.perfect, 2); assert.equal(attempt.result.score, 200);
    assert.equal(ui.node('result-pulse').hidden, false);
    assert.equal(ui.progress().records[0].pulse, undefined, 'base score remains separate');
    await ui.click('back-to-library'); await ui.click('progress-open');
    assert.equal(ui.node('best-pulse').hidden, false);
    await ui.click('history-tab');
    const row = ui.node('history-list').children.find(node => node.tagName === 'ARTICLE');
    assert.ok(row.children.at(-1).children.some(node => node.textContent.includes('Pulse:')));
    await ui.click('home'); await ui.click('play'); if (compatibleAudio) await ui.click('load-begin');
    assert.equal(ui.node('pulse').dataset.outcome, 'active');
    await ui.click('pause'); await ui.click('quit'); assert.equal(ui.progress().history.length, 1);
  });
}
test('old records survive a worse score with a new Pulse result; demo and calibration hide awards', async t => {
  const id = '0734D2E4-7693-418B-82F8-C6D88A02A782';
  const old = { score: 98765, accuracy: 98, bestStreak: 100 };
  const ui = await mount(t, { chart, records: { [id + ':1']: old }, settings: { compatibleAudio: true } });
  await ui.click('play'); await ui.click('load-begin'); ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.deepEqual(ui.progress().records.find(record => record.rulesVersion === 'web-v1').result, old);
  assert.equal(ui.progress().records.length, 2); assert.equal(ui.progress().history[0].pulse.captured, 0);
  const saved = structuredClone(ui.progress());
  for (const mode of ['demo', 'calibration']) {
    await ui.click('back-to-library');
    await ui.click(mode); if (mode === 'calibration') await ui.click('play');
    await ui.click('load-begin'); assert.equal(ui.node('pulse').hidden, true);
    ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
    assert.equal(ui.node('result-pulse').hidden, true); assert.deepEqual(ui.progress(), saved);
  }
});
test('Pulse uses Intl percentages and handles all verdicts without hiding the playfield', async t => {
  const ui = await mount(t);
  const view = { index: 3, total: 8, notes: 12, done: 8, result: null };
  renderPulse(view); assert.ok(ui.node('pulse-detail').textContent.includes(formatPercent(90)));
  for (const [result, outcome] of [[{ captured: true, perfect: true, accuracy: 100 }, 'perfect'],
    [{ captured: true, perfect: false, accuracy: 90 }, 'captured'], [{ captured: false, misses: 1 }, 'missed']]) {
    renderPulse({ ...view, result }); assert.equal(ui.node('pulse').dataset.outcome, outcome);
    assert.equal(ui.node('pulse-progress-row').hidden, true);
  }
});
test('buffering does not advance Pulse or accept inputs; restart discards the unfinished run', async t => {
  const ui = await mount(t, { chart, settings: { compatibleAudio: true } });
  await ui.click('play'); await ui.click('load-begin');
  const media = ui.native.instances.at(-1); media.currentTime = 1; ui.tick(1);
  ui.lanes[0].onpointerdown(pointer); ui.lanes[0].onpointerup(pointer);
  media.readyState = 2; media.currentTime = 12; ui.tick(12);
  assert.equal(ui.node('pulse').dataset.outcome, 'active');
  ui.lanes[2].onpointerdown(pointer); ui.lanes[2].onpointerup(pointer);
  media.readyState = 4; ui.tick(12);
  assert.equal(ui.node('pulse').dataset.outcome, 'perfect');
  await ui.click('pause'); await ui.click('restart'); await ui.click('load-begin');
  assert.equal(ui.node('pulse').dataset.outcome, 'active'); assert.equal(ui.progress().history.length, 0);
  ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.equal(ui.progress().history[0].pulse.captured, 0); assert.equal(ui.progress().history.length, 1);
});

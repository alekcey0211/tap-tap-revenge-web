import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, deferred } from './helpers/ui-harness.mjs';
import { renderPulse, pulseReasons } from '../dist/pulse-view.js';
import { PULSE_CHARTS, PULSE_COUNTS } from '../dist/phrase-charts.js';
import { choosePulseZones } from '../dist/pulse-zones.js';
import { formatPercent } from '../dist/format.js';
const pointer = { pointerId: 1, preventDefault() {} };
const chart = [{ time: 1, lane: 0, duration: 0 }, { time: 26, lane: 1, duration: 0 }];
const firstId = 'restless-urban-groove-v1';
const settle = choosePulseZones(chart, PULSE_CHARTS[firstId], PULSE_COUNTS[firstId], () => 0)[0].end + .1;
for (const compatibleAudio of [false, true]) {
  test(`Pulse in ${compatibleAudio ? 'compatible' : 'Web Audio'} mode: pause, score, history and retry`, async t => {
    t.mock.method(Math, 'random', () => 0);
    const ui = await mount(t, { settings: { compatibleAudio }, chart });
    await ui.openSong(); if (compatibleAudio) {
      const gate = deferred(); ui.native.gate = gate;
      const begin = ui.click('play');
      assert.equal(ui.native.plays.length, 1, 'play called in gesture before promise resolves');
      assert.equal(ui.audio.contexts.length, 0, 'no AudioContext in compatible mode');
      gate.resolve(); await begin; ui.native.gate = null;
    } else await ui.click('play');
    function advance(position, afterResume = false) {
      if (compatibleAudio) ui.native.instances.at(-1).currentTime = position;
      ui.tick(compatibleAudio ? position : position + (afterResume ? 2 : 0));
    }
    advance(1); ui.lanes[0].onpointerdown(pointer); ui.lanes[0].onpointerup(pointer);
    advance(settle); assert.equal(ui.node('pulse').dataset.outcome, 'perfect');
    await ui.click('pause'); const title = ui.node('pulse-title').textContent;
    ui.tick(999); assert.equal(ui.node('pulse-title').textContent, title); assert.equal(ui.progress().history.length, 0);
    // Resume context starts from the current mocked clock. Restore it to pause time.
    ui.audio.currentTime = settle; await ui.click('resume');
    advance(26, true); ui.lanes[1].onpointerdown(pointer); ui.lanes[1].onpointerup(pointer);
    advance(151, true);
    const attempt = ui.progress().history[0];
    assert.equal(attempt.pulse.total, 2); assert.equal(attempt.pulse.perfect, 2); assert.equal(attempt.result.score, 200);
    assert.equal(ui.node('result-pulse').hidden, false);
    assert.equal(ui.progress().records[0].pulse, undefined, 'base score remains separate');
    await ui.click('back-to-library'); await ui.click('home'); await ui.click('menu-progress');
    assert.equal(ui.node('best-pulse').hidden, false);
    await ui.click('history-tab');
    const row = ui.node('history-list').children.find(node => node.tagName === 'ARTICLE');
    assert.ok(row.children.at(-1).children.some(node => node.textContent.includes('Pulse:')));
    await ui.click('home'); await ui.start();
    assert.equal(ui.node('pulse').dataset.outcome, 'active');
    await ui.click('pause'); await ui.click('quit'); assert.equal(ui.progress().history.length, 1);
  });
}
test('old records survive a worse score with a new Pulse result; calibration hides awards', async t => {
  const id = '0734D2E4-7693-418B-82F8-C6D88A02A782';
  const old = { score: 98765, accuracy: 98, bestStreak: 100 };
  const ui = await mount(t, { chart, records: { [id + ':1']: old }, settings: { compatibleAudio: true } });
  await ui.start(); ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.deepEqual(ui.progress().records.find(record => record.rulesVersion === 'web-v1').result, old);
  assert.equal(ui.progress().records.length, 2); assert.equal(ui.progress().history[0].pulse.captured, 0);
  const saved = structuredClone(ui.progress());
  await ui.click('back-to-library'); await ui.click('settings-open'); await ui.click('settings-calibration'); await ui.start();
  assert.equal(ui.node('pulse').hidden, true);
  ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.equal(ui.node('result-pulse').hidden, true); assert.deepEqual(ui.progress(), saved);
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
  t.mock.method(Math, 'random', () => 0);
  const ui = await mount(t, { chart, settings: { compatibleAudio: true } });
  await ui.start();
  const media = ui.native.instances.at(-1); media.currentTime = 1; ui.tick(1);
  ui.lanes[0].onpointerdown(pointer); ui.lanes[0].onpointerup(pointer);
  media.readyState = 2; media.currentTime = settle; ui.tick(settle);
  assert.equal(ui.node('pulse').dataset.outcome, 'active');
  ui.lanes[2].onpointerdown(pointer); ui.lanes[2].onpointerup(pointer);
  media.readyState = 4; ui.tick(settle);
  assert.equal(ui.node('pulse').dataset.outcome, 'perfect');
  await ui.click('pause'); await ui.click('restart');
  assert.equal(ui.node('pulse').dataset.outcome, 'active'); assert.equal(ui.progress().history.length, 0);
  ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.equal(ui.progress().history[0].pulse.captured, 0); assert.equal(ui.progress().history.length, 1);
});

test('results explain a failed Pulse with zero misses and clear details for calibration', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true }, chart: [{ time: 1, lane: 0, duration: 0 }] });
  await ui.start();
  ui.node('result-details').open = true;
  ui.native.instances.at(-1).currentTime = 1.06; ui.tick(1.06);
  ui.lanes[0].onpointerdown(pointer); ui.lanes[0].onpointerup(pointer);
  ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.equal(ui.progress().history[0].result.misses, 0);
  assert.equal(ui.progress().history[0].pulse.captured, 0);
  assert.equal(ui.node('pulse-explanation').hidden, false);
  assert.equal(ui.node('result-details').open, false);
  assert.equal(ui.node('result-pulse-count').textContent, '0 / 1');
  assert.ok(ui.node('pulse-breakdown').children[0].textContent.includes(formatPercent(80)));
  assert.ok(ui.node('pulse-rule').textContent.includes(formatPercent(90)));
  await ui.click('back-to-library'); await ui.click('settings-open'); await ui.click('settings-calibration'); await ui.start();
  ui.native.instances.at(-1).currentTime = 151; ui.tick(151);
  assert.equal(ui.node('pulse-explanation').hidden, true);
  assert.equal(ui.node('pulse-breakdown').children.length, 0);
});

test('Pulse explains every failed condition and never rounds a failed accuracy into a pass', () => {
  const reasons = pulseReasons({ misses: 0, broken: 1, strays: 2, accuracy: 80 });
  assert.equal(reasons.length, 3);
  assert.ok(reasons.some(reason => reason.includes('удержаний')));
  assert.ok(reasons.some(reason => reason.includes('Лишние')));
  assert.ok(reasons.some(reason => reason.includes(formatPercent(80))));
  assert.deepEqual(pulseReasons({ accuracy: 89.999, misses: 0, broken: 0, strays: 0 }), [`Точность ниже ${formatPercent(90)}`]);
  assert.deepEqual(pulseReasons({ accuracy: 90, misses: 0, broken: 0, strays: 0 }), []);
});

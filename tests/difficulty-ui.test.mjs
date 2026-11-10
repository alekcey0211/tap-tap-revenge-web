import test from 'node:test';
import assert from 'node:assert/strict';
import { mount } from './helpers/ui-harness.mjs';
import { formatCount } from '../dist/format.js?v=0.3.0';

test('difficulty cards show real chart counts and decorative intensity, keeping one selected level', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } });
  for (const song of ui.catalog.filter(song => !song.tutorial)) {
    await ui.openSong(song.title);
    for (let index = 0; index < 4; index++) {
      const button = ui.node('difficulties').children[index];
      const [meter, check, title, count] = button.children;
      assert.equal(button.dataset.level, String(index + 1));
      assert.equal(meter.attrs['aria-hidden'], 'true'); assert.equal(check.attrs['aria-hidden'], 'true');
      assert.equal(meter.children.length, 4);
      assert.equal(meter.children.filter(bar => bar.dataset.lit === 'true').length, index + 1);
      assert.equal(title.textContent, ['Легко', 'Средне', 'Сложно', 'Экстрим'][index]);
      assert.equal(count.textContent, formatCount(song.levels[index + 1].notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' }));
      await button.onclick();
      const selected = ui.node('difficulties').children.filter(node => node.attrs['aria-pressed'] === 'true');
      assert.equal(selected.length, 1); assert.equal(selected[0].dataset.level, String(index + 1));
      assert.equal(ui.document.activeElement, selected[0]);
    }
  }
  assert.equal(ui.native.plays.length, 0, 'choosing a card must not start audio');
  assert.equal(ui.progress().history.length, 0);
});
test('calibration exposes only its existing easy chart, without invented counts for unavailable levels', async t => {
  const ui = await mount(t); await ui.click('menu-play'); await ui.click('settings-open'); await ui.click('settings-calibration');
  const buttons = ui.node('difficulties').children;
  assert.equal(buttons[0].disabled, false); assert.equal(buttons[0].attrs['aria-pressed'], 'true');
  for (const button of buttons.slice(1)) {
    assert.equal(button.disabled, true); assert.equal(button.attrs['aria-pressed'], 'false');
    assert.equal(button.children.at(-1).textContent, 'Недоступно');
  }
});

test('calibration hides game-only controls and restores them for a song', async t => {
  const ui = await mount(t);
  await ui.click('menu-settings'); await ui.click('settings-calibration');
  for (const id of ['song-difficulty', 'record', 'demo', 'offline-open']) assert.equal(ui.node(id).hidden, true);
  assert.equal(ui.node('hero-art').src, 'assets/scene/calibration.png');
  assert.equal(ui.node('play').disabled, false);
  await ui.click('home'); await ui.openSong();
  for (const id of ['song-difficulty', 'record', 'demo', 'offline-open']) assert.equal(ui.node(id).hidden, false);
});

test('progress reuses song difficulty cards without starting audio', async t => {
  const ui = await mount(t); await ui.click('menu-progress');
  for (let index = 0; index < 4; index++) {
    await ui.node('progress-levels').children[index].onclick();
    const button = ui.node('progress-levels').children[index];
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert.equal(button.dataset.level, String(index + 1));
    assert.deepEqual(button.children.map(node => node.className), ['difficulty-meter', 'difficulty-check', 'difficulty-name', 'difficulty-notes']);
    assert.equal(ui.document.activeElement, button);
  }
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
});

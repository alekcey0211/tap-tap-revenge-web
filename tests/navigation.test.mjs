import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, deferred } from './helpers/ui-harness.mjs';

const screens = ['menu', 'library', 'song-screen', 'game-screen', 'results', 'preparation', 'progress-screen', 'settings-screen', 'about-screen', 'offline-screen', 'pause-screen', 'import-screen'];
function onlyScreen(ui, active) {
  assert.equal(ui.document.body.dataset.screen, active);
  for (const name of screens) {
    assert.equal(ui.node(name).hidden, name !== active, name + ' visibility');
    assert.equal(ui.node(name).inert, name !== active, name + ' input isolation');
  }
}

test('home is a silent game menu; Play opens the catalogue and Back returns home', async t => {
  const ui = await mount(t);
  onlyScreen(ui, 'menu');
  assert.equal(ui.document.activeElement, ui.node('menu-play'));
  assert.equal(ui.node('app-version').textContent, ui.node('settings-version').textContent);
  await ui.click('menu-play'); onlyScreen(ui, 'library');
  assert.equal(ui.node('home').attrs['aria-label'], 'Главное меню');
  await ui.click('home'); onlyScreen(ui, 'menu');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
});

test('settings and help replace the page, then restore focus and scroll to their origin', async t => {
  const ui = await mount(t);
  for (const [button, screen, close] of [['menu-settings', 'settings-screen', 'settings-close'], ['menu-about', 'about-screen', 'about-close']]) {
    window.scrollTo({ top: 120 });
    await ui.click(button); onlyScreen(ui, screen);
    assert.equal(window.scrollY, 0);
    assert.equal(ui.document.activeElement, ui.node('screen-title'));
    window.scrollTo({ top: 800 });
    await ui.click(close); onlyScreen(ui, 'menu');
    assert.equal(window.scrollY, 120);
    assert.equal(ui.document.activeElement, ui.node(button));
  }
});

test('nested download → settings → back keeps the selected song, scroll and focus', async t => {
  const ui = await mount(t); await ui.openSong('Overdrive');
  window.scrollTo({ top: 160 });
  await ui.click('offline-open'); onlyScreen(ui, 'offline-screen');
  window.scrollTo({ top: 60 });
  await ui.click('offline-settings'); onlyScreen(ui, 'settings-screen');
  await ui.click('home'); onlyScreen(ui, 'offline-screen');
  assert.equal(window.scrollY, 60);
  assert.equal(ui.document.activeElement, ui.node('offline-settings'));
  await ui.click('offline-close'); onlyScreen(ui, 'song-screen');
  assert.equal(window.scrollY, 160);
  assert.equal(ui.document.activeElement, ui.node('offline-open'));
  assert.equal(ui.node('hero-title').textContent, 'Overdrive');
  assert.equal(ui.node('play').disabled, false);
});

for (const compatibleAudio of [false, true]) test(`pause → settings → back stays paused until a gesture (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } }); await ui.start();
  if (compatibleAudio) ui.native.instances[0].currentTime = 7;
  ui.tick(7); await ui.click('pause'); onlyScreen(ui, 'pause-screen');
  assert.equal(ui.document.activeElement, ui.node('resume'));
  await ui.click('settings-open'); onlyScreen(ui, 'settings-screen');
  ui.tick(40); await ui.click('settings-close'); onlyScreen(ui, 'pause-screen');
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 1);
  assert.equal(ui.node('time').textContent, '0:07 / 2:30');
  await ui.click('resume'); onlyScreen(ui, 'game-screen');
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 2);
  if (compatibleAudio) assert.equal(ui.native.plays.at(-1), 7);
  else assert.equal(ui.audio.starts.at(-1).offset, 7);
});

test('background song loading and audio-mode changes cannot reveal the page behind settings', async t => {
  const ui = await mount(t); ui.audio.loadGate = deferred();
  const loading = ui.openSong('Overdrive'); await new Promise(setImmediate);
  await ui.click('settings-open'); onlyScreen(ui, 'settings-screen');
  ui.audio.loadGate.resolve(); await loading; onlyScreen(ui, 'settings-screen');
  await ui.node('compatible-audio').onchange({ target: { checked: true } }); onlyScreen(ui, 'settings-screen');
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
  await ui.click('home'); onlyScreen(ui, 'song-screen');
  const gate = deferred(); ui.native.gate = gate;
  const start = ui.click('play');
  assert.equal(ui.native.plays.length, 1, 'native play still runs synchronously');
  gate.resolve(); await start;
});

test('Escape returns through informational pages without starting audio', async t => {
  const ui = await mount(t); await ui.click('menu-settings');
  ui.events.keydown({ code: 'Escape', target: { tagName: 'BUTTON' }, preventDefault() {} });
  onlyScreen(ui, 'menu');
  assert.equal(ui.document.activeElement, ui.node('menu-settings'));
});

test('no dialogs remain; updates and iPhone installation live in settings, not the song', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const settings = html.slice(html.indexOf('<section id="settings-screen"'), html.indexOf('<section id="about-screen"'));
  const offline = html.slice(html.indexOf('<section id="offline-screen"'), html.indexOf('<section id="pause-screen"'));
  const song = html.slice(html.indexOf('<section id="song-screen"'), html.indexOf('<section id="game-screen"'));
  assert.doesNotMatch(html, /<dialog\b/);
  assert.match(settings, /id="update-check"/); assert.match(settings, /На экран Домой/);
  assert.match(settings, /id="settings-version"/);
  assert.doesNotMatch(offline + song, /id="update-check"|«Поделиться»/);
  assert.match(song, /↓ Скачать трек/);
});

test('silent runway preview has no gameplay or audio and the departing menu is inert', async t => {
  const ui = await mount(t); await ui.openSong('Overdrive');
  assert.equal(ui.node('song-backdrop').hidden, false);
  ui.tick(0); ui.tick(5);
  assert.equal(ui.audio.starts.length + ui.native.plays.length, 0);
  assert.equal(ui.progress().history.length, 0);
  await ui.click('play');
  assert.equal(ui.node('song-backdrop').hidden, true);
  assert.equal(ui.node('song-screen').dataset.departing, 'true');
  assert.equal(ui.node('song-screen').inert, true);
  assert.equal(ui.document.activeElement, ui.node('pause'));
});

test('a pending native resume is cancelled when settings replace pause; closing settings never resumes', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } }); await ui.start();
  ui.native.instances[0].currentTime = 9; await ui.click('pause');
  const gate = deferred(); ui.native.gate = gate;
  const resuming = ui.click('resume');
  await ui.click('settings-open'); onlyScreen(ui, 'settings-screen');
  gate.resolve(); await resuming; onlyScreen(ui, 'settings-screen');
  assert.equal(ui.native.instances[0].paused, true);
  await ui.click('home'); onlyScreen(ui, 'pause-screen');
  assert.equal(ui.node('resume').disabled, false);
  ui.native.gate = null; await ui.click('resume'); onlyScreen(ui, 'game-screen');
  assert.equal(ui.native.plays.at(-1), 9);
});

test('pointer navigation restores its trigger even when the browser did not focus the tapped button', async t => {
  const ui = await mount(t);
  ui.node('menu-play').focus();
  ui.node('menu-settings').onclick({ currentTarget: ui.node('menu-settings') });
  onlyScreen(ui, 'settings-screen');
  await ui.click('home');
  assert.equal(ui.document.activeElement, ui.node('menu-settings'));
});

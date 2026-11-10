import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRoute, routeHash } from '../dist/routing.js';
import { mount, deferred } from './helpers/ui-harness.mjs';

const catalog = JSON.parse(await readFile(new URL('../dist/assets/catalog.json', import.meta.url)));
const song = catalog.find(song => !song.tutorial);
const songURL = (level = '1') => routeHash({ screen: 'song-screen', song, level });
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

for (const screen of ['menu', 'library', 'settings-screen', 'about-screen', 'progress-screen', 'song-screen', 'offline-screen']) {
  test(`URL round trip and reload restore ${screen} without playback`, async t => {
    const hash = routeHash({ screen, song, level: '3' });
    assert.equal(parseRoute(hash, catalog).screen, screen);
    const ui = await mount(t, { hash });
    assert.equal(ui.document.body.dataset.screen, screen);
    assert.equal(ui.location.hash, hash);
    assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
    assert.equal(ui.audio.contexts.length, 0, 'restoring a URL must not attempt Web Audio resume');
    if (['song-screen', 'offline-screen'].includes(screen)) {
      assert.equal(ui.node('hero-title').textContent, song.title);
      assert.equal(ui.node('difficulties').children[2].attrs['aria-pressed'], 'true');
    }
  });
}

test('bad URLs, unknown songs and unavailable levels normalize to safe pages', () => {
  for (const hash of ['#/bad', '#/%E0%A4%A', '#/settings/extra']) assert.equal(parseRoute(hash, catalog).screen, 'menu');
  assert.equal(parseRoute('#/song/missing?difficulty=4', catalog).screen, 'library');
  assert.equal(parseRoute(songURL('bad'), catalog).level, '1');
  const calibration = parseRoute('#/calibration?difficulty=4', catalog);
  assert.equal(calibration.song.tutorial, true); assert.equal(calibration.level, '1');
  assert.equal(routeHash(calibration), '#/calibration');
});

test('invalid deep link is replaced, not pushed into a redirect loop', async t => {
  const ui = await mount(t, { hash: '#/song/deleted?difficulty=4' });
  assert.equal(ui.location.hash, '#/library');
  ui.history.back(); assert.equal(ui.location.hash, '#/library');
});

for (const compatibleAudio of [false, true]) test(`restored song starts only from Play (${compatibleAudio})`, async t => {
  const ui = await mount(t, { hash: songURL('4'), settings: { compatibleAudio } });
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
  const work = ui.click('play');
  if (compatibleAudio) assert.equal(ui.native.plays.length, 1, 'native play is still in the original click');
  await work;
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
  assert.equal(ui.node('mode-label').textContent, 'Экстрим');
  assert.equal(ui.location.hash, songURL('4'), 'runtime game state has a safe song reload target');
  await ui.click('pause');
  assert.equal(ui.location.hash, songURL('4'));
});

test('difficulty replaces the current URL; browser Back/Forward navigates pages, not all chosen levels', async t => {
  const ui = await mount(t); await ui.openSong();
  await ui.node('difficulties').children[1].onclick();
  await ui.node('difficulties').children[3].onclick();
  assert.equal(ui.location.hash, songURL('4'));
  ui.history.back(); assert.equal(ui.document.body.dataset.screen, 'library');
  ui.history.back(); assert.equal(ui.document.body.dataset.screen, 'menu');
  ui.history.forward(); assert.equal(ui.document.body.dataset.screen, 'library');
  ui.history.forward(); assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.node('difficulties').children[3].attrs['aria-pressed'], 'true');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
});

test('utility close consumes browser history and restores song focus and scroll', async t => {
  const ui = await mount(t); await ui.openSong();
  window.scrollTo({ top: 120 });
  await ui.click('offline-open'); const offlineURL = ui.location.hash;
  await ui.click('offline-settings');
  await ui.click('settings-close'); assert.equal(ui.location.hash, offlineURL);
  await ui.click('offline-close'); assert.equal(ui.location.hash, songURL());
  assert.equal(window.scrollY, 120); assert.equal(ui.document.activeElement, ui.node('offline-open'));
  ui.history.back(); assert.equal(ui.document.body.dataset.screen, 'library');
});

for (const compatibleAudio of [false, true]) test(`browser Back from settings restores a paused run without resuming (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } }); await ui.start();
  if (compatibleAudio) ui.native.instances[0].currentTime = 9;
  ui.tick(9); await ui.click('pause'); await ui.click('settings-open');
  ui.history.back();
  assert.equal(ui.document.body.dataset.screen, 'pause-screen');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 1);
  ui.history.forward(); assert.equal(ui.document.body.dataset.screen, 'settings-screen');
  ui.history.back(); await ui.click('resume');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 2);
});

test('browser navigation cancels a pending chart and stale completion cannot replace the new screen', async t => {
  const ui = await mount(t); await ui.openSong();
  const gate = deferred(); ui.chartNetwork.gates.set('4', gate);
  const loading = ui.node('difficulties').children[3].onclick();
  ui.history.back();
  gate.resolve(); await loading;
  assert.equal(ui.document.body.dataset.screen, 'library'); assert.equal(ui.location.hash, '#/library');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
});

test('manual hash change loads the target and handles popstate/hashchange only once', async t => {
  const ui = await mount(t, { settings: { compatibleAudio: true } });
  ui.navigate(songURL('2')); await settle();
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.node('play').disabled, false);
  assert.equal(ui.audio.loads.length, 1);
  ui.events.popstate(); ui.events.hashchange(); await settle();
  assert.equal(ui.audio.loads.length, 1);
  ui.history.back(); assert.equal(ui.document.body.dataset.screen, 'menu');
});

test('a reload during preparation does not rewrite the song URL to the library', async t => {
  const ui = await mount(t); ui.audio.loadGate = deferred();
  const loading = ui.openSong(); await new Promise(setImmediate);
  const hash = ui.location.hash; ui.events.pagehide();
  assert.equal(ui.location.hash, hash);
  ui.audio.loadGate.resolve(); await loading;
  assert.equal(ui.native.plays.length + ui.audio.starts.length, 0);
  await ui.click('song-load-retry'); await ui.click('play');
  assert.equal(ui.document.body.dataset.screen, 'game-screen');
});

test('calibration deep link and its instructions survive reload', async t => {
  const ui = await mount(t, { hash: '#/calibration' });
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.node('song-difficulty').hidden, true);
  assert.match(ui.node('status').textContent, /метроному/);
  assert.equal(ui.location.hash, '#/calibration');
});

test('real close click events do not bypass browser history', async t => {
  const ui = await mount(t); await ui.click('menu-settings');
  ui.node('settings-close').onclick({ type: 'click' });
  assert.equal(ui.document.body.dataset.screen, 'menu');
  ui.history.forward(); assert.equal(ui.document.body.dataset.screen, 'settings-screen');
});

for (const compatibleAudio of [false, true]) test(`browser Back stops an active run and Forward does not autoplay (${compatibleAudio})`, async t => {
  const ui = await mount(t, { settings: { compatibleAudio } }); await ui.start();
  ui.history.back(); assert.equal(ui.document.body.dataset.screen, 'library');
  if (compatibleAudio) assert.equal(ui.native.instances[0].paused, true);
  const plays = ui.native.plays.length + ui.audio.starts.length;
  ui.history.forward(); await settle();
  assert.equal(ui.document.body.dataset.screen, 'song-screen');
  assert.equal(ui.native.plays.length + ui.audio.starts.length, plays);
  assert.equal(ui.progress().history.length, 0);
});

test('navigating away while a restored Web Audio song prepares cannot start it later', async t => {
  const ui = await mount(t, { hash: songURL() });
  ui.audio.loadGate = deferred();
  const starting = ui.click('play'); await new Promise(setImmediate);
  ui.navigate('#/settings');
  ui.audio.loadGate.resolve(); await starting;
  assert.equal(ui.document.body.dataset.screen, 'settings-screen');
  assert.equal(ui.audio.starts.length, 0);
});

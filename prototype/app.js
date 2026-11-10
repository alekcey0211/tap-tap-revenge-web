import { Engine, WebGPUEngine } from '@babylonjs/core';
import { MediaSongAudio } from '../media-audio.js?v=0.3.1';
import { createScene } from './scene.js';
import { chooseBackend } from './backend.js';
import { Transport } from './transport.js';

const $ = id => document.getElementById(id);
const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const seconds = new Intl.NumberFormat('ru-RU', { minimumIntegerDigits: 2, useGrouping: false });
const clock = time => `${numbers.format(Math.floor(time / 60))}:${seconds.format(Math.floor(time % 60))}`;
const player = new MediaSongAudio(), transport = new Transport(player);
let stage, engine, tracks, selected, chart = [], trackRequest = 0, energy = true, ready = false, statsAt = 0;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
$('reduced').checked = motion.matches;
motion.addEventListener('change', event => { if (event.matches) $('reduced').checked = true; });
const preference = new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'auto';
$('renderer').value = preference;
$('renderer').onchange = () => {
  transport.pause(); const url = new URL(location.href); url.searchParams.set('renderer', $('renderer').value); location.assign(url.href);
};
$('options-toggle').onclick = () => {
  const open = $('options').hidden;
  $('options').hidden = !open; $('options-toggle').setAttribute('aria-expanded', String(open));
};
$('energy-toggle').onclick = () => {
  energy = !energy; $('energy-toggle').setAttribute('aria-pressed', String(energy));
  $('energy-toggle').textContent = `×${numbers.format(8)} ${energy ? 'включён' : 'выключен'}`;
  $('energy').dataset.active = String(energy);
  $('energy-value').textContent = `×${numbers.format(energy ? 8 : 1)}`;
};
function syncControls() {
  const playing = ['playing', 'starting'].includes(transport.state);
  $('play').disabled = !ready;
  $('silent').disabled = !ready || playing;
  $('restart').disabled = !ready;
  $('play').textContent = playing ? 'Ⅱ Пауза' : transport.state === 'paused' && transport.offset > 0 ? '▶ Продолжить' : '▶ С музыкой';
}
function pause(message) {
  transport.pause(); syncControls();
  if (message) $('status').textContent = message;
}
function start(music) {
  if (!ready || document.hidden) return;
  if (['playing', 'starting'].includes(transport.state)) { pause('Пауза. Продолжение — только по нажатию.'); return; }
  // Native play runs synchronously here, before timers or await, using the unchanged compatible player.
  const playing = transport.play(music);
  syncControls(); $('status').textContent = music ? 'Автодемо · попадания показаны автоматически' : 'Без звука · отдельная демонстрация эффектов';
  playing.then(syncControls).catch(() => { $('status').textContent = 'Звук не запустился. Нажми «Продолжить» ещё раз.'; syncControls(); });
}
$('play').onclick = () => start(transport.state === 'paused' && transport.offset > 0 ? transport.music : true);
$('silent').onclick = () => start(false);
$('restart').onclick = () => { transport.reset(); stage.setChart(chart); syncControls(); $('status').textContent = 'Готово. Выбери запуск с музыкой или без звука.'; };
$('reload').onclick = () => location.reload();
function suspend() { if (['playing', 'starting'].includes(transport.state)) pause('Пауза после ухода из приложения. Нажми «Продолжить».'); }
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', () => { suspend(); });
player.oninterrupt = () => { if (['playing', 'starting'].includes(transport.state)) pause('Воспроизведение прервано. Нажми «Продолжить».'); };
window.addEventListener('resize', () => stage?.resize());

async function json(path) { const response = await fetch(path); if (!response.ok) throw new Error('network'); return response.json(); }
async function loadTrack(song) {
  const id = ++trackRequest; selected = song; ready = false; transport.reset(); player.dispose(); syncControls();
  $('status').textContent = 'Загружаем музыку и карту…';
  $('cover').src = `../assets/tracks/${song.id}/artwork.jpg`; $('track-name').textContent = song.title;
  try {
    const [notes, audio] = await Promise.all([json(`../assets/tracks/${song.id}/2.json`), player.load(`../assets/tracks/${song.id}/audio.m4a`, song.duration)]);
    if (id !== trackRequest) return;
    chart = notes; transport.setTrack(audio); stage.setChart(notes); ready = true; syncControls();
    $('status').textContent = 'Автодемо готово. Музыка начнётся только после нажатия.';
  } catch {
    if (id !== trackRequest) return;
    $('status').textContent = 'Не удалось загрузить трек. Проверь интернет или выбери другую песню.';
    $('reload').hidden = false;
  }
}
$('song').onchange = () => { void loadTrack(tracks.find(song => song.id === $('song').value)); };

function deadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('renderer timeout')), ms); })]).finally(() => clearTimeout(timer));
}
async function createRenderer(gpu) {
  // A failed WebGPU context cannot turn into WebGL on the same canvas.
  const old = $('stage'), canvas = old.cloneNode(); old.replaceWith(canvas);
  let candidate;
  try {
    const options = { antialias: true, audioEngine: false, powerPreference: 'high-performance' };
    candidate = gpu ? new WebGPUEngine(canvas, options) : new Engine(canvas, true, options);
    if (gpu) {
      const initialization = candidate.initAsync();
      try { await deadline(initialization, 15000); }
      catch (error) { void initialization.then(() => candidate.dispose(), () => {}); throw error; }
    }
    candidate.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 1.5));
    const world = createScene(candidate, canvas);
    await deadline(world.scene.whenReadyAsync(), 20000);
    return { engine: candidate, stage: world, name: gpu ? 'WebGPU' : `WebGL ${numbers.format(candidate.webGLVersion)}` };
  } catch (error) { candidate?.dispose(); throw error; }
}
async function initialize() {
  try {
    const result = await chooseBackend({ preference, supported: () => deadline(WebGPUEngine.IsSupportedAsync, 5000),
      webgpu: () => createRenderer(true), webgl: () => createRenderer(false) });
    engine = result.engine; stage = result.stage;
    $('backend').textContent = result.name + (result.fallback ? ' · запасной' : '');
    document.body.dataset.backend = result.name.startsWith('WebGPU') ? 'webgpu' : 'webgl';
    engine.onContextLostObservable.add(() => { pause('Графика прервана. Перезагрузи прототип или выбери WebGL.'); ready = false; syncControls(); $('reload').hidden = false; });
    engine.runRenderLoop(() => {
      if (document.hidden) return;
      const before = transport.state; transport.update(); if (before !== transport.state) syncControls();
      const time = transport.position, playing = transport.state === 'playing';
      const feedback = stage.update(time, playing, energy, $('reduced').checked);
      stage.scene.render();
      $('clock').textContent = clock(time);
      $('timeline-fill').style.transform = `scaleX(${selected ? Math.min(1, time / selected.duration) : 0})`;
      $('judgment').textContent = playing && feedback.hitAge >= 0 && feedback.hitAge < .2 ? 'PERFECT' : 'АВТОДЕМО · БЕЗ РЕКОРДОВ';
      if (performance.now() - statsAt > 1000) { $('fps').textContent = `${numbers.format(engine.getFps())} FPS · LAB 0.1`; statsAt = performance.now(); }
      if (transport.state === 'ended') $('status').textContent = 'Демо завершено. Можно запустить снова или выбрать другую песню.';
    });
    tracks = (await json('../assets/catalog.json')).filter(song => !song.tutorial);
    for (const song of tracks) { const option = document.createElement('option'); option.value = song.id; option.textContent = song.title; $('song').append(option); }
    $('song').disabled = false;
    const first = tracks.find(song => song.id === 'warehouse-echoes-v1') || tracks[0]; $('song').value = first.id;
    await loadTrack(first);
  } catch {
    $('backend').textContent = 'Графика недоступна'; $('status').textContent = 'Не удалось создать сцену. Попробуй WebGL в параметрах или вернись в рабочую игру.';
    $('reload').hidden = false;
  }
}
void initialize();

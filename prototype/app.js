import { Engine, WebGPUEngine } from '@babylonjs/core';
import { MediaSongAudio } from '../dist/media-audio.js';
import { createScene } from './scene.js';
import { chooseBackend } from './backend.js';
import { Transport } from './transport.js';
import { PlaySession } from './session.js';
import { TRAVEL } from '../dist/engine.js';

const $ = id => document.getElementById(id);
const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 });
const seconds = new Intl.NumberFormat('ru-RU', { minimumIntegerDigits: 2, useGrouping: false });
const clock = time => `${numbers.format(Math.floor(time / 60))}:${seconds.format(Math.floor(time % 60))}`;
const player = new MediaSongAudio(), transport = new Transport(player);
let stage, engine, tracks, selected, chart = [], trackRequest = 0, energy = true, ready = false, statsAt = 0, session;
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
  if (open) pause('Пауза. Выбери параметры или продолжи игру.');
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
  $('play').textContent = playing ? 'Ⅱ Пауза' : transport.state === 'paused' && transport.offset > 0 ? '▶ Продолжить' : session?.demo ? '▶ Смотреть' : '▶ Играть';
  document.body.dataset.running = String(playing);
  $('hit-zones').hidden = !ready || session?.demo || transport.state !== 'playing';
  $('mode').disabled = !ready; $('difficulty').disabled = !ready;
  layout();
}
function pause(message) {
  transport.pause(); session?.suspend(); syncControls();
  if (message) $('status').textContent = message;
}
function start(music) {
  if (!ready || document.hidden) return;
  if (['playing', 'starting'].includes(transport.state)) { pause('Пауза. Продолжение — только по нажатию.'); return; }
  if (transport.state === 'ended') resetRun();
  $('options').hidden = true; $('options-toggle').setAttribute('aria-expanded', 'false');
  session.resume(transport.position);
  // Native play runs synchronously here, before timers or await, using the unchanged compatible player.
  const run = session;
  const playing = transport.play(music);
  syncControls(); $('status').textContent = session.demo ? 'Автодемо · без рекордов' : 'Нажимай кольца в такт. Ноты со шлейфом удерживай.';
  playing.then(syncControls).catch(() => { if (session !== run) return; $('status').textContent = 'Звук не запустился. Нажми «Продолжить» ещё раз.'; syncControls(); });
}
$('play').onclick = () => start(transport.state === 'paused' && transport.offset > 0 ? transport.music : true);
$('silent').onclick = () => start(false);
function resetRun() {
  transport.reset();
  session = new PlaySession(chart, { demo: $('mode').value === 'demo', onHit: (note, time) => stage.hit(note.lane, time) });
  stage.setChart(session.game.notes, TRAVEL[$('difficulty').value]);
  $('result').hidden = true;
  $('track-meta').textContent = session.demo ? 'Автодемо · без рекордов' : `${$('difficulty').selectedOptions[0].textContent} · без сохранения`;
  syncControls(); $('status').textContent = session.demo ? 'Автодемо готово.' : 'Нажимай кольца в такт. Ноты со шлейфом удерживай.';
}
$('restart').onclick = resetRun;
$('mode').onchange = resetRun;
$('difficulty').onchange = () => { void loadTrack(selected); };
$('reload').onclick = () => location.reload();
function suspend() { if (['playing', 'starting'].includes(transport.state)) pause('Пауза после ухода из приложения. Нажми «Продолжить».'); }
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', () => { suspend(); });
player.oninterrupt = () => { if (['playing', 'starting'].includes(transport.state)) pause('Воспроизведение прервано. Нажми «Продолжить».'); };
function layout() {
  if (!stage) return;
  stage.resize();
  const points = stage.targets(), width = Math.min(150, points[1].x - points[0].x);
  document.querySelectorAll('[data-lane]').forEach((button, lane) => {
    button.style.left = `${points[lane].x}px`; button.style.top = `${points[lane].y}px`;
    button.style.width = `${width}px`;
  });
}
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
const canInput = () => ready && !session.demo && transport.state === 'playing' && !player.waiting && !document.hidden;
function press(lane, source) {
  if (!canInput() || !$('options').hidden) return;
  session.press(lane, source, transport.position);
  renderScore();
}
function release(source) {
  if (session && transport.state === 'playing') session.release(source, transport.position);
}
for (const button of document.querySelectorAll('[data-lane]')) {
  button.onpointerdown = event => {
    if (event.button !== 0 || !canInput()) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId);
    press(Number(button.dataset.lane), `pointer:${event.pointerId}`);
  };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = event => release(`pointer:${event.pointerId}`);
  // Keyboard / assistive activation only; a pointer click must not score twice.
  button.onclick = event => {
    if (event.detail !== 0) return;
    press(Number(button.dataset.lane), 'accessible'); release('accessible');
  };
  button.oncontextmenu = event => event.preventDefault();
}
const keyLanes = { KeyD: 0, KeyF: 1, KeyJ: 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 };
window.addEventListener('keydown', event => {
  if (event.target.closest?.('select, input, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  const lane = keyLanes[event.code];
  if (lane === undefined || !canInput()) return;
  event.preventDefault(); if (!event.repeat) press(lane, `key:${event.code}`);
});
window.addEventListener('keyup', event => release(`key:${event.code}`));
// Lost key-up events must not leave a lane held; blur does NOT pause the music.
window.addEventListener('blur', () => {
  for (const source of session?.inputs.keys() || []) if (source.startsWith('key:')) release(source);
});
function renderScore() {
  if (!session) return;
  const game = session.game;
  $('score').textContent = numbers.format(game.score);
  $('combo').textContent = numbers.format(game.streak);
  $('accuracy').textContent = percent.format(game.accuracy / 100);
  const feedback = game.feedback, age = feedback ? transport.position - feedback.time : Infinity;
  $('judgment').textContent = feedback && age >= 0 && age < .65 ? ({ MISS: 'МИМО', 'HOLD LOST': 'УДЕРЖАНИЕ СОРВАНО' }[feedback.text] || feedback.text) : session.demo ? 'АВТОДЕМО' : 'ПОЙМАЙ РИТМ';
  $('judgment').dataset.error = String(feedback && ['MISS', 'HOLD LOST'].includes(feedback.text) && age < .65);
  for (const button of document.querySelectorAll('[data-lane]')) button.dataset.held = String(game.held[Number(button.dataset.lane)]);
}
function finishRun() {
  const result = session.finish();
  $('result').hidden = false;
  $('result').textContent = `${session.demo ? 'Автодемо' : 'Трек пройден'} · ${numbers.format(result.score)} очков · ${percent.format(result.accuracy / 100)}\nКомбо: ${numbers.format(result.bestStreak)} · Пропуски: ${numbers.format(result.misses)} · Лишние нажатия: ${numbers.format(result.strays)} · Сорванные удержания: ${numbers.format(result.brokenHolds)}`;
  $('status').textContent = 'Результат не сохраняется. Можно сыграть ещё раз.';
}

async function json(path) { const response = await fetch(path); if (!response.ok) throw new Error('network'); return response.json(); }
async function loadTrack(song) {
  const id = ++trackRequest; selected = song; ready = false; transport.reset(); session?.suspend(); player.dispose(); syncControls();
  $('result').hidden = true; $('reload').hidden = true;
  session = null; stage.setChart([]); $('score').textContent = numbers.format(0); $('combo').textContent = numbers.format(0);
  $('accuracy').textContent = '—'; $('judgment').textContent = 'ЗАГРУЗКА';
  $('status').textContent = 'Загружаем музыку и карту…';
  $('cover').src = `assets/tracks/${song.id}/artwork.jpg`; $('track-name').textContent = song.title;
  try {
    const [notes, audio] = await Promise.all([json(`assets/tracks/${song.id}/${$('difficulty').value}.json`), player.load(`assets/tracks/${song.id}/audio.m4a`, song.duration)]);
    if (id !== trackRequest) return;
    chart = notes; transport.setTrack(audio); ready = true; resetRun();
    $('status').textContent = 'Нажимай кольца в такт, ноты со шлейфом удерживай. Звук — после «Играть».';
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
      const before = transport.state; transport.update();
      if (before !== transport.state) {
        if (transport.state === 'ended') finishRun();
        else if (transport.state === 'paused') { session?.suspend(); $('status').textContent = 'Пауза. Нажми «Продолжить».'; }
        syncControls();
      }
      const time = transport.position, playing = transport.state === 'playing';
      if (playing) session?.advance(time);
      stage.update(time, playing, energy, $('reduced').checked);
      stage.scene.render();
      $('clock').textContent = clock(time);
      $('timeline-fill').style.transform = `scaleX(${selected ? Math.min(1, time / selected.duration) : 0})`;
      renderScore();
      if (performance.now() - statsAt > 1000) { $('fps').textContent = `${numbers.format(engine.getFps())} FPS · LAB 0.3`; statsAt = performance.now(); }

    });
    tracks = (await json('assets/catalog.json')).filter(song => !song.tutorial);
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

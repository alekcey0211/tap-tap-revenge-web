import { PhraseProgress } from './phrase-progress.js';
import { PULSE_CHARTS } from './phrase-charts.js';
import { renderPulse, pulseSummary } from './pulse-view.js';
import { OfflineView } from './offline-view.js?v=0.4.0';
import { Game } from './engine.js';
import { SongAudio } from './audio.js?v=0.3.1';
import { MediaSongAudio } from './media-audio.js?v=0.3.1';
import { Renderer } from './renderer.js?v=0.5.1';

import { Temporal } from './temporal.js';
import { formatNumber, formatPercent, formatSigned, formatTime, formatCount } from './format.js?v=0.3.0';
import { DEFAULT_SETTINGS, loadSave, saveSettings as writeSettings, recordAttempt, currentRecords, importProgress } from './storage.js?v=0.5.0';
import { ProgressView } from './progress.js?v=0.5.0';

const $ = id => document.getElementById(id);
const APP_VERSION = '0.5.1';
if ($('app-version')) $('app-version').textContent = `v${APP_VERSION}`;
$('pulse-target').textContent = formatPercent(90);
const LEVELS = { 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' };
const webAudio = new SongAudio(), mediaAudio = new MediaSongAudio();
let audio = webAudio, pendingStart = null;
let catalog, selected, level = '1', renderer, game, buffer, pulse;
let state = 'boot', demo = false, run = null, loadingRun = null, requestId = 0, pausePosition = 0;
let resumeGrace = -Infinity, demoActions = [], demoIndex = 0, calibrationOffset = null;
const inputs = [new Set(), new Set(), new Set()];
let browserStorage;
try { browserStorage = localStorage; } catch { /* Storage access itself can be denied. */ }
const loaded = loadSave(browserStorage, { ...DEFAULT_SETTINGS, motion: matchMedia('(prefers-reduced-motion: reduce)').matches });
const settings = loaded.settings;
let progress = loaded.progress, records = currentRecords(progress), saveWarning = loaded.warning, storageWritable = loaded.writable;
let progressView;
const offlineView = new OfflineView();
function saveSettings() {
  if (storageWritable) {
    try { writeSettings(browserStorage, settings, progress); }
    catch { storageWritable = false; saveWarning = 'Браузер не сохраняет прогресс. Перед закрытием страницы сохрани его в файл.'; }
  }
  if (saveWarning) $('status').textContent = saveWarning;
}
function artwork(song) { return song.tutorial ? 'assets/ui/logo.png' : `assets/tracks/${song.id}/artwork.png`; }
function show(screen) {
  for (const name of ['library', 'game-screen', 'results', 'preparation', 'progress-screen']) $(name).hidden = name !== screen;
  document.body.dataset.screen = screen;
  $('appbar').hidden = screen === 'game-screen';
  $('home').hidden = !['results', 'progress-screen'].includes(screen);
  $('settings-open').hidden = ['preparation', 'progress-screen'].includes(screen);
  $('screen-title').textContent = screen === 'progress-screen' ? 'Прогресс' : screen === 'results' ? 'Результат' : screen === 'preparation' ? 'Подготовка трека' : 'Музыка';
  $('status').textContent = '';
}
function showLibrary() {
  requestId++; progressView?.close();
  audio.stop(); mediaAudio.dispose(); pendingStart = null; state = 'library'; inputs.forEach(input => input.clear());
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  show('library'); refresh(); if (saveWarning) $('status').textContent = saveWarning; $('play').focus({ preventScroll: true });
}
function refresh() {
  if (!selected) return;
  offlineView.select(selected);
  $('hero-art').src = artwork(selected);
  $('hero-title').textContent = selected.title;
  $('hero-artist').textContent = selected.artist;
  $('hero-meta').textContent = `${formatTime(selected.duration)} · ${selected.genre}`;
  $('tracks').replaceChildren();
  for (const song of catalog.filter(song => !song.tutorial)) {
    const button = document.createElement('button'); button.className = 'track';
    button.setAttribute('aria-pressed', String(song.id === selected.id));
    const img = document.createElement('img'); img.src = artwork(song); img.alt = '';
    const text = document.createElement('span'); const title = document.createElement('strong'); const artist = document.createElement('small');
    title.textContent = song.title; artist.textContent = song.artist; text.append(title, artist);
    const duration = document.createElement('em'); duration.textContent = formatTime(song.duration);
    button.append(img, text, duration);
    button.onclick = () => { selected = song; if (!song.levels[level]) level = '1'; refresh(); $('play').focus({ preventScroll: true }); };
    $('tracks').append(button);
  }
  $('difficulties').replaceChildren();
  for (const [value, name] of Object.entries(LEVELS)) {
    const button = document.createElement('button'); button.textContent = name;
    button.setAttribute('aria-pressed', String(level === value)); button.disabled = !selected.levels[value];
    button.onclick = () => { level = value; refresh(); $('difficulties').children[Number(value) - 1].focus({ preventScroll: true }); }; $('difficulties').append(button);
  }
  $('note-count').textContent = formatCount(selected.levels[level].notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' });
  const best = records[`${selected.id}:${level}`];
  $('record').textContent = Number.isFinite(best?.score) && Number.isFinite(best?.accuracy) ? `Рекорд ${formatNumber(best.score)} · ${formatPercent(best.accuracy)}` : 'Рекорд ещё не установлен';
  $('play').disabled = false; $('demo').disabled = false; $('calibration').disabled = false;
  $('settings-calibration').disabled = false; $('progress-open').disabled = false;
}
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}.`);
  return response.json();
}
function preparation(song, difficulty, error = false) {
  show('preparation');
  $('preparation').dataset.error = String(error);
  $('preparation-track').hidden = !song;
  if (song) {
    $('preparation-art').src = artwork(song);
    $('preparation-title').textContent = song.title;
    $('preparation-artist').textContent = `${song.artist} · ${LEVELS[difficulty]}`;
  }
  $('loading-indicator').hidden = error;
  $('error-icon').hidden = !error;
  $('load-retry').hidden = !error;
  $('load-begin').hidden = true;
  $('load-cancel').hidden = !catalog;
  $('preparation-heading').textContent = error
    ? (song ? 'Не удалось загрузить трек' : 'Не удалось загрузить игру')
    : (song ? 'Загружаем трек…' : 'Загружаем музыку…');
  $('preparation-description').textContent = error
    ? (song ? 'Попробуй ещё раз или выбери другой трек.' : 'Попробуй загрузить игру ещё раз.')
    : (song ? 'Игра начнётся после загрузки.' : 'Готовим список треков.');
  if (error) $('load-retry').focus({ preventScroll: true });
}
async function start(isDemo = false) {
  if (document.hidden || !selected || ['loading', 'ready', 'starting'].includes(state)) return;
  const id = ++requestId;
  const song = selected, difficulty = level;
  loadingRun = { song, level: difficulty, demo: isDemo };
  audio.stop(); mediaAudio.dispose(); pendingStart = null;
  audio = settings.compatibleAudio ? mediaAudio : webAudio;
  $('play').disabled = true; state = 'loading'; preparation(song, difficulty);
  $('load-cancel').focus({ preventScroll: true });
  try {
    // Web Audio unlock stays in the original gesture. Native playback gets its own button after loading.
    if (audio === webAudio) await audio.unlock();
    if (id !== requestId) return;
    const [chart, loadedBuffer] = await Promise.all([
      json(`assets/tracks/${song.id}/${difficulty}.json`), audio.load(`assets/tracks/${song.id}/audio.m4a`, song.duration),
    ]);
    if (id !== requestId) return;
    pendingStart = { id, chart, loadedBuffer, song, difficulty, isDemo };
    if (audio === mediaAudio) {
      state = 'ready'; $('loading-indicator').hidden = true; $('load-begin').hidden = false;
      $('preparation-heading').textContent = 'Трек готов';
      $('preparation-description').textContent = 'Совместимый звук. Громкость — кнопками телефона. После нажатия музыка начнётся сразу, без отсчёта.';
      $('load-begin').focus({ preventScroll: true });
    } else await beginRun();
  } catch {
    if (id !== requestId) return;
    state = 'load-error'; audio.stop(); preparation(song, difficulty, true);
    $('preparation-description').textContent = 'Попробуй ещё раз или выбери другой трек. Без сети доступны только заранее скачанные треки.';
    if (globalThis.navigator?.onLine === false) $('preparation-description').textContent = 'Не удалось запустить трек без сети. Проверь скачивание в разделе «Установка и офлайн». Если трек скачан, попробуй ещё раз или включи «Совместимый звук».';
  } finally { if (id === requestId) $('play').disabled = false; }
}
async function beginRun() {
  if (document.hidden || !pendingStart || !['loading', 'ready'].includes(state)) return;
  const { id, chart, loadedBuffer, song, difficulty, isDemo } = pendingStart;
  pendingStart = null; state = 'starting'; $('load-begin').hidden = true;
  $('loading-indicator').hidden = false;
  $('preparation-heading').textContent = 'Включаем музыку…';
  try {
    renderer.effects.reset();
    game = new Game(chart); buffer = loadedBuffer; demo = isDemo; run = { song, level: difficulty };
    pulse = !demo && !song.tutorial && PULSE_CHARTS[song.id] ? new PhraseProgress(game.notes, PULSE_CHARTS[song.id]) : null;
    renderPulse(pulse?.view(0) ?? null);
    inputs.forEach(input => input.clear());
    demoActions = chart.flatMap(note => [{ time: note.time, lane: note.lane, down: true },
      { time: note.time + (note.duration || 0.035), lane: note.lane, down: false }])
      .sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));
    demoIndex = 0; resumeGrace = -Infinity;
    audio.setVolume(settings.volume / 100);
    // Native play is invoked before the first await, directly from the ready button.
    await audio.play(buffer);
    if (id !== requestId) return;
    state = 'playing';
    show('game-screen'); $('now-title').textContent = song.title; $('now-artist').textContent = song.artist;
    $('now-art').src = artwork(song);
    $('pause-track').textContent = `${song.title} · ${LEVELS[difficulty]}`;
    $('mode-label').textContent = demo ? 'ДЕМО · без рекорда' : song.tutorial ? 'КАЛИБРОВКА · без рекорда' : LEVELS[difficulty];
    $('pause').focus({ preventScroll: true });
  } catch {
    if (id !== requestId) return;
    state = 'load-error'; audio.stop(); preparation(song, difficulty, true);
    $('preparation-heading').textContent = 'Не удалось включить музыку';
  }
}
function gameTime() { return audio.position - settings.offset / 1000; }
function pause(openDialog = true) {
  if (state !== 'playing' && state !== 'resuming') return;
  if (state === 'resuming') requestId++;
  pausePosition = audio.pause();
  state = 'paused'; $('resume').disabled = false;
  game.held.fill(false); inputs.forEach(input => input.clear());
  $('pause-error').hidden = true;
  if (openDialog && !$('pause-dialog').open) $('pause-dialog').showModal();
}
async function resume() {
  if (document.hidden || state !== 'paused') return;
  const id = ++requestId;
  state = 'resuming'; $('resume').disabled = true;
  try {
    if (audio === webAudio) await audio.unlock();
    if (state !== 'resuming' || id !== requestId) return;
    await audio.play(buffer, pausePosition, 2);
    if (state !== 'resuming' || id !== requestId) return;
    $('pause-dialog').close(); state = 'playing';
    resumeGrace = pausePosition - settings.offset / 1000 + .3;
    $('pause').focus({ preventScroll: true });
  } catch {
    if (id !== requestId) return;
    audio.stop(); state = 'paused';
    $('pause-error').textContent = 'Не удалось включить звук. Нажми «Продолжить», чтобы попробовать ещё раз.';
    $('pause-error').hidden = false;
  } finally { if (id === requestId) $('resume').disabled = false; }
}
function down(lane, source) {
  if (state !== 'playing' || demo || audio.countdown > 0 || audio.waiting) return;
  const wasHeld = inputs[lane].size > 0; inputs[lane].add(source);
  if (!wasHeld) {
    const time = gameTime();
    renderer.effects.recordHit(game.press(lane, time), time, game.multiplier(time));
    pulse?.recordInput(time, game.strays);
  }
}
function up(lane, source) {
  const had = inputs[lane].delete(source);
  if (had && inputs[lane].size === 0 && state === 'playing' && !demo && audio.countdown === 0) game.release(lane, gameTime());
}
function finish() {
  audio.stop(); state = 'results'; show('results');
  const result = game.finish();
  const pulseResult = pulse?.finish();
  $('result-pulse').hidden = !pulseResult;
  $('result-pulse').textContent = pulseResult ? pulseSummary(pulseResult) : '';
  const key = `${run.song.id}:${run.level}`;
  const previousScore = records[key]?.score;
  const isRecord = !demo && !run.song.tutorial && (!records[key] || result.score > records[key].score);
  if (!demo && !run.song.tutorial) {
    progress = recordAttempt(progress, { songId: run.song.id, level: run.level, result, pulse: pulseResult,
      playedAt: Temporal.Now.instant().toString(), id: crypto.randomUUID() });
    records = currentRecords(progress); saveSettings();
  }
  $('result-art').src = artwork(run.song); $('result-heading').textContent = run.song.title;
  $('result-artist').textContent = `${run.song.artist} · ${LEVELS[run.level]}`;
  $('score-caption').textContent = demo ? 'ДЕМО · БЕЗ РЕКОРДА' : run.song.tutorial ? 'КАЛИБРОВКА · БЕЗ РЕКОРДА' : isRecord ? 'НОВЫЙ РЕКОРД' : 'ТВОЙ РЕЗУЛЬТАТ';
  $('score-caption').dataset.record = String(isRecord);
  $('record-delta').hidden = !isRecord || !Number.isFinite(previousScore);
  $('record-delta').textContent = isRecord && Number.isFinite(previousScore) ? `${formatSigned(result.score - previousScore)} к рекорду` : '';
  $('final-score').textContent = formatNumber(result.score);
  $('result-rating').textContent = demo ? 'ДЕМО ЗАВЕРШЕНО' : run.song.tutorial ? 'КАЛИБРОВКА' : result.misses === 0 && result.brokenHolds === 0 && result.strays === 0 ? 'FULL COMBO' : 'ТРЕК ПРОЙДЕН';
  $('result-accuracy').textContent = formatPercent(result.accuracy);
  $('result-combo').textContent = formatNumber(result.bestStreak);
  $('result-misses').textContent = `Пропуски: ${formatNumber(result.misses)}`;
  document.querySelector('.result-details').open = false;
  $('result-stats').replaceChildren();
  for (const [label, value] of [['Точность', formatPercent(result.accuracy)], ['Лучшая серия', formatNumber(result.bestStreak)],
    ['Попадания / пропуски', `${formatNumber(result.hits)} / ${formatNumber(result.misses)}`], ['Perfect / Great', `${formatNumber(result.counts.PERFECT)} / ${formatNumber(result.counts.GREAT)}`],
    ['Сорванные удержания', formatNumber(result.brokenHolds)], ['Лишние нажатия', formatNumber(result.strays)]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value;
    $('result-stats').append(dt, dd);
  }
  $('calibration-result').hidden = !run.song.tutorial; $('apply-calibration').hidden = true;
  if (run.song.tutorial && !demo) {
    const errors = [...game.errors].sort((a, b) => a - b);
    if (errors.length >= 8) {
      const median = errors[Math.floor(errors.length / 2)];
      calibrationOffset = Math.max(-500, Math.min(500, Math.round((settings.offset + median * 1000) / 5) * 5));
      $('calibration-result').textContent = `По ${formatNumber(errors.length)} попаданиям: поправка ${formatNumber(calibrationOffset)} мс. Если играл по звуку метронома, можно применить её.`;
      $('apply-calibration').hidden = false;
    } else $('calibration-result').textContent = 'Для оценки задержки нужно хотя бы 8 попаданий. Нажимай среднюю дорожку или F по звуку метронома.';
  }
  $('retry').focus({ preventScroll: true });
}
function text(id, value) {
  const node = $(id);
  if (node.textContent !== String(value)) node.textContent = value;
}
function interruptPlayback() {
  if (!['playing', 'resuming'].includes(state)) return;
  pause();
  $('pause-error').textContent = 'Воспроизведение остановилось. Нажми «Продолжить», чтобы включить музыку.';
  $('pause-error').hidden = false;
}
webAudio.oninterrupt = mediaAudio.oninterrupt = interruptPlayback;

function frame() {
  if (state === 'playing' && audio.interrupted) interruptPlayback();
  if (game && ['playing', 'paused', 'resuming'].includes(state)) {
    const position = state === 'playing' ? audio.position : pausePosition;
    const time = position - settings.offset / 1000, countdown = state === 'playing' ? audio.countdown : 0;
    if (state === 'playing' && countdown === 0 && !audio.waiting) {
      if (demo) {
        while (demoIndex < demoActions.length && demoActions[demoIndex].time <= time) {
          const action = demoActions[demoIndex++];
          if (action.down) renderer.effects.recordHit(game.press(action.lane, action.time), action.time, game.multiplier(action.time));
          else game.release(action.lane, action.time);
        }
        if (game.revengeReady) game.activateRevenge(time);
      } else if (time >= resumeGrace && resumeGrace !== -Infinity) {
        for (let lane = 0; lane < 3; lane++) if (!game.held[lane]) game.release(lane, time);
        resumeGrace = -Infinity;
      }
      game.update(time);
      pulse?.advance(time);
    }
    renderPulse(pulse?.view(time) ?? null);
    renderer.render(game, time, run.level, buffer.duration, countdown, settings.motion);
    text('time', `${formatTime(position)} / ${formatTime(buffer.duration)}`);
    text('live-score', formatNumber(game.score));
    text('live-combo', formatNumber(game.streak));
    const multiplier = game.multiplier(time);
    text('multiplier', `×${formatNumber(multiplier)}`);
    $('multiplier').dataset.level = String(multiplier);
    $('song-progress').value = Math.min(1, Math.max(0, position / buffer.duration));
    $('revenge-progress').value = time < game.revengeUntil ? Math.max(0, (game.revengeUntil - time) / 15 * 50) : Math.min(50, game.streak);
    $('revenge').disabled = !game.revengeReady || demo || countdown > 0 || Boolean(audio.waiting) || state !== 'playing';
    text('revenge-label', time < game.revengeUntil ? `×${formatNumber(8)} · ${formatNumber(Math.ceil(game.revengeUntil - time))} с` : `REVENGE ×${formatNumber(8)}`);
    $('audio-status').hidden = audio !== mediaAudio;
    text('audio-status', audio.waiting ? 'Ожидаем звук…' : 'Совместимый звук');
    text('game-stats', `Очки: ${formatNumber(game.score)}; попадания: ${formatNumber(game.hits)}; пропуски: ${formatNumber(game.misses)}`);
    if (state === 'playing' && audio.position > buffer.duration + Math.max(0, settings.offset / 1000) + .3) finish();
  }
  requestAnimationFrame(frame);
}

$('load-begin').onclick = beginRun;
$('play').onclick = () => start(false);
$('demo').onclick = () => start(true);
$('home').onclick = showLibrary;
$('pause').onclick = () => pause();
$('resume').onclick = resume;
$('restart').onclick = () => { if (document.hidden) return; $('pause-dialog').close(); selected = run.song; level = run.level; return start(demo); };
$('quit').onclick = showLibrary;
$('retry').onclick = () => { selected = run.song; level = run.level; return start(demo); };
$('back-to-library').onclick = showLibrary;
$('revenge').onclick = () => { if (state === 'playing' && !demo && !audio.waiting && audio.countdown === 0) game.activateRevenge(gameTime()); };
function selectCalibration() {
  showLibrary();
  selected = catalog.find(song => song.tutorial); level = '1'; refresh();
  $('status').textContent = 'Нажимай среднюю дорожку или F в такт метроному. Первые ноты начинаются на 12-й секунде.';
}
$('calibration').onclick = selectCalibration;
$('settings-calibration').onclick = selectCalibration;
$('load-cancel').onclick = showLibrary;
$('load-retry').onclick = () => {
  if (!catalog) return initialize();
  selected = loadingRun.song; level = loadingRun.level;
  return start(loadingRun.demo);
};
$('apply-calibration').onclick = () => { settings.offset = calibrationOffset; $('offset').value = calibrationOffset; saveSettings(); $('apply-calibration').hidden = true; $('calibration-result').textContent = `Применена поправка ${formatNumber(calibrationOffset)} мс.`; };
$('settings-open').onclick = () => { pause(false); $('settings-dialog').showModal(); };
function closeSettings() { $('settings-dialog').close(); if (state === 'paused') $('pause-dialog').showModal(); }
$('settings-close').onclick = closeSettings;
$('settings-dialog').oncancel = event => { event.preventDefault(); closeSettings(); };
$('pause-dialog').oncancel = event => { event.preventDefault(); resume(); };
$('about-open').onclick = () => { pause(false); $('about-dialog').showModal(); };
function closeAbout() { $('about-dialog').close(); if (state === 'paused') $('pause-dialog').showModal(); }
$('about-close').onclick = closeAbout;
$('about-dialog').oncancel = event => { event.preventDefault(); closeAbout(); };
function syncSettings() {
  $('compatible-audio').checked = settings.compatibleAudio;
  $('volume').disabled = settings.compatibleAudio;
  $('volume').value = settings.volume; $('volume-value').value = formatPercent(settings.volume);
  $('offset').value = settings.offset; $('motion').checked = settings.motion;
  document.body.dataset.reducedMotion = String(settings.motion);
}
syncSettings();
$('compatible-audio').onchange = event => {
  settings.compatibleAudio = event.target.checked;
  $('volume').disabled = settings.compatibleAudio;
  saveSettings();
};
$('volume').oninput = event => { settings.volume = Number(event.target.value); $('volume-value').value = formatPercent(settings.volume); audio.setVolume(settings.volume / 100); saveSettings(); };
$('offset').onchange = event => { const value = Number(event.target.value); settings.offset = Number.isFinite(value) ? Math.max(-500, Math.min(500, value)) : 0; event.target.value = settings.offset; saveSettings(); };
document.body.dataset.reducedMotion = String(settings.motion);
$('motion').onchange = event => {
  settings.motion = event.target.checked;
  document.body.dataset.reducedMotion = String(settings.motion);
  saveSettings();
};
for (const button of document.querySelectorAll('[data-lane]')) {
  const lane = Number(button.dataset.lane);
  button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); down(lane, `p${event.pointerId}`); };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = event => up(lane, `p${event.pointerId}`);
  button.onclick = event => { if (event.detail === 0) { down(lane, 'accessible'); up(lane, 'accessible'); } };
}
const keys = { KeyD: 0, KeyF: 1, KeyJ: 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 };
window.addEventListener('keydown', event => {
  if (event.repeat || document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (state !== 'playing') return;
  if (event.code in keys) { event.preventDefault(); down(keys[event.code], event.code); }
  if (event.code === 'Escape') { event.preventDefault(); pause(); }
  if (event.code === 'Space') { event.preventDefault(); if (!demo && !audio.waiting && audio.countdown === 0) game.activateRevenge(gameTime()); }
});
window.addEventListener('keyup', event => { if (event.code in keys) up(keys[event.code], event.code); });
function leavePage() {
  if (['loading', 'ready', 'starting'].includes(state)) showLibrary(); else pause();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) leavePage(); });
window.addEventListener('pagehide', leavePage);
window.addEventListener('blur', leavePage);

progressView = new ProgressView({
  getProgress: () => progress, getSettings: () => settings, getWarning: () => saveWarning,
  onSelect: (song, difficulty) => { selected = song; level = difficulty; showLibrary(); },
  onImport: text => {
    const snapshot = importProgress(browserStorage, text);
    progress = snapshot.progress; records = currentRecords(progress); Object.assign(settings, snapshot.settings);
    storageWritable = true; saveWarning = ''; syncSettings();
  },
});
$('progress-open').onclick = () => {
  audio.stop(); state = 'progress'; show('progress-screen'); progressView.open(catalog, selected, level);
};

async function initialize() {
  const id = ++requestId;
  state = 'boot'; preparation(null);
  try {
    const [songs, paths] = await Promise.all([json('assets/catalog.json'), json('assets/paths.json')]);
    if (id !== requestId) return;
    catalog = songs; selected = songs.find(song => !song.tutorial);
    const tracks = catalog.filter(song => !song.tutorial);
    $('catalog-count').textContent = `${formatCount(tracks.length, { one: 'трек', few: 'трека', many: 'треков', other: 'трека' })} · ${formatCount(tracks.reduce((total, song) => total + Object.keys(song.levels).length, 0), { one: 'карта', few: 'карты', many: 'карт', other: 'карты' })}`;
    renderer = new Renderer($('canvas'), paths);
    state = 'library'; show('library'); refresh(); if (saveWarning) $('status').textContent = saveWarning; requestAnimationFrame(frame);
  } catch {
    if (id !== requestId) return;
    state = 'boot-error'; preparation(null, null, true);
  }
}
await initialize();
void offlineView.initialize();

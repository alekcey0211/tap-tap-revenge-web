import { artwork } from './artwork.js';
import { PhraseProgress } from './phrase-progress.js?v=0.8.2';
import { PULSE_CHARTS, PULSE_COUNTS } from './phrase-charts.js?v=0.8.2';
import { choosePulseZones } from './pulse-zones.js?v=0.8.2';
import { renderPulse, renderPulseBreakdown } from './pulse-view.js?v=0.8.2';
import { OfflineView } from './offline-view.js?v=0.8.0';
import { Game, TRAVEL } from './engine.js';
import { SongAudio } from './audio.js?v=0.5.3';
import { MediaSongAudio } from './media-audio.js?v=0.3.1';
import { Renderer } from './renderer.js?v=0.8.3';

import { Temporal } from './temporal.js';
import { formatNumber, formatPercent, formatSigned, formatTime, formatCount } from './format.js?v=0.3.0';
import { DEFAULT_SETTINGS, loadSave, saveSettings as writeSettings, recordAttempt, currentRecords, importProgress } from './storage.js?v=0.8.2';
import { ProgressView } from './progress.js?v=0.8.2';

const $ = id => document.getElementById(id);
const APP_VERSION = '0.8.4';
if ($('app-version')) $('app-version').textContent = `v${APP_VERSION}`;
$('settings-version').textContent = `v${APP_VERSION}`;
$('pulse-target').textContent = formatPercent(90);
const LEVELS = { 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' };
const webAudio = new SongAudio(), mediaAudio = new MediaSongAudio();
let audio = webAudio, readyTrack = null, preparedAudio = null, previewSize = '';
let catalog, selected, level = '1', renderer, previewRenderer, previewGame, game, buffer, pulse;
let state = 'boot', demo = false, run = null, requestId = 0, pausePosition = 0;
let resumeGrace = -Infinity, demoActions = [], demoIndex = 0, calibrationOffset = null;
const inputs = [new Set(), new Set(), new Set()];
let browserStorage;
try { browserStorage = localStorage; } catch { /* Storage access itself can be denied. */ }
const loaded = loadSave(browserStorage, { ...DEFAULT_SETTINGS, motion: matchMedia('(prefers-reduced-motion: reduce)').matches });
const settings = loaded.settings;
let progress = loaded.progress, records = currentRecords(progress), saveWarning = loaded.warning, storageWritable = loaded.writable;
let progressView;
const pageStack = [];
const screenTitles = { menu: 'Главное меню', library: 'Музыка', 'song-screen': 'Песня', 'game-screen': 'Игра', results: 'Результат',
  preparation: 'Подготовка трека', 'progress-screen': 'Прогресс', 'settings-screen': 'Настройки',
  'about-screen': 'Об игре', 'offline-screen': 'Скачать трек', 'pause-screen': 'Пауза', 'import-screen': 'Восстановление' };
const offlineView = new OfflineView({ onOpen: () => openPage('offline-screen', 'screen-title', $('offline-open')), onClose: backPage });
function saveSettings() {
  if (storageWritable) {
    try { writeSettings(browserStorage, settings, progress); }
    catch { storageWritable = false; saveWarning = 'Браузер не сохраняет прогресс. Перед закрытием страницы сохрани его в файл.'; }
  }
  if (saveWarning) $('status').textContent = saveWarning;
}
function show(screen) {
  $('song-screen').dataset.departing = 'false';
  $('song-backdrop').hidden = screen !== 'song-screen';
  for (const name of Object.keys(screenTitles)) {
    $(name).hidden = name !== screen; $(name).inert = name !== screen;
  }
  document.body.dataset.screen = screen;
  document.body.dataset.utility = String(['settings-screen', 'about-screen', 'offline-screen', 'pause-screen', 'import-screen'].includes(screen));
  $('appbar').hidden = ['menu', 'game-screen'].includes(screen);
  $('home').hidden = ['menu', 'game-screen', 'preparation', 'pause-screen'].includes(screen);
  $('home').setAttribute('aria-label', pageStack.length ? 'Назад' : screen === 'library' ? 'Главное меню' : 'К трекам');
  $('settings-open').hidden = ['game-screen', 'preparation', 'progress-screen', 'settings-screen', 'offline-screen', 'about-screen', 'import-screen'].includes(screen);
  $('screen-title').textContent = screenTitles[screen];
  $('status').textContent = '';
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!['menu', 'game-screen'].includes(screen)) $('screen-title').focus({ preventScroll: true });
}
function openPage(screen, focus = 'screen-title', returnFocus = document.activeElement) {
  if (document.hidden || document.body.dataset.screen === screen) return;
  if (['playing', 'resuming', 'starting'].includes(state)) pause();
  pageStack.push({ screen: document.body.dataset.screen, focus: returnFocus, scroll: window.scrollY });
  show(screen); $(focus).focus({ preventScroll: true });
}
function backPage() {
  const previous = pageStack.pop();
  if (!previous) return showLibrary();
  show(previous.screen);
  window.scrollTo({ top: previous.scroll, behavior: 'instant' });
  if (previous.focus?.isConnected && !previous.focus.disabled) previous.focus.focus({ preventScroll: true });
}
function showLibrary() {
  requestId++; progressView?.close();
  audio.stop(); mediaAudio.dispose(); readyTrack = null; preparedAudio = null; state = 'library'; inputs.forEach(input => input.clear());
  pageStack.length = 0;
  show('library'); refresh(); if (saveWarning) $('status').textContent = saveWarning; $('tracks').children[0]?.focus({ preventScroll: true });
}
function showMenu() {
  showLibrary(); state = 'menu'; show('menu'); $('menu-play').focus({ preventScroll: true });
}
function artistName(song) { return song.artist.replace(' · программный синтез', ''); }
function refresh() {
  if (!selected) return;
  offlineView.select(selected);
  $('hero-art').src = artwork(selected);
  $('hero-title').textContent = selected.title;
  $('hero-artist').textContent = artistName(selected);
  $('hero-meta').textContent = `${formatTime(selected.duration)} · ${selected.genre}`;
  $('tracks').replaceChildren();
  for (const song of [...catalog.filter(song => !song.tutorial)].sort((a, b) => Number(b.id === 'overdrive-v1') - Number(a.id === 'overdrive-v1') || Number(b.id === 'neon-circuit-v1') - Number(a.id === 'neon-circuit-v1'))) {
    const button = document.createElement('button'); button.className = 'track';
    button.setAttribute('aria-pressed', String(song.id === selected.id));
    const img = document.createElement('img'); img.src = artwork(song); img.alt = '';
    const text = document.createElement('span'); const title = document.createElement('strong'); const artist = document.createElement('small');
    title.textContent = song.title; artist.textContent = artistName(song); text.append(title, artist);
    const duration = document.createElement('em'); duration.textContent = formatTime(song.duration);
    button.append(img, text, duration);
    button.onclick = () => openSong(song);
    $('tracks').append(button);
  }
  $('difficulties').replaceChildren();
  for (const [value, name] of Object.entries(LEVELS)) {
    const button = document.createElement('button'); button.dataset.level = value;
    const meter = document.createElement('span'); meter.className = 'difficulty-meter'; meter.setAttribute('aria-hidden', 'true');
    for (let step = 1; step <= 4; step++) {
      const bar = document.createElement('i'); bar.dataset.lit = String(step <= Number(value)); meter.append(bar);
    }
    const check = document.createElement('span'); check.className = 'difficulty-check'; check.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong'); title.className = 'difficulty-name'; title.textContent = name;
    const count = document.createElement('span'); count.className = 'difficulty-notes';
    count.textContent = selected.levels[value] ? formatCount(selected.levels[value].notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' }) : 'Недоступно';
    button.append(meter, check, title, count);
    button.setAttribute('aria-pressed', String(level === value)); button.disabled = !selected.levels[value];
    button.onclick = () => { level = value; const loading = prepareSong(); $('difficulties').children[Number(value) - 1].focus({ preventScroll: true }); return loading; }; $('difficulties').append(button);
  }
  $('note-count').textContent = formatCount(selected.levels[level].notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' });
  const best = records[`${selected.id}:${level}`];
  $('record').textContent = Number.isFinite(best?.score) && Number.isFinite(best?.accuracy) ? `Рекорд ${formatNumber(best.score)} · ${formatPercent(best.accuracy)}` : progress.records.some(entry => entry.songId === selected.id && entry.level === level)
    ? 'Новые правила ×8. Прежний рекорд — в «Мой прогресс».' : 'Рекорд ещё не установлен';
  $('calibration').disabled = false;
  $('settings-calibration').disabled = false; $('progress-open').disabled = false;
  $('menu-play').disabled = false; $('menu-progress').disabled = false;
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
function openSong(song = selected) {
  if (document.hidden || !song) return;
  pageStack.length = 0;
  selected = song; if (!song.levels[level]) level = '1';
  show('song-screen'); $('home').focus({ preventScroll: true });
  return prepareSong();
}
async function prepareSong() {
  const id = ++requestId, song = selected, difficulty = level;
  audio.stop(); mediaAudio.dispose(); readyTrack = null;
  audio = settings.compatibleAudio ? mediaAudio : webAudio;
  const output = audio;
  state = 'song-loading'; refresh();
  $('play').disabled = true; $('demo').disabled = true; $('play-label').textContent = 'Готовим трек…';
  $('song-load-retry').hidden = true; $('song-status').textContent = 'Загружаем музыку и карту. Звук начнётся только после «Играть».';
  try {
    // Selecting a song is a gesture; Web Audio unlocks silently, native mode never creates a context.
    if (output === webAudio) await output.unlock();
    if (id !== requestId) return;
    if (!preparedAudio || preparedAudio.songId !== song.id || preparedAudio.output !== output) {
      preparedAudio = { songId: song.id, output, promise: output.load(`assets/tracks/${song.id}/audio.m4a`, song.duration) };
    }
    const [chart, loadedBuffer] = await Promise.all([
      json(`assets/tracks/${song.id}/${difficulty}.json`), preparedAudio.promise,
    ]);
    if (id !== requestId) return;
    readyTrack = { chart, loadedBuffer, song, difficulty, output };
    state = 'song-ready'; $('play').disabled = false; $('demo').disabled = false;
    $('play-label').textContent = 'Играть';
    $('song-status').textContent = output === mediaAudio ? 'Готово · совместимый звук' : 'Готово к выступлению';
  } catch {
    if (id !== requestId) return;
    preparedAudio = null; state = 'song-error'; $('play-label').textContent = 'Играть';
    $('song-load-retry').hidden = false;
    $('song-status').textContent = 'Не удалось подготовить трек. Повтори загрузку. Без сети доступны заранее скачанные песни.';
  }
}
function stageEntrance() {
  if (settings.motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // The real song panel leaves over the same background; it never blocks game taps or focus.
  $('song-screen').hidden = false; $('song-screen').inert = true;
  $('song-screen').dataset.departing = 'true';
}
$('song-screen').onanimationend = event => {
  if (event.target === $('song-screen') && $('song-screen').dataset.departing === 'true') {
    $('song-screen').hidden = true; $('song-screen').inert = true; $('song-screen').dataset.departing = 'false';
  }
};
async function start(isDemo = false) {
  if (document.hidden || !['song-ready', 'results', 'paused'].includes(state)) return;
  const expected = settings.compatibleAudio ? mediaAudio : webAudio;
  if (!readyTrack || readyTrack.song.id !== selected.id || readyTrack.difficulty !== level || readyTrack.output !== expected) return openSong(selected);
  const fromSong = state === 'song-ready';
  const { chart, loadedBuffer, song, difficulty, output } = readyTrack;
  const id = ++requestId;
  audio = output; state = 'starting'; $('play').disabled = true; $('demo').disabled = true;
  try {
    // Native play below remains before any await. The Web Audio branch resumes from this same click.
    if (audio === webAudio) await audio.unlock();
    if (id !== requestId) return;
    renderer.effects.reset();
    game = new Game(chart, { automaticRevenge: true }); buffer = loadedBuffer; demo = isDemo; run = { song, level: difficulty };
    pulse = !demo && !song.tutorial && PULSE_CHARTS[song.id] ? new PhraseProgress(game.notes, PULSE_CHARTS[song.id],
      choosePulseZones(game.notes, PULSE_CHARTS[song.id], PULSE_COUNTS[song.id])) : null;
    renderPulse(pulse?.view(0) ?? null);
    inputs.forEach(input => input.clear());
    demoActions = chart.flatMap(note => [{ time: note.time, lane: note.lane, down: true },
      { time: note.time + (note.duration || 0.035), lane: note.lane, down: false }])
      .sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));
    demoIndex = 0; resumeGrace = -Infinity;
    audio.setVolume(settings.volume / 100);
    const playback = audio.play(buffer, 0, 0);
    pageStack.length = 0; show('game-screen'); if (fromSong) stageEntrance();
    $('now-title').textContent = song.title; $('now-artist').textContent = artistName(song); $('now-art').src = artwork(song);
    $('pause-track').textContent = `${song.title} · ${LEVELS[difficulty]}`;
    $('mode-label').textContent = demo ? 'ДЕМО · без рекорда' : song.tutorial ? 'КАЛИБРОВКА · без рекорда' : LEVELS[difficulty];
    $('pause').focus({ preventScroll: true });
    await playback;
    if (id !== requestId) return;
    state = 'playing';
  } catch {
    if (id !== requestId) return;
    audio.stop(); state = 'song-ready'; show('song-screen');
    $('play').disabled = false; $('demo').disabled = false; $('play-label').textContent = 'Играть';
    $('song-status').textContent = 'Не удалось включить звук. Нажми «Играть», чтобы попробовать снова.';
  }
}
function gameTime() { return audio.position - settings.offset / 1000; }
function pause() {
  if (state === 'starting') {
    requestId++; audio.stop(); state = 'song-ready'; show('song-screen');
    $('play').disabled = false; $('demo').disabled = false; $('play-label').textContent = 'Играть';
    $('song-status').textContent = 'Запуск остановлен. Нажми «Играть», чтобы начать снова.';
    $('play').focus({ preventScroll: true });
    return;
  }
  if (state !== 'playing' && state !== 'resuming') return;
  if (state === 'resuming') requestId++;
  pausePosition = audio.pause();
  state = 'paused'; $('resume').disabled = false;
  game.held.fill(false); inputs.forEach(input => input.clear());
  $('pause-error').hidden = true;
  show('pause-screen'); $('resume').focus({ preventScroll: true });
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
    state = 'playing'; show('game-screen');
    resumeGrace = pausePosition - settings.offset / 1000 + .3;
    $('pause').focus({ preventScroll: true });
  } catch {
    if (id !== requestId) return;
    audio.stop(); state = 'paused';
    $('pause-error').textContent = 'Не удалось включить звук. Нажми «Продолжить», чтобы попробовать ещё раз.';
    $('pause-error').hidden = false;
  } finally { if (id === requestId) $('resume').disabled = false; }
}
function pressNote(lane, time) {
  const strays = game.strays;
  const note = game.press(lane, time);
  renderer.effects.observeFailures(game, time);
  renderer.effects.recordHit(note, time, game.multiplier(time));
  if (game.strays > strays) renderer.effects.recordJudgment(lane, 'МИМО', time, true);
}
function releaseNote(lane, time) {
  game.release(lane, time);
  renderer.effects.observeFailures(game, time);
}
function down(lane, source) {
  if (state !== 'playing' || demo || audio.countdown > 0 || audio.waiting) return;
  const wasHeld = inputs[lane].size > 0; inputs[lane].add(source);
  if (!wasHeld) {
    const time = gameTime();
    pressNote(lane, time);
    pulse?.recordInput(time, game.strays);
  }
}
function up(lane, source) {
  const had = inputs[lane].delete(source);
  if (had && inputs[lane].size === 0 && state === 'playing' && !demo && audio.countdown === 0) releaseNote(lane, gameTime());
}
function finish() {
  audio.stop(); state = 'results'; show('results');
  const result = game.finish();
  const pulseResult = pulse?.finish();
  $('result-pulse').hidden = !pulseResult;
  $('result-pulse-count').textContent = pulseResult ? `${formatNumber(pulseResult.captured)} / ${formatNumber(pulseResult.total)}` : '';
  $('result-pulse-perfect').textContent = pulseResult ? `Идеальных: ${formatNumber(pulseResult.perfect)}` : '';
  renderPulseBreakdown(pulse?.phrases);
  const key = `${run.song.id}:${run.level}`;
  const previousScore = records[key]?.score;
  const isRecord = !demo && !run.song.tutorial && (!records[key] || result.score > records[key].score);
  if (!demo && !run.song.tutorial) {
    progress = recordAttempt(progress, { songId: run.song.id, level: run.level, result, pulse: pulseResult,
      playedAt: Temporal.Now.instant().toString(), id: crypto.randomUUID() });
    records = currentRecords(progress); saveSettings();
  }
  $('result-art').src = artwork(run.song); $('result-heading').textContent = run.song.title;
  $('result-artist').textContent = `${artistName(run.song)} · ${LEVELS[run.level]}`;
  $('score-caption').textContent = demo ? 'ДЕМО · БЕЗ РЕКОРДА' : run.song.tutorial ? 'КАЛИБРОВКА · БЕЗ РЕКОРДА' : isRecord ? 'НОВЫЙ РЕКОРД' : 'ТВОЙ РЕЗУЛЬТАТ';
  $('score-caption').dataset.record = String(isRecord);
  $('record-delta').hidden = !isRecord || !Number.isFinite(previousScore);
  $('record-delta').textContent = isRecord && Number.isFinite(previousScore) ? `${formatSigned(result.score - previousScore)} к рекорду` : '';
  $('final-score').textContent = formatNumber(result.score);
  $('results').dataset.fullCombo = String(!demo && !run.song.tutorial && result.misses === 0 && result.brokenHolds === 0 && result.strays === 0);
  $('result-rating').textContent = demo ? 'ДЕМО ЗАВЕРШЕНО' : run.song.tutorial ? 'КАЛИБРОВКА' : result.misses === 0 && result.brokenHolds === 0 && result.strays === 0 ? 'FULL COMBO' : 'ТРЕК ПРОЙДЕН';
  $('result-accuracy').textContent = formatPercent(result.accuracy);
  $('result-combo').textContent = formatNumber(result.bestStreak);
  $('result-misses').textContent = `Пропуски: ${formatNumber(result.misses)}`;
  $('result-details').open = false;
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
  if (previewRenderer && !$('song-backdrop').hidden) {
    const size = `${$('song-canvas').clientWidth}:${$('song-canvas').clientHeight}`;
    if (size !== previewSize) {
      previewRenderer.render(previewGame, 0, '1', 0, 0, true); previewSize = size;
    }
  }
  if (state === 'playing' && audio.interrupted) interruptPlayback();
  if (game && ['starting', 'playing', 'paused', 'resuming'].includes(state)) {
    const position = state === 'playing' ? audio.position : state === 'starting' ? 0 : pausePosition;
    const time = position - settings.offset / 1000, countdown = state === 'playing' ? audio.countdown : 0;
    if (state === 'playing' && countdown === 0 && !audio.waiting) {
      if (demo) {
        while (demoIndex < demoActions.length && demoActions[demoIndex].time <= time) {
          const action = demoActions[demoIndex++];
          if (action.down) pressNote(action.lane, action.time);
          else releaseNote(action.lane, action.time);
        }
      } else if (time >= resumeGrace && resumeGrace !== -Infinity) {
        for (let lane = 0; lane < 3; lane++) if (!game.held[lane]) releaseNote(lane, time);
        resumeGrace = -Infinity;
      }
      game.update(time);
      renderer.effects.observeFailures(game, time);
      pulse?.advance(time);
    }
    renderPulse(pulse?.view(time) ?? null);
    if (!$('game-screen').hidden) renderer.render(game, time, run.level, buffer.duration, countdown, settings.motion, pulse?.zones(time, TRAVEL[run.level]));
    text('time', `${formatTime(position)} / ${formatTime(buffer.duration)}`);
    text('live-score', formatNumber(game.score));
    text('live-combo', formatNumber(game.streak));
    const multiplier = game.multiplier(time);
    text('multiplier', `×${formatNumber(multiplier)}`);
    $('multiplier').dataset.level = String(multiplier);
    $('game-screen').dataset.energy = multiplier === 8 ? 'active' : 'charging';
    $('song-progress').value = Math.min(1, Math.max(0, position / buffer.duration));
    $('revenge-progress').value = Math.min(50, game.streak);
    text('revenge-label', multiplier === 8 ? `×${formatNumber(8)}` : `АВТО ×${formatNumber(8)} · ${formatNumber(Math.min(50, game.streak))} / ${formatNumber(50)}`);
    $('audio-status').hidden = audio !== mediaAudio;
    text('audio-status', audio.waiting ? 'Ожидаем звук…' : 'Совместимый звук');
    text('game-stats', `Очки: ${formatNumber(game.score)}; попадания: ${formatNumber(game.hits)}; пропуски: ${formatNumber(game.misses)}`);
    if (state === 'playing' && audio.position > buffer.duration + Math.max(0, settings.offset / 1000) + .3) finish();
  }
  requestAnimationFrame(frame);
}

$('song-load-retry').onclick = prepareSong;
$('play').onclick = () => start(false);
$('demo').onclick = () => start(true);
function goBack() {
  if (document.body.dataset.screen === 'library') return showMenu();
  if (document.body.dataset.screen === 'progress-screen') progressView.close();
  if (document.body.dataset.screen === 'import-screen') return progressView.cancelImport();
  return pageStack.length ? backPage() : showLibrary();
}
$('home').onclick = goBack;
$('pause').onclick = () => pause();
$('resume').onclick = resume;
$('restart').onclick = () => { if (document.hidden) return; selected = run.song; level = run.level; return start(demo); };
$('quit').onclick = showLibrary;
$('retry').onclick = () => { selected = run.song; level = run.level; return start(demo); };
$('back-to-library').onclick = showLibrary;
function selectCalibration() {
  showLibrary();
  selected = catalog.find(song => song.tutorial); level = '1';
  const loading = openSong(selected);
  $('status').textContent = 'Нажимай среднюю дорожку или F в такт метроному. Первые ноты начинаются на 12-й секунде.';
  return loading;
}
$('calibration').onclick = selectCalibration;
$('settings-calibration').onclick = selectCalibration;
$('load-cancel').onclick = showLibrary;
$('load-retry').onclick = initialize;
$('apply-calibration').onclick = () => { settings.offset = calibrationOffset; $('offset').value = calibrationOffset; saveSettings(); $('apply-calibration').hidden = true; $('calibration-result').textContent = `Применена поправка ${formatNumber(calibrationOffset)} мс.`; };
$('menu-play').onclick = showLibrary;
$('settings-open').onclick = $('menu-settings').onclick = event => openPage('settings-screen', 'screen-title', event?.currentTarget);
$('settings-close').onclick = backPage;
$('about-open').onclick = $('menu-about').onclick = event => openPage('about-screen', 'screen-title', event?.currentTarget);
$('about-close').onclick = backPage;
$('offline-settings').onclick = () => openPage('settings-screen', 'screen-title', $('offline-settings'));
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
  if (['song-ready', 'song-loading', 'song-error'].includes(state)) return prepareSong();
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
  if (event.repeat || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.code === 'Escape' && pageStack.length) { event.preventDefault(); goBack(); return; }
  if (event.code === 'Escape' && state === 'paused') { event.preventDefault(); resume(); return; }
  if (state !== 'playing') return;
  if (event.code in keys) { event.preventDefault(); down(keys[event.code], event.code); }
  if (event.code === 'Escape') { event.preventDefault(); pause(); }
});
window.addEventListener('keyup', event => { if (event.code in keys) up(keys[event.code], event.code); });
function leavePage() {
  if (['song-loading', 'starting'].includes(state)) showLibrary(); else pause();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) leavePage(); });
window.addEventListener('pagehide', leavePage);
window.addEventListener('blur', leavePage);

progressView = new ProgressView({
  onOpenImport: () => openPage('import-screen', 'import-cancel'), onCloseImport: backPage,
  getProgress: () => progress, getSettings: () => settings, getWarning: () => saveWarning,
  onSelect: (song, difficulty) => { level = difficulty; progressView.close(); return openSong(song); },
  onImport: text => {
    const snapshot = importProgress(browserStorage, text);
    progress = snapshot.progress; records = currentRecords(progress); Object.assign(settings, snapshot.settings);
    storageWritable = true; saveWarning = ''; syncSettings();
  },
});
$('progress-open').onclick = $('menu-progress').onclick = event => {
  audio.stop(); state = 'progress'; openPage('progress-screen', 'screen-title', event?.currentTarget); progressView.open(catalog, selected, level);
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
    previewRenderer = new Renderer($('song-canvas'), paths); previewGame = new Game([]);
    state = 'menu'; show('menu'); refresh(); if (saveWarning) $('status').textContent = saveWarning; $('menu-play').focus({ preventScroll: true }); requestAnimationFrame(frame);
  } catch {
    if (id !== requestId) return;
    state = 'boot-error'; preparation(null, null, true);
  }
}
await initialize();
void offlineView.initialize();

import { Game } from './engine.js';
import { SongAudio } from './audio.js';
import { Renderer } from './renderer.js';

const $ = id => document.getElementById(id);
const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Extreme' };
const audio = new SongAudio();
let catalog, selected, level = '1', renderer, game, buffer;
let state = 'library', demo = false, run = null, requestId = 0, pausePosition = 0;
let resumeGrace = -Infinity, demoActions = [], demoIndex = 0, calibrationOffset = null;
const inputs = [new Set(), new Set(), new Set()];
const settings = { volume: 75, offset: 0, motion: matchMedia('(prefers-reduced-motion: reduce)').matches };
let records = {};
try {
  const saved = JSON.parse(localStorage.getItem('ttr-web-settings') || '{}');
  if (Number.isFinite(saved.volume)) settings.volume = Math.max(0, Math.min(100, saved.volume));
  if (Number.isFinite(saved.offset)) settings.offset = Math.max(-500, Math.min(500, saved.offset));
  if (typeof saved.motion === 'boolean') settings.motion = saved.motion;
  records = JSON.parse(localStorage.getItem('ttr-web-records') || '{}') || {};
} catch { /* Storage is optional, including private browsing. */ }
function saveSettings() {
  try { localStorage.setItem('ttr-web-settings', JSON.stringify(settings)); } catch { /* Session-only settings. */ }
}
function formatTime(value) { const seconds = Math.max(0, Math.floor(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function artwork(song) { return song.tutorial ? 'assets/ui/logo.png' : `assets/tracks/${song.id}/artwork.png`; }
function show(screen) {
  for (const name of ['library', 'game-screen', 'results']) $(name).hidden = name !== screen;
  $('status').textContent = '';
}
function showLibrary() {
  requestId++;
  audio.stop(); state = 'library'; inputs.forEach(input => input.clear());
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  show('library'); refresh();
}
function refresh() {
  if (!selected) return;
  $('hero-art').src = artwork(selected);
  $('hero-title').textContent = selected.title;
  $('hero-artist').textContent = selected.artist;
  $('hero-meta').textContent = `${formatTime(selected.duration)} · ${selected.genre} · APK 4.5`;
  $('tracks').replaceChildren();
  for (const song of catalog.filter(song => !song.tutorial)) {
    const button = document.createElement('button'); button.className = 'track';
    button.setAttribute('aria-pressed', String(song.id === selected.id));
    const img = document.createElement('img'); img.src = artwork(song); img.alt = '';
    const text = document.createElement('span'); const title = document.createElement('strong'); const artist = document.createElement('small');
    title.textContent = song.title; artist.textContent = song.artist; text.append(title, artist);
    const duration = document.createElement('em'); duration.textContent = formatTime(song.duration);
    button.append(img, text, duration);
    button.onclick = () => { selected = song; if (!song.levels[level]) level = '1'; refresh(); };
    $('tracks').append(button);
  }
  $('difficulties').replaceChildren();
  for (const [value, name] of Object.entries(LEVELS)) {
    const button = document.createElement('button'); button.textContent = name;
    button.setAttribute('aria-pressed', String(level === value)); button.disabled = !selected.levels[value];
    button.onclick = () => { level = value; refresh(); }; $('difficulties').append(button);
  }
  $('note-count').textContent = `${selected.levels[level].notes} нот`;
  const best = records[`${selected.id}:${level}`];
  $('record').textContent = Number.isFinite(best?.score) && Number.isFinite(best?.accuracy) ? `BEST ${best.score.toLocaleString('en-US')} · ${best.accuracy.toFixed(1)}%` : 'Оригинальная карта · рекорд ещё не установлен';
  $('play').disabled = false; $('demo').disabled = false; $('calibration').disabled = false;
}
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}.`);
  return response.json();
}
async function start(isDemo = false) {
  const id = ++requestId;
  const song = selected, difficulty = level;
  $('play').disabled = true; state = 'loading'; $('status').textContent = 'Загрузка трека…';
  try {
    // AudioContext is resumed synchronously from the user's gesture, before fetching.
    await audio.unlock();
    const [chart, loadedBuffer] = await Promise.all([
      json(`assets/tracks/${song.id}/${difficulty}.json`), audio.load(`assets/tracks/${song.id}/audio.m4a`),
    ]);
    if (id !== requestId) return;
    game = new Game(chart); buffer = loadedBuffer; demo = isDemo; run = { song, level: difficulty };
    inputs.forEach(input => input.clear());
    demoActions = chart.flatMap(note => [{ time: note.time, lane: note.lane, down: true },
      { time: note.time + (note.duration || 0.035), lane: note.lane, down: false }])
      .sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));
    demoIndex = 0; resumeGrace = -Infinity;
    audio.setVolume(settings.volume / 100); audio.play(buffer); state = 'playing';
    show('game-screen'); $('now-title').textContent = song.title; $('now-artist').textContent = song.artist;
    $('mode-label').textContent = demo ? 'DEMO · без рекорда' : LEVELS[difficulty].toUpperCase();
    $('pause').focus({ preventScroll: true });
  } catch (error) {
    if (id !== requestId) return;
    state = 'library'; audio.stop(); show('library'); $('status').textContent = `Не удалось начать игру: ${error.message}`;
  } finally { if (id === requestId) $('play').disabled = false; }
}
function gameTime() { return audio.position - settings.offset / 1000; }
function pause(openDialog = true) {
  if (state !== 'playing') return;
  pausePosition = audio.pause(); state = 'paused';
  game.held.fill(false); inputs.forEach(input => input.clear());
  if (openDialog) $('pause-dialog').showModal();
}
async function resume() {
  if (state !== 'paused') return;
  try {
    await audio.unlock();
    $('pause-dialog').close();
    audio.play(buffer, pausePosition, 2); state = 'playing';
    resumeGrace = pausePosition - settings.offset / 1000 + .3;
    $('pause').focus({ preventScroll: true });
  } catch (error) { $('status').textContent = error.message; }
}
function down(lane, source) {
  if (state !== 'playing' || demo || audio.countdown > 0) return;
  const wasHeld = inputs[lane].size > 0; inputs[lane].add(source);
  if (!wasHeld) game.press(lane, gameTime());
}
function up(lane, source) {
  const had = inputs[lane].delete(source);
  if (had && inputs[lane].size === 0 && state === 'playing' && !demo && audio.countdown === 0) game.release(lane, gameTime());
}
function finish() {
  audio.stop(); state = 'results'; show('results');
  const result = game.finish();
  const key = `${run.song.id}:${run.level}`;
  const isRecord = !demo && !run.song.tutorial && (!records[key] || result.score > records[key].score);
  if (isRecord) {
    records[key] = result;
    try { localStorage.setItem('ttr-web-records', JSON.stringify(records)); } catch { /* No persistent storage. */ }
  }
  $('result-art').src = artwork(run.song); $('result-heading').textContent = run.song.title;
  $('result-artist').textContent = `${run.song.artist} · ${LEVELS[run.level]}`;
  $('score-caption').textContent = demo ? 'DEMO SCORE · НЕ СОХРАНЁН' : isRecord ? 'NEW PERSONAL BEST' : 'YOUR SCORE';
  $('final-score').textContent = result.score.toLocaleString('en-US');
  $('result-rating').textContent = result.misses === 0 && result.brokenHolds === 0 && result.strays === 0 ? 'FULL COMBO' : 'THANKS FOR PLAYING';
  $('result-stats').replaceChildren();
  for (const [label, value] of [['Точность', `${result.accuracy.toFixed(1)}%`], ['Лучшая серия', result.bestStreak],
    ['Попадания / пропуски', `${result.hits} / ${result.misses}`], ['Perfect / Great', `${result.counts.PERFECT} / ${result.counts.GREAT}`],
    ['Сорванные удержания', result.brokenHolds], ['Лишние нажатия', result.strays]]) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value;
    $('result-stats').append(dt, dd);
  }
  $('calibration-result').hidden = !run.song.tutorial; $('apply-calibration').hidden = true;
  if (run.song.tutorial && !demo) {
    const errors = [...game.errors].sort((a, b) => a - b);
    if (errors.length >= 8) {
      const median = errors[Math.floor(errors.length / 2)];
      calibrationOffset = Math.max(-500, Math.min(500, Math.round((settings.offset + median * 1000) / 5) * 5));
      $('calibration-result').textContent = `По ${errors.length} попаданиям: поправка ${calibrationOffset} мс. Если играл по звуку метронома, можно применить её.`;
      $('apply-calibration').hidden = false;
    } else $('calibration-result').textContent = 'Для оценки задержки нужно хотя бы 8 попаданий. Повтори и нажимай F по звуку, а не по картинке.';
  }
  $('retry').focus({ preventScroll: true });
}
function frame() {
  if (game && (state === 'playing' || state === 'paused')) {
    const time = gameTime(), countdown = state === 'playing' ? audio.countdown : 0;
    if (state === 'playing' && countdown === 0) {
      if (demo) {
        while (demoIndex < demoActions.length && demoActions[demoIndex].time <= time) {
          const action = demoActions[demoIndex++];
          if (action.down) game.press(action.lane, action.time); else game.release(action.lane, action.time);
        }
        if (game.revengeReady) game.activateRevenge(time);
      } else if (time >= resumeGrace && resumeGrace !== -Infinity) {
        for (let lane = 0; lane < 3; lane++) if (!game.held[lane]) game.release(lane, time);
        resumeGrace = -Infinity;
      }
      game.update(time);
    }
    renderer.render(game, time, run.level, buffer.duration, countdown, settings.motion);
    $('time').textContent = `${formatTime(audio.position)} / ${formatTime(buffer.duration)}`;
    $('revenge').disabled = !game.revengeReady || demo || countdown > 0 || state !== 'playing';
    $('revenge').textContent = time < game.revengeUntil ? `×8 · ${Math.ceil(game.revengeUntil - time)}s` : 'REVENGE ×8';
    $('game-stats').textContent = `Очки: ${game.score}; попадания: ${game.hits}; пропуски: ${game.misses}`;
    if (state === 'playing' && audio.position > buffer.duration + Math.max(0, settings.offset / 1000) + .3) finish();
  }
  requestAnimationFrame(frame);
}

$('play').onclick = () => start(false);
$('demo').onclick = () => { if (state !== 'loading') start(true); };
$('home').onclick = showLibrary;
$('pause').onclick = () => pause();
$('resume').onclick = resume;
$('restart').onclick = () => { $('pause-dialog').close(); selected = run.song; level = run.level; start(demo); };
$('quit').onclick = showLibrary;
$('retry').onclick = () => { selected = run.song; level = run.level; start(demo); };
$('back-to-library').onclick = showLibrary;
$('revenge').onclick = () => game.activateRevenge(gameTime());
$('calibration').onclick = () => { selected = catalog.find(song => song.tutorial); level = '1'; refresh(); $('status').textContent = 'Нажимай F на звук метронома. Первые калибровочные ноты начинаются на 12-й секунде.'; };
$('apply-calibration').onclick = () => { settings.offset = calibrationOffset; $('offset').value = calibrationOffset; saveSettings(); $('apply-calibration').hidden = true; $('calibration-result').textContent = `Применена поправка ${calibrationOffset} мс.`; };
$('settings-open').onclick = () => { pause(false); $('settings-dialog').showModal(); };
function closeSettings() { $('settings-dialog').close(); if (state === 'paused') $('pause-dialog').showModal(); }
$('settings-close').onclick = closeSettings;
$('settings-dialog').oncancel = event => { event.preventDefault(); closeSettings(); };
$('pause-dialog').oncancel = event => { event.preventDefault(); resume(); };
$('about-open').onclick = () => { pause(false); $('about-dialog').showModal(); };
function closeAbout() { $('about-dialog').close(); if (state === 'paused') $('pause-dialog').showModal(); }
$('about-close').onclick = closeAbout;
$('about-dialog').oncancel = event => { event.preventDefault(); closeAbout(); };
$('volume').value = settings.volume; $('volume-value').value = `${settings.volume}%`;
$('offset').value = settings.offset; $('motion').checked = settings.motion;
$('volume').oninput = event => { settings.volume = Number(event.target.value); $('volume-value').value = `${settings.volume}%`; audio.setVolume(settings.volume / 100); saveSettings(); };
$('offset').onchange = event => { const value = Number(event.target.value); settings.offset = Number.isFinite(value) ? Math.max(-500, Math.min(500, value)) : 0; event.target.value = settings.offset; saveSettings(); };
$('motion').onchange = event => { settings.motion = event.target.checked; saveSettings(); };
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
  if (event.code === 'Space') { event.preventDefault(); if (!demo && audio.countdown === 0) game.activateRevenge(gameTime()); }
});
window.addEventListener('keyup', event => { if (event.code in keys) up(keys[event.code], event.code); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => pause());

try {
  const filenames = ['background.png', 'background-revenge.png', 'space.jpg', 'space-revenge.jpg', 'parts.png', 'HUD.png', 'progressBall.png'];
  const [songs, paths, entries] = await Promise.all([json('assets/catalog.json'), json('assets/paths.json'),
    Promise.all(filenames.map(async name => { const image = new Image(); image.src = `assets/theme/${name}`; await image.decode(); return [name, image]; }))]);
  catalog = songs; selected = songs.find(song => !song.tutorial);
  renderer = new Renderer($('canvas'), Object.fromEntries(entries), paths);
  refresh(); requestAnimationFrame(frame);
} catch (error) { $('status').textContent = `Не удалось загрузить игру. ${error.message} Запусти npm start из папки проекта.`; }

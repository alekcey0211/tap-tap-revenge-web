import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/', import.meta.url), out = new URL('prototype/', root);
await mkdir(out, { recursive: true });
const normalize = text => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(base, path = '') {
  const result = [];
  for (const item of await readdir(new URL(path || '.', base), { withFileTypes: true })) {
    if (!path && item.name === 'prototype') continue;
    if (item.isDirectory()) result.push(...await walk(base, path + item.name + '/'));
    else result.push(path + item.name);
  }
  return result.sort();
}
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Stable app changed; review prototype adapter: ${from}`);
  return text.replace(from, to);
}
const spectra = JSON.parse(await readFile(new URL('spectra.json', import.meta.url)));
for (const [id, track] of Object.entries(spectra.tracks)) {
  if (track.audioHash !== hash(await readFile(new URL(`assets/tracks/${id}/audio.m4a`, root)))) throw new Error('Music changed: run node prototype/analyze-music.mjs');
}
const mainSources = {};
for (const path of await walk(root)) {
  mainSources[path] = hash(await readFile(new URL(path, root)));
  if (path === 'assets/scene/concert.jpg') continue;
  await mkdir(new URL('./', new URL(path, out)), { recursive: true });
  await cp(new URL(path, root), new URL(path, out));
}
await rm(new URL('assets/scene/concert.jpg', out), { force: true });
// New catalog: medium/hard/extreme charts become easy/medium/hard. Calibration stays intact.
const catalog = JSON.parse(await readFile(new URL('assets/catalog.json', root)));
for (const song of catalog.filter(song => !song.tutorial)) {
  const levels = {};
  for (let level = 1; level <= 3; level++) {
    levels[level] = song.levels[level + 1];
    await cp(new URL(`assets/tracks/${song.id}/${level + 1}.json`, root), new URL(`assets/tracks/${song.id}/${level}.json`, out));
  }
  song.levels = levels;
  await rm(new URL(`assets/tracks/${song.id}/4.json`, out), { force: true });
}
await writeFile(new URL('assets/catalog.json', out), JSON.stringify(catalog, null, 2) + '\n');
const engine = replaceOnce(await readFile(new URL('engine.js', root), 'utf8'),
  'export const TRAVEL = { 1: 2.7, 2: 2.15, 3: 1.8, 4: 1.4 };', 'export const TRAVEL = { 1: 2.15, 2: 1.8, 3: 1.4 };');
await writeFile(new URL('engine.js', out), engine);
const difficulty = replaceOnce(await readFile(new URL('difficulty.js', root), 'utf8'),
  "{ 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' }", "{ 1: 'Легко', 2: 'Средне', 3: 'Сложно' }")
  .replace('step <= 4', 'step <= 3');
await writeFile(new URL('difficulty.js', out), difficulty);
const style = (await readFile(new URL('style.css', root), 'utf8')).replaceAll('url("assets/scene/concert.jpg")', 'none').replace(/^img\[src\$="scene\/concert\.jpg"\].*\n/m, '');
await writeFile(new URL('style.css', out), style);
let app = await readFile(new URL('app.js', root), 'utf8');
app = replaceOnce(app, "'./renderer.js?v=0.9.0'", "'./babylon-renderer.js?v=0.6.0'");
app = replaceOnce(app, "const APP_VERSION = '0.10.4';", "const APP_VERSION = '0.6.0-babylon';");
app = replaceOnce(app, 'pulse?.zones(time, TRAVEL[run.level]));', 'pulse?.zones(time, TRAVEL[run.level]), { songId: run.song.id, position });');
await writeFile(new URL('app.js', out), app);
let storage = (await readFile(new URL('storage.js', root), 'utf8')).replaceAll('ttr-web-', 'ttr-babylon-').replace('compatibleAudio: false', 'compatibleAudio: true');
storage = replaceOnce(storage, "'ttr-babylon-save-v1'", "'ttr-babylon-save-v2'");
storage = replaceOnce(storage, "CHART_VERSION = 'original-v1'", "CHART_VERSION = 'neon-three-v1'");
const legacyStart = storage.indexOf('function legacy(storage, defaults) {');
const legacyEnd = storage.indexOf('function resetLegacyPulse', legacyStart);
if (legacyStart < 0 || legacyEnd < 0) throw new Error('Storage migration changed');
storage = storage.slice(0, legacyStart) + `function legacy(storage, defaults) {
  let settings = defaults;
  try { settings = settingsFrom(JSON.parse(storage.getItem('ttr-babylon-settings') || '{}'), defaults); } catch {}
  try { const previous = storage.getItem('ttr-babylon-save-v1'); if (previous) settings = parseProgress(previous).settings; } catch {}
  return { settings, progress: { records: [], history: [] } };
}
` + storage.slice(legacyEnd);
await writeFile(new URL('storage.js', out), storage);
let html = await readFile(new URL('index.html', root), 'utf8');
html = replaceOnce(html, '<title>Tap Tap Revenge · Web</title>', '<title>TAPBEAT · Stage Lab</title>');
html = replaceOnce(html, 'content="Tap Tap Web"', 'content="Tapbeat"');
html = replaceOnce(html, '<script type="module" src="app.js?v=0.10.4"></script>', '<link rel="stylesheet" href="babylon.css?v=0.6.0">\n  <script type="module" src="game-bootstrap.js?v=0.6.0"></script>');
html = replaceOnce(html, 'TAP TAP<span>REVENGE</span>', 'TAP<span>BEAT</span>');
html = replaceOnce(html, 'TAP TAP REVENGE / WEB', 'TAPBEAT / WEB');
// Compact song hierarchy and a shared geometric icon treatment; behavior stays in app.js.
html = replaceOnce(html, '<p id="hero-artist"></p>', '<p id="hero-artist"></p><p id="hero-meta"></p>');
html = replaceOnce(html, '</div><p id="hero-meta"></p></div>', '</div></div>');
const icon = path => `<svg class="control-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${path}</svg>`;
const backIcon = icon('<path d="M18 5 7 16l11 11M8 16h20" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="bevel"/>');
const settingsIcon = icon('<path d="m12 3-1 4-4 2-4-1-2 7 4 2 1 4-2 3 6 5 3-3h4l3 3 6-5-2-3 1-4 4-2-2-7-4 1-4-2-1-4Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="bevel"/><circle cx="15.5" cy="16" r="4" fill="currentColor"/>');
const pauseIcon = icon('<path d="M7 5h7v22H7zM20 5h7v22h-7z" fill="currentColor"/>');
html = replaceOnce(html, 'aria-label="К трекам" hidden>‹</button>', `aria-label="К трекам" hidden>${backIcon}</button>`);
html = replaceOnce(html, 'aria-label="Настройки">⚙</button>', `aria-label="Настройки">${settingsIcon}</button>`);
html = replaceOnce(html, 'aria-label="Пауза">Ⅱ</button>', `aria-label="Пауза">${pauseIcon}</button>`);
html = replaceOnce(html, '<span class="pause-symbol" aria-hidden="true">Ⅱ</span>', `<span class="pause-symbol" aria-hidden="true">${pauseIcon}</span>`);
html = replaceOnce(html, '<strong id="live-score">0</strong>', '<div class="hud-score"><small>Счёт</small><strong id="live-score">0</strong></div>');
html = replaceOnce(html, '<body>', `<body>
  <div id="babylon-buffer" aria-hidden="true"></div>
  <div id="babylon-loading" role="status">Готовим объёмную сцену…</div>
  <div id="babylon-error" hidden role="alert"><h2>Сцена недоступна</h2><p id="babylon-error-message">Попробуй WebGL или перезагрузи прототип.</p><button id="babylon-webgl">Использовать WebGL</button><button id="babylon-reload">Перезагрузить</button><a href="../#/">Рабочая игра</a></div>`);
html = replaceOnce(html, '<p class="menu-subtitle">Поймай свой ритм</p>', '<p class="menu-subtitle">Тапай в бит · STAGE LAB</p><p class="babylon-badge"><span id="babylon-backend">Babylon.js</span> · <span id="babylon-fps"></span></p>');
html = replaceOnce(html, '<p class="menu-version">', '<div class="babylon-links"><a href="lab.html">Лаборатория эффектов</a><a href="../#/">Рабочая версия</a></div><p class="menu-version">');
html = replaceOnce(html, '<div class="game-shell">', '<div class="game-shell"><div class="babylon-background" aria-hidden="true"><div class="babylon-viewport"><canvas id="babylon-background-canvas"></canvas></div></div>');
html = replaceOnce(html, 'id="revenge" class=', 'id="revenge" hidden class=');
// Keep every original screen/control id so app.js remains the owner of product behavior.
const settingsStart = html.indexOf('<section id="settings-screen"');
const settingsContent = html.indexOf('>', settingsStart) + 1;
html = html.slice(0, settingsContent) + '<p class="babylon-badge">STAGE LAB · отдельные настройки, рекорды и офлайн-треки</p><label>Графика<select id="babylon-renderer-choice"><option value="auto">WebGPU → WebGL</option><option value="webgl">Только WebGL</option></select></label>' + html.slice(settingsContent);
await writeFile(new URL('index.html', out), html);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root)));
manifest.name = 'Tapbeat · Stage Lab'; manifest.short_name = 'Tapbeat';
await writeFile(new URL('manifest.webmanifest', out), JSON.stringify(manifest, null, 2) + '\n');
await cp(new URL('game-bootstrap.js', import.meta.url), new URL('game-bootstrap.js', out));
await cp(new URL('game.css', import.meta.url), new URL('babylon.css', out));
await cp(new URL('lab.html', import.meta.url), new URL('lab.html', out));
await cp(new URL('lab.css', import.meta.url), new URL('stage.css', out));
for (const [source, target] of [['app.js', 'stage.js'], ['game-renderer.js', 'babylon-renderer.js']]) {
  const result = await build({ write: false, entryPoints: [new URL(source, import.meta.url).pathname], outfile: new URL(target, out).pathname,
    bundle: true, minify: true, format: 'esm', target: ['safari16', 'es2022'], legalComments: 'inline' });
  await writeFile(new URL(target, out), normalize(result.outputFiles[0].text));
}
const files = ['app.js', 'scene.js', 'hold-feedback.js', 'venue-layout.js', 'timing.js', 'backend.js', 'transport.js', 'session.js', 'spectrum.js', 'spectra.json', 'spectrum-analysis.mjs', 'analyze-music.mjs', 'input-regions.js', 'game-renderer.js', 'game-bootstrap.js', 'game.css', 'lab.html', 'lab.css', 'build.mjs', 'package.json', 'package-lock.json'];
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(new URL(file, import.meta.url)))])));
const bytes = await readFile(new URL('stage.js', out));
const renderer = await readFile(new URL('babylon-renderer.js', out));
await writeFile(new URL('build.json', out), JSON.stringify({ babylon: '9.32.1', sources, mainSources, bundle: hash(bytes), renderer: hash(renderer) }, null, 2) + '\n');
const license = normalize(await readFile(new URL('node_modules/@babylonjs/core/license.md', import.meta.url), 'utf8'));
const notice = normalize(await readFile(new URL('node_modules/@babylonjs/core/NOTICE.md', import.meta.url), 'utf8'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
await writeFile(new URL('licenses.html', out), '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Babylon.js license</title><h1>Babylon.js 9.32.1</h1><pre>' + escape(notice + '\n\n' + license) + '</pre></html>\n');
const stableManifest = JSON.parse((await readFile(new URL('offline-assets.js', root), 'utf8')).split(' = ')[1].replace(/;\s*$/, ''));
const shell = await Promise.all((await walk(out)).filter(path => !['sw.js', 'offline-assets.js', 'build.json'].includes(path)
  && (!path.startsWith('assets/tracks/') || path.endsWith('/artwork.jpg'))).map(async path => {
  const data = await readFile(new URL(path, out)); return { path, hash: hash(data), bytes: data.length };
}));
const worker = await readFile(new URL('sw.js', out), 'utf8');
const tracks = {};
for (const [id, track] of Object.entries(stableManifest.tracks)) {
  const files = await Promise.all(track.files.filter(file => !file.path.endsWith('/4.json')).map(async file => {
    const data = await readFile(new URL(file.path, out)); return { path: file.path, hash: hash(data), bytes: data.length };
  }));
  tracks[id] = { files, revision: hash(JSON.stringify(files)).slice(0, 16) };
}
const offline = { version: '0.6.0-babylon', revision: hash(JSON.stringify(shell) + worker).slice(0, 16), shell, tracks };
await writeFile(new URL('offline-assets.js', out), '// Generated by prototype/build.mjs. Do not edit.\nself.OFFLINE_ASSETS = ' + JSON.stringify(offline, null, 2) + ';\n');
console.log(`Prototype: ${shell.length} shell files; renderers ${bytes.length + renderer.length} bytes; main files unchanged.`);

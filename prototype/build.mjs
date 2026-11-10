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
const style = (await readFile(new URL('style.css', root), 'utf8')).replaceAll('url("assets/scene/concert.jpg")', 'none').replace(/^img\[src\$="scene\/concert\.jpg"\].*\n/m, '');
await writeFile(new URL('style.css', out), style);
let app = await readFile(new URL('app.js', root), 'utf8');
app = replaceOnce(app, "'./renderer.js?v=0.9.0'", "'./babylon-renderer.js?v=0.4.2'");
app = replaceOnce(app, "const APP_VERSION = '0.10.4';", "const APP_VERSION = '0.4.2-babylon';");
app = replaceOnce(app, 'pulse?.zones(time, TRAVEL[run.level]));', 'pulse?.zones(time, TRAVEL[run.level]), { songId: run.song.id, position });');
await writeFile(new URL('app.js', out), app);
const storage = (await readFile(new URL('storage.js', root), 'utf8')).replaceAll('ttr-web-', 'ttr-babylon-').replace('compatibleAudio: false', 'compatibleAudio: true');
await writeFile(new URL('storage.js', out), storage);
let html = await readFile(new URL('index.html', root), 'utf8');
html = replaceOnce(html, '<title>Tap Tap Revenge · Web</title>', '<title>Tap Tap · Babylon Stage Lab</title>');
html = replaceOnce(html, 'content="Tap Tap Web"', 'content="Tap Tap Lab"');
html = replaceOnce(html, '<script type="module" src="app.js?v=0.10.4"></script>', '<link rel="stylesheet" href="babylon.css?v=0.4.2">\n  <script type="module" src="game-bootstrap.js?v=0.4.2"></script>');
html = replaceOnce(html, '<body>', `<body>
  <div id="babylon-buffer" aria-hidden="true"></div>
  <div id="babylon-loading" role="status">Готовим объёмную сцену…</div>
  <div id="babylon-error" hidden role="alert"><h2>Сцена недоступна</h2><p id="babylon-error-message">Попробуй WebGL или перезагрузи прототип.</p><button id="babylon-webgl">Использовать WebGL</button><button id="babylon-reload">Перезагрузить</button><a href="../#/">Рабочая игра</a></div>`);
html = replaceOnce(html, '<p class="menu-subtitle">Поймай свой ритм</p>', '<p class="menu-subtitle">Поймай свой ритм · STAGE LAB</p><p class="babylon-badge"><span id="babylon-backend">Babylon.js</span> · <span id="babylon-fps"></span></p>');
html = replaceOnce(html, '<p class="menu-version">', '<div class="babylon-links"><a href="lab.html">Лаборатория эффектов</a><a href="../#/">Рабочая версия</a></div><p class="menu-version">');
html = replaceOnce(html, '<div class="game-shell">', '<div class="game-shell"><div class="babylon-background" aria-hidden="true"><div class="babylon-viewport"><canvas id="babylon-background-canvas"></canvas></div></div>');
html = replaceOnce(html, 'id="revenge" class=', 'id="revenge" hidden class=');
// Keep every original screen/control id so app.js remains the owner of product behavior.
const settingsStart = html.indexOf('<section id="settings-screen"');
const settingsContent = html.indexOf('>', settingsStart) + 1;
html = html.slice(0, settingsContent) + '<p class="babylon-badge">STAGE LAB · отдельные настройки, рекорды и офлайн-треки</p><label>Графика<select id="babylon-renderer-choice"><option value="auto">WebGPU → WebGL</option><option value="webgl">Только WebGL</option></select></label>' + html.slice(settingsContent);
await writeFile(new URL('index.html', out), html);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root)));
manifest.name = 'Tap Tap · Stage Lab'; manifest.short_name = 'Tap Tap Lab';
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
const files = ['app.js', 'scene.js', 'backend.js', 'transport.js', 'session.js', 'spectrum.js', 'spectra.json', 'spectrum-analysis.mjs', 'analyze-music.mjs', 'input-regions.js', 'game-renderer.js', 'game-bootstrap.js', 'game.css', 'lab.html', 'lab.css', 'build.mjs', 'package.json', 'package-lock.json'];
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
const offline = { version: '0.4.2-babylon', revision: hash(JSON.stringify(shell) + worker).slice(0, 16), shell, tracks: stableManifest.tracks };
await writeFile(new URL('offline-assets.js', out), '// Generated by prototype/build.mjs. Do not edit.\nself.OFFLINE_ASSETS = ' + JSON.stringify(offline, null, 2) + ';\n');
console.log(`Prototype: ${shell.length} shell files; renderers ${bytes.length + renderer.length} bytes; main files unchanged.`);

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const out = new URL('../dist/prototype/', import.meta.url);
await mkdir(out, { recursive: true });
const result = await build({ write: false, entryPoints: [new URL('app.js', import.meta.url).pathname], outfile: new URL('stage.js', out).pathname,
  bundle: true, minify: true, format: 'esm', target: ['safari16', 'es2022'], legalComments: 'inline',
  external: ['../media-audio.js*', '../track-rhythm.js*'] });
const normalize = text => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
await writeFile(new URL('stage.js', out), normalize(result.outputFiles[0].text));
const files = ['app.js', 'scene.js', 'backend.js', 'transport.js', 'build.mjs', 'package.json', 'package-lock.json'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(new URL(file, import.meta.url)))])));
const bytes = await readFile(new URL('stage.js', out));
await writeFile(new URL('build.json', out), JSON.stringify({ babylon: '9.32.1', sources, bundle: hash(bytes) }, null, 2) + '\n');
const license = normalize(await readFile(new URL('node_modules/@babylonjs/core/license.md', import.meta.url), 'utf8'));
const notice = normalize(await readFile(new URL('node_modules/@babylonjs/core/NOTICE.md', import.meta.url), 'utf8'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
await writeFile(new URL('licenses.html', out), '<!doctype html>\n<html lang="en"><meta charset="utf-8"><title>Babylon.js license</title><h1>Babylon.js 9.32.1</h1><pre>' + escape(notice + '\n\n' + license) + '</pre></html>\n');
console.log(`Prototype bundle: ${bytes.length} bytes`);

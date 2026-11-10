import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountWorker } from './helpers/sw-harness.mjs';

const fonts = ['onest-cyrillic', 'onest-latin', 'unbounded-cyrillic', 'unbounded-latin'];
test('Latin and Cyrillic fonts are self-hosted WOFF2 with packaged licenses and preloads', async () => {
  const css = await readFile(new URL('../dist/style.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const name of fonts) {
    const path = `assets/fonts/${name}.woff2`;
    const file = await readFile(new URL(`../dist/${path}`, import.meta.url));
    assert.equal(file.toString('ascii', 0, 4), 'wOF2');
    assert.ok(css.includes(`url(${path})`));
    assert.ok(html.includes(`href="${path}" as="font" type="font/woff2" crossorigin`));
  }
  for (const family of ['onest', 'unbounded']) {
    const license = await readFile(new URL(`../dist/assets/fonts/${family}-license.html`, import.meta.url), 'utf8');
    assert.ok(license.includes('SIL OPEN FONT LICENSE'));
  }
  assert.doesNotMatch(css, /@import|url\(['"]?https?:/);
});
test('installed shell serves every font byte offline without a Google Fonts connection', async () => {
  const sw = await mountWorker(); await sw.lifecycle('install'); sw.offline(true);
  for (const name of fonts) {
    const path = `assets/fonts/${name}.woff2`;
    const response = await sw.request(path, { mode: 'cors' });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(`../dist/${path}`, import.meta.url)));
  }
});

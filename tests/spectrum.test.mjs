import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyze, SAMPLE_RATE, BAND_COUNT, BAND_EDGES, SPECTRUM_FPS } from '../prototype/spectrum-analysis.mjs';
import { sampleSpectrum } from '../prototype/spectrum.js';

const spectra = JSON.parse(await readFile(new URL('../prototype/spectra.json', import.meta.url)));
const root = new URL('../dist/prototype/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('spectral analysis keeps silence silent, rather than inventing rhythmic bars', () => {
  const data = analyze(new Float32Array(SAMPLE_RATE));
  assert.ok(data.bytes.every(value => value === 0));
  assert.equal(data.frames, SPECTRUM_FPS + 1);
});

test('FFT identifies bass and treble in different bands and follows a change in frequency', () => {
  const samples = Float32Array.from({ length: SAMPLE_RATE * 2 }, (_, i) => .5 * Math.sin(2 * Math.PI * (i < SAMPLE_RATE ? 125 : 4000) * i / SAMPLE_RATE));
  const data = analyze(samples).bytes;
  for (const [frame, frequency] of [[10, 125], [30, 4000]]) {
    const values = [...data.slice(frame * BAND_COUNT, (frame + 1) * BAND_COUNT)];
    const dominant = values.indexOf(Math.max(...values));
    assert.ok(BAND_EDGES[dominant] <= frequency && BAND_EDGES[dominant + 1] > frequency);
    assert.ok(values[dominant] > 200);
  }
});

test('every spectrum matches its exact shipped audio, with finite uniformly spaced frames', async () => {
  const catalog = JSON.parse(await read('assets/catalog.json'));
  assert.deepEqual(Object.keys(spectra.tracks).sort(), catalog.map(song => song.id).sort());
  for (const song of catalog) {
    const track = spectra.tracks[song.id], audio = await readFile(new URL(`assets/tracks/${song.id}/audio.m4a`, root));
    assert.equal(track.audioHash, createHash('sha256').update(audio).digest('hex'));
    assert.ok(Math.abs(track.duration - song.duration) < .15);
    assert.equal(Buffer.from(track.data, 'base64').length, track.frames * spectra.bands);
    assert.equal(track.frames, Math.ceil(track.duration * spectra.fps) + 1);
  }
});

test('sampling is deterministic across pause/resume/seek, and interpolates real frames', () => {
  const id = 'warehouse-echoes-v1', data = Buffer.from(spectra.tracks[id].data, 'base64');
  const output = new Float32Array(BAND_COUNT), before = sampleSpectrum(id, 20).slice();
  sampleSpectrum(id, 45, output);
  assert.deepEqual(sampleSpectrum(id, 20, output), before);
  assert.notDeepEqual(sampleSpectrum(id, 10), sampleSpectrum(id, 60));
  const frame = 300, halfway = sampleSpectrum(id, (frame + .5) / SPECTRUM_FPS);
  for (let band = 0; band < BAND_COUNT; band++) assert.ok(Math.abs(halfway[band] - (data[frame * BAND_COUNT + band] + data[(frame + 1) * BAND_COUNT + band]) / 510) < 1e-6);
  for (const time of [-1, Infinity, NaN, 10000]) assert.ok(sampleSpectrum(id, time).every(value => value === 0));
  assert.ok(sampleSpectrum('not-a-song', 10).every(value => value === 0));
});

test('spectrum/scene code cannot route music, create AudioContext, or introduce a second playback clock', async () => {
  const source = await readFile(new URL('../prototype/spectrum.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AudioContext|AnalyserNode|createMediaElementSource|new Audio|setInterval|setTimeout/);
  assert.match(await read('app.js'), /\{ songId: run.song.id, position \}/);
});

test('prototype removes raster venue and hides redundant lower x8 while retaining its upper score HUD', async () => {
  const html = await read('index.html'), css = await read('style.css') + await read('babylon.css');
  assert.match(html, /id="revenge" hidden/);
  assert.match(html, /id="multiplier"/);
  assert.match(html, /id="babylon-background-canvas"/);
  assert.doesNotMatch(css, /scene\/concert\.jpg/);
  await assert.rejects(stat(new URL('assets/scene/concert.jpg', root)), { code: 'ENOENT' });
});

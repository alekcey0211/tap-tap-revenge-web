import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyze, SAMPLE_RATE, FFT_SIZE, SPECTRUM_FPS, BAND_COUNT, BAND_EDGES } from './spectrum-analysis.mjs';

const root = new URL('../dist/assets/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('catalog.json', root)));
const tracks = {};
for (const song of catalog) {
  const path = new URL(`tracks/${song.id}/audio.m4a`, root);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', fileURLToPath(path), '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  const samples = Float32Array.from({ length: pcm.length / 4 }, (_, i) => pcm.readFloatLE(i * 4));
  const { frames, bytes } = analyze(samples);
  tracks[song.id] = { audioHash: createHash('sha256').update(await readFile(path)).digest('hex'), duration: samples.length / SAMPLE_RATE, frames, data: Buffer.from(bytes).toString('base64') };
}
await writeFile(new URL('spectra.json', import.meta.url), JSON.stringify({ version: 1, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, fps: SPECTRUM_FPS, bands: BAND_COUNT, edges: BAND_EDGES, tracks }) + '\n');
console.log(`Analyzed ${catalog.length} original audio files; no audio assets modified.`);

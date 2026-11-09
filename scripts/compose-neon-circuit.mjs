// Original deterministic composition and subtractive/FM synthesis, not neural audio.
// Run with Node and ffmpeg. No downloaded samples, voices, models or paid services.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url), id = 'neon-circuit-v1';
const target = new URL(`dist/assets/tracks/${id}/`, root);
const scratch = new URL('output/neon-circuit/', root);
await mkdir(target, { recursive: true }); await mkdir(scratch, { recursive: true });
const rate = 44100, beat = 60 / 128, bars = 32, duration = bars * 4 * beat + 2;
const length = Math.round(duration * rate), left = new Float32Array(length), right = new Float32Array(length);
let seed = 173;
function noise() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; }
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
function add(at, seconds, sample, gain = 1, pan = 0) {
  const start = Math.round(at * rate), count = Math.round(seconds * rate);
  const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
  for (let i = 0; i < count && start + i < length; i++) {
    const value = sample(i / rate, i / count) * gain;
    left[start + i] += value * l; right[start + i] += value * r;
  }
}
function kick(at, gain = 1) {
  add(at, .38, t => Math.sin(2 * Math.PI * (49 * t + 52 * .025 * (1 - Math.exp(-t / .025)))) * Math.exp(-t * 13)
    + noise() * Math.exp(-t * 300) * .15, .85 * gain);
}
function hat(at, open = false) {
  let previous = 0;
  add(at, open ? .19 : .065, t => { const n = noise(), high = n - previous; previous = n;
    return high * Math.exp(-t * (open ? 25 : 90)) * Math.min(1, t * 2000); }, open ? .085 : .055, open ? .35 : -.25);
}
function snare(at) {
  add(at, .2, t => (noise() * .68 + Math.sin(2 * Math.PI * 185 * t) * .32) * Math.exp(-t * 23) * Math.min(1, t * 1000), .32);
  for (const offset of [.012, .023]) add(at + offset, .09, t => noise() * Math.exp(-t * 55), .1, offset === .012 ? -.5 : .5);
}
function bass(at, midi, seconds = beat * .4) {
  const f = hz(midi);
  add(at, seconds, (t, p) => {
    const wave = Math.sin(2 * Math.PI * f * t) + .28 * Math.sin(4 * Math.PI * f * t) + .12 * Math.sin(6 * Math.PI * f * t);
    return wave * Math.min(1, t * 180) * Math.min(1, (1 - p) * 12) * Math.exp(-t * 3);
  }, .29);
}
function pluck(at, midi, accent = 1, pan = 0) {
  const f = hz(midi);
  add(at, .45, t => Math.sin(2 * Math.PI * f * t + 1.3 * Math.exp(-t * 18) * Math.sin(4 * Math.PI * f * t))
    * Math.exp(-t * 9) * Math.min(1, t * 500), .19 * accent, pan);
}
const roots = [45, 41, 48, 43], melody = [0, 7, 12, 7, 3, 10, 7, 15];
for (let bar = 0; bar < bars; bar++) {
  const rootNote = roots[Math.floor(bar / 2) % 4], start = bar * 4 * beat;
  const breakdown = bar >= 12 && bar < 16, intro = bar < 4, outro = bar >= 28;
  for (let b = 0; b < 4; b++) {
    if (!breakdown || b === 0) kick(start + b * beat, intro ? .8 : 1);
    if (!intro && !breakdown && b % 2) snare(start + b * beat);
    hat(start + (b + .5) * beat, !intro && !breakdown);
    if (!intro && !outro) hat(start + b * beat);
    if (!breakdown) {
      bass(start + (b + .5) * beat, rootNote - 12);
      if (!intro && !outro) bass(start + (b + .75) * beat, rootNote, beat * .2);
    }
  }
  const chord = [rootNote + 12, rootNote + (rootNote === 45 ? 15 : 16), rootNote + 19];
  for (const [index, midi] of chord.entries()) {
    const f = hz(midi), chordDuration = 4 * beat;
    add(start, chordDuration, (t, p) => (Math.sin(2 * Math.PI * f * t) + .3 * Math.sin(2 * Math.PI * f * 1.003 * t))
      * Math.min(1, t * 5) * Math.min(1, (1 - p) * 5)
      * (.4 + .6 * Math.min(1, (t % beat) / .15)), breakdown ? .09 : .045, (index - 1) * .65);
  }
  if (bar >= 2 && !outro) for (let step = 0; step < 8; step++) {
    if ((intro || breakdown) && step % 2) continue;
    // A repeated motif with a second-half answer, rather than random pitches.
    const interval = melody[(step + (bar % 4 === 3 ? 2 : 0)) % 8];
    pluck(start + step * beat / 2, rootNote + 24 + interval, breakdown ? .65 : 1, (step % 3 - 1) * .35);
  }
  if ([11, 15, 27].includes(bar)) {
    for (let step = 0; step < 8; step++) snare(start + (3 + step / 8) * beat);
  }
}
// Stereo feedback delay on the mix, kept below the dry transients.
const delay = Math.round(beat * .75 * rate);
for (let i = delay; i < length; i++) {
  left[i] += right[i - delay] * .12; right[i] += left[i - delay] * .12;
}
const pcm = Buffer.alloc(length * 4);
let peak = 0;
for (let i = 0; i < length; i++) {
  const fade = Math.min(1, i / (rate * .008), (length - i) / (rate * 1.8));
  left[i] = Math.tanh(left[i] * 1.15) * fade; right[i] = Math.tanh(right[i] * 1.15) * fade;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
for (let i = 0; i < length; i++) {
  pcm.writeInt16LE(Math.round(left[i] / peak * .89 * 32767), i * 4);
  pcm.writeInt16LE(Math.round(right[i] / peak * .89 * 32767), i * 4 + 2);
}
const wav = Buffer.alloc(44);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
const wavPath = fileURLToPath(new URL('neon-circuit.wav', scratch));
await writeFile(wavPath, Buffer.concat([wav, pcm]));
const encoded = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wavPath, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', fileURLToPath(new URL('audio.m4a', target))], { encoding: 'utf8' });
if (encoded.status !== 0) throw new Error(encoded.stderr || 'ffmpeg failed');

// Maps use exactly the composition's tempo grid. No overlapping same-lane holds.
const levels = {};
for (let level = 1; level <= 4; level++) {
  const chart = [];
  for (let bar = 2; bar < 31; bar++) {
    const breakdown = bar >= 12 && bar < 16;
    const count = level === 1 ? 2 : level === 2 || breakdown ? 4 : 8;
    for (let step = 0; step < count; step++) {
      const lane = (bar + [0, 1, 2, 1, 0, 2, 1, 2][step]) % 3;
      const time = (bar * 4 + step * 4 / count) * beat;
      const duration = breakdown && step === count - 1 ? beat * .7 : 0;
      chart.push({ time, lane, duration, kind: duration ? 'hold' : 'tap' });
      if (level === 4 && !breakdown && bar % 4 === 3 && step === 0) chart.push({ time, lane: (lane + 1) % 3, duration: 0, kind: 'tap' });
    }
  }
  chart.sort((a, b) => a.time - b.time || a.lane - b.lane);
  await writeFile(new URL(`${level}.json`, target), JSON.stringify(chart) + '\n');
  levels[level] = { notes: chart.length, holds: chart.filter(n => n.duration > 0).length, shakes: 0 };
}
// Code-native geometric cover: three luminous orbs and circuit traces.
const size = 512, pixels = Buffer.alloc((size * 3 + 1) * size);
const colors = [[255, 104, 104], [201, 255, 86], [73, 230, 239]];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  let rgb = [12 + y / 80, 20 + y / 50, 31 + y / 70];
  for (let lane = 0; lane < 3; lane++) {
    const cx = 128 + lane * 128, cy = 256 + (lane === 1 ? -50 : 30), d = Math.hypot(x - cx, y - cy);
    const ring = Math.exp(-(((d - 43) / 2.2) ** 2)), aura = .25 * Math.exp(-Math.max(0, d - 43) / 18);
    const orb = d < 39 ? .7 * Math.sqrt(1 - (d / 40) ** 2) : 0;
    const trace = Math.abs(x - cx) < 1.5 && y > cy + 44 && y < 460 ? .45 : 0;
    rgb = rgb.map((v, channel) => Math.min(255, v + colors[lane][channel] * (ring + aura + orb + trace)));
  }
  const offset = y * (size * 3 + 1) + 1 + x * 3;
  rgb.forEach((v, channel) => { pixels[offset + channel] = Math.round(v); });
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), body = Buffer.concat([name, data]), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
await writeFile(new URL('artwork.png', target), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
const catalogPath = new URL('dist/assets/catalog.json', root), catalog = JSON.parse(await readFile(catalogPath));
const song = { id, title: 'Neon Circuit', artist: 'Pulse Lab · программный синтез', duration, tutorial: false, genre: 'Electro · оригинальный трек', levels };
const old = catalog.findIndex(song => song.id === id);
if (old === -1) catalog.push(song); else catalog[old] = song;
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(JSON.stringify({ id, bpm: 128, duration, levels }));

// Build-time analysis only: the browser never routes audible media through an analyser.
export const SAMPLE_RATE = 32000;
export const FFT_SIZE = 2048;
export const SPECTRUM_FPS = 20;
export const BAND_COUNT = 21;
export const BAND_EDGES = Array.from({ length: BAND_COUNT + 1 }, (_, i) => 35 * (14000 / 35) ** (i / BAND_COUNT));

function fft(real, imaginary) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = -2 * Math.PI / size, cosine = Math.cos(angle), sine = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let offset = 0; offset < size / 2; offset++) {
        const a = start + offset, b = a + size / 2;
        const re = wr * real[b] - wi * imaginary[b], im = wr * imaginary[b] + wi * real[b];
        real[b] = real[a] - re; imaginary[b] = imaginary[a] - im; real[a] += re; imaginary[a] += im;
        [wr, wi] = [wr * cosine - wi * sine, wr * sine + wi * cosine];
      }
    }
  }
}

export function analyze(samples) {
  const frames = Math.ceil(samples.length / SAMPLE_RATE * SPECTRUM_FPS) + 1;
  const powers = new Float32Array(frames * BAND_COUNT);
  const window = Float32Array.from({ length: FFT_SIZE }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  const bins = Array.from({ length: BAND_COUNT }, (_, i) => [Math.max(1, Math.ceil(BAND_EDGES[i] * FFT_SIZE / SAMPLE_RATE)), Math.ceil(BAND_EDGES[i + 1] * FFT_SIZE / SAMPLE_RATE)]);
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.round(frame / SPECTRUM_FPS * SAMPLE_RATE) - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) real[i] = (samples[start + i] || 0) * window[i];
    imaginary.fill(0); fft(real, imaginary);
    for (let band = 0; band < BAND_COUNT; band++) {
      let energy = 0;
      for (let bin = bins[band][0]; bin < bins[band][1]; bin++) energy += real[bin] ** 2 + imaginary[bin] ** 2;
      powers[frame * BAND_COUNT + band] = Math.sqrt(energy) / FFT_SIZE * 4;
    }
  }
  // A shared scale keeps strong bass/high bands distinguishable; silence stays zero.
  const sorted = [...powers].sort((a, b) => a - b);
  const reference = Math.max(.03, sorted[Math.floor(sorted.length * .98)]);
  const bytes = new Uint8Array(powers.length), previous = new Float32Array(BAND_COUNT);
  for (let frame = 0; frame < frames; frame++) for (let band = 0; band < BAND_COUNT; band++) {
    const i = frame * BAND_COUNT + band;
    const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-9, powers[i]) / reference) + 48) / 48));
    const smoothed = level > previous[band] ? level : previous[band] * .55 + level * .45;
    bytes[i] = Math.round(smoothed * 255); previous[band] = smoothed;
  }
  return { frames, bytes };
}

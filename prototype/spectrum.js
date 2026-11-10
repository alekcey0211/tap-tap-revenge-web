import spectra from './spectra.json' with { type: 'json' };

const decoded = new Map();
export function sampleSpectrum(songId, position, target = new Float32Array(spectra.bands)) {
  target.fill(0);
  const track = spectra.tracks[songId];
  if (!track || !Number.isFinite(position) || position < 0 || position > track.duration) return target;
  if (!decoded.has(songId)) decoded.set(songId, Uint8Array.from(atob(track.data), value => value.charCodeAt(0)));
  const data = decoded.get(songId), frame = position * spectra.fps;
  const before = Math.min(track.frames - 1, Math.floor(frame)), after = Math.min(track.frames - 1, before + 1), fraction = frame - before;
  for (let band = 0; band < spectra.bands; band++) {
    const a = data[before * spectra.bands + band], b = data[after * spectra.bands + band];
    target[band] = (a + (b - a) * fraction) / 255;
  }
  return target;
}

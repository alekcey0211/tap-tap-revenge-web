// Columns fit inside the circular aperture, including their outer corners.
export function spectrumColumn(index, count = 31, radius = 6.1) {
  const step = radius * 2 / count, width = step * .78;
  const x = (index - (count - 1) / 2) * step;
  const height = 2 * Math.sqrt(Math.max(0, radius ** 2 - (Math.abs(x) + width / 2) ** 2));
  return { x, width, height };
}

export function spectrumLevel(spectrum, index, count = 31) {
  if (!spectrum?.length) return 0;
  const position = index / (count - 1) * (spectrum.length - 1);
  const before = Math.floor(position), after = Math.min(spectrum.length - 1, before + 1);
  return spectrum[before] + (spectrum[after] - spectrum[before]) * (position - before);
}

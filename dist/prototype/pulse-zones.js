// Choose once per attempt, never in the render loop or from an audio callback.
export function choosePulseZones(notes, ends, count, random = Math.random) {
  const grid = [0];
  for (const end of ends) { grid.push((grid.at(-1) + end) / 2, end); }
  const candidates = [];
  for (let start = 0; start < grid.length - 1; start++) for (let span = 1; span <= 2; span++) {
    const end = grid[start + span], duration = end - grid[start];
    if (duration < 6 - 1e-5 || duration > 14 || !Number.isFinite(end)) continue;
    if (notes.some(note => note.time >= grid[start] - 1e-6 && note.time < end - 1e-6)) candidates.push({ start: grid[start], end });
  }
  const next = candidates.map(zone => {
    const index = candidates.findIndex(other => other.start >= zone.end + 4 - 1e-6);
    return index < 0 ? candidates.length : index;
  });
  // Feasibility table avoids retries and guarantees a real gap between every pair.
  const possible = Array.from({ length: candidates.length + 1 }, () => Array(count + 1).fill(false));
  for (const row of possible) row[0] = true;
  for (let i = candidates.length - 1; i >= 0; i--) for (let left = 1; left <= count; left++) {
    possible[i][left] = possible[i + 1][left] || possible[next[i]][left - 1];
  }
  let left = count, from = 0;
  while (left && !possible[0][left]) left--;
  const zones = [];
  while (left) {
    const options = candidates.flatMap((_, i) => i >= from && possible[next[i]][left - 1] ? [i] : []);
    const chosen = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
    zones.push({ ...candidates[chosen] }); from = next[chosen]; left--;
  }
  return zones;
}

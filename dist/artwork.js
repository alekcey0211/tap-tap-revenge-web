// Presentation art lives in the shell, so downloaded music/chart bundles keep their revision.
export function artwork(song) {
  if (song.tutorial) return 'assets/ui/logo.png';
  if (song.id === 'overdrive-v1') return 'assets/scene/overdrive.jpg';
  if (song.id === 'neon-circuit-v1') return 'assets/scene/concert.jpg';
  return `assets/tracks/${song.id}/artwork.png`;
}

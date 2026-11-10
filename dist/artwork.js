// Embedded covers are cached with both the shell and the selected track.
export function artwork(song) {
  if (!song || song.tutorial) return 'assets/scene/calibration.png';
  return `assets/tracks/${song.id}/artwork.jpg`;
}

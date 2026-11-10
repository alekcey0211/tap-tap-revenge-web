// Embedded covers are cached with both the shell and the selected track.
export function artwork(song) {
  if (song.tutorial) return 'assets/ui/logo.png';
  return `assets/tracks/${song.id}/artwork.jpg`;
}

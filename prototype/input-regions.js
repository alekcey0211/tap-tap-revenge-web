// Whole-height touch lanes meet halfway between the projected 3D rings.
// Equal screen thirds are incorrect when the camera's perspective narrows the track.
export function laneWidths(points, width) {
  const first = Math.max(0, Math.min(width, (points[0].x + points[1].x) / 2));
  const second = Math.max(first, Math.min(width, (points[1].x + points[2].x) / 2));
  return [first, second - first, width - second];
}

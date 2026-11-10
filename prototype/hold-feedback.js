// Reflect successful holds only; never infer a hit from pointer-down alone.
export function holdingLanes(notes, time, playing) {
  const lanes = [false, false, false];
  if (playing) for (const note of notes) {
    if (note.state === 'holding' && note.judgment && time < note.time + note.duration) lanes[note.lane] = true;
  }
  return lanes;
}

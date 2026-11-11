// Applied to engine.maxFPS before begin/endFrame, not just to scene.render().
// Audio clocks and input processing remain independent of the graphics budget.
export const pixelRatio = (ratio, coarse) => Math.min(ratio || 1, coarse ? 1 : 1.5);
export const renderFPS = ({ active, paused = false, reduced = false, coarse = false }) =>
  active ? coarse ? 30 : 60 : paused || reduced ? 1 : coarse ? 12 : 20;

import { Engine, WebGPUEngine } from '@babylonjs/core';
import { createScene } from './scene.js';
import { chooseBackend } from './backend.js';
import { laneWidths } from './input-regions.js';
import { sampleSpectrum } from './spectrum.js';
import { HitEffects } from '../dist/hit-effects.js';
import { TRAVEL } from '../dist/engine.js';
import { formatNumber } from '../dist/format.js';

let shared;
const $ = id => document.getElementById(id);
const preference = new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'auto';
const timeout = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('renderer timeout')), ms); })]).finally(() => clearTimeout(timer));
};

export async function prepareRenderer() {
  async function create(gpu) {
    const canvas = document.createElement('canvas'); canvas.className = 'babylon-surface'; canvas.setAttribute('aria-hidden', 'true');
    $('babylon-buffer').replaceChildren(canvas);
    let engine;
    try {
      const options = { antialias: true, audioEngine: false, powerPreference: 'high-performance' };
      engine = gpu ? new WebGPUEngine(canvas, options) : new Engine(canvas, true, options);
      if (gpu) {
        const initializing = engine.initAsync();
        try { await timeout(initializing, 15000); }
        catch (error) { void initializing.then(() => engine.dispose(), () => {}); throw error; }
      }
      engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 1.5));
      const world = createScene(engine, canvas, { fullViewport: true });
      await timeout(world.scene.whenReadyAsync(), 20000);
      return { engine, world, canvas, name: gpu ? 'WebGPU' : `WebGL ${formatNumber(engine.webGLVersion)}` };
    } catch (error) { engine?.dispose(); canvas.remove(); throw error; }
  }
  shared = await chooseBackend({ preference, supported: () => timeout(WebGPUEngine.IsSupportedAsync, 5000), webgpu: () => create(true), webgl: () => create(false) });
  $('babylon-backend').textContent = shared.name;
  let previousNotes, previousSize = '', statsAt = 0;
  const feedback = document.createElement('div'); feedback.className = 'babylon-feedback'; feedback.setAttribute('aria-hidden', 'true');
  const countdown = document.createElement('strong'); countdown.className = 'babylon-countdown';
  const judgments = Array.from({ length: 3 }, () => { const span = document.createElement('span'); feedback.append(span); return span; });
  feedback.append(countdown);
  shared.engine.onContextLostObservable.add(() => {
    // Let the unchanged application pause its own audio/session; never take ownership here.
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    $('babylon-error').hidden = false;
    $('babylon-error-message').textContent = 'Графика прервана. Перезагрузи прототип или выбери WebGL.';
  });
  let ambientTime = 0, stamp = performance.now();
  const ambient = { hits: [], effects: new HitEffects() }, bands = new Float32Array(21);
  shared.engine.runRenderLoop(() => {
    const now = performance.now(), delta = Math.min(.1, Math.max(0, (now - stamp) / 1000)); stamp = now;
    if (document.hidden) return;
    const screen = document.body.dataset.screen;
    const reduced = document.body.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) ambientTime += delta;
    const active = screen === 'game-screen', paused = screen === 'pause-screen';
    const data = active ? shared.pending : { owner: ambient, canvas: $('babylon-background-canvas'),
      time: paused ? shared.pending?.time || 0 : ambientTime, reduced, difficulty: '1', zones: [], track: paused ? shared.pending?.track : null };
    if (!data || !data.canvas.clientWidth || !data.canvas.clientHeight || !data.canvas.getClientRects().length) return;
    const { engine, world, canvas } = shared;
    if (canvas.parentElement !== data.canvas.parentElement) {
      data.canvas.before(canvas); data.canvas.after(feedback); previousSize = '';
    }
    const size = `${data.canvas.clientWidth}:${data.canvas.clientHeight}`;
    if (size !== previousSize) {
      world.resize(); previousSize = size;
      if (data.canvas.id === 'canvas') {
        const widths = laneWidths(world.targets(), data.canvas.clientWidth);
        document.querySelectorAll('.touch-lanes [data-lane]').forEach((button, lane) => { button.style.flex = `0 0 ${widths[lane]}px`; });
      }
    }
    const notes = data.game?.notes || emptyNotes;
    if (notes !== previousNotes) { world.setChart(notes, TRAVEL[data.difficulty] || TRAVEL[1]); previousNotes = notes; }
    const multiplier = data.game?.multiplier(data.time) || 1;
    for (const hit of data.owner.hits.splice(0)) world.hit(hit.lane, hit.time);
    const spectrum = data.track && !data.countdown ? sampleSpectrum(data.track.songId, data.track.position, bands) : null;
    world.update(data.time, active && !data.countdown, multiplier === 8, data.reduced, data.zones, spectrum);
    const effects = data.owner.effects.frame(multiplier, data.time);
    const points = world.targets();
    judgments.forEach((node, lane) => {
      const item = effects.judgments[lane]; node.textContent = item?.text || '';
      node.dataset.failed = String(Boolean(item?.failed));
      node.style.left = `${points[lane].x}px`; node.style.top = `${Math.min(data.canvas.clientHeight - 20, points[lane].y + 28)}px`;
    });
    countdown.textContent = data.countdown > 0 ? formatNumber(Math.ceil(data.countdown)) : '';
    feedback.hidden = data.canvas.id !== 'canvas';
    world.scene.render();
    if (performance.now() - statsAt > 1000) { $('babylon-fps').textContent = `${formatNumber(engine.getFps())} FPS`; statsAt = performance.now(); }
  });
}
const emptyNotes = [];

// Same contract as the live renderer; all game/audio/Pulse/save decisions remain in app.js.
export class Renderer {
  constructor(canvas) {
    if (!shared) throw new Error('Renderer is not initialized');
    this.canvas = canvas; this.hits = []; this.effects = new HitEffects();
    const record = this.effects.recordHit.bind(this.effects), reset = this.effects.reset.bind(this.effects);
    this.effects.recordHit = (note, time, multiplier) => {
      record(note, time, multiplier);
      if (note?.judgment) { this.hits.push({ lane: note.lane, time }); if (this.hits.length > 24) this.hits.shift(); }
    };
    this.effects.reset = () => { reset(); this.hits = []; };
  }
  renderBackdrop() { /* The single engine now paints the shared background on every screen. */ }

  render(game, time, difficulty, duration, countdown = 0, reduced = false, zones = [], track = null) {
    if (this.canvas.id !== 'canvas') return;
    shared.pending = { owner: this, canvas: this.canvas, game, time, difficulty, countdown, reduced, zones, track };
  }
}

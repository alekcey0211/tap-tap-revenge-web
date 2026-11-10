import { Scene, FreeCamera, Vector3, Color3, Color4, MeshBuilder, StandardMaterial, HemisphericLight, PointLight, GlowLayer, Viewport, Matrix } from '@babylonjs/core';
import { TrackRhythm } from '../dist/track-rhythm.js';

const palette = ['#ff668a', '#ffd073', '#68edff'].map(Color3.FromHexString);
const v = (x, y, z) => new Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const random = seed => { let n = seed | 0; return () => { n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return ((n ^ n >>> 16) >>> 0) / 4294967296; }; };

export function createScene(engine, canvas, { fullViewport = false } = {}) {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.018, .014, .046, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = .023; scene.fogColor = new Color3(.018, .014, .046);
  const camera = new FreeCamera('audience', v(0, 8.3, -12), scene);
  camera.setTarget(v(0, 1.6, 9)); camera.minZ = .1; camera.maxZ = 90;
  camera.fov = .88;
  const ambient = new HemisphericLight('ambient', v(0, 1, -1), scene); ambient.intensity = .7; ambient.groundColor = new Color3(.14, .05, .25);
  const pinkLight = new PointLight('magenta-light', v(-5, 5, 6), scene); pinkLight.diffuse = Color3.FromHexString('#c27aff'); pinkLight.intensity = 1.3;
  const blueLight = new PointLight('cyan-light', v(5, 6, 11), scene); blueLight.diffuse = Color3.FromHexString('#80e5ff'); blueLight.intensity = 1.5;
  const frontLight = new PointLight('front-light', v(0, 5, -3), scene); frontLight.intensity = 1.1;
  const glow = new GlowLayer('selective-glow', scene, { mainTextureRatio: .35, blurKernelSize: 32 }); glow.intensity = .55;
  function material(name, color, emission = 0, alpha = 1) {
    const m = new StandardMaterial(name, scene);
    const c = typeof color === 'string' ? Color3.FromHexString(color) : color;
    m.diffuseColor = c.scale(.5); m.emissiveColor = c.scale(emission);
    m.specularColor = new Color3(.06, .05, .08); m.specularPower = 96; m.alpha = alpha;
    if (emission >= .6) m.disableLighting = true;
    return m;
  }
  const dark = material('obsidian', '#16152b', .08);
  const floorMat = material('runway', '#19112f', .07);
  const violet = material('violet-neon', '#9a62ff', 1.5);
  const cyan = material('cyan-neon', '#62dbff', 1.4);
  const white = material('electric-core', '#d4f8ff', 3);
  const laneMats = palette.map((c, i) => material('lane-' + i, c, .65));
  const noteMats = palette.map((c, i) => { const mat = material('orb-' + i, c, .22); mat.specularColor.set(.9, .85, 1); return mat; });
  function box(name, width, height, depth, pos, mat) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene); mesh.position = pos; mesh.material = mat; return mesh;
  }
  function ring(name, diameter, thickness, pos, mat, vertical = false) {
    const mesh = MeshBuilder.CreateTorus(name, { diameter, thickness, tessellation: 64 }, scene);
    mesh.position = pos; mesh.material = mat; if (vertical) mesh.rotation.x = Math.PI / 2; return mesh;
  }
  box('stage-floor', 38, .3, 54, v(0, -.55, 17), dark);
  box('track-base', 6.4, .18, 23, v(0, -.12, 10), floorMat);
  for (const side of [-1, 1]) {
    box('runway-rail', .055, .045, 23, v(side * 3.25, .06, 10), cyan);
    box('outer-rail', .025, .05, 25, v(side * 3.65, -.25, 10), violet);
    for (let i = 0; i < 13; i++) box('edge-marker', .23, .05, .55, v(side * 3.5, .02, i * 1.8), violet);
  }
  for (const x of [-.83, .83]) box('lane-divider', .015, .015, 22, v(x, 0, 10), material('separator', '#56618c', .15));
  const pads = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.65;
    ring('target-bezel', 1.2, .16, v(x, .02, 0), dark);
    const pad = ring('target-light', 1.14, .065, v(x, .13, 0), laneMats[i]); pads.push(pad);
    ring('target-inner', .88, .02, v(x, .14, 0), laneMats[i]);
  }
  box('platform', 15, .5, 5, v(0, -.1, 20), dark);
  box('platform-rim', 15, .05, .07, v(0, .18, 17.45), violet);
  const arches = [];
  for (let i = 0; i < 5; i++) {
    const z = 21 + i * 2.4, diameter = 13 + i * 1.4;
    ring('arch-structure', diameter, .3, v(0, 1.3, z), dark, true);
    arches.push(ring('arch-neon', diameter - .32, .07, v(0, 1.3, z - .1), i % 2 ? cyan : violet, true));
  }
  const panels = [];
  for (const side of [-1, 1]) {
    for (let col = 0; col < 5; col++) {
      const x = side * (5.1 + col * 1.4), z = 12 + col * 2.7, h = 4.8 + col * .6;
      box('led-housing', .95, h + .3, .6, v(x, h / 2, z), dark);
      for (let row = 0; row < 9; row++) {
        const mat = material('led-cell', col % 2 ? '#5abfff' : '#b25bff', .6);
        const mesh = box('led', .79, h / 10, .06, v(x, .3 + row * h / 9, z - .34), mat);
        panels.push({ mesh, mat, row, col, side, color: Color3.FromHexString(col % 2 ? '#5abfff' : '#b25bff') });
      }
    }
  }
  const backPanel = material('screen-lines', '#5ddfff', 1);
  box('screen', 7, 4.8, .4, v(0, 3.5, 25), dark);
  const equalizer = [];
  for (let i = 0; i < 21; i++) equalizer.push(box('equalizer', .14, 1, .05, v((i - 10) * .27, 3, 24.7), backPanel));
  const beams = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, x = side * (4.3 + Math.floor(i / 2) * 2.3), z = 10 + Math.floor(i / 2) * 5;
    const mat = material('haze', i % 2 ? '#57cfff' : '#c47dff', .9, .055); mat.disableLighting = true; mat.backFaceCulling = false;
    const beam = MeshBuilder.CreateCylinder('light-beam', { height: 14, diameterTop: 4, diameterBottom: .07, tessellation: 20 }, scene);
    beam.position = v(x, 6.7, z); beam.material = mat; beams.push({ mesh: beam, side, x, z, mat });
    box('spotlight', .48, .3, .6, v(x, .15, z), dark);
    ring('light-lens', .32, .1, v(x, .34, z), i % 2 ? cyan : violet);
  }
  // Bounded pools: no per-frame mesh construction for notes or hit particles.
  const notePools = noteMats.map((mat, lane) => {
    const base = MeshBuilder.CreateSphere('orb-source-' + lane, { diameter: .67, segments: 20 }, scene);
    base.material = mat; base.isVisible = false;
    return Array.from({ length: 20 }, (_, i) => { const mesh = base.createInstance('note-' + lane + '-' + i); mesh.setEnabled(false); return mesh; });
  });
  const sparkSources = laneMats.map((mat, i) => {
    const mesh = MeshBuilder.CreateSphere('spark-source-' + i, { diameter: .08, segments: 4 }, scene); mesh.material = mat; mesh.isVisible = false; return mesh;
  });
  const bursts = Array.from({ length: 9 }, (_, i) => {
    const lane = i % 3, halo = ring('impact-ring', 1, .035, v(0, .25, 0), laneMats[lane]); halo.setEnabled(false);
    const flash = MeshBuilder.CreateSphere('impact-flash', { diameter: .6, segments: 12 }, scene); flash.material = laneMats[lane]; flash.setEnabled(false);
    const particles = Array.from({ length: 14 }, (_, j) => {
      const mesh = sparkSources[lane].createInstance('spark-' + i + '-' + j); mesh.setEnabled(false);
      const angle = j * Math.PI * 2 / 14;
      return { mesh, velocity: v(Math.cos(angle) * (1.3 + j % 3 * .4), .7 + j % 4 * .7, Math.sin(angle) * 1.5) };
    });
    return { lane, halo, flash, particles, born: -Infinity };
  });
  const tailPools = laneMats.map((mat, lane) => Array.from({ length: 20 }, () => {
    const mesh = box('hold-tail-' + lane, .16, .08, 1, v(0, .35, 0), mat); mesh.setEnabled(false); return mesh;
  }));
  const nextBurst = [0, 0, 0]; let totalHits = 0, lastHit = -Infinity;
  function hit(lane, time) {
    const burst = bursts[lane + (nextBurst[lane]++ % 3) * 3]; burst.born = time;
    burst.halo.position.x = burst.flash.position.x = (lane - 1) * 1.65; burst.flash.position.y = .5;
    totalHits++; lastHit = time;
  }
  // Fixed-length updatable tubes; branches stay outside the playable lanes.
  const bolts = [];
  for (const side of [-1, 1]) {
    for (let branch = 0; branch < 3; branch++) {
      const points = Array.from({ length: branch ? 9 : 22 }, (_, i) => v(side * 4, 7 - i * .2, 15 - i * .3));
      const mesh = MeshBuilder.CreateTube('lightning', { path: points, radius: branch ? .018 : .037, tessellation: 5, updatable: true }, scene);
      mesh.material = white; mesh.setEnabled(false); bolts.push({ mesh, points, side, branch });
    }
  }
  function strike(index) {
    for (const bolt of bolts) {
      const rand = random(index * 997 + bolt.side * 31 + bolt.branch * 127 + 7001);
      const trunk = bolts.find(item => item.side === bolt.side && item.branch === 0);
      const start = bolt.branch ? trunk.points[bolt.branch === 1 ? 7 : 13] : v(bolt.side * 7, 8, 17);
      const end = bolt.branch ? start.add(v(bolt.side * (1.3 + rand()), -2 - rand(), -3 - rand() * 2)) : v(bolt.side * 3.8, .1, .6);
      for (let i = 0; i < bolt.points.length; i++) {
        const t = i / (bolt.points.length - 1), jitter = Math.sin(t * Math.PI) * (bolt.branch ? .5 : 1);
        bolt.points[i].set(mix(start.x, end.x, t) + (rand() - .5) * jitter, mix(start.y, end.y, t) + (rand() - .5) * jitter * .5, mix(start.z, end.z, t) + (rand() - .5) * jitter * 1.3);
      }
      MeshBuilder.CreateTube('lightning', { path: bolt.points, instance: bolt.mesh }, scene);
    }
  }
  const zoneMat = material('pulse-zone', '#baff69', 1.2, .4);
  const zonePools = Array.from({ length: 3 }, () => ({
    sides: [-1, 1].map(side => box('pulse-side', .65, .04, 1, v(side * 3.9, .12, 0), zoneMat)),
    edges: [0, 1].map(() => box('pulse-boundary', 6.4, .025, .04, v(0, .1, 0), zoneMat)),
  }));
  let notes = [], travel = 2.15, lastTime = -Infinity, lastStrike = -Infinity, lastBeat = -1;
  const rhythm = new TrackRhythm();
  function setChart(chart, duration = 2.15) { notes = chart; travel = duration; lastTime = -Infinity; lastBeat = -1; lastStrike = -Infinity; totalHits = 0; lastHit = -Infinity; for (const b of bursts) b.born = -Infinity; }
  function update(time, playing, energy, reduced, pulseZones = []) {
    if (time < lastTime) { totalHits = 0; lastStrike = -Infinity; for (const b of bursts) b.born = -Infinity; }
    lastTime = time;
    const beat = rhythm.frame(notes, time), pulse = reduced ? .2 : beat.pulse;
    if (energy && playing && !reduced && beat.index !== lastBeat && beat.age < .16 && time - lastStrike >= .3) { strike(beat.index); lastStrike = time; }
    lastBeat = beat.index;
    const flash = energy && !reduced ? Math.max(0, 1 - (time - lastStrike) / .2) : 0;
    for (const b of bolts) { b.mesh.setEnabled(flash > 0); b.mesh.visibility = flash; }
    glow.intensity = reduced ? .4 : energy ? .8 + pulse * .35 : .38;
    pinkLight.intensity = energy ? 1.8 + pulse * 1.1 : .8; blueLight.intensity = energy ? 2 + pulse * 1.3 : 1;
    for (const [i, mat] of noteMats.entries()) mat.emissiveColor = palette[i].scale(energy ? .55 : .15);
    for (const panel of panels) {
      const wave = reduced ? 4 : (Math.sin(time * 3 + panel.col * .9 + panel.side) + 1) * 4;
      const lit = panel.row < wave + pulse * 3;
      panel.mat.emissiveColor = panel.color.scale(energy ? (lit ? .95 : .1) : .22);
    }
    for (let i = 0; i < equalizer.length; i++) {
      const bar = equalizer[i]; bar.scaling.y = reduced ? 1 : .5 + Math.abs(Math.sin(time * 3.2 + i * .5)) * (energy ? 2.7 : 1);
      bar.position.y = 1.9 + bar.scaling.y / 2;
    }
    beams.forEach((b, i) => {
      b.mesh.rotation.z = reduced ? b.side * .3 : b.side * (.3 + Math.sin(time * .6 + i) * .3);
      b.mesh.rotation.x = reduced ? -.2 : -.25 + Math.cos(time * .4 + i) * .15;
      b.mat.alpha = energy ? .065 + pulse * .018 : .025;
    });
    zonePools.forEach((pool, index) => {
      const zone = pulseZones[index];
      const start = zone ? Math.max(0, Math.min(20, (zone.start - time) / travel * 20)) : 0;
      const end = zone ? Math.max(0, Math.min(20, (zone.end - time) / travel * 20)) : 0;
      for (const mesh of pool.sides) { mesh.setEnabled(end > start); mesh.position.z = (start + end) / 2; mesh.scaling.z = Math.max(.001, end - start); }
      pool.edges.forEach((mesh, edge) => {
        const stamp = zone && (edge ? zone.end : zone.start);
        mesh.setEnabled(Boolean(zone && stamp >= time && stamp <= time + travel));
        mesh.position.z = edge ? end : start;
      });
    });
    const counts = [0, 0, 0];
    for (const pool of [...notePools, ...tailPools]) for (const mesh of pool) mesh.setEnabled(false);
    for (const note of notes) {
      if (note.time > time + travel) break;
      if (!['pending', 'holding'].includes(note.state) || counts[note.lane] >= 20) continue;
      const remaining = note.time - time, slot = counts[note.lane]++;
      const z = note.state === 'holding' ? 0 : remaining / travel * 20;
      const mesh = notePools[note.lane][slot]; mesh.setEnabled(true);
      mesh.position.set((note.lane - 1) * 1.65, .54, z);
      if (note.duration > 0) {
        const end = Math.min(20, (remaining + note.duration) / travel * 20), start = Math.max(0, z);
        if (end > start) {
          const tail = tailPools[note.lane][slot]; tail.setEnabled(true);
          tail.position.set(mesh.position.x, .35, (start + end) / 2); tail.scaling.z = end - start;
        }
      }
    }
    for (const burst of bursts) {
      const age = time - burst.born, visible = age >= 0 && age < .55;
      burst.halo.setEnabled(visible); burst.flash.setEnabled(visible && age < .12);
      if (visible) {
        burst.halo.scaling.setAll(1 + age * (energy ? 4 : 2)); burst.halo.visibility = 1 - age / .55;
        burst.flash.scaling.setAll(1 + age * 3); burst.flash.visibility = 1 - age / .12;
      }
      for (const p of burst.particles) {
        p.mesh.setEnabled(visible && !reduced); if (!visible || reduced) continue;
        const strength = energy ? 1.6 : .9;
        p.mesh.position.set((burst.lane - 1) * 1.65 + p.velocity.x * age * strength, .4 + p.velocity.y * age - age * age * 3, p.velocity.z * age * strength);
        p.mesh.scaling.setAll((1 - age / .55) * (energy ? 1.8 : 1));
      }
    }
    pads.forEach((pad, i) => { const age = time - Math.max(...bursts.filter(b => b.lane === i).map(b => b.born)); pad.scaling.setAll(1 + Math.max(0, 1 - age / .2) * .12); });
    return { hits: totalHits, hitAge: time - lastHit };
  }
  function resize() {
    engine.resize();
    // Keep all three target rings in frame on portrait screens, without camera controls.
    const height = Math.max(1, canvas.clientHeight);
    const available = fullViewport ? height : Math.min(height, Math.max(240, canvas.ownerDocument.querySelector('.dock').getBoundingClientRect().top + 12));
    camera.viewport = new Viewport(0, 1 - available / height, 1, available / height);
    const aspect = canvas.clientWidth / available;
    camera.fov = canvas.clientWidth <= 600 ? Math.max(.8, 2 * Math.atan(.28 / aspect)) : .88;
  }
  resize();
  function targets() {
    const height = canvas.clientHeight * camera.viewport.height;
    const transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
    const viewport = new Viewport(0, 0, canvas.clientWidth, height);
    return pads.map(pad => Vector3.Project(pad.position, Matrix.Identity(), transform, viewport));
  }
  return { scene, update, setChart, resize, hit, targets };
}

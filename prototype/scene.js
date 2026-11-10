import { Scene, FreeCamera, Vector3, Color3, Color4, MeshBuilder, StandardMaterial, HemisphericLight, PointLight, GlowLayer, Viewport, Matrix, TransformNode } from '@babylonjs/core';
import { holdingLanes } from './hold-feedback.js';
import { spectrumColumn, spectrumLevel } from './venue-layout.js';
import { TrackRhythm } from '../dist/track-rhythm.js';

const TRACK_WIDTH = 6.4, LANE_WIDTH = TRACK_WIDTH / 3;
const EQUALIZER_Y = 11.6;
const TRACK_NEAR = -1.5, TRACK_FAR = 64, NOTE_FAR = 56, TRAVEL_DISTANCE = 20;
const TRACK_LENGTH = TRACK_FAR - TRACK_NEAR, TRACK_CENTER = (TRACK_FAR + TRACK_NEAR) / 2;

const palette = ['#ff668a', '#ffd073', '#68edff'].map(Color3.FromHexString);
const v = (x, y, z) => new Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const random = seed => { let n = seed | 0; return () => { n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return ((n ^ n >>> 16) >>> 0) / 4294967296; }; };

export function createScene(engine, canvas, { fullViewport = false } = {}) {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.038, .012, .082, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = .017; scene.fogColor = new Color3(.038, .012, .082);
  const camera = new FreeCamera('audience', v(0, 8.3, -12), scene);
  camera.setTarget(v(0, 1.6, 9)); camera.minZ = .1; camera.maxZ = 160;
  camera.fov = .88;
  const ambient = new HemisphericLight('ambient', v(0, 1, -1), scene); ambient.intensity = .95; ambient.groundColor = new Color3(.14, .05, .25);
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
  const pink = material('rose-neon', '#ff6edb', 1.35);
  const gold = material('amber-neon', '#ffca88', 1.25);
  const white = material('electric-core', '#d4f8ff', 3);
  const laneMats = palette.map((c, i) => material('lane-' + i, c, .65));
  const noteMats = palette.map((c, i) => { const mat = material('orb-' + i, c, .15); mat.specularColor.set(.9, .85, 1); return mat; });
  function box(name, width, height, depth, pos, mat) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene); mesh.position = pos; mesh.material = mat; return mesh;
  }
  function ring(name, diameter, thickness, pos, mat, vertical = false) {
    const mesh = MeshBuilder.CreateTorus(name, { diameter, thickness, tessellation: 64 }, scene);
    mesh.position = pos; mesh.material = mat; if (vertical) mesh.rotation.x = Math.PI / 2; return mesh;
  }
  box('stage-floor', 38, .3, 80, v(0, -.55, 30), dark);
  box('track-base', TRACK_WIDTH, .18, TRACK_LENGTH, v(0, -.12, TRACK_CENTER), floorMat);
  for (const side of [-1, 1]) {
    box('runway-rail', .055, .045, TRACK_LENGTH, v(side * 3.25, .06, TRACK_CENTER), cyan);
    box('outer-rail', .025, .05, TRACK_LENGTH + 2, v(side * 3.65, -.25, TRACK_CENTER), violet);
    for (let i = 0; i < Math.ceil(TRACK_FAR / 1.8); i++) box('edge-marker', .23, .05, .55, v(side * 3.5, .02, i * 1.8), violet);
  }
  for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) box('lane-divider', .015, .015, TRACK_LENGTH, v(x, 0, TRACK_CENTER), material('separator', '#56618c', .15));
  const energyMat = material('runway-energy', '#8fefff', 1.1);
  const energyRails = [], energyMarkers = [];
  for (const side of [-1, 1]) {
    energyRails.push(box('energy-rail', .1, .035, TRACK_LENGTH, v(side * 3.3, .1, TRACK_CENTER), energyMat));
    for (let i = 0; i < Math.ceil(TRACK_FAR / 1.6); i++) {
      const mesh = box('energy-chevron', .18, .04, .8, v(side * 3.55, .12, 0), i % 2 ? gold : cyan);
      mesh.rotation.y = side * -.55; energyMarkers.push({ mesh, index: i });
    }
  }
  const pads = [], targetArcs = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * LANE_WIDTH;
    ring('target-bezel', 1.2, .16, v(x, .02, 0), dark);
    const pad = ring('target-light', 1.14, .065, v(x, .13, 0), laneMats[i]); pads.push(pad);
    ring('target-inner', .88, .02, v(x, .14, 0), laneMats[i]);
    for (let arc = 0; arc < 2; arc++) {
      const radius = .69 + arc * .045;
      const path = Array.from({ length: 19 }, (_, step) => {
        const angle = step / 18 * Math.PI * .72;
        return v(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      });
      const mesh = MeshBuilder.CreateTube('target-energy-arc', { path, radius: .027, tessellation: 6 }, scene);
      mesh.position.set(x, .18 + arc * .025, 0); mesh.material = laneMats[i]; mesh.setEnabled(false);
      targetArcs.push({ mesh, lane: i, arc });
    }
  }
  // Leave the centre open: no opaque platform or crossbar across the runway.
  for (const side of [-1, 1]) {
    box('platform-wing', 3.3, .5, 5, v(side * 5.85, -.1, 20), dark);
    box('platform-rim', 3.3, .05, .07, v(side * 5.85, .18, 17.45), violet);
  }
  const arches = [];
  for (let i = 0; i < 5; i++) {
    const z = 21 + i * 2.4, diameter = 13 + i * 1.4;
    const y = EQUALIZER_Y + i * .4; // Keep the wider rear rims above distant notes too.
    ring('arch-structure', diameter, .3, v(0, y, z), dark, true);
    arches.push(ring('arch-neon', diameter - .32, .07, v(0, y, z - .1), [violet, cyan, pink, violet, gold][i], true));
  }
  const panels = [];
  for (const side of [-1, 1]) {
    for (let col = 0; col < 5; col++) {
      const x = side * (5.1 + col * 1.4), z = 12 + col * 2.7, h = 9.5 + col * .6;
      box('led-housing', .95, h + .3, .6, v(x, h / 2, z), dark);
      for (let row = 0; row < 9; row++) {
        const mat = material('led-cell', col % 2 ? '#5abfff' : '#b25bff', .6);
        const mesh = box('led', .79, h / 10, .06, v(x, .3 + row * h / 9, z - .34), mat);
        panels.push({ mesh, mat, row, col, side, color: Color3.FromHexString(col % 2 ? '#5abfff' : '#b25bff') });
      }
    }
  }
  // The spectrum fills the inner arch instead of a small rectangular screen.
  const screen = MeshBuilder.CreateDisc('spectrum-disc', { radius: 6.5, tessellation: 96, sideOrientation: 2 }, scene);
  // Opaque backing overlaps the inner rim, sealing the former see-through seam.
  screen.position.set(0, EQUALIZER_Y, 21.4); screen.material = dark;
  const equalizer = [];
  for (let i = 0; i < 31; i++) {
    const { x, width, height } = spectrumColumn(i, 31, 6.32);
    const color = Color3.Lerp(Color3.FromHexString('#ff76df'), Color3.FromHexString('#55f1ff'), i / 30);
    const mat = material('spectrum-band-' + i, color, .65);
    const idle = material('spectrum-idle-' + i, color, .12); idle.disableLighting = true;
    box('spectrum-bed', width, height, .04, v(x, EQUALIZER_Y, 21.3), idle);
    const bar = box('equalizer', width, 1, .08, v(x, EQUALIZER_Y, 21.2), mat);
    const caps = [-1, 1].map(side => ({ side, mesh: box('spectrum-cap', width, .035, .1, v(x, EQUALIZER_Y, 21.13), mat) }));
    equalizer.push({ bar, caps, height });
  }
  // Stage wings and floor light pools add the depth and colour of the old concert art.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const mat = material('floor-pool', side < 0 ? '#ba45fa' : '#299edc', .8, .12);
      const pool = MeshBuilder.CreateDisc('floor-light', { radius: 2.3, tessellation: 24 }, scene);
      pool.rotation.x = Math.PI / 2; pool.position.set(side * (6 + i * 2.2), -.36, 6 + i * 4.5); pool.scaling.y = 2.2; pool.material = mat;
      box('wing-neon', .06, 7 + i * .7, .1, v(side * (7 + i * 1.7), 3.5 + i * .35, 20 + i * 2.4), i % 2 ? cyan : pink);
    }
  }
  const crowdMat = material('audience', '#221437', .2);
  const headSource = MeshBuilder.CreateSphere('audience-head-source', { diameter: .38, segments: 6 }, scene);
  headSource.material = crowdMat; headSource.isVisible = false;
  const bodySource = MeshBuilder.CreateCylinder('audience-body-source', { height: .7, diameterTop: .42, diameterBottom: .5, tessellation: 6 }, scene);
  bodySource.material = crowdMat; bodySource.isVisible = false;
  const crowdRandom = random(901), audience = [];
  const audienceTrims = Array.from({ length: 10 }, (_, row) => {
    const mesh = MeshBuilder.CreateTorus('audience-trim-source', { diameter: .43, thickness: .025, tessellation: 12 }, scene);
    mesh.material = row < 5 ? pink : cyan; mesh.isVisible = false; return mesh;
  });
  for (const side of [-1, 1]) for (let i = 0; i < 30; i++) {
    const x = side * (4.4 + (i % 6) * .66), z = 5.5 + Math.floor(i / 6) * 1.5, height = .8 + crowdRandom() * .25;
    const body = bodySource.createInstance('audience-body'); body.position.set(x, height / 2 - .25, z); body.scaling.y = height / .7;
    const head = headSource.createInstance('audience-head'); head.position.set(x, height - .22, z);
    const trim = audienceTrims[(side < 0 ? 0 : 5) + Math.floor(i / 6)].createInstance('audience-energy-trim');
    trim.position.set(x, height - .3, z); trim.setEnabled(false);
    audience.push({ body, head, trim, height, phase: Math.floor(i / 6) * .8 + i % 6 * .45 });
  }
  const beams = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, x = side * (4.3 + Math.floor(i / 2) * 2.3), z = 10 + Math.floor(i / 2) * 5;
    const mat = material('haze', i % 2 ? '#57cfff' : '#c47dff', .9, .055); mat.disableLighting = true; mat.backFaceCulling = false;
    const beam = MeshBuilder.CreateCylinder('light-beam', { height: 24, diameterTop: 6, diameterBottom: .07, tessellation: 20 }, scene);
    const mount = new TransformNode('spotlight-pivot', scene); mount.position.set(x, .34, z);
    beam.parent = mount; beam.position.y = 12;
    glow.addExcludedMesh(beam); beam.material = mat; beams.push({ mount, side, mat });
    box('spotlight', .48, .3, .6, v(x, .15, z), dark);
    ring('light-lens', .32, .1, v(x, .34, z), i % 2 ? cyan : violet);
  }
  // Bounded pools: no per-frame mesh construction for notes or hit particles.
  const notePools = noteMats.map((mat, lane) => {
    const base = MeshBuilder.CreateSphere('orb-source-' + lane, { diameter: .67, segments: 20 }, scene);
    base.material = mat; base.isVisible = false; glow.addExcludedMesh(base);
    return Array.from({ length: 40 }, (_, i) => { const mesh = base.createInstance('note-' + lane + '-' + i); glow.addExcludedMesh(mesh); mesh.setEnabled(false); return mesh; });
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
  const tailPools = laneMats.map((mat, lane) => Array.from({ length: 40 }, () => {
    const mesh = box('hold-tail-' + lane, .16, .08, 1, v(0, .35, 0), mat); mesh.setEnabled(false); return mesh;
  }));
  const holdPools = laneMats.map((mat, lane) => {
    const halo = ring('hold-contact', 1.05, .045, v((lane - 1) * LANE_WIDTH, .28, 0), mat);
    halo.setEnabled(false);
    const sparks = Array.from({ length: 12 }, (_, index) => {
      const mesh = sparkSources[lane].createInstance('hold-spark-' + lane + '-' + index);
      mesh.setEnabled(false); return mesh;
    });
    return { halo, sparks };
  });
  const nextBurst = [0, 0, 0]; let totalHits = 0, lastHit = -Infinity;
  function hit(lane, time) {
    const burst = bursts[lane + (nextBurst[lane]++ % 3) * 3]; burst.born = time;
    burst.halo.position.x = burst.flash.position.x = (lane - 1) * LANE_WIDTH; burst.flash.position.y = .5;
    totalHits++; lastHit = time;
  }
  // Fixed-length tubes: central overhead origins, side landings, foreground compositing.
  scene.setRenderingAutoClearDepthStencil(1, true, true, true);
  const bolts = [];
  for (const side of [-1, 1]) {
    for (let bank = 0; bank < 2; bank++) for (let branch = 0; branch < 4; branch++) {
      const points = Array.from({ length: branch ? 9 : 22 }, (_, i) => v(side * 4, 7 - i * .2, 15 - i * .3));
      const mesh = MeshBuilder.CreateTube('lightning', { path: points, radius: branch ? .023 : .048, tessellation: 5, updatable: true }, scene);
      mesh.material = white; mesh.renderingGroupId = 1; mesh.setEnabled(false); bolts.push({ mesh, points, side, bank, branch });
    }
  }
  function strike(index) {
    for (const bolt of bolts) {
      const rand = random(index * 997 + bolt.side * 31 + bolt.bank * 521 + bolt.branch * 127 + 7001);
      const trunk = bolts.find(item => item.side === bolt.side && item.bank === bolt.bank && item.branch === 0);
      const start = bolt.branch ? trunk.points[4 + bolt.branch * 4] : v(bolt.side * (2.2 + bolt.bank * .5), 9 + bolt.bank * 2, 18 + bolt.bank * 4);
      const end = bolt.branch ? start.add(v(bolt.side * (1 + rand()), -1.6 - rand(), -2 - rand() * 2)) : v(bolt.side * (3.6 + bolt.bank * 1.1), .1, .6 + bolt.bank * 7);
      for (let i = 0; i < bolt.points.length; i++) {
        const t = i / (bolt.points.length - 1), jitter = Math.sin(t * Math.PI) * (bolt.branch ? .5 : 1);
        bolt.points[i].set(mix(start.x, end.x, t) + (rand() - .5) * jitter, mix(start.y, end.y, t) + (rand() - .5) * jitter * .5, mix(start.z, end.z, t) + (rand() - .5) * jitter * 1.3);
        // Near the runway, keep every branch outside the note lanes.
        const clearance = bolt.points[i].y < 3 ? 3.5 : 1.8;
        bolt.points[i].x = bolt.side * Math.max(clearance, Math.abs(bolt.points[i].x));
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
  function update(time, playing, energy, reduced, pulseZones = [], spectrum = null) {
    if (time < lastTime) { totalHits = 0; lastStrike = -Infinity; for (const b of bursts) b.born = -Infinity; }
    lastTime = time;
    const beat = rhythm.frame(notes, time), pulse = reduced ? .2 : beat.pulse;
    if (energy && playing && !reduced && beat.index !== lastBeat && beat.age < .16 && time - lastStrike >= .3) { strike(beat.index); lastStrike = time; }
    lastBeat = beat.index;
    for (const b of bolts) {
      const age = time - lastStrike - b.bank * .055;
      const flash = energy && playing && !reduced && age >= 0 ? Math.max(0, 1 - age / .32) : 0;
      b.mesh.setEnabled(flash > 0); b.mesh.visibility = flash;
    }
    floorMat.emissiveColor.set(energy ? .13 + pulse * .025 : .007, energy ? .035 : .005, energy ? .23 + pulse * .035 : .013);
    for (const rail of energyRails) { rail.setEnabled(energy); rail.visibility = reduced ? .5 : .65 + pulse * .3; }
    for (const { mesh, index } of energyMarkers) {
      mesh.setEnabled(energy);
      mesh.position.z = reduced || !playing ? index * 1.6 : TRACK_FAR - (time * 10 + index * 1.6) % TRACK_FAR;
      mesh.visibility = reduced ? .45 : .65 + pulse * .3;
    }
    glow.intensity = reduced ? .4 : energy ? .5 + pulse * .04 : .48;
    // Keep note lighting independent of the multiplier; energy belongs to the scenery.
    pinkLight.intensity = 1.5; blueLight.intensity = 1.7;
    const animateEnergy = energy && playing && !reduced;
    for (const { mesh, lane, arc } of targetArcs) {
      mesh.setEnabled(energy);
      mesh.rotation.y = lane * .8 + arc * Math.PI + (animateEnergy ? time * (arc ? -2.8 : 3.4) : 0);
      mesh.scaling.setAll(1 + (animateEnergy ? pulse * .045 : 0));
      mesh.visibility = animateEnergy ? .7 + pulse * .3 : .65;
    }
    for (const { body, head, trim, height, phase } of audience) {
      const wave = animateEnergy ? Math.pow((Math.sin(time * 5 - phase) + 1) / 2, 3) : 0;
      const lift = wave * (.08 + pulse * .14);
      body.scaling.y = (height + lift) / .7; body.position.y = (height + lift) / 2 - .25;
      head.position.y = height + lift - .22;
      trim.position.y = height + lift - .3; trim.setEnabled(energy);
    }
    audienceTrims.forEach((source, row) => {
      const wave = animateEnergy ? Math.pow((Math.sin(time * 5 - row % 5 * .8) + 1) / 2, 3) : 0;
      // Instances share the source opacity, keeping each wave row in one draw group.
      source.visibility = animateEnergy ? .25 + wave * (.45 + pulse * .3) : .45;
    });
    for (const panel of panels) {
      const band = spectrum?.[panel.col * 4] || 0;
      const wave = reduced ? 5 : spectrum ? band * 9 : (Math.sin(time * 1.4 + panel.col * .9 + panel.side) + 1) * 3 + 1;
      const lit = panel.row < wave + pulse * 3;
      panel.mat.emissiveColor = panel.color.scale(lit ? energy ? .95 + pulse * .2 : .75 : .12);
    }
    for (let i = 0; i < equalizer.length; i++) {
      const { bar, caps, height } = equalizer[i];
      // No random or sine-driven fake equalizer; outside playback the screen is idle.
      const level = reduced ? .12 : spectrumLevel(spectrum, i);
      bar.scaling.y = .07 + Math.pow(level, .65) * (height - .07);
      for (const cap of caps) {
        cap.mesh.position.y = EQUALIZER_Y + cap.side * (bar.scaling.y / 2 - .02);
        cap.mesh.setEnabled(Boolean(spectrum) && !reduced && level > .03);
      }
    }
    beams.forEach((b, i) => {
      b.mount.rotation.z = reduced ? b.side * .3 : b.side * (.3 + Math.sin(time * (energy ? 1.5 : .6) + i) * .3);
      b.mount.rotation.x = reduced ? -.2 : -.25 + Math.cos(time * (energy ? 1.1 : .4) + i) * .15;
      b.mat.alpha = energy ? .075 + pulse * .035 : .035;
    });
    zonePools.forEach((pool, index) => {
      const zone = pulseZones[index];
      const start = zone ? Math.max(0, Math.min(NOTE_FAR, (zone.start - time) / travel * TRAVEL_DISTANCE)) : 0;
      const end = zone ? Math.max(0, Math.min(NOTE_FAR, (zone.end - time) / travel * TRAVEL_DISTANCE)) : 0;
      for (const mesh of pool.sides) { mesh.setEnabled(end > start); mesh.position.z = (start + end) / 2; mesh.scaling.z = Math.max(.001, end - start); }
      pool.edges.forEach((mesh, edge) => {
        const stamp = zone && (edge ? zone.end : zone.start);
        mesh.setEnabled(Boolean(zone && stamp >= time && stamp <= time + travel * NOTE_FAR / TRAVEL_DISTANCE));
        mesh.position.z = edge ? end : start;
      });
    });
    const counts = [0, 0, 0];
    for (const pool of [...notePools, ...tailPools]) for (const mesh of pool) mesh.setEnabled(false);
    for (const note of notes) {
      if (note.time > time + travel * NOTE_FAR / TRAVEL_DISTANCE) break;
      if (!['pending', 'holding'].includes(note.state) || counts[note.lane] >= notePools[note.lane].length) continue;
      const remaining = note.time - time, slot = counts[note.lane]++;
      const z = note.state === 'holding' ? 0 : remaining / travel * TRAVEL_DISTANCE;
      const mesh = notePools[note.lane][slot]; mesh.setEnabled(true);
      mesh.position.set((note.lane - 1) * LANE_WIDTH, .54, z);
      // Ease in at the distant end, rather than popping into the old near portal.
      const arrival = Math.max(0, Math.min(1, (NOTE_FAR - z) / 8));
      mesh.scaling.setAll(arrival);
      if (note.duration > 0) {
        const end = Math.min(NOTE_FAR, (remaining + note.duration) / travel * TRAVEL_DISTANCE), start = Math.max(0, z);
        if (end > start) {
          const tail = tailPools[note.lane][slot]; tail.setEnabled(true);
          tail.position.set(mesh.position.x, .35, (start + end) / 2); tail.scaling.set(arrival, 1, end - start);
        }
      }
    }
    const held = holdingLanes(notes, time, playing);
    holdPools.forEach(({ halo, sparks }, lane) => {
      halo.setEnabled(held[lane]);
      halo.scaling.setAll(reduced ? 1 : 1 + Math.sin(time * 18) * .045);
      sparks.forEach((mesh, index) => {
        mesh.setEnabled(held[lane] && !reduced);
        if (!held[lane] || reduced) return;
        const age = (time * 2.8 + index / sparks.length) % 1;
        const angle = index * 2.39996 + Math.floor(time * 2.8) * .7;
        const radius = .18 + age * .65;
        mesh.position.set((lane - 1) * LANE_WIDTH + Math.cos(angle) * radius,
          .4 + Math.sin(age * Math.PI) * (.6 + index % 3 * .15), Math.sin(angle) * radius);
        // Instances share visibility with their source; shrinking gives the fade-out.
        mesh.scaling.setAll((1 - age) * 1.6);
      });
    });
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
        p.mesh.position.set((burst.lane - 1) * LANE_WIDTH + p.velocity.x * age * strength, .4 + p.velocity.y * age - age * age * 3, p.velocity.z * age * strength);
        p.mesh.scaling.setAll((1 - age / .55) * (energy ? 1.8 : 1));
      }
    }
    pads.forEach((pad, i) => { const age = time - Math.max(...bursts.filter(b => b.lane === i).map(b => b.born)); pad.scaling.setAll(1 + Math.max(0, 1 - age / .2) * .12 + (animateEnergy ? pulse * .035 : 0)); });
    return { hits: totalHits, hitAge: time - lastHit };
  }
  function resize({ targetBottom = null } = {}) {
    engine.resize();
    // Keep all three target rings in frame on portrait screens, without camera controls.
    const height = Math.max(1, canvas.clientHeight);
    const available = fullViewport ? height : Math.min(height, Math.max(240, canvas.ownerDocument.querySelector('.dock').getBoundingClientRect().top + 12));
    camera.viewport = new Viewport(0, 1 - available / height, 1, available / height);
    const aspect = canvas.clientWidth / available;
    camera.fov = canvas.clientWidth <= 600 ? Math.max(.8, 2 * Math.atan(.28 / aspect)) : .88;
    if (targetBottom !== null) {
      // Aim the target rings just above the footer on every viewport height.
      const targetY = available - targetBottom;
      const pitch = Math.atan2(camera.position.y - .13, -camera.position.z)
        - Math.atan((2 * targetY / available - 1) * Math.tan(camera.fov / 2));
      camera.setTarget(v(0, camera.position.y - 21 * Math.tan(pitch), 9));
    } else camera.setTarget(v(0, 1.6, 9));
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

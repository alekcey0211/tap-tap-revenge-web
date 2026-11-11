import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Vector3 } from '@babylonjs/core';
import { createScene } from './scene.js';

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 390, renderHeight: 844 });
  t.after(() => engine.dispose());
  const world = createScene(engine, { clientWidth: 390, clientHeight: 844 }, { fullViewport: true });
  world.setChart(Array.from({ length: 80 }, (_, i) => ({ time: i * .5, lane: i % 3, state: 'pending', duration: 0 })));
  return world;
}
const named = (world, name) => world.scene.meshes.filter(mesh => mesh.name === name);
const positions = meshes => meshes.map(mesh => [...mesh.position.asArray(), ...mesh.scaling.asArray(), ...mesh.rotation.asArray(), mesh.visibility]);

test('×8 animates target arcs without moving hit targets or changing note lighting', t => {
  const world = fixture(t);
  world.update(10.01, true, false, false);
  const targets = world.targets().map(point => point.asArray());
  const orbs = world.scene.materials.filter(mat => mat.name.startsWith('orb-'));
  const lighting = () => ({
    emissions: orbs.map(mat => mat.emissiveColor.asArray()),
    lights: world.scene.lights.map(light => light.intensity),
  });
  const normal = lighting();
  const arcs = named(world, 'target-energy-arc');
  assert.equal(arcs.length, 6);
  assert.ok(arcs.every(mesh => !mesh.isEnabled()));
  world.update(10.01, true, true, false);
  const first = positions(arcs);
  world.update(10.15, true, true, false);
  assert.ok(arcs.every(mesh => mesh.isEnabled()));
  assert.notDeepEqual(positions(arcs), first);
  assert.deepEqual(world.targets().map(point => point.asArray()), targets);
  assert.deepEqual(lighting(), normal);
});

test('side columns move and illuminate on ×8, then return to their normal pose', t => {
  const world = fixture(t);
  world.update(10, true, false, false);
  const heads = named(world, 'audience-head'), bodies = named(world, 'audience-body');
  const trims = named(world, 'audience-energy-trim');
  const normal = positions([...heads, ...bodies]);
  assert.equal(trims.length, 60);
  assert.ok(trims.every(mesh => !mesh.isEnabled()));
  world.update(10.01, true, true, false);
  const first = positions([...heads, ...bodies, ...trims]);
  assert.ok(trims.every(mesh => mesh.isEnabled()));
  world.update(10.2, true, true, false);
  assert.notDeepEqual(positions([...heads, ...bodies, ...trims]), first);
  world.update(10.2, true, false, false);
  assert.deepEqual(positions([...heads, ...bodies]), normal);
  assert.ok(trims.every(mesh => !mesh.isEnabled()));
});

test('new energy effects are static when paused or reduced motion is enabled', t => {
  const world = fixture(t);
  const meshes = ['target-energy-arc', 'target-light', 'audience-body', 'audience-head', 'audience-energy-trim'].flatMap(name => named(world, name));
  for (const [playing, reduced] of [[false, false], [true, true]]) {
    world.update(10.01, playing, true, reduced);
    const first = positions(meshes);
    world.update(11.15, playing, true, reduced);
    assert.deepEqual(positions(meshes), first);
  }
});

test('energy effects stay pooled and spotlight sources remain anchored', t => {
  const world = fixture(t);
  const count = world.scene.meshes.length;
  const beams = named(world, 'light-beam');
  const bottom = mesh => Vector3.TransformCoordinates(new Vector3(0, -12, 0), mesh.computeWorldMatrix(true));
  world.update(10.01, true, true, false);
  const origins = beams.map(bottom);
  for (let i = 0; i < 200; i++) world.update(10.01 + i / 60, true, true, false);
  assert.equal(world.scene.meshes.length, count);
  beams.forEach((mesh, i) => assert.ok(Vector3.Distance(bottom(mesh), origins[i]) < 1e-6));
  world.update(14, true, false, false);
  assert.ok(named(world, 'target-energy-arc').every(mesh => !mesh.isEnabled()));
});

test('equal-width lanes centre targets, notes and held-note feedback', t => {
  const world = fixture(t);
  const dividers = named(world, 'lane-divider').map(mesh => mesh.position.x);
  const edges = [-3.2, ...dividers, 3.2];
  const pads = named(world, 'target-light');
  const notes = [0, 1, 2].map(lane => ({ lane, time: 10, duration: 2, state: 'holding', judgment: 'perfect' }));
  world.setChart(notes, 2);
  world.update(10.5, true, true, true);
  for (let lane = 0; lane < 3; lane++) {
    assert.ok(Math.abs(edges[lane + 1] - edges[lane] - 6.4 / 3) < 1e-8);
    const centre = (edges[lane] + edges[lane + 1]) / 2;
    assert.ok(Math.abs(pads[lane].position.x - centre) < 1e-8);
    assert.equal(world.scene.getMeshByName(`note-${lane}-0`).position.x, pads[lane].position.x);
    assert.equal(named(world, 'hold-contact')[lane].position.x, pads[lane].position.x);
  }
});

test('distant notes approach continuously on the extended runway', t => {
  const world = fixture(t);
  world.setChart([{ time: 10, lane: 0, duration: 1, state: 'pending' }], 2);
  const note = world.scene.getMeshByName('note-0-0');
  world.update(4.41, true, false, false);
  assert.ok(note.isEnabled());
  assert.ok(note.position.z > 55 && note.scaling.x < .02);
  world.update(5, true, false, false);
  assert.equal(note.position.z, 50);
  world.update(8, true, false, false);
  assert.equal(note.position.z, 20);
  assert.equal(note.scaling.x, 1);
  world.update(10, true, false, false);
  assert.equal(note.position.z, 0);
  const track = world.scene.getMeshByName('track-base');
  track.computeWorldMatrix(true);
  assert.ok(track.getBoundingInfo().boundingBox.maximumWorld.z >= 64);
  assert.equal(world.scene.getMeshByName('platform'), null);
});

test('raised equalizer seals the rim and clears the distant note path', t => {
  const world = fixture(t);
  const disc = world.scene.getMeshByName('spectrum-disc');
  assert.equal(disc.parent, null);
  assert.deepEqual(disc.position.asArray(), [0, 11.6, 21.4]);
  assert.deepEqual(disc.scaling.asArray(), [1, 1, 1]);
  assert.equal(disc.applyFog, true);
  named(world, 'arch-neon').forEach((mesh, i) => {
    assert.equal(mesh.parent, null);
    assert.equal(mesh.position.y, 11.6 + i * .4);
    assert.ok(Math.abs(mesh.position.z - (20.9 + i * 2.4)) < 1e-8);
    assert.deepEqual(mesh.scaling.asArray(), [1, 1, 1]);
  });
  disc.computeWorldMatrix(true);
  assert.ok(disc.getBoundingInfo().boundingBox.extendSize.x >= 6.49);
  // Conservative ray to the top of a full-size note at the farthest visible point.
  named(world, 'arch-structure').forEach((mesh, i) => {
    const noteRayY = 8.3 + (.54 + .335 - 8.3) * (mesh.position.z + 12) / (56 + 12);
    const rimBottom = mesh.position.y - (13 + i * 1.4) / 2 - .15;
    assert.ok(rimBottom > noteRayY, `arch ${i} must clear the approaching notes`);
  });
  world.update(10, true, false, false, [], new Float32Array(21).fill(.5));
  for (const bar of named(world, 'equalizer')) assert.equal(bar.position.y, 11.6);

});


test('lightning starts centrally, keeps side landings and renders above the stage', t => {
  const world = fixture(t);
  world.update(10.01, true, true, false);
  world.update(10.08, true, true, false);
  const bolts = named(world, 'lightning');
  assert.equal(bolts.length, 16);
  assert.ok(bolts.every(mesh => mesh.isEnabled() && mesh.renderingGroupId === 1));
  assert.deepEqual(world.scene.getAutoClearDepthStencilSetup(1), { autoClear: true, depth: true, stencil: true });
  assert.ok(named(world, 'led').every(mesh => mesh.renderingGroupId === 0));
  const centre = (vertices, ring) => [0, 1, 2].map(axis => {
    let sum = 0;
    for (let vertex = 0; vertex < 5; vertex++) sum += vertices[(ring * 6 + vertex) * 3 + axis];
    return sum / 5;
  });
  let trunks = 0;
  for (const bolt of bolts) {
    const vertices = bolt.getVerticesData('position');
    if (vertices.length !== 22 * 6 * 3) continue;
    const start = centre(vertices, 0), end = centre(vertices, 21);
    const bank = start[1] > 10 ? 1 : 0;
    assert.ok(Math.abs(Math.abs(start[0]) - (2.2 + bank * .5)) < 1e-5);
    assert.ok(Math.abs(Math.abs(end[0]) - (3.6 + bank * 1.1)) < 1e-5);
    assert.ok(Math.abs(end[2] - (.6 + bank * 7)) < 1e-5);
    trunks++;
  }
  assert.equal(trunks, 4);
  world.update(10.09, true, true, true);
  assert.ok(bolts.every(mesh => !mesh.isEnabled()));
});


test('hold sparks animate without writing unsupported per-instance visibility', t => {
  const world = fixture(t);
  world.setChart([{ time: 1, lane: 1, duration: 8, state: 'holding', judgment: 'perfect' }]);
  for (const mesh of world.scene.meshes.filter(mesh => mesh.getClassName() === 'InstancedMesh')) {
    Object.defineProperty(mesh, 'visibility', { get: () => 1, set: () => assert.fail('instance visibility is shared with source') });
  }
  world.update(2.01, true, true, false);
  const sparks = world.scene.meshes.filter(mesh => mesh.name.startsWith('hold-spark-1-'));
  assert.equal(sparks.length, 12); assert.ok(sparks.every(mesh => mesh.isEnabled()));
  const first = positions(sparks);
  world.update(2.15, true, true, false);
  assert.notDeepEqual(positions(sparks), first);
  world.update(2.15, false, true, false);
  assert.ok(sparks.every(mesh => !mesh.isEnabled()));
});

test('hit burst stays at the early/late note position; hold head never snaps to target', t => {
  const world = fixture(t);
  for (const time of [9.9, 10.1]) {
    const note = { lane: 0, time: 10, duration: 2, state: 'pending' };
    world.setChart([note], 2);
    world.update(time, true, false, false);
    const orb = world.scene.getMeshByName('note-0-0');
    const origin = orb.position.clone();
    note.state = 'holding';
    world.hit(0, time, note.time);
    world.update(time, true, false, false);
    assert.equal(orb.isEnabled(), false);
    assert.ok(named(world, 'hold-tail-0').some(mesh => mesh.isEnabled()));
    const flash = named(world, 'impact-flash').find(mesh => mesh.isEnabled());
    assert.ok(Vector3.Distance(flash.position, origin) < 1e-8);
    assert.ok(world.scene.meshes.filter(mesh => mesh.name.startsWith('spark-0-') || mesh.name.startsWith('spark-3-'))
      .filter(mesh => mesh.isEnabled()).every(mesh => Vector3.Distance(mesh.position, origin) < 1e-8));
    note.state = 'done';
    world.update(13, true, false, false);
    assert.ok(named(world, 'hold-tail-0').every(mesh => !mesh.isEnabled()));
  }
});

test('scene geometry stays within the mobile budget without removing stage elements', t => {
  const world = fixture(t);
  const triangles = world.scene.geometries.reduce((sum, geometry) => sum + geometry.getTotalIndices() / 3, 0);
  assert.ok(triangles < 120000, `Unique geometry: ${triangles} triangles (previously 339998)`);
  assert.equal(named(world, 'arch-neon').length, 5);
  assert.equal(named(world, 'target-light').length, 3);
});

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

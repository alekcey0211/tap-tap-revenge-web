import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPublishRef, PUBLISH_REF, validateArtifact } from '../scripts/check-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tap-tap-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'index.html'), '<!doctype html>\n');
  return root;
}

test('release guard accepts only the publication branch', () => {
  assert.doesNotThrow(() => assertPublishRef(PUBLISH_REF));
  for (const ref of [undefined, '', 'refs/heads/codex/development', 'refs/pull/1/merge', 'refs/tags/v0.1.0']) {
    assert.throws(() => assertPublishRef(ref), /Publication is allowed only/);
  }
});

test('valid static files including future PWA metadata are accepted', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets/song.m4a'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'manifest.webmanifest'), '{}\n');
  const result = await validateArtifact(root);
  assert.equal(result.files, 3);
  assert.equal(result.bytes, 22);
});

for (const name of ['game.apk', '.env', '.env.production', 'database.sqlite', 'secret.pem', 'debug.log', 'native.so', 'archive.zip']) {
  test(`artifact rejects ${name}`, async t => {
    const root = await fixture(t);
    await writeFile(join(root, name), 'not public');
    await assert.rejects(validateArtifact(root), /Private path|Unexpected artifact/);
  });
}

for (const name of ['source', 'output', 'var', 'node_modules', '.git']) {
  test(`artifact rejects private directory ${name}`, async t => {
    const root = await fixture(t);
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'data.json'), '{}');
    await assert.rejects(validateArtifact(root), /Private path/);
  });
}

test('artifact rejects symlinks without following them', async t => {
  const root = await fixture(t);
  await symlink(join(root, 'index.html'), join(root, 'alias.html'));
  await assert.rejects(validateArtifact(root), /Symlink/);
});

test('artifact rejects a symlink root', async t => {
  const root = await fixture(t);
  await symlink(root, join(root, 'link'));
  await assert.rejects(validateArtifact(join(root, 'link')), /real directory/);
});

test('artifact requires a root index.html', async t => {
  const root = await fixture(t);
  await rm(join(root, 'index.html'));
  await assert.rejects(validateArtifact(root), /ENOENT/);
});

test('artifact detects a private key marker in a public text file', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'config.json'), JSON.stringify({ value: '-----BEGIN PRIVATE KEY-----' }));
  await assert.rejects(validateArtifact(root), /Credential pattern/);
});

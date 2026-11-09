import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLISH_REF } from '../scripts/check-release.mjs';

test('both Pages jobs declare a branch guard, including manual dispatch', async () => {
  const text = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(text, /^  workflow_dispatch:/m);
  for (const job of ['build', 'deploy']) {
    const block = text.match(new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
    assert.ok(block, `Missing ${job}`);
    assert.ok(block[1].split('\n').includes(`    if: github.ref == '${PUBLISH_REF}'`));
  }
  assert.match(text, /run: node scripts\/check-release\.mjs --publish/);
});

test('development checks have no publication step or write permission', async () => {
  const text = await readFile(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.match(text, /branches: \[codex\/development\]/);
  assert.match(text, /^  pull_request:/m);
  assert.match(text, /^  contents: read$/m);
  assert.doesNotMatch(text, /:\s*write\b|deploy-pages|upload-pages-artifact|workflow_dispatch/);
  assert.match(text, /run: npm test/);
  assert.match(text, /run: node scripts\/check-release\.mjs\s*$/m);
});

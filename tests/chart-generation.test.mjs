import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('published source charts reproduce from frozen analysis without touching music', async () => {
  const result = execFileSync('python3', ['-c', `
import importlib.util, json
spec = importlib.util.spec_from_file_location('charts', 'scripts/import-suno.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps({song['id']: {level: module.make_chart(song, level) for level in range(1, 5)} for song in module.DATA['tracks']}))
`], { cwd: new URL('../', import.meta.url), maxBuffer: 2 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  for (const [song, levels] of Object.entries(JSON.parse(result))) for (const [level, notes] of Object.entries(levels)) {
    assert.deepEqual(notes, JSON.parse(await readFile(new URL(`../dist/assets/tracks/${song}/${level}.json`, import.meta.url))));
  }
});

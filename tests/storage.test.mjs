import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, DEFAULT_SETTINGS, loadSave, loadSettings, loadProgress, saveSettings, saveProgress,
  recordAttempt, recordKey, currentRecords, exportProgress, parseProgress, importProgress, IMPORT_LIMIT } from '../dist/storage.js';
import { Temporal } from '../dist/temporal.js';

const songId = '0734D2E4-7693-418B-82F8-C6D88A02A782';
const base = { score: 100, accuracy: 97.9, bestStreak: 8 };
const attempt = (overrides = {}) => ({ songId, level: '1', result: base, id: crypto.randomUUID(), playedAt: '2026-11-09T19:00:00Z', ...overrides });
const empty = () => ({ records: [], history: [] });
function store(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const makeProgress = () => recordAttempt(empty(), attempt());
const serialized = () => exportProgress(DEFAULT_SETTINGS, makeProgress());

test('migration preserves legacy bytes, valid records and compatible sound without inventing history', () => {
  const oldSettings = JSON.stringify({ compatibleAudio: true, volume: 42, offset: 25, motion: true });
  const oldRecords = JSON.stringify({ [songId + ':1']: base, [songId + ':2']: { score: 20, accuracy: 60 }, bad: base });
  const storage = store({ 'ttr-web-settings': oldSettings, 'ttr-web-records': oldRecords });
  const saved = loadSave(storage);
  assert.equal(saved.writable, true); assert.equal(saved.settings.compatibleAudio, true);
  assert.equal(saved.progress.records.length, 2); assert.equal(saved.progress.history.length, 0);
  assert.equal(saved.progress.records[1].result.bestStreak, null);
  assert.equal(storage.getItem('ttr-web-settings'), oldSettings); assert.equal(storage.getItem('ttr-web-records'), oldRecords);
  assert.equal(loadSettings(storage).volume, 42); assert.deepEqual(loadProgress(storage), saved.progress);
  saveSettings(storage, { ...saved.settings, volume: 70 });
  assert.equal(loadSave(storage).settings.volume, 70); assert.equal(loadSave(storage).progress.records.length, 2);
});

test('damaged old settings do not discard valid records, and malformed records are skipped individually', () => {
  const storage = store({ 'ttr-web-settings': '{', 'ttr-web-records': JSON.stringify({
    [songId + ':1']: base, [songId + ':2']: { score: -2, accuracy: 90 }, [songId + ':3:']: base,
  }) });
  const saved = loadSave(storage); assert.deepEqual(saved.settings, DEFAULT_SETTINGS); assert.equal(saved.progress.records.length, 1);
});

test('invalid new saves remain untouched and read-only; legacy values remain readable', () => {
  for (const bad of ['{', JSON.stringify({ schemaVersion: 99 })]) {
    const storage = store({ [SAVE_KEY]: bad, 'ttr-web-settings': '{"compatibleAudio":true}' });
    const saved = loadSave(storage);
    assert.equal(saved.writable, false); assert.ok(saved.warning); assert.equal(saved.settings.compatibleAudio, true);
    assert.equal(storage.getItem(SAVE_KEY), bad);
  }
});

test('unavailable storage and write quota leave a usable in-memory session', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadSave(denied).writable, false); assert.equal(loadSave(undefined).writable, false);
  const quota = store({ 'ttr-web-records': JSON.stringify({ [songId + ':1']: base }) });
  quota.setItem = () => { throw new Error('quota'); };
  assert.equal(loadSave(quota).progress.records.length, 1);
});

test('attempts retain the previous best, preserve a worse result in history and ignore demo/tutorial', () => {
  let progress = recordAttempt(empty(), attempt());
  progress = recordAttempt(progress, attempt({ result: { ...base, score: 200 } }));
  assert.equal(progress.records[0].previousScore, 100); assert.equal(progress.history[0].isRecord, true);
  progress = recordAttempt(progress, attempt({ result: { ...base, score: 90 } }));
  assert.equal(progress.records[0].result.score, 200); assert.equal(progress.history[0].isRecord, false);
  assert.equal(progress.history[0].previousScore, 200);
  assert.equal(recordAttempt(progress, attempt({ demo: true })), progress);
  assert.equal(recordAttempt(progress, attempt({ tutorial: true })), progress);
  const existing = progress.history[0];
  assert.equal(recordAttempt(progress, attempt({ id: existing.id })), progress);
});

test('history keeps the latest 100 attempts while lifetime best survives eviction', () => {
  let progress = recordAttempt(empty(), attempt({ result: { ...base, score: 9999 } }));
  for (let i = 1; i <= 105; i++) progress = recordAttempt(progress, attempt({ playedAt: Temporal.Instant.from('2026-11-09T19:00:00Z').add({ seconds: i }).toString() }));
  assert.equal(progress.history.length, 100); assert.equal(progress.records[0].result.score, 9999);
  assert.equal(progress.history[0].playedAt, '2026-11-09T19:01:45Z');
  assert.equal(progress.history.at(-1).playedAt, '2026-11-09T19:00:06Z');
});

test('chart/rules revisions have separate records and current record lookup excludes other versions', () => {
  let progress = makeProgress();
  progress = recordAttempt(progress, attempt({ chartVersion: 'future-v2', result: { ...base, score: 999 } }));
  progress = recordAttempt(progress, attempt({ rulesVersion: 'future-v2', result: { ...base, score: 888 } }));
  assert.equal(progress.records.length, 3); assert.equal(new Set(progress.records.map(recordKey)).size, 3);
  assert.equal(currentRecords(progress)[songId + ':1'].score, 100);
});

test('export/import round trip replaces data atomically and repeated import does not duplicate attempts', () => {
  const storage = store(), settings = { ...DEFAULT_SETTINGS, compatibleAudio: true }, progress = makeProgress();
  saveProgress(storage, progress, settings);
  const text = exportProgress(settings, progress); const parsed = parseProgress(text);
  assert.equal(parsed.settings.compatibleAudio, true);
  assert.equal(text.includes('audio.m4a'), false);
  importProgress(storage, text); importProgress(storage, text);
  assert.deepEqual(loadProgress(storage), progress);
});

test('bad JSON, oversized input, unknown schemas and invalid fields never write partial data', () => {
  const storage = store({ [SAVE_KEY]: serialized() }), original = storage.getItem(SAVE_KEY);
  const mutations = [
    value => { value.schemaVersion = 2; }, value => { value.settings.volume = 101; },
    value => { value.settings.compatibleAudio = 'yes'; }, value => { value.progress.records[0].result.accuracy = 100.1; },
    value => { value.progress.records[0].result.score = -1; }, value => { value.progress.records[0].result.score = 1.5; },
    value => { delete value.progress.records[0].chartVersion; }, value => { value.progress.records[0].rulesVersion = {}; },
    value => { value.progress.history[0].playedAt = 'yesterday'; }, value => { value.progress.history[0].playedAt = '2026-02-30T00:00Z'; },
    value => { value.progress.history[0].playedAt = '+999999-01-01T00:00Z'; },
    value => { value.progress.records = []; }, value => { value.progress.history.push(value.progress.history[0]); },
    value => { value.progress.records.push(value.progress.records[0]); },
    value => { value.progress.history[0].isRecord = 'true'; },
    value => { value.progress.history[0].previousScore = 9999; },
    value => { value.progress.history = Array(101).fill(value.progress.history[0]); },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(original); mutate(value);
    assert.throws(() => importProgress(storage, JSON.stringify(value))); assert.equal(storage.getItem(SAVE_KEY), original);
  }
  for (const text of ['{', '[]', 'null', ' '.repeat(IMPORT_LIMIT + 1)]) {
    assert.throws(() => importProgress(storage, text)); assert.equal(storage.getItem(SAVE_KEY), original);
  }
});

test('quota failure on import preserves the existing snapshot', () => {
  const storage = store({ [SAVE_KEY]: serialized() }), original = storage.getItem(SAVE_KEY);
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => importProgress(storage, serialized()), /quota/);
  assert.equal(storage.getItem(SAVE_KEY), original);
});

test('import strips extra fields and cannot pollute prototypes', () => {
  const text = serialized().replace('"schemaVersion":1,', '"schemaVersion":1,"__proto__":{"polluted":true},');
  const parsed = parseProgress(text);
  assert.equal({}.polluted, undefined); assert.equal(Object.hasOwn(parsed, '__proto__'), false);
});

test('complete result details survive migration and export', () => {
  const result = { ...base, hits: 8, misses: 1, brokenHolds: 0, strays: 2, counts: { PERFECT: 6, GREAT: 2, GOOD: 0, OK: 0 } };
  const storage = store({ 'ttr-web-records': JSON.stringify({ [songId + ':1']: result }) });
  const saved = loadSave(storage);
  assert.deepEqual(parseProgress(exportProgress(saved.settings, saved.progress)).progress.records[0].result, result);
});

test('a maximum-size valid export remains within the import size limit', () => {
  const result = { score: 1e9, accuracy: 99.99999999999999, bestStreak: 1e9, hits: 1e9, misses: 1e9, brokenHolds: 1e9, strays: 1e9,
    counts: { PERFECT: 1e9, GREAT: 1e9, GOOD: 1e9, OK: 1e9 } };
  const records = Array.from({ length: 256 }, () => ({ songId: crypto.randomUUID(), level: '4', chartVersion: 'a'.repeat(40), rulesVersion: 'b'.repeat(40), result, previousScore: 1e9 - 1 }));
  const history = records.slice(0, 100).map(entry => ({ ...entry, id: crypto.randomUUID(), playedAt: '2026-11-09T19:00:00.999999999Z', isRecord: true }));
  const text = exportProgress(DEFAULT_SETTINGS, { records, history });
  assert.ok(new TextEncoder().encode(text).length <= IMPORT_LIMIT);
  assert.equal(parseProgress(text).progress.history.length, 100);
});

const pulse = (captured = 6, perfect = 2, total = 8) => ({ pulseRules: 'strict-v1', phraseVersion: 'random-zones-v1', total, captured, perfect });
test('Pulse best is independent of score, legacy records and sound survive round trip', () => {
  const settings = { ...DEFAULT_SETTINGS, compatibleAudio: true, offset: 35 };
  let progress = recordAttempt(empty(), attempt({ result: { ...base, score: 500 } }));
  const oldRecords = structuredClone(progress.records), oldAttempt = structuredClone(progress.history[0]);
  progress = recordAttempt(progress, attempt({ pulse: pulse(6, 6) }));
  progress = recordAttempt(progress, attempt({ pulse: pulse(7, 1) }));
  progress = recordAttempt(progress, attempt({ pulse: pulse(6, 6) }));
  assert.deepEqual(progress.records, oldRecords);
  assert.deepEqual(progress.pulseRecords[0].pulse, pulse(7, 1), 'never combine separate runs');
  progress = recordAttempt(progress, attempt({ pulse: pulse(7, 3) }));
  assert.deepEqual(progress.pulseRecords[0].pulse, pulse(7, 3));
  const storage = store(); importProgress(storage, exportProgress(settings, progress));
  assert.deepEqual(loadProgress(storage), progress); assert.deepEqual(loadSettings(storage), settings);
  assert.deepEqual(progress.history.find(item => item.id === oldAttempt.id), oldAttempt);
  assert.equal(progress.records[0].pulse, undefined);
  for (const mode of ['demo', 'tutorial']) assert.equal(recordAttempt(progress, attempt({ pulse: pulse(8, 8), [mode]: true })), progress);
});
test('Pulse versions have distinct bests and survive history eviction', () => {
  let progress = recordAttempt(empty(), attempt({ pulse: pulse(8, 8) }));
  progress = recordAttempt(progress, attempt({ pulse: { ...pulse(), pulseRules: 'future-v2' } }));
  progress = recordAttempt(progress, attempt({ pulse: { ...pulse(), phraseVersion: 'future-map' } }));
  for (let i = 0; i < 101; i++) progress = recordAttempt(progress, attempt({ pulse: pulse(1, 0), playedAt: '2026-11-10T00:00Z' }));
  assert.equal(progress.pulseRecords.length, 3); assert.deepEqual(progress.pulseRecords[0].pulse, pulse(8, 8));
  assert.deepEqual(parseProgress(exportProgress(DEFAULT_SETTINGS, progress)).progress, progress);
});
test('invalid Pulse import never replaces old data', () => {
  const original = exportProgress(DEFAULT_SETTINGS, recordAttempt(empty(), attempt({ pulse: pulse() })));
  const storage = store({ [SAVE_KEY]: original });
  const mutations = [
    v => { v.progress.history[0].pulse.perfect = 7; },
    v => { v.progress.history[0].pulse.captured = 9; },
    v => { v.progress.history[0].pulse.total = 0; },
    v => { v.progress.history[0].pulse.total = 65; },
    v => { v.progress.history[0].pulse.captured = 1.5; },
    v => { v.progress.history[0].pulse.pulseRules = {}; },
    v => { v.progress.history[0].pulse.phraseVersion = ''; },
    v => { v.progress.pulseRecords = []; },
    v => { delete v.progress.pulseRecords; },
    v => { v.progress.pulseRecords.push(v.progress.pulseRecords[0]); },
    v => { v.progress.pulseRecords[0].pulse.captured = 5; },
    v => { v.progress.pulseRecords[0].pulse.total = 9; },
    v => { v.progress.pulseRecords[0].songId = crypto.randomUUID(); },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(original); mutate(value);
    assert.throws(() => importProgress(storage, JSON.stringify(value)));
    assert.equal(storage.getItem(SAVE_KEY), original);
  }
});
test('maximum-size export including independent Pulse records remains importable', () => {
  const result = { score: 1e9, accuracy: 99.99999999999999, bestStreak: 1e9, hits: 1e9, misses: 1e9, brokenHolds: 1e9, strays: 1e9,
    counts: { PERFECT: 1e9, GREAT: 1e9, GOOD: 1e9, OK: 1e9 } };
  const records = Array.from({ length: 256 }, () => ({ songId: crypto.randomUUID(), level: '4', chartVersion: 'a'.repeat(40), rulesVersion: 'b'.repeat(40), result, previousScore: 1e9 - 1 }));
  const award = { ...pulse(64, 64, 64), pulseRules: 'a'.repeat(40), phraseVersion: 'b'.repeat(40) };
  const pulseRecords = records.map(({ songId, level, chartVersion, rulesVersion }) => ({ songId, level, chartVersion, rulesVersion, pulse: award }));
  const history = records.slice(0, 100).map(entry => ({ ...entry, pulse: award, id: crypto.randomUUID(), playedAt: '2026-11-09T19:00:00.999999999Z', isRecord: true }));
  const text = exportProgress(DEFAULT_SETTINGS, { records, history, pulseRecords });
  assert.ok(new TextEncoder().encode(text).length <= IMPORT_LIMIT, `size ${new TextEncoder().encode(text).length}`);
  assert.equal(parseProgress(text).progress.pulseRecords.length, 256);
});

test('safe original-track slugs round-trip; malformed or path-like identifiers remain rejected', () => {
  for (const songId of ['neon-circuit-v1', 'overdrive-v1']) {
    const progress = recordAttempt(empty(), attempt({ songId }));
    assert.deepEqual(parseProgress(exportProgress(DEFAULT_SETTINGS, progress)).progress, progress);
  }
  for (const songId of ['', '../cover', 'x/y', 'x:y', 'x%2Fy', '<img>', 'a'.repeat(65), '-foo']) {
    assert.throws(() => recordAttempt(empty(), attempt({ songId })), /повреждён/);
  }
});

test('manual records and history retain their rules and values when automatic records are added', () => {
  const old = recordAttempt(empty(), attempt({ rulesVersion: 'web-v1', result: { ...base, score: 9000 } }));
  const before = structuredClone(old);
  const next = recordAttempt(parseProgress(exportProgress(DEFAULT_SETTINGS, old)).progress, attempt({ result: { ...base, score: 100 } }));
  assert.deepEqual(next.records.find(r => r.rulesVersion === 'web-v1'), before.records[0]);
  assert.ok(next.history.some(r => r.id === before.history[0].id));
  assert.equal(currentRecords(next)[songId + ':1'].score, 100);
  const migrated = loadSave(store({ 'ttr-web-records': JSON.stringify({ [songId + ':1']: base }) }));
  assert.equal(migrated.progress.records[0].rulesVersion, 'web-v1');
  assert.deepEqual(currentRecords(migrated.progress), {});
});

test('authorized old Pulse reset preserves scores, settings, attempts and new-map awards on load and import', () => {
  const settings = { ...DEFAULT_SETTINGS, compatibleAudio: true, offset: 35 };
  let progress = recordAttempt(empty(), attempt({ pulse: { ...pulse(8, 8), phraseVersion: 'phrases-v1' } }));
  progress = recordAttempt(progress, attempt({ pulse: { ...pulse(5, 4, 6), phraseVersion: 'random-zones-v1' } }));
  const original = exportProgress(settings, progress), storage = store({ [SAVE_KEY]: original, unrelated: 'keep' });
  const reset = loadSave(storage);
  assert.equal(reset.writable, true); assert.deepEqual(reset.settings, settings);
  assert.deepEqual(reset.progress.records, progress.records);
  assert.equal(reset.progress.history.length, 2); assert.equal(reset.progress.history.filter(entry => entry.pulse).length, 1);
  assert.deepEqual(reset.progress.pulseRecords.map(entry => entry.pulse.phraseVersion), ['random-zones-v1']);
  assert.equal(storage.getItem('unrelated'), 'keep');
  const stored = storage.getItem(SAVE_KEY);
  assert.deepEqual(loadSave(storage).progress, reset.progress); assert.equal(storage.getItem(SAVE_KEY), stored);
  assert.deepEqual(importProgress(storage, original).progress, reset.progress, 'import does not resurrect obsolete awards');
  assert.deepEqual(parseProgress(stored).progress, reset.progress);
});

test('failed Pulse reset write leaves original save bytes intact and reports read-only state', () => {
  const original = exportProgress(DEFAULT_SETTINGS, recordAttempt(empty(), attempt({ pulse: { ...pulse(), phraseVersion: 'phrases-v1' } })));
  const storage = store({ [SAVE_KEY]: original }); storage.setItem = () => { throw new Error('quota'); };
  const reset = loadSave(storage);
  assert.equal(reset.writable, false); assert.ok(reset.warning.includes('Pulse'));
  assert.equal(storage.getItem(SAVE_KEY), original);
  assert.equal(reset.progress.records.length, 1); assert.equal(reset.progress.pulseRecords.length, 0);
});

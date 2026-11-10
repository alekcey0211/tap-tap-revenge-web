import { Temporal } from './temporal.js';

export const SAVE_KEY = 'ttr-web-save-v1';
export const HISTORY_LIMIT = 100;
export const IMPORT_LIMIT = 512 * 1024;
export const CHART_VERSION = 'original-v1';
export const RULES_VERSION = 'auto-revenge-v3';
export const DEFAULT_SETTINGS = { compatibleAudio: false, volume: 75, offset: 0, motion: false };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const songSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validSongId = value => typeof value === 'string' && (uuid.test(value) || value.length <= 64 && songSlug.test(value));
const version = /^[a-zA-Z0-9._-]{1,40}$/;
const invalid = () => { throw new Error('Файл прогресса повреждён или имеет неизвестный формат.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e9;
export const recordKey = ({ songId, level, chartVersion = CHART_VERSION, rulesVersion = RULES_VERSION }) =>
  `${songId}:${level}:${chartVersion}:${rulesVersion}`;

export const pulseKey = entry => `${recordKey(entry)}:${entry.pulse.pulseRules}:${entry.pulse.phraseVersion}`;
function pulseFrom(value) {
  if (!object(value) || typeof value.pulseRules !== 'string' || !version.test(value.pulseRules)
    || typeof value.phraseVersion !== 'string' || !version.test(value.phraseVersion)
    || !Number.isSafeInteger(value.total) || value.total < 1 || value.total > 64
    || !count(value.captured) || value.captured > value.total || !count(value.perfect) || value.perfect > value.captured) invalid();
  return { pulseRules: value.pulseRules, phraseVersion: value.phraseVersion,
    total: value.total, captured: value.captured, perfect: value.perfect };
}
function identityFrom(value) {
  if (!object(value) || !validSongId(value.songId) || !['1', '2', '3', '4'].includes(value.level)
    || typeof value.chartVersion !== 'string' || !version.test(value.chartVersion) || typeof value.rulesVersion !== 'string' || !version.test(value.rulesVersion)) invalid();
  return { songId: value.songId, level: value.level, chartVersion: value.chartVersion, rulesVersion: value.rulesVersion };
}
const pulseBetter = (candidate, previous) => candidate.captured > previous.captured
  || candidate.captured === previous.captured && candidate.perfect > previous.perfect;

function settingsFrom(value, defaults = DEFAULT_SETTINGS, strict = false) {
  const result = { ...defaults };
  if (!object(value)) { if (strict) invalid(); return result; }
  for (const name of ['compatibleAudio', 'motion']) {
    if (typeof value[name] === 'boolean') result[name] = value[name]; else if (strict) invalid();
  }
  for (const [name, min, max] of [['volume', 0, 100], ['offset', -500, 500]]) {
    if (Number.isFinite(value[name])) {
      if (strict && (value[name] < min || value[name] > max)) invalid();
      result[name] = Math.max(min, Math.min(max, value[name]));
    } else if (strict) invalid();
  }
  return result;
}
function resultFrom(value) {
  if (!object(value) || !count(value.score) || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 100) invalid();
  if (value.bestStreak != null && !count(value.bestStreak)) invalid();
  const result = { score: value.score, accuracy: value.accuracy, bestStreak: value.bestStreak ?? null };
  for (const name of ['hits', 'misses', 'brokenHolds', 'strays']) {
    if (value[name] === undefined) continue;
    if (!count(value[name])) invalid();
    result[name] = value[name];
  }
  if (value.counts !== undefined) {
    if (!object(value.counts)) invalid();
    result.counts = {};
    for (const name of ['PERFECT', 'GREAT', 'GOOD', 'OK']) {
      if (!count(value.counts[name])) invalid();
      result.counts[name] = value.counts[name];
    }
  }
  return result;
}
function entryFrom(value, attempt = false) {
  const identity = identityFrom(value);
  const result = resultFrom(value.result);
  if (value.previousScore !== null && !count(value.previousScore)) invalid();
  const entry = { ...identity, result, previousScore: value.previousScore };
  if (!attempt && entry.previousScore !== null && entry.previousScore >= result.score) invalid();
  if (attempt) {
    if (!uuid.test(value.id) || typeof value.playedAt !== 'string' || value.playedAt.length > 40 || typeof value.isRecord !== 'boolean') invalid();
    let instant;
    try { instant = Temporal.Instant.from(value.playedAt); } catch { invalid(); }
    const year = instant.toZonedDateTimeISO('UTC').year;
    if (year < 1970 || year > 2200) invalid();
    if (value.isRecord && entry.previousScore !== null && entry.previousScore >= result.score) invalid();
    if (value.pulse !== undefined) entry.pulse = pulseFrom(value.pulse);
    Object.assign(entry, { id: value.id, playedAt: instant.toString(), isRecord: value.isRecord });
  }
  return entry;
}
function snapshotFrom(value) {
  if (!object(value) || value.format !== 'tap-tap-web-progress' || value.schemaVersion !== 1 || !object(value.progress)) invalid();
  const { records, history } = value.progress;
  if (!Array.isArray(records) || records.length > 256 || !Array.isArray(history) || history.length > HISTORY_LIMIT) invalid();
  const cleanRecords = records.map(entry => entryFrom(entry)), cleanHistory = history.map(entry => entryFrom(entry, true));
  if (new Set(cleanRecords.map(recordKey)).size !== records.length || new Set(cleanHistory.map(item => item.id)).size !== history.length) invalid();
  const best = new Map(cleanRecords.map(entry => [recordKey(entry), entry.result.score]));
  if (cleanHistory.some(entry => !best.has(recordKey(entry)) || best.get(recordKey(entry)) < entry.result.score)) invalid();
  const progress = { records: cleanRecords, history: cleanHistory };
  if (value.progress.pulseRecords !== undefined) {
    if (!Array.isArray(value.progress.pulseRecords) || value.progress.pulseRecords.length > 256) invalid();
    progress.pulseRecords = value.progress.pulseRecords.map(entry => ({ ...identityFrom(entry), pulse: pulseFrom(entry.pulse) }));
    const pulseBest = new Map(progress.pulseRecords.map(entry => [pulseKey(entry), entry.pulse]));
    if (pulseBest.size !== progress.pulseRecords.length || progress.pulseRecords.some(entry => !best.has(recordKey(entry)))) invalid();
    for (const entry of cleanHistory.filter(entry => entry.pulse)) {
      const best = pulseBest.get(pulseKey(entry));
      if (!best || best.total !== entry.pulse.total || pulseBetter(entry.pulse, best)) invalid();
    }
  } else if (cleanHistory.some(entry => entry.pulse)) invalid();
  cleanHistory.sort((a, b) => Temporal.Instant.compare(b.playedAt, a.playedAt));
  return { format: 'tap-tap-web-progress', schemaVersion: 1, settings: settingsFrom(value.settings, DEFAULT_SETTINGS, true),
    progress };
}
export function parseProgress(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > IMPORT_LIMIT) throw new Error('Файл прогресса слишком большой.');
  let value;
  try { value = JSON.parse(text); } catch { invalid(); }
  return snapshotFrom(value);
}
function legacy(storage, defaults) {
  let settings = defaults, records = [];
  try { settings = settingsFrom(JSON.parse(storage.getItem('ttr-web-settings') || '{}'), defaults); } catch { /* Retain defaults. */ }
  try {
    const old = JSON.parse(storage.getItem('ttr-web-records') || '{}');
    if (object(old)) for (const [key, result] of Object.entries(old).slice(0, 256)) {
      const parts = key.split(':');
      const [songId, level] = parts;
      if (parts.length !== 2 || !uuid.test(songId) || !['1', '2', '3', '4'].includes(level)) continue;
      try { records.push({ songId, level, chartVersion: CHART_VERSION, rulesVersion: 'web-v1', result: resultFrom(result), previousScore: null }); } catch { /* Skip only the malformed record. */ }
    }
  } catch { /* Keep valid settings when old records are damaged. */ }
  return { settings, progress: { records, history: [] } };
}
function resetLegacyPulse(progress) {
  const legacy = entry => ['phrases-v1', 'phrases-v2', 'phrases-v3'].includes(entry.pulse?.phraseVersion);
  if (!progress.history.some(legacy) && !progress.pulseRecords?.some(legacy)) return progress;
  // User-approved reset of the old Pulse map only. Scores and attempts stay intact.
  return { ...progress,
    history: progress.history.map(entry => { if (!legacy(entry)) return entry; const { pulse, ...attempt } = entry; return attempt; }),
    ...(progress.pulseRecords ? { pulseRecords: progress.pulseRecords.filter(entry => !legacy(entry)) } : {}) };
}
export function loadSave(storage, defaults = DEFAULT_SETTINGS) {
  const empty = { settings: { ...defaults }, progress: { records: [], history: [] } };
  try {
    const text = storage.getItem(SAVE_KEY);
    if (text !== null) {
      try {
        const snapshot = parseProgress(text), progress = resetLegacyPulse(snapshot.progress);
        if (progress !== snapshot.progress) {
          try { saveProgress(storage, progress, snapshot.settings); }
          catch { return { ...snapshot, progress, writable: false,
            warning: 'Не удалось сохранить сброс старого Pulse. Исходный файл не изменён; новые результаты доступны только до закрытия страницы.' }; }
        }
        return { ...snapshot, progress, writable: true, warning: '' };
      }
      catch { return { ...legacy(storage, defaults), writable: false, warning: 'Сохранение не удалось прочитать. Исходные данные не изменены; новые результаты доступны только до закрытия страницы.' }; }
    }
    const migrated = legacy(storage, defaults);
    saveProgress(storage, migrated.progress, migrated.settings);
    return { ...migrated, writable: true, warning: '' };
  } catch {
    // Reading may work while writes fail (quota/private browsing). Preserve readable records.
    return { ...(storage ? legacy(storage, defaults) : empty), writable: false,
      warning: 'Браузер не сохраняет прогресс. Перед закрытием страницы сохрани его в файл.' };
  }
}
export const loadSettings = (storage, defaults) => loadSave(storage, defaults).settings;
export const loadProgress = storage => loadSave(storage).progress;
export function exportProgress(settings, progress) {
  return JSON.stringify(snapshotFrom({ format: 'tap-tap-web-progress', schemaVersion: 1, settings, progress }));
}
export function saveProgress(storage, progress, settings) {
  storage.setItem(SAVE_KEY, exportProgress(settings, progress));
}
export function saveSettings(storage, settings, progress = loadProgress(storage)) { saveProgress(storage, progress, settings); }
export function importProgress(storage, text) {
  const snapshot = parseProgress(text);
  snapshot.progress = resetLegacyPulse(snapshot.progress);
  // One key/write: validation and user confirmation happen before this atomic replacement.
  storage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  return snapshot;
}
export function recordAttempt(progress, { songId, level, result, pulse, playedAt, id, demo = false, tutorial = false,
  chartVersion = CHART_VERSION, rulesVersion = RULES_VERSION }) {
  if (demo || tutorial) return progress;
  const identity = { songId, level, chartVersion, rulesVersion }, key = recordKey(identity);
  const previous = progress.records.find(entry => recordKey(entry) === key);
  const isRecord = !previous || result.score > previous.result.score;
  const entry = entryFrom({ ...identity, result, pulse, previousScore: previous?.result.score ?? null, playedAt, id, isRecord }, true);
  if (progress.history.some(attempt => attempt.id === id)) return progress;
  const records = isRecord ? [...progress.records.filter(item => recordKey(item) !== key),
    entryFrom(entry)] : progress.records;
  const history = [entry, ...progress.history].sort((a, b) => Temporal.Instant.compare(b.playedAt, a.playedAt)).slice(0, HISTORY_LIMIT);
  const next = { ...progress, records, history };
  if (entry.pulse) {
    const pulseRecords = progress.pulseRecords || [], pulseId = pulseKey(entry);
    const previousPulse = pulseRecords.find(item => pulseKey(item) === pulseId);
    if (previousPulse && previousPulse.pulse.total !== entry.pulse.total) invalid();
    next.pulseRecords = !previousPulse || pulseBetter(entry.pulse, previousPulse.pulse)
      ? [...pulseRecords.filter(item => pulseKey(item) !== pulseId), { ...identity, pulse: entry.pulse }] : pulseRecords;
  }
  return next;
}
export function currentRecords(progress) {
  return Object.fromEntries(progress.records.filter(entry => entry.chartVersion === CHART_VERSION && entry.rulesVersion === RULES_VERSION)
    .map(entry => [`${entry.songId}:${entry.level}`, entry.result]));
}

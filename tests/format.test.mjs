import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatSigned, formatPercent, formatTime, formatCount, formatDay, formatAttemptTime } from '../dist/format.js';
import { Temporal } from '../dist/temporal.js';

test('Russian percentages use Intl percent style, decimal comma and a non-breaking space', () => {
  assert.equal(formatPercent(97.9), '97,9\u00a0%');
  for (const value of [0, 1, 75, 100, 99.95]) assert.equal(formatPercent(value), new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(value / 100));
  assert.equal(formatNumber(284600), new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(284600));
  assert.equal(formatSigned(12800), '+12\u00a0800');
});

test('track durations use Intl numbers, not calendar dates', () => {
  assert.equal(formatTime(97.756), '1:37'); assert.equal(formatTime(-4), '0:00'); assert.equal(formatTime(9), '0:09');
  assert.equal(formatCount(21, { one: 'нота', few: 'ноты', many: 'нот' }), '21 нота');
});

test('day groups are local-calendar based across midnight and year boundaries', () => {
  const now = Temporal.Instant.from('2026-01-01T00:15:00Z');
  assert.equal(formatDay('2025-12-31T23:30:00Z', now, 'Europe/Belgrade'), 'Сегодня');
  assert.equal(formatDay('2025-12-31T22:30:00Z', now, 'Europe/Belgrade'), 'Вчера');
  assert.equal(formatAttemptTime('2026-11-09T19:42:00Z', 'Europe/Belgrade'), '20:42');
});

test('yesterday subtracts one calendar day rather than 24 hours across daylight saving', () => {
  assert.equal(formatDay('2026-03-28T00:30:00Z', Temporal.Instant.from('2026-03-29T21:00Z'), 'Europe/Belgrade'), 'Вчера');
  assert.equal(formatDay('2026-10-24T01:30:00Z', Temporal.Instant.from('2026-10-25T22:30Z'), 'Europe/Belgrade'), 'Вчера');
});

test('older dates use the Temporal locale formatter and invalid instants are rejected', () => {
  const date = Temporal.PlainDate.from('2025-11-09');
  assert.equal(formatDay('2025-11-09T12:00Z', Temporal.Instant.from('2026-11-09T12:00Z'), 'UTC'), date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }));
  assert.throws(() => formatAttemptTime('not a date', 'UTC'));
});

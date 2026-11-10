import { Temporal } from './temporal.js';

export const LOCALE = 'ru-RU';
const numbers = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const signed = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0, signDisplay: 'always' });
const percents = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 });
const seconds = new Intl.NumberFormat(LOCALE, { minimumIntegerDigits: 2, useGrouping: false });
const plurals = new Intl.PluralRules(LOCALE);
export const formatNumber = value => numbers.format(value);
export const formatSigned = value => signed.format(value);
// Game accuracy and volume are stored on a 0..100 scale; Intl expects 0..1.
export const formatPercent = value => percents.format(value / 100);
export function formatCount(value, forms) { return `${formatNumber(value)} ${forms[plurals.select(value)] ?? forms.other}`; }
export function formatTime(value) {
  const total = Math.max(0, Math.floor(value));
  return `${formatNumber(Math.floor(total / 60))}:${seconds.format(total % 60)}`;
}
export function localDateTime(instant, timeZone = Temporal.Now.timeZoneId()) {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
}
export function formatAttemptTime(instant, timeZone) {
  return localDateTime(instant, timeZone).toLocaleString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
export function formatDay(instant, now = Temporal.Now.instant(), timeZone = Temporal.Now.timeZoneId()) {
  const date = localDateTime(instant, timeZone).toPlainDate();
  const today = localDateTime(now, timeZone).toPlainDate();
  if (date.equals(today)) return 'Сегодня';
  if (date.equals(today.subtract({ days: 1 }))) return 'Вчера';
  return date.toLocaleString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

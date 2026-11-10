import { formatNumber, formatPercent, formatCount, formatTime } from './format.js?v=0.3.0';
const $ = id => document.getElementById(id);
function text(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
export function renderPulse(view) {
  $('pulse').hidden = !view;
  if (!view) return;
  const { index, total, notes, done, result } = view;
  if (view.finished && !view.recent) {
    $('pulse').dataset.outcome = 'finished';
    text('pulse-title', pulseSummary(view));
    text('pulse-detail', 'Награды отдельно от очков');
    $('pulse-progress-row').hidden = true;
    return;
  }
  const label = `Фрагмент ${formatNumber(index)} / ${formatNumber(total)}`;
  if (view.waiting) {
    $('pulse').dataset.outcome = 'waiting';
    text('pulse-title', `Следующий Pulse · ${label}`);
    text('pulse-detail', `Начнётся через ${formatTime(Math.ceil(view.startsIn))}`);
    $('pulse-progress-row').hidden = true;
    return;
  }
  $('pulse').dataset.outcome = result ? result.perfect ? 'perfect' : result.captured ? 'captured' : 'missed' : 'active';
  text('pulse-title', result ? result.perfect ? 'Идеальный Pulse' : result.captured ? 'Pulse взят' : index === total ? 'Фрагмент завершён' : 'Следующий — твой' : `PULSE · ${label}`);
  const reason = result ? result.captured ? formatPercent(result.accuracy) : pulseReasons(result)[0] || '' : '';
  text('pulse-detail', result ? `${label} · ${reason}` : `Точность от ${formatPercent(90)} · без ошибок`);
  $('pulse-progress-row').hidden = Boolean(result);
  $('pulse-progress').max = notes; $('pulse-progress').value = done;
  text('pulse-notes', `${formatNumber(done)} / ${formatCount(notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' })}`);
}
export function pulseSummary(pulse) {
  return `Pulse: ${formatNumber(pulse.captured)} / ${formatCount(pulse.total, { one: 'фрагмент', few: 'фрагмента', many: 'фрагментов', other: 'фрагмента' })} · идеальных: ${formatNumber(pulse.perfect)}`;
}
export function pulseReasons(result) {
  const reasons = [];
  if (result.misses) reasons.push(`Пропуски: ${formatNumber(result.misses)}`);
  if (result.broken) reasons.push(`Срывы удержаний: ${formatNumber(result.broken)}`);
  if (result.strays) reasons.push(`Лишние нажатия: ${formatNumber(result.strays)}`);
  if (result.accuracy < 90) {
    const measured = formatPercent(result.accuracy), threshold = formatPercent(90);
    reasons.push(measured === threshold ? `Точность ниже ${threshold}` : `Точность ${measured}, нужно от ${threshold}`);
  }
  return reasons;
}
export function renderPulseBreakdown(phrases = []) {
  $('pulse-explanation').hidden = !phrases.length;
  $('pulse-explanation').open = false;
  text('pulse-rule', `Каждый фрагмент: точность от ${formatPercent(90)}, без пропусков, лишних нажатий и срывов удержания. Точность — средняя оценка нот: PERFECT ${formatPercent(100)}, GREAT ${formatPercent(80)}, GOOD ${formatPercent(50)}, OK ${formatPercent(20)}. Множитель очков на неё не влияет.`);
  const items = phrases.flatMap((phrase, index) => {
    if (!phrase.result || phrase.result.captured) return [];
    const item = document.createElement('li');
    item.textContent = `Фрагмент ${formatNumber(index + 1)} не взят: ${pulseReasons(phrase.result).join('; ')}.`;
    return [item];
  });
  $('pulse-breakdown').replaceChildren(...items);
}

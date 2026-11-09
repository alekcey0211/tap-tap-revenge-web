import { formatNumber, formatPercent, formatCount } from './format.js?v=0.3.0';
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
  $('pulse').dataset.outcome = result ? result.perfect ? 'perfect' : result.captured ? 'captured' : 'missed' : 'active';
  text('pulse-title', result ? result.perfect ? 'Идеальный Pulse' : result.captured ? 'Pulse взят' : index === total ? 'Фрагмент завершён' : 'Следующий — твой' : `PULSE · ${label}`);
  const reason = result?.misses ? `Пропуски: ${formatNumber(result.misses)}` : result?.broken ? `Срывы удержаний: ${formatNumber(result.broken)}`
    : result?.strays ? `Лишние нажатия: ${formatNumber(result.strays)}` : result ? result.captured ? formatPercent(result.accuracy) : `Точность ниже ${formatPercent(90)}` : '';
  text('pulse-detail', result ? `${label} · ${reason}` : `Точность от ${formatPercent(90)} · без ошибок`);
  $('pulse-progress-row').hidden = Boolean(result);
  $('pulse-progress').max = notes; $('pulse-progress').value = done;
  text('pulse-notes', `${formatNumber(done)} / ${formatCount(notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' })}`);
}
export function pulseSummary(pulse) {
  return `Pulse: ${formatNumber(pulse.captured)} / ${formatNumber(pulse.total)} · идеальных: ${formatNumber(pulse.perfect)}`;
}

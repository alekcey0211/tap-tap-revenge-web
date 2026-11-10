import { formatCount } from './format.js?v=0.3.0';
export const LEVELS = { 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' };

export function renderDifficulties(container, song, level, onSelect) {
  container.replaceChildren();
  for (const [value, name] of Object.entries(LEVELS)) {
    const button = document.createElement('button'); button.dataset.level = value;
    const meter = document.createElement('span'); meter.className = 'difficulty-meter'; meter.setAttribute('aria-hidden', 'true');
    for (let step = 1; step <= 4; step++) {
      const bar = document.createElement('i'); bar.dataset.lit = String(step <= Number(value)); meter.append(bar);
    }
    const check = document.createElement('span'); check.className = 'difficulty-check'; check.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong'); title.className = 'difficulty-name'; title.textContent = name;
    const count = document.createElement('span'); count.className = 'difficulty-notes';
    count.textContent = song.levels[value] ? formatCount(song.levels[value].notes, { one: 'нота', few: 'ноты', many: 'нот', other: 'ноты' }) : 'Недоступно';
    button.append(meter, check, title, count);
    button.setAttribute('aria-pressed', String(level === value)); button.disabled = !song.levels[value];
    button.onclick = () => {
      const result = onSelect(value);
      container.children[Number(value) - 1].focus({ preventScroll: true });
      return result;
    };
    container.append(button);
  }
}

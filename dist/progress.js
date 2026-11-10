import { artwork } from './artwork.js';
import { PULSE_RULES } from './phrase-progress.js';
import { PHRASE_VERSION } from './phrase-charts.js';
import { pulseSummary } from './pulse-view.js';
import { Temporal } from './temporal.js';
import { formatNumber, formatPercent, formatSigned, formatCount, formatAttemptTime, formatDay } from './format.js?v=0.3.0';
import { CHART_VERSION, RULES_VERSION, HISTORY_LIMIT, IMPORT_LIMIT, recordKey, exportProgress, parseProgress } from './storage.js?v=0.6.0';

const $ = id => document.getElementById(id);
const LEVELS = { 1: 'Легко', 2: 'Средне', 3: 'Сложно', 4: 'Экстрим' };
const attemptForms = { one: 'попытка', few: 'попытки', many: 'попыток', other: 'попытки' };
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function option(value, text) { const element = node('option', text); element.value = value; return element; }
function svgNode(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
export class ProgressView {
  constructor({ getProgress, getSettings, getWarning, onImport, onSelect, onOpenImport, onCloseImport }) {
    Object.assign(this, { getProgress, getSettings, getWarning, onImport, onSelect, onOpenImport, onCloseImport });
    this.songs = []; this.level = '1'; this.tab = 'records'; this.fileRequest = 0; this.pendingImport = null;
    this.rules = RULES_VERSION;
    $('progress-rules').onchange = () => { this.rules = $('progress-rules').value; this.renderRecords(); };
    $('records-tab').onclick = () => this.setTab('records');
    $('history-tab').onclick = () => this.setTab('history');
    $('progress-song').onchange = () => { this.song = this.songs.find(song => song.id === $('progress-song').value); this.renderRecords(); };
    $('history-song').onchange = $('history-level').onchange = () => this.renderHistory();
    $('history-reset').onclick = () => { $('history-song').value = ''; $('history-level').value = ''; this.renderHistory(); };
    $('progress-play').onclick = () => this.onSelect(this.song, this.level);
    $('progress-export').onclick = () => this.download();
    $('progress-import').onclick = () => { $('progress-file').value = ''; $('progress-file').click(); };
    $('progress-file').onchange = () => this.readFile($('progress-file').files?.[0]);
    $('import-cancel').onclick = () => this.cancelImport();
    $('import-confirm').onclick = () => {
      if (!this.pendingImport) return;
      try {
        this.onImport(this.pendingImport);
        this.cancelImport(); this.render();
        $('progress-message').textContent = 'Прогресс и настройки восстановлены.';
      } catch {
        $('import-error').hidden = false;
        $('import-error').textContent = 'Не удалось сохранить файл в браузере. Текущий прогресс не изменён.';
      }
    };
  }
  open(catalog, song, level) {
    this.rules = RULES_VERSION;
    this.songs = catalog.filter(item => !item.tutorial);
    this.song = this.songs.find(item => item.id === song?.id) || this.songs[0];
    this.level = this.song.levels[level] ? level : '1';
    $('progress-song').replaceChildren(...this.songs.map(song => option(song.id, song.title)));
    $('history-song').replaceChildren(option('', 'Все треки'), ...this.songs.map(song => option(song.id, song.title)));
    $('history-level').replaceChildren(option('', 'Все сложности'), ...Object.entries(LEVELS).map(([value, title]) => option(value, title)));
    $('history-song').value = ''; $('history-level').value = '';
    $('progress-message').textContent = '';
    this.setTab('records'); $('records-tab').focus({ preventScroll: true });
  }
  close() { this.fileRequest++; this.pendingImport = null; }
  setTab(tab) {
    this.tab = tab;
    $('records-tab').setAttribute('aria-pressed', String(tab === 'records'));
    $('history-tab').setAttribute('aria-pressed', String(tab === 'history'));
    $('records-panel').hidden = tab !== 'records'; $('history-panel').hidden = tab !== 'history';
    this.render();
  }
  render() {
    $('save-warning').textContent = this.getWarning(); $('save-warning').hidden = !this.getWarning();
    if (this.tab === 'records') this.renderRecords(); else this.renderHistory();
  }
  renderRecords() {
    const { song, level } = this;
    $('progress-song').value = song.id;
    $('progress-art').src = artwork(song);
    $('progress-artist').textContent = song.artist;
    $('progress-levels').replaceChildren(...Object.entries(LEVELS).map(([value, title]) => {
      const button = node('button', title); button.disabled = !song.levels[value];
      button.setAttribute('aria-pressed', String(value === level));
      button.onclick = () => { this.level = value; this.renderRecords(); $('progress-levels').children[Number(value) - 1].focus({ preventScroll: true }); };
      return button;
    }));
    const progress = this.getProgress();
    const rules = [...new Set([RULES_VERSION, ...progress.records.map(entry => entry.rulesVersion)])];
    if (!rules.includes(this.rules)) this.rules = RULES_VERSION;
    $('progress-rules').replaceChildren(...rules.map(value => option(value, value === RULES_VERSION
      ? 'Авто ×8 · до ошибки' : value === 'web-v1' ? 'Ручной ×8 · прежние рекорды' : `Правила: ${value}`)));
    $('progress-rules').value = this.rules;
    const key = recordKey({ songId: song.id, level, rulesVersion: this.rules });
    const best = progress.records.find(entry => recordKey(entry) === key);
    $('personal-best').hidden = !best; $('record-empty').hidden = Boolean(best);
    if (best) {
      $('best-score').textContent = formatNumber(best.result.score);
      $('best-accuracy').textContent = formatPercent(best.result.accuracy);
      $('best-combo').textContent = best.result.bestStreak === null ? '—' : formatNumber(best.result.bestStreak);
      $('best-delta').hidden = best.previousScore === null;
      $('best-delta').textContent = best.previousScore === null ? '' : `${formatSigned(best.result.score - best.previousScore)} к прошлому рекорду`;
    }
    const bestPulse = progress.pulseRecords?.find(entry => recordKey(entry) === key
      && entry.pulse.pulseRules === PULSE_RULES && entry.pulse.phraseVersion === PHRASE_VERSION);
    $('best-pulse').hidden = !bestPulse;
    $('best-pulse-value').textContent = bestPulse ? pulseSummary(bestPulse.pulse) : '';
    const recent = progress.history.filter(entry => recordKey(entry) === key).slice(0, 5).reverse();
    $('accuracy-caption').textContent = `Последние попытки этой карты: ${formatNumber(recent.length)}`;
    $('accuracy-plot').replaceChildren(); $('accuracy-empty').hidden = recent.length >= 2;
    $('accuracy-empty').textContent = recent.length ? 'Ещё одна попытка — и здесь появится график.' : 'График появится после двух новых попыток. Старые рекорды сохранены, но истории у них нет.';
    if (recent.length < 2) return;
    const values = recent.map(entry => entry.result.accuracy);
    const minimum = Math.min(90, Math.floor(Math.min(...values) / 10) * 10);
    const points = values.map((value, index) => [12 + index * 296 / (values.length - 1), 88 - (value - minimum) / (100 - minimum) * 76]);
    const svg = svgNode('svg', { viewBox: '0 0 320 100', class: 'accuracy-chart', role: 'img',
      'aria-label': values.map((value, i) => `Попытка ${formatNumber(i + 1)}: ${formatPercent(value)}`).join('; ') });
    svg.append(svgNode('polyline', { points: points.map(point => point.join(',')).join(' '), fill: 'none', stroke: '#c9ff56', 'stroke-width': 2 }));
    for (const [cx, cy] of points) svg.append(svgNode('circle', { cx, cy, r: 4, fill: '#c9ff56' }));
    const labels = node('div', undefined, 'accuracy-values'); labels.append(node('span', formatPercent(values[0])), node('span', formatPercent(values.at(-1))));
    const axis = node('p', `Шкала: ${formatPercent(minimum)} — ${formatPercent(100)}`, 'accuracy-axis');
    $('accuracy-plot').append(svg, labels, axis);
  }
  renderHistory() {
    const songId = $('history-song').value, level = $('history-level').value;
    const history = this.getProgress().history.filter(item => (!songId || item.songId === songId) && (!level || item.level === level));
    $('history-caption').textContent = `Показано: ${formatNumber(history.length)} · Храним до ${formatNumber(HISTORY_LIMIT)} попыток`;
    $('history-list').replaceChildren();
    $('history-empty').hidden = history.length > 0; $('history-reset').hidden = !songId && !level;
    $('history-empty-help').textContent = songId || level ? 'Для этих фильтров нет результатов. Попробуй выбрать другой трек или сложность.' : 'Пройди любой трек — здесь появятся результат и время игры. Старые рекорды доступны во вкладке «Рекорды».';
    const now = Temporal.Now.instant(), timeZone = Temporal.Now.timeZoneId();
    let day = '';
    for (const entry of history) {
      const label = formatDay(entry.playedAt, now, timeZone);
      if (label !== day) { $('history-list').append(node('h3', label, 'history-day')); day = label; }
      const song = this.songs.find(item => item.id === entry.songId);
      const row = node('article', undefined, 'history-row');
      const img = node('img'); img.alt = ''; img.src = song ? artwork(song) : 'assets/ui/logo.png';
      const detail = node('div'); detail.append(node('h4', song?.title || 'Трек из другого каталога'),
        node('p', `${LEVELS[entry.level]} · ${formatAttemptTime(entry.playedAt, timeZone)}`));
      if (entry.chartVersion !== CHART_VERSION || entry.rulesVersion !== RULES_VERSION) detail.append(node('p', 'Другая версия карты или правил'));
      const score = node('div', undefined, 'history-score-row'); score.append(node('strong', formatNumber(entry.result.score)));
      if (entry.isRecord) { const badge = node('span', 'РЕКОРД', 'history-badge'); badge.title = 'Личный рекорд на момент этой попытки'; score.append(badge); }
      score.append(node('p', `${formatPercent(entry.result.accuracy)} · Комбо ${entry.result.bestStreak === null ? '—' : formatNumber(entry.result.bestStreak)}`));
      if (entry.pulse) score.append(node('p', pulseSummary(entry.pulse), 'history-pulse'));
      row.append(img, detail, score); $('history-list').append(row);
    }
  }
  download() {
    try {
      const content = exportProgress(this.getSettings(), this.getProgress());
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = node('a'); link.href = url; link.download = `tap-tap-progress-${Temporal.Now.plainDateISO()}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('progress-message').textContent = 'Файл подготовлен. Сохрани его через загрузки браузера.';
    } catch { $('progress-message').textContent = 'Не удалось подготовить файл прогресса. Попробуй ещё раз.'; }
  }
  async readFile(file) {
    const request = ++this.fileRequest;
    this.pendingImport = null;
    if (!file) return;
    $('progress-message').textContent = '';
    try {
      if (file.size > IMPORT_LIMIT) throw new Error(`Выбери JSON-файл прогресса размером до ${formatNumber(IMPORT_LIMIT / 1024)} КБ.`);
      const text = await file.text();
      if (request !== this.fileRequest) return;
      const snapshot = parseProgress(text);
      this.pendingImport = text;
      $('import-summary').textContent = `В файле: ${formatCount(snapshot.progress.records.length, { one: 'рекорд', few: 'рекорда', many: 'рекордов', other: 'рекорда' })}, ${formatCount(snapshot.progress.history.length, attemptForms)}. Заменить текущие данные?`;
      $('import-error').hidden = true; this.onOpenImport();
    } catch (error) {
      if (request === this.fileRequest) $('progress-message').textContent = error.message;
    }
  }
  cancelImport() { this.fileRequest++; this.pendingImport = null; this.onCloseImport(); $('progress-import').focus({ preventScroll: true }); }
}

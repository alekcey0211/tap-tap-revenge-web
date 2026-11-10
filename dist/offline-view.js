import { OfflineLibrary } from './offline.js?v=0.4.0';
import { LOCALE } from './format.js?v=0.3.0';
const megabytes = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const $ = id => document.getElementById(id);

export class OfflineView {
  constructor({ onOpen, onClose }) {
    this.library = new OfflineLibrary();
    this.song = null; this.generation = 0; this.busy = false;
    $('offline-download').onclick = () => this.change('downloadTrack');
    $('offline-remove').onclick = () => this.change('removeTrack');
    $('offline-open').onclick = () => { onOpen(); this.refresh(); };
    $('offline-close').onclick = onClose;
    $('update-check').onclick = () => this.checkUpdates();
  }
  openSettings() {
    if (this.library.registration) return this.checkUpdates();
    this.checkWhenReady = true;
  }
  async checkUpdates() {
    if (this.checking) return;
    this.checking = true;
    this.updateStatus();
    try {
      await this.library.checkUpdate();
      this.checked = true;
      this.checking = false;
      this.updateStatus();
    } catch {
      this.checking = false;
      this.updateStatus();
      if (!this.library.updateReady) $('update-status').textContent = 'Не удалось проверить обновления. Подключись к интернету и попробуй ещё раз.';
    }
  }
  async initialize() {
    try {
      await this.library.register(() => { this.updateStatus(); this.refresh(); });
      this.updateStatus();
      if (this.checkWhenReady) { this.checkWhenReady = false; await this.checkUpdates(); }
    } catch {
      $('update-status').textContent = 'Офлайн пока недоступен. Открой игру по HTTPS с интернетом и попробуй перезагрузить страницу.';
      $('update-check').disabled = true;
    }
  }
  updateStatus() {
    $('update-check').disabled = this.checking || !this.library.registration;
    $('update-status').dataset.update = this.library.updateReady ? 'ready' : 'current';
    $('update-status').textContent = this.library.installFailed
      ? 'Не удалось сохранить новую версию для офлайна. Проверь интернет и свободное место, затем повтори проверку.'
      : this.library.updateReady
      ? 'Доступна новая версия. После игры закрой все её вкладки и окно приложения с домашнего экрана, затем открой снова. Прогресс и скачанные треки сохранятся.'
      : this.library.registration?.installing ? 'Сохраняем новую версию игры… Не закрывай страницу.'
      : this.checking ? 'Проверяем обновления…'
      : this.checked && this.library.available ? 'Установлена актуальная версия. Игра готова к запуску без сети.'
      : this.library.available ? 'Эта версия готова к запуску без сети. Обновления применяются после закрытия всех окон игры.'
      : 'Готовим игру для офлайна…';
  }
  select(song) { this.song = song; this.refresh(); }
  async refresh() {
    const generation = ++this.generation;
    const song = this.song;
    $('offline-download').disabled = true; $('offline-remove').hidden = true;
    $('offline-track').textContent = song?.title || '';
    if (this.busy) { $('offline-state').textContent = 'Операция со скачанным треком ещё выполняется…'; return; }
    if (!song || !this.library.available) return;
    try {
      const result = await this.library.getOfflineState(song.id);
      if (generation !== this.generation || this.busy) return;
      $('offline-download').disabled = result.state === 'ready';
      $('offline-remove').hidden = result.state === 'missing';
      $('offline-remove').disabled = false;
      $('offline-state').textContent = result.state === 'ready'
        ? `Доступен без сети · ${megabytes.format(result.bytes / 1024 / 1024)} МБ`
        : result.state === 'partial' ? 'Скачивание не завершено. Скачай трек заново.' : 'Не скачан. Для игры нужен интернет.';
    } catch { if (generation === this.generation) $('offline-state').textContent = 'Не удалось проверить скачанный трек. Попробуй открыть этот раздел ещё раз.'; }
  }
  async change(method) {
    if (this.busy || !this.song) return;
    const song = this.song; this.busy = true; this.generation++;
    $('offline-download').disabled = true; $('offline-remove').disabled = true;
    $('offline-state').textContent = method === 'downloadTrack' ? 'Скачиваем музыку и все сложности… Не закрывай игру.' : 'Удаляем скачанный трек…';
    try {
      await this.library[method](song.id);
      this.busy = false; await this.refresh();
    } catch (error) {
      this.busy = false;
      await this.refresh();
      $('offline-state').textContent = error.message === 'quota' ? 'Не хватает места. Удали другой скачанный трек и повтори.'
        : error.message === 'version' ? 'Файлы трека обновились. Проверь обновления игры и скачай трек после обновления.'
        : 'Не удалось завершить операцию. Проверь интернет и попробуй ещё раз. Незавершённый трек не считается скачанным.';
    }
  }
}

export class SongAudio {
  constructor() {
    this.context = null;
    this.source = null;
    this.buffers = new Map();
    this.offset = 0;
    this.startAt = 0;
    this.volume = 0.75;
  }
  async unlock() {
    // iOS 17+: use the media channel rather than the silent-switch-controlled ambient channel.
    // https://bugs.webkit.org/show_bug.cgi?id=237322#c6
    try {
      if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // This optional API must not prevent playback in browsers that reject it.
    }
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    await this.context.resume();
  }
  async load(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось загрузить аудио. Проверь локальный сервер.');
    const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    this.buffers.set(url, buffer);
    return buffer;
  }
  play(buffer, offset = 0, countdown = 3) {
    this.stop();
    this.offset = offset;
    this.startAt = this.context.currentTime + countdown;
    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.source.connect(this.gain).connect(this.context.destination);
    this.source.start(this.startAt, Math.min(offset, buffer.duration));
  }
  get countdown() { return this.source ? Math.max(0, this.startAt - this.context.currentTime) : 0; }
  get position() { return this.source ? this.offset + Math.max(0, this.context.currentTime - this.startAt) : this.offset; }
  pause() { const position = this.position; this.stop(); this.offset = position; return position; }
  stop() {
    if (this.source) { this.source.stop(); this.source.disconnect(); this.gain.disconnect(); this.source = null; }
  }
  setVolume(volume) {
    this.volume = volume;
    if (this.gain) this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }
}

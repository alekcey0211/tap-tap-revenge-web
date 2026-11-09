export class SongAudio {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.needsContextReset = false;
    this.clockSample = null;
    this.unlockGeneration = 0;
    this.context = null;
    this.source = null;
    this.buffers = new Map();
    this.offset = 0;
    this.startAt = 0;
    this.volume = 0.75;
  }
  async unlock() {
    const generation = ++this.unlockGeneration;
    // iOS 17+: use the media channel rather than the silent-switch-controlled ambient channel.
    // https://bugs.webkit.org/show_bug.cgi?id=237322#c6
    try {
      if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // This optional API must not prevent playback in browsers that reject it.
    }
    if (this.needsContextReset && this.context) {
      this.stop();
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
      this.context = null;
    }
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.context.onstatechange = () => { if (this.interrupted) this.oninterrupt?.(); };
    }
    const context = this.context;
    this.needsContextReset = false;
    let timeout;
    try {
      // resume stays inside the user gesture; a stuck promise must not lock the pause UI.
      await Promise.race([context.resume(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Audio resume timed out')), 4000);
      })]);
      if (context.state !== 'running') throw new Error('Audio context is not running');
    } catch (error) {
      if (this.context === context && generation === this.unlockGeneration) this.needsContextReset = true;
      throw error;
    } finally { clearTimeout(timeout); }
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
    this.clockSample = { time: this.context.currentTime, checkedAt: this.now() };
    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.source.connect(this.gain).connect(this.context.destination);
    this.source.start(this.startAt, Math.min(offset, buffer.duration));
  }
  get interrupted() {
    if (!this.source) return false;
    if (this.context.state !== 'running') return true;
    const time = this.context.currentTime, now = this.now();
    if (!this.clockSample || time !== this.clockSample.time) this.clockSample = { time, checkedAt: now };
    // Some interrupted devices report running while the audio clock is frozen.
    // Detect it without advancing game time or falling back to a silent countdown.
    if (now - this.clockSample.checkedAt >= 1500) {
      this.needsContextReset = true;
      return true;
    }
    return false;
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

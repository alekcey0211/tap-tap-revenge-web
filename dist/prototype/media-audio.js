// Opt-in output that never connects the media element to an AudioContext.
// play() must be called directly from a user's click, after the track is fetched.
export class MediaSongAudio {
  constructor(createMedia = () => new Audio(), now = () => performance.now()) {
    this.createMedia = createMedia;
    this.now = now;
    this.media = null;
    this.track = null;
    this.url = null;
    this.active = false;
    this.offset = 0;
    this.endedAt = null;
    this.generation = 0;
  }
  async load(url, duration) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid track duration');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось загрузить музыку.');
    return { blob: await response.blob(), duration };
  }
  play(track, offset = 0) {
    if (this.track !== track) {
      this.dispose();
      this.media = this.createMedia();
      const onInterruption = () => { if (this.interrupted) this.oninterrupt?.(); };
      this.media.addEventListener('pause', onInterruption);
      this.media.addEventListener('error', onInterruption);
      this.url = URL.createObjectURL(track.blob);
      this.media.src = this.url;
      this.media.preload = 'auto';
      this.track = track;
    }
    this.stop();
    const generation = this.generation;
    this.offset = Math.max(0, offset);
    this.endedAt = null;
    this.active = true;
    // The original clock keeps running briefly after the song ends, for note offset.
    // Never restart an ended media element while resuming that silent tail.
    if (this.offset >= track.duration) {
      this.endedAt = this.now() - (this.offset - track.duration) * 1000;
      return Promise.resolve(true);
    }
    let playback;
    try {
      this.media.currentTime = this.offset;
      this.media.muted = false;
      this.media.volume = 1;
      // No await or timer before play(): preserve the iPhone user activation.
      playback = this.media.play();
    } catch (error) {
      this.stop();
      return Promise.reject(error);
    }
    return Promise.resolve(playback).then(() => {
      if (generation !== this.generation) return false;
      if (Number.isFinite(this.media.duration) && this.media.duration > 0) track.duration = this.media.duration;
      return true;
    }, error => {
      if (generation === this.generation) this.stop();
      throw error;
    });
  }
  get countdown() { return 0; }
  get position() {
    if (!this.active) return this.offset;
    if (this.media.ended || this.endedAt !== null) {
      this.endedAt ??= this.now();
      return this.track.duration + (this.now() - this.endedAt) / 1000;
    }
    // During buffering the media clock freezes; the game must freeze with it.
    return this.media.currentTime;
  }
  get waiting() { return this.active && !this.media.ended && this.endedAt === null && (this.media.readyState < 3 || this.media.seeking); }
  get interrupted() { return this.active && this.endedAt === null && !this.media.ended && (this.media.paused || Boolean(this.media.error)); }
  pause() { const position = this.position; this.stop(); return position; }
  stop() {
    this.offset = this.position;
    this.active = false;
    this.generation++;
    this.media?.pause();
  }
  setVolume() { /* Compatible mode uses the device's media volume. */ }
  dispose() {
    this.stop();
    if (this.media) {
      this.media.removeAttribute('src');
      this.media.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.media = null; this.track = null;
  }
}

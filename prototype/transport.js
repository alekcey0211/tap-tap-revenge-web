// No storage or automatic resume. Music is the authoritative clock.
export class Transport {
  constructor(player, now = () => performance.now() / 1000) {
    this.player = player; this.now = now; this.state = 'ready'; this.offset = 0; this.generation = 0;
  }
  setTrack(track) { this.pause(); this.player.dispose(); this.track = track; this.offset = 0; this.state = 'ready'; }
  get position() {
    if (!['playing', 'starting'].includes(this.state)) return this.offset;
    return this.music ? this.player.position : this.offset + this.now() - this.started;
  }
  play(music) {
    if (!this.track || ['playing', 'starting'].includes(this.state)) return Promise.resolve();
    if (this.state === 'ended') this.offset = 0;
    this.music = music; this.started = this.now(); this.state = 'starting';
    const id = ++this.generation;
    let playback;
    try { playback = music ? this.player.play(this.track, this.offset) : Promise.resolve(); }
    catch (error) { this.state = 'paused'; return Promise.reject(error); }
    return Promise.resolve(playback).then(() => {
      if (id === this.generation) this.state = 'playing';
    }, error => {
      if (id !== this.generation) return;
      this.pause(); throw error;
    });
  }
  pause() {
    this.offset = this.position; this.generation++;
    this.player.stop();
    if (this.state !== 'ended') this.state = 'paused';
  }
  reset() { this.pause(); this.offset = 0; this.state = 'ready'; }
  update() {
    if (this.state === 'playing' && this.position >= this.track.duration) {
      this.pause(); this.offset = this.track.duration; this.state = 'ended';
    }
    if (this.state === 'playing' && this.music && this.player.interrupted) this.pause();
  }
}

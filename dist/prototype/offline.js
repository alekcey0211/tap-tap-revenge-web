// Only explicit downloads write music caches. Progress lives separately in localStorage.
export class OfflineLibrary {
  constructor(serviceWorker = globalThis.navigator?.serviceWorker) {
    this.serviceWorker = serviceWorker;
    this.registration = null;
    this.installFailed = false;
  }
  async register(onChange = () => {}) {
    if (!this.serviceWorker) throw new Error('unsupported');
    this.onChange = onChange;
    const existing = await this.serviceWorker.getRegistration?.('./');
    try { this.registration = await this.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }); }
    catch (error) {
      if (!existing?.active) throw error;
      this.registration = existing; // Offline launch must not depend on an update network request.
    }
    const watch = () => {
      this.installFailed = false;
      onChange();
      const worker = this.registration.installing;
      worker?.addEventListener('statechange', () => {
        this.installFailed = worker.state === 'redundant';
        onChange();
      });
    };
    this.registration.addEventListener('updatefound', watch);
    watch();
    return this.registration;
  }
  get available() { return Boolean(this.registration?.active); }
  get updateReady() { return Boolean(this.registration?.waiting); }
  async checkUpdate() {
    if (!this.registration) throw new Error('unsupported');
    if (!this.registration.active && !this.registration.installing) return this.register(this.onChange);
    await this.registration.update();
  }
  request(type, id) {
    const worker = this.registration?.active;
    if (!worker) return Promise.reject(new Error('not-ready'));
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = (error, result) => {
        clearTimeout(timeout); channel.port1.close();
        if (error) reject(new Error(error)); else resolve(result);
      };
      const timeout = setTimeout(() => finish('timeout'), 90000);
      channel.port1.onmessage = event => finish(event.data.error, event.data.result);
      try { worker.postMessage({ type, id }, [channel.port2]); }
      catch { finish('unsupported'); }
    });
  }
  getOfflineState(id) { return this.request('state', id); }
  downloadTrack(id) { return this.request('download', id); }
  removeTrack(id) { return this.request('remove', id); }
}

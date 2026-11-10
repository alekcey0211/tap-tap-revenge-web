// Reuse selected offline tracks across the Canvas → Babylon promotion.
// Paths alone are not sufficient: the three new levels have different numbers.
async function migrateSelectedTracks() {
  const retained = new Set();
  const names = await caches.keys();
  const prefixes = [prefix, ...(self.OFFLINE_ASSETS.previousTrackScopes || []).map(path =>
    `tap-tap:${new URL(path, base).pathname}:`)];
  for (const [id, track] of Object.entries(tracks)) {
    if ((await getOfflineState(id)).state === 'ready') continue;
    const candidates = names.filter(name => name !== trackName(id) && prefixes.some(value => name.startsWith(`${value}track:${id}:`)));
    for (const name of candidates) {
      try {
        const previous = await caches.open(name), byHash = new Map();
        for (const request of await previous.keys()) {
          const response = await previous.match(request);
          if (!response || response.status !== 200) continue;
          const data = await response.clone().arrayBuffer();
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
          byHash.set(`${digest}:${data.byteLength}`, response);
        }
        if (!track.files.every(file => byHash.has(`${file.hash}:${file.bytes}`))) {
          retained.add(name); continue;
        }
        const current = await caches.open(trackName(id));
        for (const file of track.files) await current.put(url(file.path), byHash.get(`${file.hash}:${file.bytes}`).clone());
        if ((await getOfflineState(id)).state !== 'ready') throw new Error('incomplete');
        break;
      } catch {
        // Quota/corruption must not destroy the user's previous download.
        await caches.delete(trackName(id)); retained.add(name);
      }
    }
  }
  return retained;
}

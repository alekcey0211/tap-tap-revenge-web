/* Classic worker for Safari. Never force activation or claim a running session. */
importScripts('./offline-assets.js');
const { shell, tracks, version, revision } = self.OFFLINE_ASSETS;
const base = self.registration.scope;
const prefix = `tap-tap:${new URL(base).pathname}:`;
const shellName = `${prefix}shell:${version}:${revision}`;
const url = path => new URL(path, base).href;
const shellFiles = new Map(shell.map(file => [url(file.path), file]));
const trackFiles = new Map(Object.entries(tracks).flatMap(([id, track]) => track.files.map(file => [url(file.path), { id, file }])));
const trackName = id => `${prefix}track:${id}:${tracks[id].revision}`;
const jobs = new Map();

async function verifiedFetch(file, signal) {
  const response = await fetch(url(file.path), { cache: 'no-store', signal });
  if (!response.ok || response.status !== 200 || response.redirected) throw new Error('network');
  const data = await response.clone().arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== file.hash || data.byteLength !== file.bytes) throw new Error('version');
  return response;
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const existed = (await caches.keys()).includes(shellName);
  const cache = await caches.open(shellName);
  try {
    // A partial or mixed release must never replace the previous offline shell.
    for (const file of shell) {
      if (!await cache.match(url(file.path))) await cache.put(url(file.path), await verifiedFetch(file));
    }
  } catch (error) { if (!existed) await caches.delete(shellName); throw error; }
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  // Default activation waits until ALL old controlled windows have closed.
  const keep = new Set([shellName, ...Object.keys(tracks).map(trackName)]);
  for (const name of await caches.keys()) if (name.startsWith(prefix) && !keep.has(name)) await caches.delete(name);
})()));

async function getOfflineState(id) {
  if (!tracks[id]) throw new Error('unknown-track');
  const name = trackName(id);
  if (!(await caches.keys()).includes(name)) return { state: 'missing', bytes: 0 };
  const cache = await caches.open(name);
  let found = 0;
  for (const file of tracks[id].files) if (await cache.match(url(file.path))) found++;
  return { state: found === tracks[id].files.length ? 'ready' : found ? 'partial' : 'missing',
    bytes: tracks[id].files.reduce((total, file) => total + file.bytes, 0) };
}
async function downloadTrack(id) {
  if ((await getOfflineState(id)).state === 'ready') return getOfflineState(id);
  const name = trackName(id);
  await caches.delete(name);
  const cache = await caches.open(name);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    for (const file of tracks[id].files) await cache.put(url(file.path), await verifiedFetch(file, controller.signal));
    const result = await getOfflineState(id);
    if (result.state !== 'ready') throw new Error('incomplete');
    return result;
  } catch (error) { await caches.delete(name); throw error; }
  finally { clearTimeout(timeout); }
}
async function removeTrack(id) {
  if (!tracks[id]) throw new Error('unknown-track');
  await caches.delete(trackName(id));
  return getOfflineState(id);
}

self.addEventListener('message', event => {
  const { type, id } = event.data || {};
  if (!event.ports[0] || !event.source?.url?.startsWith(base)) return;
  const operation = { state: getOfflineState, download: downloadTrack, remove: removeTrack }[type];
  if (!operation || !Object.hasOwn(tracks, id)) return;
  // Serialize operations for a track, including requests from other windows.
  const work = (jobs.get(id) || Promise.resolve()).catch(() => {}).then(() => operation(id));
  jobs.set(id, work);
  event.waitUntil(work.then(result => event.ports[0].postMessage({ result }), error => {
    event.ports[0].postMessage({ error: error.name === 'QuotaExceededError' ? 'quota' : error.message === 'version' ? 'version' : 'download' });
  }).finally(() => { if (jobs.get(id) === work) jobs.delete(id); }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const parsed = new URL(request.url);
  if (request.method !== 'GET' || parsed.origin !== new URL(base).origin || !request.url.startsWith(base)) return;
  const canonical = request.mode === 'navigate' && [base, url('index.html')].includes(parsed.origin + parsed.pathname)
    ? url('index.html') : parsed.origin + parsed.pathname;
  const shellFile = shellFiles.get(canonical);
  const trackFile = trackFiles.get(canonical);
  if (!shellFile && !trackFile) return;
  event.respondWith((async () => {
    try {
      if (shellFile) {
        const cache = await caches.open(shellName);
        const cached = await cache.match(canonical);
        if (cached) return cached;
        if (trackFile && (await getOfflineState(trackFile.id)).state === 'ready') {
          const artwork = await (await caches.open(trackName(trackFile.id))).match(canonical);
          if (artwork) return artwork;
        }
        const response = await verifiedFetch(shellFile);
        await cache.put(canonical, response.clone());
        return response;
      }
      const { id, file } = trackFile;
      if ((await getOfflineState(id)).state === 'ready') {
        const cached = await (await caches.open(trackName(id))).match(canonical);
        if (cached) return cached;
      }
      // Playing online does not implicitly download a track for offline use.
      return await verifiedFetch(file);
    } catch {
      return new Response('Данные игры недоступны. Подключись к интернету. Для обновления закрой все окна игры и открой её снова.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

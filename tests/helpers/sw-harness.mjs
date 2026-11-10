import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export class FakeCaches {
  stores = new Map();
  quota = false;
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const files = this.stores.get(name);
    return {
      keys: async () => [...files.keys()],
      match: async url => {
        const entry = files.get(String(url));
        return entry ? new Response(entry.bytes.slice(0), { status: entry.status, headers: entry.headers }) : undefined;
      },
      put: async (url, response) => {
        if (this.quota) throw new DOMException('quota', 'QuotaExceededError');
        // CacheStorage owns bytes, not a live Response stream from an old worker realm.
        files.set(String(url), { bytes: await response.clone().arrayBuffer(), status: response.status,
          headers: [...response.headers] });
      },
      delete: async url => files.delete(String(url)),
    };
  }
}

export async function mountWorker({ scope = 'https://example.test/tap-tap-revenge-web/', caches = new FakeCaches(), assets = null, root = new URL('../../dist/', import.meta.url) } = {}) {
  const events = {}, requests = [];
  const config = await readFile(new URL('offline-assets.js', root), 'utf8');
  const code = await readFile(new URL('sw.js', root), 'utf8');
  let offline = false, failPath = null, mismatch = null;
  const self = { registration: { scope }, addEventListener: (name, handler) => { events[name] = handler; } };
  const context = vm.createContext({ self, caches, URL, Response, Uint8Array, crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    importScripts(path) { if (path !== './offline-assets.js') throw new Error('unexpected script'); vm.runInContext(config, context); if (assets) self.OFFLINE_ASSETS = assets; },
    fetch: async url => {
      requests.push(url);
      if (offline || url.endsWith(failPath || '/never')) throw new Error('network');
      const path = url.slice(scope.length);
      const bytes = await readFile(new URL(path, root));
      return new Response(url.endsWith(mismatch || '/never') ? 'mixed release' : bytes);
    },
  });
  vm.runInContext(code, context);
  function lifecycle(type) { let work; events[type]({ waitUntil: promise => { work = promise; } }); return work; }
  function message(type, id, source = scope) {
    let work, response;
    events.message({ data: { type, id }, source: { url: source }, ports: [{ postMessage: data => { response = data; } }], waitUntil: promise => { work = promise; } });
    return Promise.resolve(work).then(() => response);
  }
  function request(path, { method = 'GET', mode = 'cors' } = {}) {
    let work;
    events.fetch({ request: { url: new URL(path, scope).href, method, mode }, respondWith: promise => { work = promise; } });
    return work;
  }
  return { lifecycle, message, request, caches, requests, assets: self.OFFLINE_ASSETS,
    offline: value => { offline = value; }, fail: path => { failPath = path; }, mismatch: path => { mismatch = path; }, scope };
}

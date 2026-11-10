import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SAVE_KEY, currentRecords } from '../../dist/storage.js';
import { SongAudio } from '../../dist/audio.js?v=0.5.3';

let sequence = 0;
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Minimal DOM/audio doubles. Browser layout and native input are checked separately.
export async function mount(t, { records = {}, settings = {}, bootFailure = false, saved = null, storageFailure = false, chart = null } = {}) {
  const html = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
  const elements = new Map(), lanes = [], events = {}, frames = [], values = new Map();
  values.set('ttr-web-settings', JSON.stringify(settings));
  values.set('ttr-web-records', JSON.stringify(records));
  if (saved) values.set(SAVE_KEY, JSON.stringify(saved));
  const canvasContext = new Proxy({}, { get: (_, name) => ['createLinearGradient', 'createRadialGradient'].includes(name)
    ? () => ({ addColorStop() {} }) : () => {} });
  class Element {
    constructor(tagName, attrs = '') {
      this.tagName = tagName.toUpperCase(); this.attrs = {}; this.dataset = {};
      this.children = []; this.textContent = ''; this.hidden = /\bhidden\b/.test(attrs);
      this.disabled = /\bdisabled\b/.test(attrs); this.open = false; this.value = '';
      this.isConnected = true; this.scrollTop = 0; this.inert = /\binert\b/.test(attrs);
      this.clientWidth = 390; this.clientHeight = 500;
      for (const [, name, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) this.setAttribute(name, value);
    }
    setAttribute(name, value) { this.attrs[name] = value; if (name.startsWith('data-')) this.dataset[name.slice(5)] = value; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    focus() { document.activeElement = this; }
    click() { return this.onclick?.(); }
    remove() {}
    getContext() { return canvasContext; }
    setPointerCapture() {}
  }
  for (const [, tag, attrs] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
    const node = new Element(tag, attrs);
    if (node.attrs.id) { assert.ok(!elements.has(node.attrs.id), 'unique IDs'); elements.set(node.attrs.id, node); }
    if (node.dataset.lane !== undefined) lanes.push(node);
  }
  const detail = new Element('details');
  const dialogs = () => [...elements.values()].filter(node => node.tagName === 'DIALOG' && node.open);
  const document = {
    body: new Element('body'), hidden: false, activeElement: null,
    getElementById(id) { assert.ok(elements.has(id), `existing element: ${id}`); return elements.get(id); },
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    querySelector: selector => selector === '.result-details' ? detail : dialogs()[0] || null,
    querySelectorAll: selector => selector === '[data-lane]' ? lanes : dialogs(),
    addEventListener: (name, fn) => { events[name] = fn; },
  };
  const catalog = JSON.parse(await readFile(new URL('../../dist/assets/catalog.json', import.meta.url)));
  const audio = { currentTime: 0, starts: [], loads: [], resumeFailure: false, loadFailure: false, loadGate: null, state: 'running', contexts: [], resumeGate: null };
  class AudioContext {
    constructor() { audio.contexts.push(this); }
    get state() { return audio.state; }
    get currentTime() { return audio.currentTime; }
    resume() {
      if (audio.resumeFailure) return Promise.reject(new Error('test unlock'));
      audio.state = 'running';
      return audio.resumeGate?.promise || Promise.resolve();
    }
    close() { this.closed = true; return Promise.resolve(); }
    createBufferSource() { return { connect: n => n, disconnect() {}, stop() {}, start: (at, offset) => audio.starts.push({ at, offset }) }; }
    createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const native = { instances: [], plays: [], gate: null, failure: false, now: 0 };
  class Audio {
    constructor() {
      this.currentTime = 0; this.duration = 150; this.readyState = 4; this.ended = false; this.paused = true;
      native.instances.push(this);
    }
    addEventListener(name, fn) { this['on' + name] = fn; }
    play() {
      native.plays.push(this.currentTime); this.paused = false;
      return native.failure ? Promise.reject(new Error('test native playback')) : native.gate?.promise || Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute(name) { delete this[name]; }
    load() {}
  }
  const globals = {
    document, window: { scrollY: 0, scrollTo({ top }) { this.scrollY = top; }, addEventListener: (name, fn) => { events[name] = fn; } },
    AudioContext, Audio, performance: { now: () => native.now }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: callback => { frames.push(callback); },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => { if (storageFailure) throw new Error('quota'); values.set(key, value); } },
    fetch: async url => {
      if (bootFailure && url === 'assets/catalog.json') return { ok: false };
      if (url.endsWith('.m4a')) {
        audio.loads.push(url);
        if (audio.loadGate) await audio.loadGate.promise;
        if (audio.loadFailure) return { ok: false };
        return { ok: true, blob: async () => new Blob(['music'], { type: 'audio/mp4' }) };
      }
      if (chart && /assets\/tracks\/.*\/\d\.json$/.test(url)) return { ok: true, json: async () => chart };
      return { ok: true, json: async () => JSON.parse(await readFile(new URL('../../dist/' + url, import.meta.url))) };
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  t.mock.method(SongAudio.prototype, 'load', async url => {
    audio.loads.push(url);
    if (audio.loadGate) await audio.loadGate.promise;
    if (audio.loadFailure) throw new Error('test network error');
    return { duration: 150 };
  });
  await import('../../dist/app.js?ui-test=' + sequence++);
  const node = id => document.getElementById(id);
  return {
    node, audio, native, catalog, document, lanes, values, events, detail,
    openSong(title = catalog.find(song => !song.tutorial).title) {
      if (document.body.dataset.screen === 'menu') node('menu-play').onclick();
      return node('tracks').children.find(button => button.children[1].children[0].textContent === title).onclick();
    },
    // Explicit navigation helper for gameplay regressions, not a replacement for click().
    async start(mode = 'play') {
      if (['menu', 'library'].includes(document.body.dataset.screen)) await this.openSong();
      await this.click(mode);
    },
    click: async id => { assert.equal(node(id).disabled, false, id); node(id).focus(); await node(id).onclick(); },
    tick(time) { audio.currentTime = time; const callback = frames.shift(); assert.ok(callback); callback(); },
    setBootFailure(value) { bootFailure = value; },
    records: () => values.has(SAVE_KEY) ? currentRecords(JSON.parse(values.get(SAVE_KEY)).progress) : records,
    settings: () => values.has(SAVE_KEY) ? JSON.parse(values.get(SAVE_KEY)).settings : settings,
    progress: () => values.has(SAVE_KEY) ? JSON.parse(values.get(SAVE_KEY)).progress : { records: [], history: [] },
    setStorageFailure(value) { storageFailure = value; },
    selectedTrack: id => node('tracks').children.find(button => button.children[1].children[0].textContent === id),
  };
}

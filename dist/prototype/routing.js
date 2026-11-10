// Hash URLs work under the GitHub Pages project path and in the offline shell.
const pages = { '': 'menu', library: 'library', settings: 'settings-screen', about: 'about-screen', progress: 'progress-screen' };
export function parseRoute(hash, catalog) {
  try {
    const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').map(decodeURIComponent), query = new URLSearchParams(search);
    let screen = pages[parts[0]], song;
    if (parts[0] === 'calibration' && parts.length === 1) {
      screen = 'song-screen'; song = catalog.find(item => item.tutorial);
    } else if (['song', 'offline'].includes(parts[0]) && parts.length === 2) {
      screen = parts[0] === 'song' ? 'song-screen' : 'offline-screen';
      song = catalog.find(item => item.id === parts[1]);
      if (!song) return { screen: 'library' };
    } else {
      if (!screen || parts.length !== 1) return { screen: 'menu' };
      song = catalog.find(item => item.id === query.get('song'));
    }
    const level = song?.levels[query.get('difficulty')] ? query.get('difficulty') : '1';
    return { screen, song, level };
  } catch { return { screen: 'menu' }; }
}
export function routeHash({ screen, song, level = '1' }) {
  if (['song-screen', 'game-screen', 'pause-screen', 'results', 'offline-screen'].includes(screen) && song) {
    if (song.tutorial && screen !== 'offline-screen') return '#/calibration';
    return `#/${screen === 'offline-screen' ? 'offline' : 'song'}/${encodeURIComponent(song.id)}?difficulty=${level}`;
  }
  if (screen === 'import-screen') screen = 'progress-screen';
  const path = Object.keys(pages).find(key => pages[key] === screen) || '';
  const query = song && ['settings', 'about', 'progress'].includes(path)
    ? '?' + new URLSearchParams({ song: song.id, difficulty: level }) : '';
  return '#/' + path + query;
}

export class HashRouter {
  constructor(browser, onRoute) {
    this.browser = browser; this.onRoute = onRoute;
    this.entries = []; this.index = -1; this.serial = 0; this.applying = false;
    this.change = () => {
      const hash = browser.location.hash, key = browser.history.state?.ttrRoute;
      if (this.entries[this.index]?.key === key && this.entries[this.index]?.hash === hash) return;
      const known = this.entries.findIndex(entry => entry.key === key && entry.hash === hash);
      if (known >= 0) this.index = known;
      else {
        this.entries.splice(this.index + 1);
        this.entries.push({ hash, key: ++this.serial }); this.index++;
      }
      void this.apply(hash);
    };
  }
  start() {
    this.browser.addEventListener('popstate', this.change);
    this.browser.addEventListener('hashchange', this.change);
    this.browser.history.scrollRestoration = 'manual';
    this.entries.push({ hash: this.browser.location.hash, key: ++this.serial }); this.index = 0;
    return this.apply(this.browser.location.hash);
  }
  apply(hash) {
    this.applying = true;
    this.pendingHash = null;
    let work;
    try { work = this.onRoute(hash); }
    finally {
      this.applying = false;
      this.write(this.pendingHash || hash, true);
    }
    return work;
  }
  write(hash, replace = false) {
    if (this.applying) { this.pendingHash = hash; return; }
    if (!replace && this.entries[this.index]?.hash === hash) return;
    if (!replace) {
      this.entries.splice(this.index + 1);
      this.entries.push({ hash, key: ++this.serial }); this.index++;
    } else this.entries[this.index].hash = hash;
    this.browser.history[replace ? 'replaceState' : 'pushState'](
      { ttrRoute: this.entries[this.index].key }, '', hash);
  }
  backTo(hash) {
    if (this.index <= 0 || this.entries[this.index - 1].hash !== hash) return false;
    this.browser.history.back(); return true;
  }
}

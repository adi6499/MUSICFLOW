// Start-up. Draw the app straight away; saved data and the last session fill
// in a moment later without blocking the first paint.

import './lib/px';
import { render } from 'preact';
// Ubuntu, in the three weights the design uses. Only the Latin sets are packed;
// other scripts use the device's own font.
import '@fontsource/ubuntu/latin-400.css';
import '@fontsource/ubuntu/latin-500.css';
import '@fontsource/ubuntu/latin-700.css';
import '@fontsource/ubuntu/latin-ext-400.css';
import '@fontsource/ubuntu/latin-ext-500.css';
import '@fontsource/ubuntu/latin-ext-700.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/player.css';
import './styles/glass.css';
import { App } from './app';
import { hydrate } from './lib/library';
import { initNative, isApp } from './lib/native';
import { initOffline } from './lib/offline';
import { restoreSession } from './lib/player';

const root = document.getElementById('app')!;
root.textContent = '';
render(<App />, root);

initNative();
void hydrate();
void restoreSession();
void initOffline();

// While developing only: a handle for poking at the app from the browser console.
if (import.meta.env.DEV) {
  void Promise.all([
    import('./lib/player'), import('./lib/library'), import('./lib/router'), import('./lib/api'), import('./lib/station'), import('./lib/ytimport'), import('./lib/eq'), import('./lib/mixes'), import('./lib/offline'),
  ]).then(([player, library, router, api, station, ytimport, eq, mixes, offline]) => {
    (window as any).__sukoonDev = { player, library, router, api, station, ytimport, eq, mixes, offline };
  });
}

// On the website, keep a copy of the app itself so it opens instantly and
// still opens with no internet. (Inside the Android app the files are already
// on the phone, so this is skipped.)
if (import.meta.env.PROD && !isApp && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
navigator.serviceWorker.register('./sw.js').catch(() => { /* the app works without it */ });
    // The very first visit loads the app's files before the keeper is in place,
    // so hand it the list afterwards. From then on Sukoon opens with no internet.
    navigator.serviceWorker.ready.then((reg) => {
      const mine = performance.getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && u.includes('/assets/'));
      reg.active?.postMessage({ type: 'keep', urls: [...new Set(mine)] });
    }).catch(() => { /* optional */ });
  });
}

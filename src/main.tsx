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
import { restoreSession } from './lib/player';

const root = document.getElementById('app')!;
root.textContent = '';
render(<App />, root);

initNative();
void hydrate();
void restoreSession();

// While developing only: a handle for poking at the app from the browser console.
if (import.meta.env.DEV) {
  void Promise.all([
    import('./lib/player'), import('./lib/library'), import('./lib/router'), import('./lib/api'), import('./lib/station'), import('./lib/ytimport'), import('./lib/eq'), import('./lib/mixes'),
  ]).then(([player, library, router, api, station, ytimport, eq, mixes]) => {
    (window as any).__sukoonDev = { player, library, router, api, station, ytimport, eq, mixes };
  });
}

// On the website, keep a copy of the app itself so it opens instantly and
// still opens with no internet. (Inside the Android app the files are already
// on the phone, so this is skipped.)
if (import.meta.env.PROD && !isApp && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* the app works without it */ });
  });
}

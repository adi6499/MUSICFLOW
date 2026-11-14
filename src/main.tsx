// Start-up. Draw the app straight away; saved data and the last session fill
// in a moment later without blocking the first paint.

import './lib/px';
import { render } from 'preact';
import '@fontsource/instrument-serif/400.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/player.css';
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
    import('./lib/player'), import('./lib/library'), import('./lib/router'), import('./lib/api'), import('./lib/station'), import('./lib/ytimport'),
  ]).then(([player, library, router, api, station, ytimport]) => {
    (window as any).__sukoonDev = { player, library, router, api, station, ytimport };
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

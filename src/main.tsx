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
import { getAppFile, isNewer } from './lib/appfile';
import { hydrate } from './lib/library';
import { initNative, isApp } from './lib/native';
import { initOffline } from './lib/offline';
import { restoreSession } from './lib/player';
import { go, to } from './lib/router';
import { toast } from './lib/toast';
import { VERSION } from './lib/version';

const root = document.getElementById('app')!;
root.textContent = '';
render(<App />, root);

initNative();
void hydrate();
void restoreSession();
void initOffline();

// Inside the Android app: a moment after start-up, see whether the website
// offers a newer version, and say so once (Settings keeps showing it after).
if (isApp) {
  setTimeout(() => {
    void getAppFile()
      .then((file) => {
        if (!file || !isNewer(file.version, VERSION)) return;
        let told = '';
        try { told = localStorage.getItem('sukoon.updateTold') || ''; } catch { /* optional */ }
        if (told === file.version) return;
        try { localStorage.setItem('sukoon.updateTold', file.version); } catch { /* optional */ }
        toast(`Music Flow ${file.version} is ready.`, { label: 'See', run: () => go(to.getApp()) }, 6000);
      })
      .catch(() => { /* offline, or nothing published: stay quiet */ });
  }, 5000);
}

// While developing only: a handle for poking at the app from the browser console,
// and two address knobs for taking pictures with an off-screen browser:
//   ?set={"glassLevel":30,"theme":"dark"}   apply these settings
//   ?scroll=400                             scroll this far down once the page has filled in
//   ?song=kesariya                          put this song in the player (paused), so the mini player shows
if (import.meta.env.DEV) {
  try {
    const knobs = new URLSearchParams(location.search);
    const set = knobs.get('set');
    if (set) void import('./lib/library').then((library) => library.setSettings(JSON.parse(set)));
    const scroll = Number(knobs.get('scroll'));
    if (scroll > 0) setTimeout(() => window.scrollTo(0, scroll), 2500);
    const song = knobs.get('song');
    if (song) {
      void Promise.all([import('./lib/api'), import('./lib/player')]).then(async ([api, player]) => {
        const found = await api.searchSongs(song, 1, 3);
        if (found.length) { player.playTracks(found, 0, 'Preview'); player.pause(); }
      });
    }
  } catch { /* a mistyped knob is simply ignored */ }
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
    // so hand it the list afterwards. From then on Music Flow opens with no internet.
    navigator.serviceWorker.ready.then((reg) => {
      const mine = performance.getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && u.includes('/assets/'));
      reg.active?.postMessage({ type: 'keep', urls: [...new Set(mine)] });
    }).catch(() => { /* optional */ });
  });
}

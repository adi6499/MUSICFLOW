// Which screen is showing, and moving between screens.
//
// Addresses live after the # (for example #/album/123), which works the same
// on a website, in a sub-folder and inside the Android app.
//
// Three things make moving around feel right:
//  * Going Back returns you to exactly where you were scrolled.
//  * Anything that slides over the page (the player, a menu) closes with the
//    Back button instead of leaving the screen underneath.
//  * Screens cross-fade into each other where the browser supports it.

import { signal } from '@preact/signals';
import { settings } from './library';

export interface Route {
  /** First part of the address: '', 'search', 'album', … */
  name: string;
  /** The remaining parts: ['123'] for #/album/123. */
  parts: string[];
  query: Record<string, string>;
  path: string;
}

function parse(hash: string): Route {
  let raw = hash.replace(/^#/, '');
  if (raw[0] !== '/') raw = '/' + raw;
  const [pathOnly, qs = ''] = raw.split('?');
  const bits = pathOnly.split('/').filter(Boolean).map((b) => {
    try { return decodeURIComponent(b); } catch { return b; }
  });
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (!k) continue;
      try { query[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { query[k] = v; }
    }
  }
  return { name: bits[0] || '', parts: bits.slice(1), query, path: raw };
}

const inBrowser = typeof window !== 'undefined';

export const route = signal<Route>(parse(inBrowser ? location.hash : ''));
/** Names of things currently slid over the page, bottom to top. */
export const overlays = signal<string[]>([]);
/** 'push' when going somewhere new, 'pop' when going back. Screens may use it to choose an entrance. */
export const lastMove = signal<'push' | 'pop' | 'replace'>('replace');

let idx = 0;
const scrollAt = new Map<number, number>();
let ignorePop = 0;

function calm(): boolean {
  return settings.value.calmMotion || (inBrowser && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function show(next: Route, move: 'push' | 'pop' | 'replace', scrollTo: number, instant = false): void {
  const apply = () => {
    lastMove.value = move;
    route.value = next;
  };
  const place = () => {
    if (scrollTo <= 0) { window.scrollTo(0, 0); return; }
    // The page may still be filling in; keep nudging until it is tall enough.
    let tries = 0;
    const settle = () => {
      window.scrollTo(0, scrollTo);
      if (Math.abs(window.scrollY - scrollTo) > 4 && tries++ < 12) setTimeout(settle, 50);
    };
    settle();
  };
  const doc = document as Document & { startViewTransition?: (cb: () => unknown) => { finished: Promise<void> } };
  const same = next.name === route.value.name && next.parts.join('/') === route.value.parts.join('/');
  if (instant || !doc.startViewTransition || calm() || document.hidden || same) {
    apply();
    requestAnimationFrame(place);
    setTimeout(place, 0);
    return;
  }
  document.documentElement.dataset.move = move;
  try {
    const vt = doc.startViewTransition(async () => {
      apply();
      // Let the new screen render before the browser takes its "after" picture.
      await new Promise((r) => setTimeout(r, 0));
      place();
    });
    vt.finished.catch(() => { /* interrupted by another move: fine */ });
  } catch {
    apply();
    setTimeout(place, 0);
  }
}

/** Go to another screen. */
export function go(path: string, opts: { replace?: boolean } = {}): void {
  if (!inBrowser) return;
  const target = path[0] === '/' ? path : '/' + path;
  const hadOverlay = overlays.value.length > 0;
  if (hadOverlay) overlays.value = [];
  if (target === route.value.path && !hadOverlay) { window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); return; }
  scrollAt.set(idx, window.scrollY);
  const next = parse('#' + target);
  if (hadOverlay) {
    // The overlay owns the newest history entry; turn that entry into the new screen.
    idx += 1;
    history.replaceState({ i: idx }, '', '#' + target);
    // The overlay is already sliding away; switch the screen underneath without a second animation.
    show(next, 'push', 0, true);
  } else if (opts.replace) {
    history.replaceState({ i: idx }, '', '#' + target);
    show(next, 'replace', 0);
  } else {
    idx += 1;
    history.pushState({ i: idx }, '', '#' + target);
    show(next, 'push', 0);
  }
}

/** Change the address without leaving the screen (used while typing a search). */
export function quietReplace(path: string): void {
  if (!inBrowser) return;
  const target = path[0] === '/' ? path : '/' + path;
  history.replaceState({ i: idx, ov: overlays.value.length ? 1 : 0 }, '', '#' + target);
  route.value = parse('#' + target);
}

export function back(): void {
  if (!inBrowser) return;
  if (idx > 0 || overlays.value.length) history.back();
  else go('/', { replace: true });
}

/** Can Back still do something inside the app? (The Android shell asks this.) */
export function canGoBack(): boolean {
  return overlays.value.length > 0 || idx > 0;
}

/** Something slid over the page: make the Back button close it. */
export function openOverlay(name: string): void {
  if (!inBrowser || overlays.value.includes(name)) return;
  if (!overlays.value.length) history.pushState({ i: idx, ov: 1 }, '');
  overlays.value = [...overlays.value, name];
}

/** Closed from its own button (not with Back). */
export function closeOverlay(name: string): void {
  if (!overlays.value.includes(name)) return;
  const rest = overlays.value.filter((n) => n !== name);
  overlays.value = rest;
  if (!rest.length && inBrowser && history.state?.ov) {
    ignorePop++;
    history.back();
  }
}

export const isOpen = (name: string) => overlays.value.includes(name);

if (inBrowser) {
  try { history.scrollRestoration = 'manual'; } catch { /* older browsers */ }
  const st = history.state;
  if (st && typeof st.i === 'number') {
    idx = st.i;
    // A reload while an overlay was open: that entry is now just the page.
    if (st.ov) history.replaceState({ i: idx }, '');
  } else {
    history.replaceState({ i: 0 }, '');
  }

  window.addEventListener('popstate', (e) => {
    if (ignorePop > 0) { ignorePop--; return; }
    const open = overlays.value;
    if (open.length) {
      if (parse(location.hash).path === route.value.path) {
        // Back closes the top-most overlay and stays on the page.
        const rest = open.slice(0, -1);
        overlays.value = rest;
        if (rest.length) history.pushState({ i: idx, ov: 1 }, '');
        return;
      }
      // The address itself changed (a typed address or a plain link): close everything and go there.
      overlays.value = [];
    }
    const state = e.state as { i?: number } | null;
    scrollAt.set(idx, window.scrollY);
    if (state && typeof state.i === 'number') {
      const move = state.i < idx ? 'pop' : 'push';
      idx = state.i;
      show(parse(location.hash), move, scrollAt.get(idx) || 0);
    } else {
      // The address was typed or a plain link was followed.
      idx += 1;
      history.replaceState({ i: idx }, '');
      show(parse(location.hash), 'push', 0);
    }
  });

  let waiting = false;
  window.addEventListener('scroll', () => {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(() => { waiting = false; scrollAt.set(idx, window.scrollY); });
  }, { passive: true });
}

/** Address helpers, so screens never build paths by hand. */
export const to = {
  home: () => '/',
  search: (q = '') => (q ? `/search?q=${encodeURIComponent(q)}` : '/search'),
  library: (tab = '') => (tab ? `/library/${tab}` : '/library'),
  localPlaylist: (id: string) => `/library/playlist/${encodeURIComponent(id)}`,
  album: (id: string) => `/album/${encodeURIComponent(id)}`,
  playlist: (id: string) => `/playlist/${encodeURIComponent(id)}`,
  artist: (id: string) => `/artist/${encodeURIComponent(id)}`,
  /** Songs know the artist's name but often not the id; the artist screen resolves it. */
  artistNamed: (name: string) => `/artist/~${encodeURIComponent(name)}`,
  section: (key: string) => `/section/${encodeURIComponent(key)}`,
  mood: (key: string) => `/mood/${encodeURIComponent(key)}`,
  podcasts: () => '/podcasts',
  show: (id: string) => `/show/${encodeURIComponent(id)}`,
  settings: () => '/settings',
  importer: () => '/import',
};

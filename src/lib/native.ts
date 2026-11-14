// The bridge to the Android app shell. In a normal browser none of this does
// anything. Inside the app, Android provides `window.SukoonNative`, and this
// file (a) tells Android what is playing so it can show the notification and
// lock-screen controls and keep playback alive in the background, and
// (b) receives button presses coming back from there.

import { effect } from '@preact/signals';
import * as player from './player';
import { back, canGoBack } from './router';

interface Shell {
  /** JSON: {id,title,artist,album,image,playing,position,duration}. */
  update(json: string): void;
  /** Asks Android to send a JSON POST; the answer arrives as an 'http' event. */
  httpPost?(id: string, url: string, body: string): void;
  /** Light vibration. */
  haptic?(ms: number): void;
  /** Saves a small text file into the phone's Downloads folder. */
  saveText?(name: string, text: string): void;
  /** Light or dark is showing: lets Android colour the status-bar icons to match. */
  theme?(dark: boolean): void;
  /** Same, with the theme's background colour (#rrggbb) so the edges of the screen match it. */
  themeColor?(dark: boolean, background: string): void;
}

declare global {
  interface Window {
    SukoonNative?: Shell;
    /** Android calls this. Returns true when the event was handled. */
    __sukoon?: (event: string, a?: unknown, b?: unknown, c?: unknown) => boolean;
  }
}

const shell: Shell | undefined = typeof window !== 'undefined' ? window.SukoonNative : undefined;

export const isApp = !!shell;
export const canPost = !!shell?.httpPost;

const waiting = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let postId = 0;

/** POST JSON through Android's own networking (which is not bound by browser cross-site rules). */
export function post(url: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!shell?.httpPost) { reject(new Error('Not available here.')); return; }
    const id = 'p' + ++postId;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('The request took too long.'));
    }, 20000);
    waiting.set(id, { resolve, reject, timer });
    try { shell.httpPost(id, url, JSON.stringify(body)); } catch (e) {
      clearTimeout(timer);
      waiting.delete(id);
      reject(e instanceof Error ? e : new Error('The request failed.'));
    }
  });
}

/** Save a file to the phone's Downloads (Android app only). Returns false in a normal browser. */
export function saveText(name: string, text: string): boolean {
  if (!shell?.saveText) return false;
  try { shell.saveText(name, text); return true; } catch { return false; }
}

/** Tell the Android shell which appearance is showing. Does nothing in a browser. */
export function setTheme(dark: boolean, background: string): void {
  try {
    if (shell?.themeColor) shell.themeColor(dark, background);
    else shell?.theme?.(dark);
  } catch { /* shell went away */ }
}

/** Extra space the screens must leave for the status bar and gesture bar inside the app. */
function setInsets(top: number, bottom: number): void {
  const root = document.documentElement;
  root.style.setProperty('--safe-top', `${Math.max(0, top)}px`);
  root.style.setProperty('--safe-bottom', `${Math.max(0, bottom)}px`);
  try { localStorage.setItem('sukoon.insets', JSON.stringify([top, bottom])); } catch { /* optional */ }
}

export function initNative(): void {
  if (typeof window === 'undefined') return;

  window.__sukoon = (event, a, b, c) => {
    switch (event) {
      case 'play': player.play(); return true;
      case 'pause': player.pause(); return true;
      case 'toggle': player.toggle(); return true;
      case 'next': void player.next(); return true;
      case 'prev': player.prev(); return true;
      case 'seek': if (typeof a === 'number') player.seek(a); return true;
      case 'stop': player.pause(); return true;
      case 'back':
        // Android's Back button: close what is open, or go back a screen.
        if (canGoBack()) { back(); return true; }
        return false;
      case 'insets':
        if (typeof a === 'number' && typeof b === 'number') setInsets(a, b);
        return true;
      case 'http': {
        const job = waiting.get(String(a));
        if (!job) return false;
        waiting.delete(String(a));
        clearTimeout(job.timer);
        if (b === true) {
          try { job.resolve(JSON.parse(String(c))); } catch { job.reject(new Error('The answer could not be read.')); }
        } else {
          job.reject(new Error(typeof c === 'string' && c ? c : 'The request failed.'));
        }
        return true;
      }
      default:
        return false;
    }
  };

  if (!shell) return;
  document.documentElement.dataset.app = 'android';
  try {
    const saved = JSON.parse(localStorage.getItem('sukoon.insets') || 'null');
    if (Array.isArray(saved)) setInsets(Number(saved[0]) || 0, Number(saved[1]) || 0);
  } catch { /* first run */ }

  // Tell Android whenever the song or the play/pause state changes, and on
  // seeks. Between those, Android advances the position by itself.
  let lastSent = '';
  let lastPos = 0;
  effect(() => {
    const snap = player.snapshot();
    const key = `${snap.id}|${snap.playing}|${Math.round(snap.duration)}`;
    const jumped = Math.abs(snap.position - lastPos) > 3;
    lastPos = snap.position;
    if (key === lastSent && !jumped) return;
    lastSent = key;
    try { shell.update(JSON.stringify(snap)); } catch { /* shell went away */ }
  });
}

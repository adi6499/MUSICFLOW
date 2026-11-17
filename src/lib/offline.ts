// Downloads: keep songs on this device so they play with no internet.
//
// A downloaded song is stored inside Music Flow's own storage on the device (the
// same private place the library lives), together with its cover and, where
// they exist, its lyrics. Nothing is written to the phone's shared folders,
// and nothing is uploaded. The player (player.ts) asks here first, so a
// downloaded song also starts instantly and uses no data when online.
//
// Two songs are fetched at a time. The waiting list is remembered, so closing
// the app or losing the connection only pauses a download; it carries on by
// itself next time.

import { batch, computed, signal } from '@preact/signals';
import type { Stream, Track } from './types';
import { withStreams } from './api';
import { settings } from './library';
import { getLyrics } from './lyrics';
import { kvGet, kvSet } from './store';
import { toast } from './toast';
import { img, plural, sleep } from './util';

export interface Saved {
  t: Track;
  /** Bytes on the device. */
  size: number;
  /** Quality it was saved at, in kbps. */
  q: number;
  at: number;
}

const DB_NAME = 'sukoon-offline';
const AUDIO = 'audio';
const ART = 'art';
const INDEX_KEY = 'offline:index';
const QUEUE_KEY = 'offline:queue';
const AT_ONCE = 2;

const inBrowser = typeof window !== 'undefined';

/** False where the browser has nowhere to keep files (some private windows): the download buttons are then hidden. */
export const supported = inBrowser && typeof indexedDB !== 'undefined' && typeof fetch === 'function' && typeof URL !== 'undefined' && !!URL.createObjectURL;

/** Everything downloaded, newest first. */
export const downloads = signal<Saved[]>([]);
/** Songs being fetched or waiting their turn: id → true while fetching, false while waiting. */
export const active = signal<Record<string, boolean>>({});
/** id → 0…1 for the songs being fetched right now. */
export const percent = signal<Record<string, number>>({});
/** Is there an internet connection? */
export const online = signal(!inBrowser || navigator.onLine !== false);
/** True once the list of downloads has been read from the device. */
export const ready = signal(false);

const byId = computed(() => {
  const map = new Map<string, Saved>();
  for (const d of downloads.value) map.set(d.t.id, d);
  return map;
});

export const totalBytes = computed(() => downloads.value.reduce((sum, d) => sum + d.size, 0));
export const busyCount = computed(() => Object.keys(active.value).length);

/** For screens: redraws when the answer changes. */
export const isDownloaded = (id: string): boolean => byId.value.has(id);
/** For the player: a plain look-up that subscribes to nothing. */
export const has = (id: string): boolean => byId.peek().has(id);
/** Can this be played right now? Offline, only downloaded songs can. */
export const canPlay = (t: Track): boolean => online.value || (t.kind === 'song' && byId.value.has(t.id));

/** 5,300,000 → "5.1 MB"; 1,400,000,000 → "1.3 GB". */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return (mb / 1024).toFixed(1) + ' GB';
  return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
}

// ---------------------------------------------------------------- the store on the device

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (!supported) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
        if (!db.objectStoreNames.contains(ART)) db.createObjectStore(ART);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Run one request against a store. Rejects when the device is out of space, so the caller can say so. */
async function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  if (!db) throw new Error('no storage');
  return new Promise<T | undefined>((resolve, reject) => {
    try {
      const tx = db.transaction(store, mode);
      const req = work(tx.objectStore(store));
      let out: T | undefined;
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('storage'));
      tx.onabort = () => reject(tx.error || new Error('storage'));
    } catch (e) {
      reject(e);
    }
  });
}

const full = (e: unknown): boolean => /quota|space|full/i.test(String((e as { name?: string })?.name || '') + String((e as { message?: string })?.message || ''));

// ---------------------------------------------------------------- playing a downloaded song

/** A few ready-to-play addresses, most recent last. Older ones are let go. */
const urls = new Map<string, string>();
const KEEP_URLS = 6;

export const peekUrl = (id: string): string => urls.get(id) || '';

/** An address the audio player can use for a downloaded song ('' if it is not on the device after all). */
export async function localUrl(id: string): Promise<string> {
  const known = urls.get(id);
  if (known) {
    // Mark as recently used.
    urls.delete(id);
    urls.set(id, known);
    return known;
  }
  if (!has(id)) return '';
  try {
    const blob = await run<Blob>(AUDIO, 'readonly', (s) => s.get(id) as IDBRequest<Blob>);
    if (!blob || !blob.size) {
      // The list says it is here but the file is gone (storage was cleared): forget it.
      forget([id]);
      return '';
    }
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    while (urls.size > KEEP_URLS) {
      const [oldId, oldUrl] = urls.entries().next().value as [string, string];
      urls.delete(oldId);
      try { URL.revokeObjectURL(oldUrl); } catch { /* already gone */ }
    }
    return url;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- covers

/** picture address → the copy kept on the device. Filled at start-up and as songs are downloaded. */
const art = new Map<string, string>();
/** Ticks when a saved cover becomes available, so pictures on screen can pick it up. */
export const artTick = signal(0);

/** The saved copy of a picture, if there is one. */
export const offlineArt = (url: string): string | undefined => art.get(url);

async function keepArt(track: Track): Promise<void> {
  if (!track.image) return;
  for (const size of [150, 500] as const) {
    const url = img(track.image, size);
    if (!url || art.has(url)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      await run(ART, 'readwrite', (s) => { s.put(blob, url); });
      art.set(url, URL.createObjectURL(blob));
      artTick.value++;
    } catch { /* the cover is a nicety; the song is what matters */ }
  }
}

async function loadArt(): Promise<void> {
  try {
    const db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ART, 'readonly');
      const req = tx.objectStore(ART).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const key = String(cur.key);
        if (!art.has(key) && cur.value instanceof Blob) art.set(key, URL.createObjectURL(cur.value));
        cur.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    if (art.size) artTick.value++;
  } catch { /* covers simply come from the network */ }
}

// ---------------------------------------------------------------- words for downloaded songs

// Lyrics come from a free, community-run library. A big playlist must not
// send it hundreds of requests at once (it answers "too many" and gives
// nothing), so the words are fetched one song at a time with a pause between.
const wordsWanted: Track[] = [];
let wordsBusy = false;

function wantWords(track: Track): void {
  wordsWanted.push(track);
  void fetchWords();
}

async function fetchWords(): Promise<void> {
  if (wordsBusy) return;
  wordsBusy = true;
  try {
    while (wordsWanted.length && online.peek()) {
      const track = wordsWanted.shift()!;
      let reached = true;
      try { await getLyrics(track); } catch { reached = false; }
      // Refused or unreachable: give it a good rest before the next one.
      await sleep(reached ? 900 : 20000);
    }
  } finally {
    wordsBusy = false;
  }
}

// ---------------------------------------------------------------- downloading

let waiting: Track[] = [];
let running = 0;
const stops = new Map<string, AbortController>();
/** Tallies for the message shown when a batch finishes. */
let doneNow = 0;
let failedNow = 0;
let lastDone = '';
let spaceWarned = false;

function saveIndex(): void { void kvSet(INDEX_KEY, downloads.value); }
function saveQueue(): void { void kvSet(QUEUE_KEY, waiting.map(slim)); }

/** A copy without anything that only made sense during this visit. */
function slim(t: Track): Track {
  return { ...t };
}

function wantedQuality(): number {
  const q = settings.peek().downloadQuality;
  return q === 'high' ? 320 : q === 'saver' ? 96 : 160;
}

function choose(streams: Stream[] | undefined, want: number): Stream | null {
  if (!streams || !streams.length) return null;
  let best: Stream | null = null;
  for (const s of streams) if (s.q <= want && (!best || s.q > best.q)) best = s;
  // Nothing at or below the wanted quality: take the smallest there is.
  if (!best) for (const s of streams) if (!best || s.q < best.q) best = s;
  return best;
}

function mark(id: string, fetching: boolean | null): void {
  const a = { ...active.value };
  if (fetching === null) delete a[id]; else a[id] = fetching;
  active.value = a;
  if (fetching !== true && id in percent.value) {
    const p = { ...percent.value };
    delete p[id];
    percent.value = p;
  }
}

/**
 * Download one song or many. Songs already on the device, or already on their
 * way, are skipped. Returns how many were added to the list.
 */
export function download(tracks: Track | Track[]): number {
  if (!supported) return 0;
  const seen = new Set<string>();
  const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => {
    if (t.kind !== 'song' || has(t.id) || t.id in active.peek() || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  if (!list.length) return 0;
  const a = { ...active.peek() };
  for (const t of list) a[t.id] = false;
  active.value = a;
  waiting.push(...list);
  saveQueue();
  pump();
  return list.length;
}

function pump(): void {
  if (!online.peek()) return;
  while (running < AT_ONCE && waiting.length) {
    const track = waiting.shift()!;
    running++;
    void one(track).finally(() => {
      running--;
      saveQueue();
      if (waiting.length && online.peek()) pump();
      else if (!running) finished();
    });
  }
}

async function one(track: Track): Promise<void> {
  const ctl = new AbortController();
  stops.set(track.id, ctl);
  mark(track.id, true);
  try {
    await withStreams(track, ctl.signal);
    const pick = choose(track.streams, wantedQuality());
    if (!pick) throw new Error('no audio');
    const res = await fetch(pick.url, { signal: ctl.signal });
    if (!res.ok) throw new Error('audio ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const type = res.headers.get('content-type') || 'audio/mp4';
    let blob: Blob;
    if (res.body && total > 0) {
      // Read it piece by piece so the progress can be shown.
      const reader = res.body.getReader();
      const parts: BlobPart[] = [];
      let got = 0;
      let shown = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          parts.push(value);
          got += value.byteLength;
          const now = Math.min(0.99, got / total);
          if (now - shown >= 0.04) {
            shown = now;
            percent.value = { ...percent.value, [track.id]: now };
          }
        }
      }
      blob = new Blob(parts, { type });
    } else {
      blob = await res.blob();
    }
    if (blob.size < 20000) throw new Error('empty');
    await run(AUDIO, 'readwrite', (s) => { s.put(blob, track.id); });
    downloads.value = [{ t: slim(track), size: blob.size, q: pick.q, at: Date.now() }, ...downloads.value.filter((d) => d.t.id !== track.id)];
    saveIndex();
    doneNow++;
    lastDone = track.title;
    // The cover and the words come along, so the song is whole without internet.
    void keepArt(track);
    wantWords(track);
  } catch (e) {
    if (ctl.signal.aborted) return; // stopped on purpose
    if (!online.peek() || (inBrowser && navigator.onLine === false)) {
      // The connection dropped: put it back and carry on when it returns.
      waiting.unshift(track);
      mark(track.id, false);
      stops.delete(track.id);
      return;
    }
    if (full(e)) {
      // No room left: stop the whole list rather than fail song after song.
      waiting = [];
      active.value = {};
      percent.value = {};
      if (!spaceWarned) {
        spaceWarned = true;
        toast('This device is out of space. Remove some downloads and try again.', undefined, 5200);
      }
      return;
    }
    failedNow++;
  } finally {
    stops.delete(track.id);
    // Still listed as "fetching" means it neither finished nor went back to waiting.
    if (active.peek()[track.id] === true) mark(track.id, null);
  }
}

function finished(): void {
  if (waiting.length) return; // paused (offline), not done
  const done = doneNow;
  const failed = failedNow;
  const name = lastDone;
  doneNow = 0;
  failedNow = 0;
  lastDone = '';
  spaceWarned = false;
  if (done === 1 && !failed) toast(`Downloaded “${name}”`);
  else if (done > 0 && !failed) toast(`Downloaded ${plural(done, 'song')}`);
  else if (done > 0) toast(`Downloaded ${plural(done, 'song')}. ${failed} couldn't be downloaded.`, undefined, 4600);
  else if (failed === 1) toast("That song couldn't be downloaded. Please try again.");
  else if (failed > 1) toast(`${failed} songs couldn't be downloaded. Please try again.`);
}

/** Stop everything that is downloading or waiting. Songs already saved stay. */
export function stopAll(): void {
  waiting = [];
  for (const ctl of stops.values()) ctl.abort();
  stops.clear();
  batch(() => { active.value = {}; percent.value = {}; });
  doneNow = 0;
  failedNow = 0;
  saveQueue();
}

/** Stop one song that is downloading or waiting. */
export function stop(id: string): void {
  waiting = waiting.filter((t) => t.id !== id);
  stops.get(id)?.abort();
  stops.delete(id);
  mark(id, null);
  saveQueue();
}

// ---------------------------------------------------------------- removing

function forget(ids: string[]): void {
  const gone = new Set(ids);
  downloads.value = downloads.value.filter((d) => !gone.has(d.t.id));
  saveIndex();
  for (const id of ids) {
    const url = urls.get(id);
    if (url) { urls.delete(id); try { URL.revokeObjectURL(url); } catch { /* already gone */ } }
  }
}

/** Remove downloaded songs from the device. They stay in the library and still play online. */
export async function remove(ids: string[]): Promise<void> {
  const mine = ids.filter((id) => has(id));
  if (!mine.length) return;
  forget(mine);
  try {
    await run(AUDIO, 'readwrite', (s) => { for (const id of mine) s.delete(id); });
  } catch { /* the list no longer mentions them; the space is reclaimed on the next clean-up */ }
}

export async function removeAll(): Promise<void> {
  stopAll();
  for (const url of urls.values()) { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }
  urls.clear();
  for (const url of art.values()) { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }
  art.clear();
  downloads.value = [];
  saveIndex();
  try {
    await run(AUDIO, 'readwrite', (s) => { s.clear(); });
    await run(ART, 'readwrite', (s) => { s.clear(); });
  } catch { /* nothing more to do */ }
}

// ---------------------------------------------------------------- start-up

/** Read the list of downloads, check it against what is really on the device, and resume anything unfinished. */
export async function initOffline(): Promise<void> {
  if (!inBrowser) return;
  window.addEventListener('online', () => { online.value = true; pump(); void fetchWords(); });
  window.addEventListener('offline', () => { online.value = false; });
  if (!supported) { ready.value = true; return; }
  try {
    const [index, queue] = await Promise.all([kvGet<Saved[]>(INDEX_KEY), kvGet<Track[]>(QUEUE_KEY)]);
    let list = Array.isArray(index) ? index.filter((d) => d && d.t && typeof d.t.id === 'string' && typeof d.t.title === 'string') : [];
    // The files themselves are the truth: drop list entries with no file, and files with no entry.
    try {
      const keys = (await run<IDBValidKey[]>(AUDIO, 'readonly', (s) => s.getAllKeys())) || [];
      const onDisk = new Set(keys.map(String));
      const listed = new Set(list.map((d) => d.t.id));
      list = list.filter((d) => onDisk.has(d.t.id));
      const strays = [...onDisk].filter((id) => !listed.has(id));
      if (strays.length) void run(AUDIO, 'readwrite', (s) => { for (const id of strays) s.delete(id); }).catch(() => { /* next time */ });
    } catch { /* could not check; trust the list */ }
    downloads.value = list;
    if (Array.isArray(index) && list.length !== index.length) saveIndex();
    ready.value = true;
    void loadArt();
    const pending = Array.isArray(queue) ? queue.filter((t) => t && typeof t.id === 'string' && t.kind === 'song') : [];
    if (pending.length) download(pending);
  } catch {
    ready.value = true;
  }
}

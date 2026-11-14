// The playback engine. One place owns the audio, the queue and "what next".
//
// Design choices that keep it dependable:
//  * ONE audio element is reused for every song. Phones only allow background
//    and lock-screen playback to continue on an element the person has already
//    started by hand, so swapping elements between songs would stall there.
//  * Every start gets a ticket number. If the person taps three songs quickly,
//    only the last one is allowed to finish starting.
//  * A song that fails is retried once with a fresh address and lower quality,
//    then skipped. Three skips in a row stop playback instead of racing through
//    the whole queue.

import { batch, computed, effect, signal } from '@preact/signals';
import type { RepeatMode, Track } from './types';
import { isAbort, refetchSong, withStreams } from './api';
import { episodePos, logPlay, setEpisodePos, settings } from './library';
import { kvGet, kvSet } from './store';
import { toast } from './toast';
import { clamp, img, isIOS, shuffled } from './util';
import * as eq from './eq';
import { moreLike, markHeard } from './station';

// ---------------------------------------------------------------- state

export const queue = signal<Track[]>([]);
export const index = signal(-1);
export const current = computed<Track | null>(() => queue.value[index.value] ?? null);
/** True while sound is (meant to be) coming out. */
export const playing = signal(false);
/** True while a song is being fetched or is buffering. */
export const loading = signal(false);
export const position = signal(0);
export const duration = signal(0);
export const bufferedTo = signal(0);
export const shuffle = signal(false);
export const repeat = signal<RepeatMode>('off');
/** A timestamp to stop at, 'track' to stop when this song ends, or null. */
export const sleepAt = signal<number | 'track' | null>(null);
/** Where the queue came from, e.g. "Liked songs". Shown above the title in the player. */
export const playingFrom = signal('');
export const volume = signal(readVolume());
/** Ticks once a second while a sleep timer runs, so the countdown redraws. */
export const now = signal(Date.now());

const MAX_QUEUE = 600;
const SILENCE = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function readVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem('sukoon.volume') || '1');
    return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
  } catch { return 1; }
}

// ---------------------------------------------------------------- audio elements

const hasAudio = typeof Audio !== 'undefined';
/** Songs: allowed to be read by the equalizer (the catalog's audio permits it). */
const music: HTMLAudioElement = hasAudio ? new Audio() : ({} as HTMLAudioElement);
/** Podcasts: many hosts don't permit that, so they get a plain element. */
const spoken: HTMLAudioElement = hasAudio ? new Audio() : ({} as HTMLAudioElement);
if (hasAudio) {
  music.crossOrigin = 'anonymous';
  music.preload = 'auto';
  spoken.preload = 'auto';
}
let el: HTMLAudioElement = music;
const unlocked = new WeakSet<HTMLAudioElement>();

let ticket = 0;
let failedTicket = -1;
/** Id of the track whose audio is actually loaded in `el`. */
let loadedId = '';
let pendingSeek = 0;
let logged = false;
let retried = false;
let skipsInARow = 0;
let unshuffled: Track[] | null = null;
let toppingUp = false;
let lastSave = 0;
let lastPosState = 0;
let fading = false;

function pickUrl(track: Track): string {
  if (track.kind === 'episode') return track.url || '';
  const streams = track.streams;
  if (!streams || !streams.length) return '';
  const want = wantedBitrate();
  let best = streams[0];
  for (const s of streams) if (s.q <= want && s.q >= best.q) best = s;
  return best.url;
}

let forceLow = false;
function wantedBitrate(): number {
  if (forceLow) return 96;
  const q = settings.value.quality;
  if (q === 'high') return 320;
  if (q === 'normal') return 160;
  if (q === 'saver') return 96;
  const c = (navigator as any).connection;
  if (c?.saveData) return 96;
  if (c?.effectiveType && /2g|3g/.test(c.effectiveType)) return 96;
  if (c?.type === 'cellular') return 160;
  return 320;
}

/** First ever play on a phone must happen inside the tap itself. This "blesses" the element. */
function unlock(target: HTMLAudioElement): void {
  if (unlocked.has(target)) return;
  unlocked.add(target);
  try {
    target.src = SILENCE;
    const p = target.play();
    if (p) p.catch(() => { /* fine: the real play follows */ });
  } catch { /* fine */ }
}

async function start(track: Track, startAt = 0, autoplay = true): Promise<void> {
  const my = ++ticket;
  const target = track.kind === 'episode' ? spoken : music;
  if (el !== target) {
    try { el.pause(); } catch { /* nothing loaded */ }
    el = target;
  }
  logged = false;
  loadedId = '';
  batch(() => {
    loading.value = true;
    position.value = startAt;
    duration.value = track.duration || 0;
    bufferedTo.value = 0;
    if (autoplay) playing.value = true;
  });
  setMeta(track);
  markHeard(track);

  let url = pickUrl(track);
  if (!url) {
    if (autoplay) unlock(el);
    try {
      await withStreams(track);
    } catch (e) {
      if (my !== ticket || isAbort(e)) return;
      fail(track, my);
      return;
    }
    if (my !== ticket) return;
    url = pickUrl(track);
    if (!url) { fail(track, my); return; }
  }

  if (el === music && settings.value.eqOn) eq.attach(music);
  pendingSeek = startAt > 1 ? startAt : 0;
  try {
    el.src = url;
    el.playbackRate = track.kind === 'episode' ? settings.value.podcastSpeed : 1;
    el.volume = volume.value;
    loadedId = track.id;
    if (!autoplay) {
      loading.value = false;
      return;
    }
    unlocked.add(el);
    eq.wake();
    await el.play();
  } catch (e) {
    if (my !== ticket) return;
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return; // a newer start replaced this one
    if (name === 'NotAllowedError') {
      // The browser wants a tap first (for example after a reload).
      batch(() => { playing.value = false; loading.value = false; });
      return;
    }
    fail(track, my);
  }
}

/** A song would not play. Try once more with a fresh address, then move on. */
function fail(track: Track, my: number): void {
  if (my !== ticket) return;
  // The audio element reports one failure twice (a rejected play() and an
  // "error" event). Handle each start's failure only once.
  if (failedTicket === my) return;
  failedTicket = my;
  if (!retried && track.kind === 'song') {
    retried = true;
    forceLow = true;
    const at = position.value;
    void refetchSong(track.id)
      .then((fresh) => {
        if (my !== ticket) return;
        if (fresh?.streams?.length) track.streams = fresh.streams;
        void start(track, at, true);
      })
      .catch(() => { if (my === ticket) giveUp(track); })
      .finally(() => { forceLow = false; });
    return;
  }
  giveUp(track);
}

function giveUp(track: Track): void {
  retried = false;
  skipsInARow++;
  const offline = navigator.onLine === false;
  if (offline || skipsInARow >= 3 || index.value >= queue.value.length - 1) {
    batch(() => { playing.value = false; loading.value = false; });
    toast(offline ? 'You are offline. Playback will continue when you are back.' : `Couldn't play “${track.title}”.`);
    skipsInARow = 0;
    return;
  }
  toast(`Skipped “${track.title}” — it wouldn't play.`);
  void next(true);
}

// ---------------------------------------------------------------- element events

function wire(a: HTMLAudioElement): void {
  const mine = () => a === el;
  a.addEventListener('playing', () => {
    if (!mine() || a.src === SILENCE) return;
    retried = false;
    skipsInARow = 0;
    batch(() => { playing.value = true; loading.value = false; });
    void topUp();
  });
  a.addEventListener('pause', () => {
    if (!mine() || a.src === SILENCE || a.ended) return;
    // A pause that we did not ask for (headphones pulled, a call) still counts.
    if (loadedId && !loading.value) playing.value = false;
    saveSession(true);
  });
  a.addEventListener('waiting', () => { if (mine() && loadedId) loading.value = true; });
  a.addEventListener('canplay', () => { if (mine() && loadedId) loading.value = false; });
  a.addEventListener('loadedmetadata', () => {
    if (!mine() || !loadedId) return;
    if (Number.isFinite(a.duration) && a.duration > 0) duration.value = a.duration;
    if (pendingSeek > 0) {
      try { a.currentTime = Math.min(pendingSeek, Math.max(0, (a.duration || pendingSeek) - 2)); } catch { /* not seekable yet */ }
      pendingSeek = 0;
    }
  });
  a.addEventListener('durationchange', () => {
    if (mine() && loadedId && Number.isFinite(a.duration) && a.duration > 0) duration.value = a.duration;
  });
  a.addEventListener('progress', () => {
    if (!mine() || !loadedId) return;
    try {
      const b = a.buffered;
      if (b.length) bufferedTo.value = b.end(b.length - 1);
    } catch { /* not ready */ }
  });
  a.addEventListener('timeupdate', () => {
    if (!mine() || !loadedId || a.src === SILENCE) return;
    const t = a.currentTime;
    position.value = t;
    const track = current.value;
    if (!track) return;
    const d = duration.value;
    if (!logged && (t > 30 || (d > 0 && t > d / 2))) {
      logged = true;
      logPlay(track);
    }
    const stamp = Date.now();
    if (stamp - lastPosState > 1000) {
      lastPosState = stamp;
      setPosState();
      if (track.kind === 'episode' && t > 5) setEpisodePos(track.id, d > 0 && t > d - 15 ? 0 : t);
    }
    if (stamp - lastSave > 8000) saveSession();
    // Get the next song's address ready shortly before this one ends.
    if (d > 0 && d - t < 25) prepareNext();
    if (d > 0 && d - t < 40) void topUp();
  });
  a.addEventListener('ended', () => { if (mine() && a.src !== SILENCE) onEnded(); });
  a.addEventListener('error', () => {
    if (!mine() || !loadedId || a.src === SILENCE || !a.src) return;
    const track = current.value;
    if (track) fail(track, ticket);
  });
}
if (hasAudio) { wire(music); wire(spoken); }

function onEnded(): void {
  const track = current.value;
  if (track?.kind === 'episode') setEpisodePos(track.id, 0);
  if (sleepAt.value === 'track') {
    sleepAt.value = null;
    batch(() => { playing.value = false; position.value = 0; });
    loadedId = '';
    toast('Sleep timer ended. Good night.');
    return;
  }
  if (repeat.value === 'one' && track) {
    void start(track, 0, true);
    return;
  }
  void next(true);
}

let preparedFor = '';
function prepareNext(): void {
  const upcoming = queue.value[index.value + 1];
  if (!upcoming || upcoming.id === preparedFor) return;
  preparedFor = upcoming.id;
  void withStreams(upcoming).catch(() => { preparedFor = ''; });
}

// ---------------------------------------------------------------- controls

/** Replace the queue and start playing. */
export function playTracks(tracks: Track[], startIndex = 0, from = ''): void {
  if (!tracks.length) return;
  let list = tracks.slice(0, MAX_QUEUE);
  let at = clamp(startIndex, 0, list.length - 1);
  unshuffled = null;
  if (shuffle.value && list.length > 1) {
    unshuffled = list;
    const first = list[at];
    list = [first, ...shuffled(list.filter((_, i) => i !== at))];
    at = 0;
  }
  batch(() => {
    queue.value = list;
    index.value = at;
    playingFrom.value = from;
  });
  retried = false;
  skipsInARow = 0;
  void start(list[at], resumePoint(list[at]), true);
}

/** Shuffle a list and play it from the top. */
export function playShuffled(tracks: Track[], from = ''): void {
  if (!tracks.length) return;
  shuffle.value = true;
  playTracks(tracks, Math.floor(Math.random() * Math.min(tracks.length, MAX_QUEUE)), from);
}

function resumePoint(track: Track): number {
  if (track.kind !== 'episode') return 0;
  const at = episodePos.value[track.id] || 0;
  return at > 10 && (!track.duration || at < track.duration - 20) ? at : 0;
}

export function toggle(): void {
  const track = current.value;
  if (!track) return;
  if (playing.value) {
    playing.value = false;
    loading.value = false;
    if (loadedId === track.id) { try { el.pause(); } catch { /* nothing */ } } else ticket++;
    return;
  }
  if (loadedId === track.id && el.src && el.src !== SILENCE) {
    playing.value = true;
    eq.wake();
    el.play().catch((e) => {
      if ((e as { name?: string })?.name !== 'AbortError') playing.value = false;
    });
  } else {
    void start(track, position.value, true);
  }
}

export function pause(): void { if (playing.value) toggle(); }
export function play(): void { if (!playing.value) toggle(); }

export async function next(auto = false): Promise<void> {
  const q = queue.value;
  if (!q.length) return;
  let i = index.value + 1;
  if (i >= q.length) {
    if (repeat.value === 'all') i = 0;
    else {
      const seed = current.value;
      if (seed && seed.kind === 'song' && settings.value.autoplay) {
        loading.value = true;
        await topUp(true);
        if (index.value + 1 < queue.value.length) { jump(index.value + 1); return; }
      }
      loading.value = false;
      if (auto) {
        batch(() => { playing.value = false; position.value = 0; });
        loadedId = '';
      } else {
        toast('That was the last song in the queue.');
      }
      return;
    }
  }
  jump(i);
}

export function prev(): void {
  if (position.value > 4 || index.value <= 0) { seek(0); return; }
  jump(index.value - 1);
}

/** Play the song at this place in the queue. */
export function jump(i: number): void {
  const q = queue.value;
  if (i < 0 || i >= q.length) return;
  index.value = i;
  retried = false;
  void start(q[i], resumePoint(q[i]), true);
}

export function seek(seconds: number): void {
  const d = duration.value || current.value?.duration || 0;
  const to = clamp(seconds, 0, d > 0 ? Math.max(0, d - 0.25) : seconds);
  position.value = to;
  if (loadedId && el.src && el.src !== SILENCE) {
    try { el.currentTime = to; } catch { pendingSeek = to; }
    setPosState();
  }
}

export function seekBy(delta: number): void { seek(position.value + delta); }

export function setVolume(v: number): void {
  volume.value = clamp(v, 0, 1);
  if (!fading) { try { el.volume = volume.value; } catch { /* read-only on iPhone */ } }
  try { localStorage.setItem('sukoon.volume', String(volume.value)); } catch { /* optional */ }
}

export function setSpeed(rate: number): void {
  settings.value = { ...settings.value, podcastSpeed: rate };
  if (current.value?.kind === 'episode') { try { el.playbackRate = rate; } catch { /* nothing loaded */ } setPosState(); }
}

export function cycleRepeat(): void {
  repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off';
}

export function toggleShuffle(): void {
  const q = queue.value;
  const cur = current.value;
  if (!shuffle.value) {
    shuffle.value = true;
    if (q.length > 2 && cur) {
      unshuffled = q;
      const i = index.value;
      queue.value = [...q.slice(0, i + 1), ...shuffled(q.slice(i + 1))];
    }
    return;
  }
  shuffle.value = false;
  if (unshuffled && cur) {
    const have = new Set(q.map((t) => t.id));
    const restored = unshuffled.filter((t) => have.has(t.id));
    const extra = q.filter((t) => !unshuffled!.some((u) => u.id === t.id));
    const list = [...restored, ...extra];
    const at = list.findIndex((t) => t.id === cur.id);
    batch(() => { queue.value = list; index.value = at >= 0 ? at : 0; });
  }
  unshuffled = null;
}

/** Put a song right after the current one. */
export function playNext(track: Track): void {
  const q = queue.value;
  if (!q.length || index.value < 0) { playTracks([track]); return; }
  const cur = current.value;
  if (cur && cur.id === track.id) return;
  const without = q.filter((t) => t.id !== track.id);
  const at = cur ? without.findIndex((t) => t.id === cur.id) : index.value;
  const list = [...without.slice(0, at + 1), track, ...without.slice(at + 1)];
  batch(() => { queue.value = list; index.value = at; });
  preparedFor = '';
}

/** Add songs to the end of the queue. Returns how many were new. */
export function addToQueue(tracks: Track[]): number {
  const q = queue.value;
  if (!q.length || index.value < 0) { playTracks(tracks); return tracks.length; }
  const have = new Set(q.map((t) => t.id));
  const fresh = tracks.filter((t) => !have.has(t.id) && (have.add(t.id), true));
  if (fresh.length) queue.value = [...q, ...fresh].slice(0, MAX_QUEUE + 200);
  return fresh.length;
}

export function removeAt(i: number): void {
  const q = queue.value;
  if (i < 0 || i >= q.length) return;
  const list = q.filter((_, n) => n !== i);
  const at = index.value;
  if (i === at) {
    if (!list.length) { stop(); return; }
    const to = Math.min(at, list.length - 1);
    batch(() => { queue.value = list; index.value = to; });
    if (playing.value) void start(list[to], 0, true);
    else { ticket++; loadedId = ''; batch(() => { position.value = 0; duration.value = list[to].duration || 0; }); setMeta(list[to]); }
    return;
  }
  batch(() => { queue.value = list; if (i < at) index.value = at - 1; });
  preparedFor = '';
}

export function moveInQueue(from: number, to: number): void {
  const q = queue.value;
  if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return;
  const cur = current.value;
  const list = q.slice();
  const [one] = list.splice(from, 1);
  list.splice(to, 0, one);
  batch(() => { queue.value = list; if (cur) index.value = list.findIndex((t) => t.id === cur.id); });
  preparedFor = '';
}

/** Remove everything after the current song. */
export function clearUpNext(): void {
  const at = index.value;
  if (at >= 0) queue.value = queue.value.slice(0, at + 1);
  unshuffled = null;
}

export function stop(): void {
  ticket++;
  try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* nothing loaded */ }
  loadedId = '';
  batch(() => {
    queue.value = [];
    index.value = -1;
    playing.value = false;
    loading.value = false;
    position.value = 0;
    duration.value = 0;
    playingFrom.value = '';
  });
  unshuffled = null;
  saveSession(true);
}

// ---------------------------------------------------------------- endless play

/** When the queue is about to run out, quietly add songs like the ones just heard. */
async function topUp(force = false): Promise<void> {
  if (toppingUp || !settings.value.autoplay || repeat.value === 'all') return;
  const q = queue.value;
  const seed = current.value;
  if (!seed || seed.kind !== 'song') return;
  if (!force && q.length - index.value - 1 > 1) return;
  toppingUp = true;
  try {
    const more = await moreLike(seed, new Set(q.map((t) => t.id)));
    if (more.length && queue.value === q) queue.value = [...q, ...more];
    else if (more.length) {
      const have = new Set(queue.value.map((t) => t.id));
      queue.value = [...queue.value, ...more.filter((t) => !have.has(t.id))];
    }
  } catch { /* stay quiet: the queue simply ends */ } finally {
    toppingUp = false;
  }
}

// ---------------------------------------------------------------- sleep timer

/** minutes → stop after that long; 'track' → stop when this song ends; null → off. */
export function setSleep(choice: number | 'track' | null): void {
  sleepAt.value = typeof choice === 'number' ? Date.now() + choice * 60000 : choice;
  restoreVolume();
}

export const sleepLeft = computed<number | null>(() => {
  const at = sleepAt.value;
  return typeof at === 'number' ? Math.max(0, Math.ceil((at - now.value) / 1000)) : null;
});

function restoreVolume(): void {
  fading = false;
  try { el.volume = volume.value; } catch { /* read-only on iPhone */ }
}

if (typeof window !== 'undefined') {
  setInterval(() => {
    const at = sleepAt.value;
    if (typeof at !== 'number') return;
    const t = Date.now();
    now.value = t;
    const left = at - t;
    if (left <= 0) {
      sleepAt.value = null;
      if (playing.value) toggle();
      setTimeout(restoreVolume, 400);
      toast('Sleep timer ended. Good night.');
    } else if (left < 20000 && playing.value && !isIOS) {
      // Fade out gently over the last 20 seconds.
      fading = true;
      try { el.volume = volume.value * clamp(left / 20000, 0.05, 1); } catch { /* ignore */ }
    }
  }, 1000);
}

// ---------------------------------------------------------------- lock screen / headset buttons

function setMeta(track: Track): void {
  if (!('mediaSession' in navigator)) return;
  try {
    const art = track.image
      ? [
          { src: img(track.image, 150), sizes: '150x150', type: 'image/jpeg' },
          { src: img(track.image, 500), sizes: '500x500', type: 'image/jpeg' },
        ]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || (track.kind === 'episode' ? 'Podcast' : ''),
      artwork: art,
    });
  } catch { /* older browsers */ }
}

function setPosState(): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration.value;
  if (!(d > 0) || !Number.isFinite(d)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      position: clamp(position.value, 0, d),
      playbackRate: el.playbackRate || 1,
    });
  } catch { /* some browsers reject odd values */ }
}

if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const on = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* not supported here */ }
  };
  on('play', () => play());
  on('pause', () => pause());
  on('previoustrack', () => prev());
  on('nexttrack', () => void next());
  on('stop', () => pause());
  on('seekto', (d) => { if (typeof d.seekTime === 'number') seek(d.seekTime); });
  on('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
  on('seekforward', (d) => seekBy(d.seekOffset || 10));
  effect(() => {
    try { navigator.mediaSession.playbackState = current.value ? (playing.value ? 'playing' : 'paused') : 'none'; } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------- remember between visits

interface Session {
  queue: Track[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  from: string;
}

/** Nothing is written until the previous visit has been read back, or we would wipe it. */
let sessionReady = false;

function saveSession(force = false): void {
  if (!sessionReady) return;
  const stamp = Date.now();
  if (!force && stamp - lastSave < 3000) return;
  lastSave = stamp;
  const q = queue.value;
  const at = index.value;
  // Keep a window around the current song so the saved copy stays small.
  const lo = Math.max(0, at - 50);
  const session: Session = {
    queue: q.slice(lo, lo + 250),
    index: at - lo,
    position: Math.floor(position.value),
    shuffle: shuffle.value,
    repeat: repeat.value,
    from: playingFrom.value,
  };
  void kvSet('session', session);
}

/** Bring back the last queue, paused where it stopped. Call once at start-up. */
export async function restoreSession(): Promise<void> {
  try {
    if (sessionReady) return;
    const s = await kvGet<Session>('session');
    if (!s || !Array.isArray(s.queue) || !s.queue.length || queue.value.length) return;
    const list = s.queue.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string');
    const at = clamp(s.index | 0, 0, list.length - 1);
    if (!list.length) return;
    batch(() => {
      queue.value = list;
      index.value = at;
      position.value = Math.max(0, s.position | 0);
      duration.value = list[at].duration || 0;
      shuffle.value = !!s.shuffle;
      repeat.value = s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off';
      playingFrom.value = typeof s.from === 'string' ? s.from : '';
    });
    setMeta(list[at]);
  } catch { /* start fresh */ } finally {
    sessionReady = true;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveSession(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(true); });
  // Coming back online while a song was stuck: try again.
  window.addEventListener('online', () => {
    const track = current.value;
    if (track && playing.value && loading.value) void start(track, position.value, true);
  });
  effect(() => { index.value; queue.value; saveSession(); });
  // Equalizer switched on or off while a song is playing.
  effect(() => {
    const on = settings.value.eqOn;
    if (on && hasAudio && el === music && loadedId) eq.attach(music);
    eq.apply(on, settings.value.eqGains);
  });
}

/** For the Android app shell: lets it read and drive playback. */
export function snapshot() {
  const t = current.value;
  return {
    id: t?.id || '',
    title: t?.title || '',
    artist: t?.artist || '',
    album: t?.album || '',
    image: t ? img(t.image, 500) : '',
    playing: playing.value,
    position: position.value,
    duration: duration.value,
  };
}

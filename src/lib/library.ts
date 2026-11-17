// Everything that belongs to the person: likes, their playlists, what they
// played, what they follow, and their settings. Held in memory as signals (so
// every screen updates by itself) and written to the device a moment after
// each change.

import { computed, effect, signal, type Signal } from '@preact/signals';
import type { AlbumRef, ArtistRef, LocalPlaylist, PlaylistRef, Settings, ShowRef, Track } from './types';
import { kvGetMany, kvSet, keepStorage } from './store';
import { uid } from './util';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  quality: 'auto',
  languages: ['hindi', 'english'],
  autoplay: true,
  tint: true,
  calmMotion: false,
  glassLevel: 100,
  haptics: true,
  crossfade: 5,
  lightTheme: 'paper',
  darkTheme: 'ink',
  eqOn: false,
  eqPreset: 'Original',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  fxBass: 0,
  fxClarity: 0,
  fxSpace: 0,
  fxLoud: 0,
  fxVocal: 0,
  fxLowCut: 0,
  downloadQuality: 'normal',
  keepLiked: false,
  podcastSpeed: 1,
  welcomed: false,
  homeTipSeen: false,
  appTipSeen: false,
  soundTipSeen: false,
};

const unit = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const SETTINGS_KEY = 'sukoon.settings';

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const got = JSON.parse(raw);
      if (got && typeof got === 'object') {
        const merged = { ...DEFAULT_SETTINGS, ...got } as Settings;
        if (!Array.isArray(merged.languages) || !merged.languages.length) merged.languages = DEFAULT_SETTINGS.languages;
        if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== 10) merged.eqGains = DEFAULT_SETTINGS.eqGains.slice();
        // Anything saved by an older version, or damaged, falls back to a safe value.
        merged.fxBass = unit(merged.fxBass);
        merged.fxClarity = unit(merged.fxClarity);
        merged.fxSpace = unit(merged.fxSpace);
        merged.fxLoud = unit(merged.fxLoud);
        merged.fxVocal = unit(merged.fxVocal);
        merged.haptics = merged.haptics !== false;
        merged.crossfade = typeof merged.crossfade === 'number' && merged.crossfade >= 0 && merged.crossfade <= 12 ? merged.crossfade : 5;
        merged.fxLowCut = typeof merged.fxLowCut === 'number' && merged.fxLowCut > 0 ? Math.min(300, merged.fxLowCut) : 0;
        // The glass used to be a plain on/off switch; "off" becomes Solid, anything else Clear.
        const level = (got as { glassLevel?: unknown }).glassLevel;
        merged.glassLevel = typeof level === 'number' && level >= 0 && level <= 100
          ? Math.round(level)
          : (got as { glass?: unknown }).glass === false ? 0 : 100;
        delete (merged as { glass?: unknown }).glass;
        if (merged.downloadQuality !== 'high' && merged.downloadQuality !== 'saver') merged.downloadQuality = 'normal';
        merged.keepLiked = merged.keepLiked === true;
        if (typeof merged.lightTheme !== 'string') merged.lightTheme = DEFAULT_SETTINGS.lightTheme;
        if (typeof merged.darkTheme !== 'string') merged.darkTheme = DEFAULT_SETTINGS.darkTheme;
        return merged;
      }
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_SETTINGS, eqGains: DEFAULT_SETTINGS.eqGains.slice() };
}

/** Settings are small and needed before the first paint, so they live in localStorage. */
export const settings = signal<Settings>(readSettings());

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.value = { ...settings.value, [key]: value };
}

/** Change several settings in one step (one redraw, one save). */
export function setSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

effect(() => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value)); } catch { /* storage full or blocked */ }
});

export interface Played { t: Track; at: number }
export type SavedRef = AlbumRef | PlaylistRef;

export const liked = signal<Track[]>([]);
export const playlists = signal<LocalPlaylist[]>([]);
export const history = signal<Played[]>([]);
export const counts = signal<Record<string, number>>({});
export const saved = signal<SavedRef[]>([]);
export const following = signal<ArtistRef[]>([]);
export const shows = signal<ShowRef[]>([]);
export const episodePos = signal<Record<string, number>>({});
export const searches = signal<string[]>([]);
/** Listening per day: "2026-11-17" → [seconds listened, songs played]. */
export const daily = signal<Record<string, [number, number]>>({});
/** True once saved data has been read from the device. */
export const hydrated = signal(false);

export const likedIds = computed(() => new Set(liked.value.map((t) => t.id)));
const savedIds = computed(() => new Set(saved.value.map((r) => r.type + r.id)));
const followIds = computed(() => new Set(following.value.map((a) => a.id)));
const showIds = computed(() => new Set(shows.value.map((s) => s.id)));

const BOXES: Array<[string, Signal<any>]> = [
  ['liked', liked], ['playlists', playlists], ['history', history], ['counts', counts],
  ['saved', saved], ['following', following], ['shows', shows], ['episodePos', episodePos], ['searches', searches],
  ['daily', daily],
];

/** Read everything from the device once at start-up, then keep it written. */
export async function hydrate(): Promise<void> {
  const got = await kvGetMany(BOXES.map(([k]) => 'lib:' + k));
  for (const [key, box] of BOXES) {
    const v = got['lib:' + key];
    if (v !== undefined && v !== null && typeof v === typeof box.value && Array.isArray(v) === Array.isArray(box.value)) box.value = v;
  }
  hydrated.value = true;
  for (const [key, box] of BOXES) {
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const value = box.value;
      if (first) { first = false; return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void kvSet('lib:' + key, value), 250);
    });
  }
  keepStorage();
}

// ---------------------------------------------------------------- likes

export const isLiked = (id: string) => likedIds.value.has(id);

/** Returns true when the song is now liked. */
export function toggleLike(track: Track): boolean {
  if (likedIds.value.has(track.id)) {
    liked.value = liked.value.filter((t) => t.id !== track.id);
    return false;
  }
  liked.value = [track, ...liked.value];
  return true;
}

// ---------------------------------------------------------------- playlists

export function createPlaylist(name: string, tracks: Track[] = []): LocalPlaylist {
  const now = Date.now();
  const clean = name.trim().slice(0, 80) || 'New playlist';
  const pl: LocalPlaylist = { id: uid(), name: clean, tracks: dedupe(tracks), created: now, updated: now };
  playlists.value = [pl, ...playlists.value];
  return pl;
}

export function renamePlaylist(id: string, name: string): void {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  playlists.value = playlists.value.map((p) => (p.id === id ? { ...p, name: clean, updated: Date.now() } : p));
}

export function deletePlaylist(id: string): LocalPlaylist | undefined {
  const gone = playlists.value.find((p) => p.id === id);
  playlists.value = playlists.value.filter((p) => p.id !== id);
  return gone;
}

export function restorePlaylist(pl: LocalPlaylist): void {
  if (!playlists.value.some((p) => p.id === pl.id)) playlists.value = [pl, ...playlists.value];
}

/** Returns how many songs were actually added (songs already there are skipped). */
export function addToPlaylist(id: string, tracks: Track[]): number {
  let added = 0;
  playlists.value = playlists.value.map((p) => {
    if (p.id !== id) return p;
    const have = new Set(p.tracks.map((t) => t.id));
    const fresh = tracks.filter((t) => !have.has(t.id) && (have.add(t.id), true));
    added = fresh.length;
    return fresh.length ? { ...p, tracks: [...p.tracks, ...fresh], updated: Date.now() } : p;
  });
  return added;
}

export function removeFromPlaylist(id: string, trackId: string): void {
  playlists.value = playlists.value.map((p) =>
    p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updated: Date.now() } : p,
  );
}

export function moveInPlaylist(id: string, from: number, to: number): void {
  playlists.value = playlists.value.map((p) => {
    if (p.id !== id || from === to || from < 0 || to < 0 || from >= p.tracks.length || to >= p.tracks.length) return p;
    const tracks = p.tracks.slice();
    const [one] = tracks.splice(from, 1);
    tracks.splice(to, 0, one);
    return { ...p, tracks, updated: Date.now() };
  });
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

// ---------------------------------------------------------------- history

const HISTORY_MAX = 400;

export function logPlay(track: Track): void {
  const rest = history.value.filter((p) => p.t.id !== track.id);
  history.value = [{ t: track, at: Date.now() }, ...rest].slice(0, HISTORY_MAX);
  if (track.kind === 'song') {
    counts.value = { ...counts.value, [track.id]: (counts.value[track.id] || 0) + 1 };
    addToDay(0, 1);
  }
}

export function clearHistory(): void {
  history.value = [];
  counts.value = {};
  daily.value = {};
}

// ---------------------------------------------------------------- listening per day

/** The local calendar day as "2026-11-17". */
export function dayKey(d = new Date()): string {
  const two = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function addToDay(seconds: number, plays: number): void {
  const key = dayKey();
  const map = { ...daily.value };
  const had = map[key] || [0, 0];
  map[key] = [had[0] + seconds, had[1] + plays];
  // A little over a year is plenty; older days are dropped.
  const keys = Object.keys(map);
  if (keys.length > 400) for (const k of keys.sort().slice(0, keys.length - 400)) delete map[k];
  daily.value = map;
}

/** Called by the player with time actually spent listening. */
export function addListening(seconds: number): void {
  if (seconds > 0 && seconds < 3600) addToDay(seconds, 0);
}

/** Songs played most, most-played first. */
export const mostPlayed = computed(() => {
  const c = counts.value;
  const byId = new Map<string, Track>();
  for (const p of history.value) if (p.t.kind === 'song') byId.set(p.t.id, p.t);
  for (const t of liked.value) if (!byId.has(t.id)) byId.set(t.id, t);
  return Object.keys(c)
    .filter((id) => c[id] >= 2 && byId.has(id))
    .sort((a, b) => c[b] - c[a])
    .slice(0, 30)
    .map((id) => byId.get(id)!);
});

/** Artists heard most recently, by how often they appear in history. */
export const topArtistNames = computed(() => {
  const tally = new Map<string, number>();
  for (const p of history.value.slice(0, 120)) {
    if (p.t.kind !== 'song') continue;
    const name = p.t.artist.split(',')[0]?.trim();
    if (name) tally.set(name, (tally.get(name) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name);
});

// ---------------------------------------------------------------- saved & followed

export const isSaved = (ref: { type: string; id: string }) => savedIds.value.has(ref.type + ref.id);

export function toggleSaved(ref: SavedRef): boolean {
  if (savedIds.value.has(ref.type + ref.id)) {
    saved.value = saved.value.filter((r) => !(r.type === ref.type && r.id === ref.id));
    return false;
  }
  saved.value = [ref, ...saved.value];
  return true;
}

export const isFollowing = (id: string) => followIds.value.has(id);

export function toggleFollow(artist: ArtistRef): boolean {
  if (followIds.value.has(artist.id)) {
    following.value = following.value.filter((a) => a.id !== artist.id);
    return false;
  }
  following.value = [{ type: 'artist', id: artist.id, name: artist.name, image: artist.image }, ...following.value];
  return true;
}

export const isShowSaved = (id: string) => showIds.value.has(id);

export function toggleShow(show: ShowRef): boolean {
  if (showIds.value.has(show.id)) {
    shows.value = shows.value.filter((s) => s.id !== show.id);
    return false;
  }
  shows.value = [{ type: 'show', id: show.id, title: show.title, author: show.author, image: show.image, genre: show.genre }, ...shows.value];
  return true;
}

export function setEpisodePos(id: string, seconds: number): void {
  const map = { ...episodePos.value, [id]: Math.floor(seconds) };
  const keys = Object.keys(map);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete map[k];
  episodePos.value = map;
}

// ---------------------------------------------------------------- searches

export function addSearch(q: string): void {
  const clean = q.trim();
  if (clean.length < 2) return;
  searches.value = [clean, ...searches.value.filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(0, 12);
}

export function removeSearch(q: string): void {
  searches.value = searches.value.filter((s) => s !== q);
}

// ---------------------------------------------------------------- backup

const BACKUP_MARK = 'sukoon-backup';

export function exportLibrary(): string {
  const data: Record<string, unknown> = { mark: BACKUP_MARK, version: 1, exported: new Date().toISOString(), settings: settings.value };
  for (const [key, box] of BOXES) data[key] = box.value;
  return JSON.stringify(data);
}

/** Merges a backup into what is already here. Throws if the file is not a Music Flow backup. */
export function importLibrary(text: string): { songs: number; playlists: number } {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a Music Flow backup.'); }
  if (!data || data.mark !== BACKUP_MARK) throw new Error('That file is not a Music Flow backup.');
  const okTrack = (t: any): t is Track => !!t && typeof t.id === 'string' && typeof t.title === 'string';
  let songs = 0;
  let lists = 0;
  if (Array.isArray(data.liked)) {
    const have = new Set(liked.value.map((t) => t.id));
    const fresh = data.liked.filter((t: any) => okTrack(t) && !have.has(t.id));
    songs = fresh.length;
    if (fresh.length) liked.value = [...liked.value, ...fresh];
  }
  if (Array.isArray(data.playlists)) {
    const have = new Set(playlists.value.map((p) => p.id));
    const fresh = data.playlists
      .filter((p: any) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks) && !have.has(p.id))
      .map((p: any) => ({ ...p, tracks: p.tracks.filter(okTrack) }));
    lists = fresh.length;
    if (fresh.length) playlists.value = [...playlists.value, ...fresh];
  }
  if (Array.isArray(data.saved)) {
    const have = new Set(saved.value.map((r) => r.type + r.id));
    saved.value = [...saved.value, ...data.saved.filter((r: any) => r && r.id && r.type && !have.has(r.type + r.id))];
  }
  if (Array.isArray(data.following)) {
    const have = new Set(following.value.map((a) => a.id));
    following.value = [...following.value, ...data.following.filter((a: any) => a && a.id && a.name && !have.has(a.id))];
  }
  if (Array.isArray(data.shows)) {
    const have = new Set(shows.value.map((s) => s.id));
    shows.value = [...shows.value, ...data.shows.filter((s: any) => s && s.id && s.title && !have.has(s.id))];
  }
  if (Array.isArray(data.history) && !history.value.length) history.value = data.history.filter((p: any) => p && okTrack(p.t)).slice(0, HISTORY_MAX);
  if (data.counts && typeof data.counts === 'object' && !Object.keys(counts.value).length) counts.value = data.counts;
  return { songs, playlists: lists };
}

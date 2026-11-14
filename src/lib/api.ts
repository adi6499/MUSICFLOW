// Talks to the song catalog.
//
// Reliability rules, in order:
//  1. Never ask twice for the same thing at the same moment (in-flight sharing).
//  2. Remember answers for a while, so going back to a page is instant.
//  3. If the main server is slow or down, quietly use the backup server.
//  4. If everything fails but we still hold an older answer, show that instead
//     of an error.

import type { Album, AlbumRef, Artist, ArtistRef, HomeSection, Playlist, PlaylistRef, SearchResults, Track } from './types';
import {
  dedupeSongs, toAlbum, toAlbumRefs, toArtist, toArtistRefs, toHome, toPlaylist, toPlaylistRefs, toTrack, toTracks,
} from './normalize';
import { kvGet, kvSet } from './store';
import { alike, plain, sleep } from './util';

interface Server {
  name: string;
  base: string;
  /** Path that returns one song with its audio addresses. */
  song(id: string): string;
  artist(id: string): string;
  /** Number of the first page in paged results. */
  firstPage: number;
  /** Whether it can build the home feed. */
  home: boolean;
  /** Path for "songs that go well after this one", where the server offers it. */
  similar?(id: string, limit: number): string;
}

const SERVERS: Server[] = [
  {
    name: 'main',
    base: 'https://spoton-sigma.vercel.app/api',
    song: (id) => `/songs?id=${encodeURIComponent(id)}`,
    artist: (id) => `/artists?id=${encodeURIComponent(id)}`,
    firstPage: 1,
    home: true,
  },
  {
    name: 'backup',
    base: 'https://jiosaavn-api-sage.vercel.app/api',
    song: (id) => `/songs/${encodeURIComponent(id)}`,
    artist: (id) => `/artists/${encodeURIComponent(id)}?songCount=20&albumCount=20`,
    firstPage: 0,
    home: false,
    similar: (id, limit) => `/songs/${encodeURIComponent(id)}/suggestions?limit=${limit}`,
  },
];

const TIMEOUT_MS = 10000;
const REST_MS = 45000;
const restingUntil = new Map<string, number>();

export class ApiError extends Error {
  offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.name = 'ApiError';
    this.offline = offline;
  }
}

export function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

/** Healthy servers first; a server that just failed rests for a short while. */
function lineup(first?: string): Server[] {
  const now = Date.now();
  const up: Server[] = [];
  const resting: Server[] = [];
  const ordered = first ? [...SERVERS].sort((a, b) => Number(b.name === first) - Number(a.name === first)) : SERVERS;
  for (const s of ordered) ((restingUntil.get(s.name) || 0) > now ? resting : up).push(s);
  return up.concat(resting);
}

async function fetchJson(url: string, outer?: AbortSignal): Promise<any> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
  const onOuter = () => ctl.abort();
  if (outer) {
    if (outer.aborted) ctl.abort();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`The music server answered ${res.status}`);
    return await res.json();
  } catch (e) {
    if (timedOut) throw new Error('The music server took too long to answer');
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Return false when the answer is technically fine but empty, to try the next server. */
  filled?: (data: any) => boolean;
  /** Ask this server first (the other remains the fallback). */
  first?: string;
}

async function request(build: (s: Server) => string | null, opts: RequestOptions = {}): Promise<any> {
  let lastError: unknown = null;
  let emptyAnswer: any;
  let gotEmpty = false;
  for (let round = 0; round < 2; round++) {
    let hadFailure = false;
    for (const server of lineup(opts.first)) {
      const path = build(server);
      if (!path) continue;
      try {
        const json = await fetchJson(server.base + path, opts.signal);
        if (!json || json.success === false) throw new Error(json?.message || 'The music server could not answer');
        restingUntil.delete(server.name);
        const data = json.data !== undefined ? json.data : json;
        if (opts.filled && !opts.filled(data)) {
          gotEmpty = true;
          emptyAnswer = data;
          continue;
        }
        return data;
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        hadFailure = true;
        lastError = e;
        restingUntil.set(server.name, Date.now() + REST_MS);
      }
    }
    // Every server answered, just with nothing: that is a real "no results".
    if (gotEmpty && !hadFailure) return emptyAnswer;
    if (round === 0) await sleep(650);
  }
  if (gotEmpty) return emptyAnswer;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  throw new ApiError(
    offline ? 'You are offline. Check your internet and try again.' : "Couldn't reach the music library. Please try again in a moment.",
    offline,
  );
}

// ---------------------------------------------------------------- cache

interface Kept<T> { at: number; data: T }
const kept = new Map<string, Kept<unknown>>();
const flying = new Map<string, Promise<unknown>>();
const MAX_KEPT = 400;

function remember<T>(key: string, data: T): void {
  if (kept.size >= MAX_KEPT) {
    // Drop the oldest quarter; Map keeps insertion order.
    let drop = MAX_KEPT / 4;
    for (const k of kept.keys()) {
      kept.delete(k);
      if (--drop <= 0) break;
    }
  }
  kept.delete(key);
  kept.set(key, { at: Date.now(), data });
}

/** What we already know for this key, however old. Instant; used to paint a page before the network answers. */
export function peek<T>(key: string): T | undefined {
  return kept.get(key)?.data as T | undefined;
}

export function isFresh(key: string, ttl: number): boolean {
  const k = kept.get(key);
  return !!k && Date.now() - k.at < ttl;
}

/** Drop what we remember for a key, so the next request really asks the server. */
export function forget(key: string): void {
  kept.delete(key);
}

/** An older copy saved on the device (only for keys loaded with `persist`). */
export async function peekSaved<T>(key: string): Promise<T | undefined> {
  const saved = await kvGet<Kept<T>>('cache:' + key);
  return saved?.data;
}

export async function cached<T>(key: string, ttl: number, load: () => Promise<T>, persist = false): Promise<T> {
  if (isFresh(key, ttl)) return kept.get(key)!.data as T;
  const already = flying.get(key);
  if (already) return already as Promise<T>;
  const job = (async () => {
    try {
      const data = await load();
      remember(key, data);
      if (persist) void kvSet('cache:' + key, { at: Date.now(), data });
      return data;
    } catch (e) {
      if (isAbort(e)) throw e;
      const stale = kept.get(key);
      if (stale) return stale.data as T;
      if (persist) {
        const saved = await kvGet<Kept<T>>('cache:' + key);
        if (saved?.data !== undefined) return saved.data;
      }
      throw e;
    } finally {
      flying.delete(key);
    }
  })();
  flying.set(key, job);
  return job;
}

/** The names answers are remembered under. Screens use these to paint instantly from memory. */
export const keys = {
  song: (id: string) => 'song:' + id,
  album: (id: string) => 'album:' + id,
  playlist: (id: string) => 'playlist:' + id,
  artist: (id: string) => 'artist:' + id,
  artistByName: (name: string) => 'artistByName:' + plain(name),
  songs: (q: string, page = 1, limit = 24) => `s:songs:${q.trim().toLowerCase()}:${page}:${limit}`,
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---------------------------------------------------------------- endpoints

const enc = encodeURIComponent;

function list(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.songs)) return data.songs;
  return [];
}

export function getSong(id: string, signal?: AbortSignal): Promise<Track | null> {
  return cached('song:' + id, 6 * HOUR, async () => {
    const data = await request((s) => s.song(id), { signal, filled: (d) => list(d).length > 0 });
    return toTrack(list(data)[0]);
  });
}

/**
 * Songs the catalog itself would play after this one (its "song radio").
 * Only some servers offer this; an empty list means "not available", never an error.
 */
export function getSimilar(id: string, limit = 24, signal?: AbortSignal): Promise<Track[]> {
  return cached(`similar:${id}:${limit}`, 30 * MIN, async () => {
    try {
      const data = await request((s) => (s.similar ? s.similar(id, limit) : null), { signal, filled: (d) => list(d).length > 0 });
      return toTracks(list(data));
    } catch (e) {
      if (isAbort(e)) throw e;
      return [];
    }
  });
}

/** Ask again, ignoring what we remembered (used when an audio address stopped working). */
export async function refetchSong(id: string): Promise<Track | null> {
  kept.delete('song:' + id);
  return getSong(id);
}

export function getAlbum(id: string, signal?: AbortSignal): Promise<Album> {
  return cached('album:' + id, 6 * HOUR, async () => {
    const data = await request(() => `/albums?id=${enc(id)}`, { signal, filled: (d) => !!d && !!d.id });
    const album = toAlbum(data);
    if (!album) throw new ApiError('This album could not be opened.');
    return album;
  });
}

export function getPlaylist(id: string, signal?: AbortSignal): Promise<Playlist> {
  return cached('playlist:' + id, HOUR, async () => {
    // The two servers page differently, and the main one silently drops songs
    // from some playlists (it has returned 2 of 24). So ask the backup first,
    // and whenever a list looks short for what the playlist claims to hold,
    // ask the other server too and keep whichever is fuller.
    const path = (s: Server) => (s.firstPage === 0 ? `/playlists?id=${enc(id)}&page=0&limit=100` : `/playlists?id=${enc(id)}&limit=200`);
    const usable = (d: any) => !!d && !!d.id && Array.isArray(d.songs) && d.songs.length > 0;
    let playlist = toPlaylist(await request(path, { signal, first: 'backup', filled: usable }));
    if (!playlist) throw new ApiError('This playlist could not be opened.');
    const claimed = playlist.songCount || 0;
    if (playlist.songs.length < 5 || playlist.songs.length < claimed * 0.6) {
      try {
        const other = toPlaylist(await request(path, { signal, first: 'main', filled: usable }));
        if (other && other.songs.length > playlist.songs.length) playlist = other;
      } catch (e) {
        if (isAbort(e)) throw e;
      }
    }
    return playlist;
  });
}

export function getArtist(id: string, signal?: AbortSignal): Promise<Artist> {
  return cached('artist:' + id, 6 * HOUR, async () => {
    // The backup server lists more of an artist's songs and albums, so it is asked first.
    const data = await request((s) => s.artist(id), { signal, first: 'backup', filled: (d) => !!d && !!d.id && Array.isArray(d.topSongs) && d.topSongs.length > 0 });
    const artist = toArtist(data);
    if (!artist) throw new ApiError('This artist could not be opened.');
    return artist;
  });
}

/** Songs carry artist names but not always artist ids, so pages can also be opened by name. */
export function findArtist(name: string, signal?: AbortSignal): Promise<ArtistRef | null> {
  return cached('artistByName:' + plain(name), 6 * HOUR, async () => {
    const found = await searchArtists(name, signal);
    if (!found.length) return null;
    const want = plain(name);
    let best = found[0];
    let bestScore = alike(want, plain(best.name));
    for (const a of found) {
      const score = alike(want, plain(a.name));
      if (score > bestScore) { best = a; bestScore = score; }
    }
    return bestScore >= 0.5 ? best : null;
  });
}

export function searchSongs(query: string, page = 1, limit = 24, signal?: AbortSignal): Promise<Track[]> {
  const q = query.trim();
  return cached(`s:songs:${q.toLowerCase()}:${page}:${limit}`, 15 * MIN, async () => {
    const data = await request(
      (s) => `/search/songs?query=${enc(q)}&page=${s.firstPage + page - 1}&limit=${limit}`,
      { signal, filled: (d) => list(d).length > 0 },
    );
    return toTracks(list(data));
  });
}

export function searchAlbums(query: string, signal?: AbortSignal, limit = 14): Promise<AlbumRef[]> {
  const q = query.trim();
  return cached(`s:albums:${q.toLowerCase()}:${limit}`, 15 * MIN, async () => {
    const data = await request((s) => `/search/albums?query=${enc(q)}&page=${s.firstPage}&limit=${limit}`, { signal, filled: (d) => list(d).length > 0 });
    return toAlbumRefs(list(data));
  });
}

export function searchArtists(query: string, signal?: AbortSignal, limit = 10): Promise<ArtistRef[]> {
  const q = query.trim();
  return cached(`s:artists:${q.toLowerCase()}:${limit}`, 15 * MIN, async () => {
    const data = await request((s) => `/search/artists?query=${enc(q)}&page=${s.firstPage}&limit=${limit}`, { signal, filled: (d) => list(d).length > 0 });
    return toArtistRefs(list(data));
  });
}

export function searchPlaylists(query: string, signal?: AbortSignal, limit = 14): Promise<PlaylistRef[]> {
  const q = query.trim();
  return cached(`s:playlists:${q.toLowerCase()}:${limit}`, 15 * MIN, async () => {
    const data = await request((s) => `/search/playlists?query=${enc(q)}&page=${s.firstPage}&limit=${limit}`, { signal, filled: (d) => list(d).length > 0 });
    return toPlaylistRefs(list(data));
  });
}

export const searchKey = (query: string) => 's:all:' + query.trim().toLowerCase();

/** Everything for the search screen in one go. One part failing never hides the others. */
export function searchAll(query: string, signal?: AbortSignal): Promise<SearchResults> {
  return cached(searchKey(query), 15 * MIN, () => searchEverything(query, signal));
}

async function searchEverything(query: string, signal?: AbortSignal): Promise<SearchResults> {
  const q = query.trim();
  const [songs, albums, artists, playlists] = await Promise.allSettled([
    searchSongs(q, 1, 30, signal),
    searchAlbums(q, signal),
    searchArtists(q, signal),
    searchPlaylists(q, signal),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (songs.status === 'rejected' && albums.status === 'rejected' && artists.status === 'rejected' && playlists.status === 'rejected') {
    throw songs.reason;
  }
  return {
    songs: songs.status === 'fulfilled' ? dedupeSongs(songs.value) : [],
    albums: albums.status === 'fulfilled' ? albums.value : [],
    artists: artists.status === 'fulfilled' ? artists.value : [],
    playlists: playlists.status === 'fulfilled' ? playlists.value : [],
  };
}

export const homeKey = (languages: string[]) => 'home:' + (languages.length ? languages.slice().sort().join(',') : 'hindi');

/** The shelves on the first screen. Saved on the device so the app opens with content already there. */
export function getHome(languages: string[], signal?: AbortSignal): Promise<HomeSection[]> {
  const langs = languages.length ? languages : ['hindi'];
  return cached(homeKey(langs), 30 * MIN, async () => {
    try {
      const data = await request(
        (s) => (s.home ? `/modules?language=${enc(langs.join(','))}` : null),
        { signal, filled: (d) => !!d && typeof d === 'object' && Object.keys(d).length > 0 },
      );
      const sections = toHome(data);
      if (sections.length) return sections;
    } catch (e) {
      if (isAbort(e)) throw e;
    }
    return homeFromSearch(langs[0], signal);
  }, true);
}

/** If the home feed itself is unavailable, build a simpler one out of searches. */
async function homeFromSearch(language: string, signal?: AbortSignal): Promise<HomeSection[]> {
  const [songs, playlists, albums] = await Promise.allSettled([
    searchSongs(`top ${language} songs`, 1, 24, signal),
    searchPlaylists(`${language} hits`, signal, 16),
    searchAlbums(`new ${language}`, signal, 16),
  ]);
  const sections: HomeSection[] = [];
  if (songs.status === 'fulfilled' && songs.value.length) sections.push({ key: 'trending', title: 'Popular right now', layout: 'cards', items: dedupeSongs(songs.value) });
  if (playlists.status === 'fulfilled' && playlists.value.length) sections.push({ key: 'playlists', title: 'Playlists worth a listen', layout: 'cards', items: playlists.value });
  if (albums.status === 'fulfilled' && albums.value.length) sections.push({ key: 'new', title: 'Albums', layout: 'cards', items: albums.value });
  if (!sections.length) throw new ApiError("Couldn't reach the music library. Please try again in a moment.");
  return sections;
}

/** Fill in audio addresses for a song that arrived without them. Returns the same object, completed. */
export async function withStreams(track: Track, signal?: AbortSignal): Promise<Track> {
  if (track.kind !== 'song' || (track.streams && track.streams.length)) return track;
  const full = await getSong(track.id, signal);
  if (full?.streams?.length) {
    track.streams = full.streams;
    if (!track.duration && full.duration) track.duration = full.duration;
    if (!track.album && full.album) track.album = full.album;
    if (!track.albumId && full.albumId) track.albumId = full.albumId;
    if (!track.artist && full.artist) track.artist = full.artist;
    if (!track.image && full.image) track.image = full.image;
  }
  return track;
}

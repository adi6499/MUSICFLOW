// Turns whatever the catalog servers send into Sukoon's own shapes (types.ts).
// Every function here is defensive: a missing or odd field never throws, it
// just leaves that detail out.

import type {
  Album, AlbumRef, Artist, ArtistRef, HomeSection, Item, Playlist, PlaylistRef, Stream, Track,
} from './types';
import { decode, plain, firstArtist } from './util.ts';

type Raw = Record<string, any>;

function text(v: unknown): string {
  return decode(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Artwork arrives as a string, or as a list of {quality,url} from small to large. */
const PLACEHOLDER = /artist-default|default-music|share-image|_default\./i;

/** The catalog's grey "no picture" placeholders are worse than our own quiet fallback. */
export function pickImage(v: unknown): string {
  const url = rawImage(v);
  return PLACEHOLDER.test(url) ? '' : url;
}

function rawImage(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v === 'null' ? '' : v.replace(/^http:\/\//, 'https://');
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) {
      const one = v[i];
      const url = typeof one === 'string' ? one : one?.url || one?.link;
      if (url && typeof url === 'string') return url.replace(/^http:\/\//, 'https://');
    }
    return '';
  }
  if (typeof v === 'object') {
    const o = v as Raw;
    return rawImage(o.url || o.link || '');
  }
  return '';
}

function namesOf(list: unknown): string {
  if (!Array.isArray(list)) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of list) {
    const name = text(typeof a === 'string' ? a : a?.name);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out.join(', ');
}

/** The many places an artist line can hide, in order of trust. */
function artistLine(raw: Raw): string {
  const mi: Raw = raw.more_info || {};
  if (typeof raw.primaryArtists === 'string' && raw.primaryArtists) return tidyNames(text(raw.primaryArtists));
  if (raw.artists && typeof raw.artists === 'object' && !Array.isArray(raw.artists)) {
    const primary = namesOf(raw.artists.primary);
    if (primary) return primary;
    const all = namesOf(raw.artists.all);
    if (all) return all;
  }
  if (Array.isArray(raw.artists)) {
    const n = namesOf(raw.artists);
    if (n) return n;
  }
  if (typeof raw.artists === 'string' && raw.artists) return tidyNames(text(raw.artists));
  if (typeof raw.artist === 'string' && raw.artist) return tidyNames(text(raw.artist));
  const map: Raw = mi.artistMap || raw.artistMap || {};
  const fromMap = namesOf(map.primary_artists) || namesOf(map.artists);
  if (fromMap) return fromMap;
  if (typeof mi.music === 'string' && mi.music) return tidyNames(text(mi.music));
  if (typeof raw.singers === 'string' && raw.singers) return tidyNames(text(raw.singers));
  // Home-feed songs: "Artist A, Artist B - Album name"
  if (typeof raw.subtitle === 'string' && raw.subtitle) {
    const sub = text(raw.subtitle);
    const cut = sub.lastIndexOf(' - ');
    return tidyNames(cut > 0 ? sub.slice(0, cut) : sub);
  }
  return '';
}

function tidyNames(s: string): string {
  return s.split(',').map((p) => p.trim()).filter(Boolean).join(', ');
}

function streamsOf(raw: Raw): Stream[] {
  const out: Stream[] = [];
  const list = raw.downloadUrl || raw.downloadUrls || raw.download_url;
  if (Array.isArray(list)) {
    for (const one of list) {
      const url: unknown = typeof one === 'string' ? one : one?.url || one?.link;
      if (typeof url !== 'string' || url.indexOf('http') !== 0) continue;
      const q = num(String(one?.quality ?? one?.bitrate ?? '').replace(/[^0-9]/g, '')) || bitrateIn(url);
      out.push({ q: q || 160, url: url.replace(/^http:\/\//, 'https://') });
    }
  }
  if (!out.length) {
    const direct: unknown = raw.streamUrl || raw.audioUrl;
    if (typeof direct === 'string' && direct.indexOf('http') === 0) {
      out.push({ q: bitrateIn(direct) || 160, url: direct.replace(/^http:\/\//, 'https://') });
    }
  }
  out.sort((a, b) => a.q - b.q);
  return out;
}

function bitrateIn(url: string): number {
  const m = /_(\d{2,3})\.(mp4|m4a|mp3)(\?|$)/i.exec(url);
  return m ? parseInt(m[1], 10) : 0;
}

export function toTrack(raw: Raw | null | undefined, inherit?: { image?: string; album?: string; albumId?: string }): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const title = text(raw.name ?? raw.title ?? raw.song);
  if (!id || !title) return null;
  const mi: Raw = raw.more_info || {};
  const albumObj: Raw | null = raw.album && typeof raw.album === 'object' ? raw.album : null;
  const album = text(albumObj ? albumObj.name ?? albumObj.title : raw.album ?? mi.album) || inherit?.album || '';
  const albumId = String((albumObj ? albumObj.id : raw.albumId ?? mi.album_id ?? raw.album_id) ?? '').trim() || inherit?.albumId || '';
  const track: Track = {
    id,
    kind: 'song',
    title,
    artist: artistLine(raw),
    image: pickImage(raw.image) || inherit?.image || '',
    duration: num(raw.duration ?? mi.duration),
  };
  if (album) track.album = album;
  if (albumId) track.albumId = albumId;
  const year = text(raw.year ?? mi.year);
  if (year) track.year = year;
  const language = text(raw.language ?? mi.language).toLowerCase();
  if (language) track.language = language;
  if (raw.explicitContent === true || raw.explicit_content === '1' || raw.explicit_content === 1) track.explicit = true;
  const plays = num(raw.playCount ?? raw.play_count);
  if (plays) track.plays = plays;
  const streams = streamsOf(raw);
  if (streams.length) track.streams = streams;
  return track;
}

export function toTracks(list: unknown, inherit?: { image?: string; album?: string; albumId?: string }): Track[] {
  if (!Array.isArray(list)) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = toTrack(raw, inherit);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export function toAlbumRef(raw: Raw | null | undefined): AlbumRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const title = text(raw.name ?? raw.title);
  if (!id || !title) return null;
  const mi: Raw = raw.more_info || {};
  const ref: AlbumRef = { type: 'album', id, title, artist: artistLine(raw), image: pickImage(raw.image) };
  const year = text(raw.year ?? mi.year);
  if (year) ref.year = year;
  const count = num(raw.songCount ?? mi.song_count ?? raw.list_count);
  if (count) ref.songCount = count;
  const language = text(raw.language).toLowerCase();
  if (language) ref.language = language;
  return ref;
}

export function toPlaylistRef(raw: Raw | null | undefined): PlaylistRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const title = text(raw.name ?? raw.title);
  if (!id || !title) return null;
  const mi: Raw = raw.more_info || {};
  const ref: PlaylistRef = { type: 'playlist', id, title, image: pickImage(raw.image) };
  const count = num(raw.songCount ?? mi.song_count ?? raw.list_count);
  if (count) ref.songCount = count;
  let subtitle = text(raw.subtitle ?? raw.description ?? '');
  if (!subtitle || /^(just updated|jiosaavn|saavn)$/i.test(subtitle)) subtitle = count ? `${count} songs` : '';
  if (subtitle) ref.subtitle = subtitle;
  const language = text(raw.language).toLowerCase();
  if (language) ref.language = language;
  return ref;
}

export function toArtistRef(raw: Raw | null | undefined): ArtistRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const name = text(raw.name ?? raw.title);
  if (!id || !name) return null;
  return { type: 'artist', id, name, image: pickImage(raw.image) };
}

function refs<T>(list: unknown, map: (raw: Raw) => T | null): T[] {
  if (!Array.isArray(list)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const r = map(raw) as (T & { id: string }) | null;
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export const toAlbumRefs = (list: unknown) => refs(list, toAlbumRef);
export const toPlaylistRefs = (list: unknown) => refs(list, toPlaylistRef);
/** Search also returns made-up "A & B" entries with no picture: drop those, and list real artists first. */
export function toArtistRefs(list: unknown): ArtistRef[] {
  const all = refs(list, toArtistRef).filter((a) => a.image || !/[&|,]/.test(a.name));
  return [...all.filter((a) => a.image), ...all.filter((a) => !a.image)];
}

export function toAlbum(raw: Raw | null | undefined): Album | null {
  const ref = toAlbumRef(raw);
  if (!ref || !raw) return null;
  const songs = toTracks(raw.songs, { image: ref.image, album: ref.title, albumId: ref.id });
  return { ...ref, songCount: songs.length || ref.songCount, songs };
}

export function toPlaylist(raw: Raw | null | undefined): Playlist | null {
  const ref = toPlaylistRef(raw);
  if (!ref || !raw) return null;
  const songs = toTracks(raw.songs);
  const fans = text(raw.subtitle);
  return { ...ref, subtitle: /fans|followers/i.test(fans) ? fans : ref.subtitle, songCount: num(raw.songCount) || songs.length, songs };
}

export function toArtist(raw: Raw | null | undefined): Artist | null {
  const ref = toArtistRef(raw);
  if (!ref || !raw) return null;
  const albums = toAlbumRefs([...(Array.isArray(raw.topAlbums) ? raw.topAlbums : []), ...(Array.isArray(raw.singles) ? raw.singles : [])]);
  return { ...ref, topSongs: toTracks(raw.topSongs), albums };
}

/** One entry of the home feed: a song, an album or a playlist, told apart by `type`. */
function toFeedItem(raw: Raw): Item | null {
  const type = String(raw?.type ?? '');
  if (type === 'song') return toTrack(raw);
  if (type === 'album') return toAlbumRef(raw);
  if (type === 'playlist') return toPlaylistRef(raw);
  return null;
}

function feed(list: unknown, max = 24): Item[] {
  if (!Array.isArray(list)) return [];
  const out: Item[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const item = toFeedItem(raw);
    if (!item) continue;
    const key = ('type' in item ? item.type : 'song') + item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** The catalog's "launch" data → the shelves on Home. */
export function toHome(raw: Raw | null | undefined): HomeSection[] {
  if (!raw || typeof raw !== 'object') return [];
  const sections: HomeSection[] = [];
  const add = (key: string, title: string, items: Item[]) => {
    if (items.length >= 3) sections.push({ key, title, layout: 'cards', items });
  };
  add('trending', 'Trending now', feed(raw.new_trending));
  add('charts', 'Top charts', feed(raw.charts));
  add('new', 'New releases', feed(raw.new_albums));
  add('playlists', 'Playlists worth a listen', feed(raw.top_playlists));
  return sections;
}

/**
 * Search often returns the same hit many times (the single, the soundtrack,
 * three compilations). Keep the most-played copy of each.
 */
export function dedupeSongs(list: Track[]): Track[] {
  const best = new Map<string, Track>();
  const order: string[] = [];
  for (const t of list) {
    const key = plain(t.title) + '|' + plain(firstArtist(t.artist));
    const had = best.get(key);
    if (!had) {
      best.set(key, t);
      order.push(key);
    } else if ((t.plays || 0) > (had.plays || 0) * 1.5 && (t.streams?.length || 0) >= (had.streams?.length || 0)) {
      best.set(key, t);
    }
  }
  return order.map((k) => best.get(k)!);
}

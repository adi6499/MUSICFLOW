// Bring a YouTube Music playlist into Sukoon.
// Step 1 reads the playlist's song names (through the website's small server
// function, or through the Android app's own networking). Step 2 finds each
// song in Sukoon's catalog.
//
// A song is only accepted when there is real evidence it is the same
// recording: the title must agree AND either an artist or the film name must
// agree too. Length is only a hint, because a music video and the album
// version of one song often differ by a minute. A wrong match is worse than a
// missing one, so anything unconvincing is left out and listed as "not found".

import type { Track } from './types';
import { searchSongs } from './api';
import { playlistIdFrom, readPlaylist } from '../../api/_ytcore.js';
import * as native from './native';
import { alike, cleanTitle, plain } from './util';

export interface YtSong {
  title: string;
  artists: string[];
  album: string;
  duration: number;
  videoId: string;
}

export interface YtPlaylist {
  id: string;
  title: string;
  songs: YtSong[];
}

export { playlistIdFrom };

export async function fetchYtPlaylist(input: string, signal?: AbortSignal): Promise<YtPlaylist> {
  const id = playlistIdFrom(input);
  if (!id) throw new Error('Paste a YouTube Music playlist link, for example music.youtube.com/playlist?list=…');
  if (native.canPost) return (await readPlaylist(id, native.post)) as YtPlaylist;
  let res: Response;
  try {
    res = await fetch(`./api/yt-playlist?list=${encodeURIComponent(id)}`, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(navigator.onLine === false ? 'You are offline. Check your internet and try again.' : "Couldn't reach the import service. Please try again.");
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    throw new Error('Playlist import is not available on this copy of Sukoon. Use the Sukoon website or the Android app.');
  }
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Couldn't read that playlist.");
  return { id: data.id, title: data.title, songs: data.songs };
}

// Words that mark a different recording of the same song. ("Male/female version"
// is deliberately not here: those differ by singer, which the artist check settles.)
const VERSION_WORDS = ['remix', 'live', 'lofi', 'lo fi', 'slowed', 'reverb', 'acoustic', 'instrumental', 'karaoke', 'cover', 'unplugged', 'mashup', 'reprise', 'sped up', 'speed up', 'sad version', 'funk'];
const VIDEO_JUNK = /official|video|lyric|audio|full song|\b4k\b|\bhd\b|visuali[sz]er|teaser|trailer/i;

/** Video titles carry extras ("| Full Video | 4K"); keep the part that is the song's name. */
function songName(yt: YtSong): string {
  let t = yt.title;
  t = t.replace(/^(full (video|song)|lyrical|official (music )?video|audio|video)\s*[:\-–|]\s*/i, '');
  t = t.split(/\s[|｜]\s/)[0];
  if (/\s[-–]\s/.test(t) && yt.artists.length) {
    const sides = t.split(/\s[-–]\s/);
    const a = plain(yt.artists[0]);
    const keep = sides.find((s) => alike(plain(s), a) < 0.5 && !VIDEO_JUNK.test(s));
    if (keep && sides.length === 2) t = keep;
  }
  t = t.replace(/\s*[([](official|full|lyric|lyrical|audio|video|4k|hd|visuali[sz]er)[^)\]]*[)\]]/gi, '');
  return cleanTitle(t);
}

/** `Judi Jodi (From "Ramayana")` → "ramayana". */
function filmOf(title: string): string {
  const m = /[([]\s*from\s+["“”'‘’]?([^"“”'‘’)\]]+)["“”'‘’]?\s*[)\]]/i.exec(title);
  return m ? plain(m[1]) : '';
}

/**
 * Other names found in a video title: "Song | Film | Singer | Label" →
 * ["film", "singer", "label"]. Any of them matching counts as evidence.
 */
function extraNames(yt: YtSong): string[] {
  const out: string[] = [];
  for (const part of yt.title.split(/\s[|｜]\s|\s[-–]\s|,\s/).slice(1)) {
    if (VIDEO_JUNK.test(part)) continue;
    const p = plain(part);
    if (p.length >= 4 && p.length <= 40) out.push(p);
  }
  return out;
}

function versionOf(title: string): string {
  const p = ' ' + plain(title.replace(/[()[\]]/g, ' ')) + ' ';
  return VERSION_WORDS.filter((w) => p.includes(' ' + w + ' ')).sort().join(',');
}

interface Clues {
  name: string;
  want: string;
  /** "Film: Song" titles — the part after the colon, tried as the song's name too. */
  alt: string;
  wantAlt: string;
  artists: string[];
  film: string;
  extras: string[];
  version: string;
}

function cluesFor(yt: YtSong): Clues {
  const name = songName(yt);
  let film = filmOf(yt.title) || plain(yt.album);
  let alt = '';
  const colon = name.indexOf(': ');
  if (colon > 0) {
    alt = name.slice(colon + 2).trim();
    if (!film) film = plain(name.slice(0, colon));
  }
  return {
    name,
    want: plain(name),
    alt,
    wantAlt: plain(alt),
    artists: yt.artists.map(plain).filter((a) => a.length >= 3),
    film,
    extras: extraNames(yt),
    version: versionOf(yt.title),
  };
}

function titleScore(want: string, have: string): number {
  if (!want || !have) return 0;
  if (want === have) return 1;
  const s = alike(want, have);
  return have.startsWith(want + ' ') || want.startsWith(have + ' ') ? Math.max(s, 0.85) : s;
}

function score(yt: YtSong, k: Clues, c: Track): number {
  const have = plain(cleanTitle(c.title));
  if (!k.want || !have) return 0;
  const title = Math.max(titleScore(k.want, have), titleScore(k.wantAlt, have));
  if (title < 0.6) return 0;

  // Evidence that it is the same recording, beyond sharing a title.
  const artistText = plain(c.artist);
  const where = `${plain(c.title)} | ${plain(c.album || '')}`;
  let proof = 0;
  let named = 0;
  for (const a of k.artists) {
    if (artistText.includes(a)) { proof = 1; named++; }
    else proof = Math.max(proof, alike(a, artistText) * 0.9);
  }
  if (proof < 1 && k.film && k.film.length >= 3 && where.includes(k.film)) proof = 1;
  if (proof < 1) {
    for (const x of k.extras) {
      if (artistText.includes(x) || where.includes(x)) { proof = 1; break; }
    }
  }

  let length = 0.4;
  if (yt.duration && c.duration) {
    const off = Math.abs(yt.duration - c.duration);
    length = off <= 4 ? 1 : off <= 12 ? 0.7 : off <= 40 ? 0.4 : 0.15;
  }

  const hasClues = k.artists.length > 0 || !!k.film || k.extras.length > 0;
  if (hasClues) {
    if (proof < 0.5) return 0;
  } else if (title < 0.9 || length < 0.7) {
    // Nothing but a title to go on: demand an exact title and the same length.
    return 0;
  }

  let total = hasClues ? 0.5 * title + 0.35 * proof + 0.15 * length : 0.8 * title + 0.2 * length;
  // When two copies both fit, the one naming more of the same artists wins
  // (this is what tells a "male version" from a "female version").
  if (k.artists.length) total += 0.06 * (named / k.artists.length);
  if (k.version !== versionOf(c.title)) total -= 0.3;
  return total;
}

/** The catalog copy of this song, or null when no result is convincing. */
export async function matchSong(yt: YtSong, signal?: AbortSignal): Promise<Track | null> {
  const k = cluesFor(yt);
  if (!k.name) return null;
  const queries: string[] = [];
  const add = (q: string) => { const clean = q.replace(/\s+/g, ' ').trim(); if (clean && !queries.includes(clean)) queries.push(clean); };
  if (yt.artists[0]) add(`${k.name} ${yt.artists[0]}`);
  if (k.film) add(`${k.name} ${k.film}`);
  add(k.name);
  if (k.alt) add(yt.artists[0] ? `${k.alt} ${yt.artists[0]}` : k.alt);
  if (yt.artists[1]) add(`${k.name} ${yt.artists[1]}`);

  let best: Track | null = null;
  let bestScore = 0;
  for (const q of queries.slice(0, 4)) {
    let found: Track[] = [];
    try { found = await searchSongs(q, 1, 10, signal); } catch (e) { if (signal?.aborted) throw e; }
    for (const c of found) {
      const s = score(yt, k, c);
      // Between equally convincing copies, prefer the one people actually play.
      if (s > bestScore + 0.02 || (s > 0 && Math.abs(s - bestScore) <= 0.02 && (c.plays || 0) > (best?.plays || 0))) {
        bestScore = Math.max(s, bestScore);
        best = c;
      }
    }
    if (bestScore >= 0.9) break;
  }
  return bestScore >= 0.66 ? best : null;
}

export interface MatchResult {
  matched: Track[];
  missed: YtSong[];
}

/** Match a whole playlist, four songs at a time, keeping the original order. */
export async function matchAll(
  songs: YtSong[],
  onProgress: (done: number, total: number, found: number) => void,
  signal?: AbortSignal,
): Promise<MatchResult> {
  const slots: Array<Track | null> = new Array(songs.length).fill(null);
  let nextIndex = 0;
  let done = 0;
  let found = 0;
  const worker = async () => {
    while (nextIndex < songs.length) {
      if (signal?.aborted) return;
      const i = nextIndex++;
      try {
        const t = await matchSong(songs[i], signal);
        if (t) { slots[i] = t; found++; }
      } catch { /* leave as missed */ }
      done++;
      onProgress(done, songs.length, found);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const matched: Track[] = [];
  const missed: YtSong[] = [];
  const seen = new Set<string>();
  slots.forEach((t, i) => {
    if (!t) missed.push(songs[i]);
    else if (!seen.has(t.id)) { seen.add(t.id); matched.push(t); }
  });
  return { matched, missed };
}

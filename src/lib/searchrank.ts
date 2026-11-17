// Search that finds the song you meant.
//
// Why this exists: the two catalog servers answer the same search very
// differently. The main one silently leaves out most international originals
// (searching "shape of you" returns four unknown covers), and both list the
// same song several times and put an obscure new version above the famous one.
//
// So Sukoon asks both servers at once, pools everything, and ranks the pool
// itself, by:
//   1. how well the title and artist match the words typed (one typo per word
//      is forgiven, and the last word may be half-typed);
//   2. how popular the song is;
//   3. whether it is the real recording — karaoke, covers and "slowed + reverb"
//      copies are pushed down unless that is what was asked for.
// Copies of the same recording are then merged into one row.
//
// Nothing in this file touches the network directly: the caller passes in an
// `ask` function. That is what lets `npm run bench:search` run the very same
// code against the live servers and report how often the right song comes top.

import type { Track } from './types';
import { toTracks } from './normalize.ts';
import { cleanTitle, plain } from './util.ts';

/** Sends one request to one server and returns the answer's `data`. Throws on failure. */
export type Ask = (server: 'main' | 'backup', path: string) => Promise<any>;

export interface Intent {
  /** The search looks like an artist's name: lead with the artist. */
  artistId?: string;
  artistName?: string;
}

export interface SongSearch {
  songs: Track[];
  intent: Intent;
}

// Words that mean "this is not the original recording".
const NOT_ORIGINAL = ['karaoke', 'instrumental', 'originally performed', 'originally perfomed', 'tribute', 'cover', 'made famous', 'in the style of', 'backing track', 'ringtone', 'lullaby', 'music box', 'bgm', 'minus one'];
const REWORKED = ['remix', 'lofi', 'lo fi', 'slowed', 'reverb', 'sped up', 'speed up', 'nightcore', '8d', 'mashup', 'techno', 'dnb', 'bass boosted', 'flip', 'trap', 'phonk', 'funk', 'ambient', 'piano', 'flute', 'violin', 'guitar', 'saxophone', 'dj', 'house', 'edm', 'chill'];
const ALTERNATE = ['live', 'acoustic', 'unplugged', 'reprise', 'version', 'demo', 'extended', 'radio edit', 'dance mix', 'remastered', 'remaster', 'edit', 'mix'];

function words(text: string): string[] {
  const p = plain(text);
  return p ? p.split(' ') : [];
}

/** Are these two words the same, allowing one slip of the finger (two in long words)? */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  const allowed = Math.min(la, lb) >= 9 ? 2 : Math.min(la, lb) >= 5 ? 1 : 0;
  // People rarely get the first letter wrong, and insisting on it avoids
  // treating unrelated short words as typos of each other.
  if (!allowed || Math.abs(la - lb) > allowed || a.charCodeAt(0) !== b.charCodeAt(0)) return false;
  // Edit distance, counting two swapped neighbours ("beleiver") as one slip,
  // and giving up as soon as the words are clearly too different.
  let before: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, before[j - 2] + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > allowed) return false;
    before = prev;
    prev = cur;
  }
  return prev[lb] <= allowed;
}

/** 1 = same word, 0.9 = one typo, 0.85 = the start of the word (still being typed), 0 = no. */
function wordMatch(typed: string, candidate: string, stillTyping: boolean): number {
  if (typed === candidate) return 1;
  if (stillTyping && typed.length >= 2 && candidate.startsWith(typed)) return 0.85;
  if (candidate.length > typed.length + 2 && typed.length >= 4 && candidate.startsWith(typed)) return 0.8;
  return close(typed, candidate) ? 0.9 : 0;
}

function bestIn(typed: string, list: string[], stillTyping: boolean): number {
  let best = 0;
  for (const w of list) {
    const m = wordMatch(typed, w, stillTyping);
    if (m > best) { best = m; if (best === 1) break; }
  }
  return best;
}

function hasPhrase(haystack: string, phrases: string[], query: string): string | null {
  const padded = ' ' + haystack + ' ';
  const q = ' ' + query + ' ';
  for (const p of phrases) {
    if (padded.includes(' ' + p + ' ') && !q.includes(' ' + p + ' ')) return p;
  }
  return null;
}

interface Scored {
  track: Track;
  score: number;
  /** How well the typed words are covered at all (0…1); used to notice a weak search. */
  match: number;
  title: string;
  artists: string[];
}

function scoreSong(query: string, qWords: string[], track: Track, prior: number, languages: string[]): Scored {
  const titleText = plain(cleanTitle(track.title));
  const title = titleText ? titleText.split(' ') : [];
  const fullText = plain(track.title + ' ' + (track.album || ''));
  const full = fullText ? fullText.split(' ') : [];
  const artist = words(track.artist);

  // Where does each typed word land: in the title, the artist, or the film/album name?
  let covered = 0;
  let titleHits = 0;
  let titleWanted = 0;
  const lastIndex = qWords.length - 1;
  for (let i = 0; i < qWords.length; i++) {
    const w = qWords[i];
    const typing = i === lastIndex;
    const inTitle = bestIn(w, title, typing);
    const inArtist = inTitle >= 1 ? 0 : bestIn(w, artist, typing);
    if (inTitle >= inArtist && inTitle > 0) {
      covered += inTitle;
      titleHits += inTitle;
      titleWanted++;
    } else if (inArtist > 0) {
      covered += inArtist * 0.92;
    } else {
      const elsewhere = bestIn(w, full, typing);
      covered += elsewhere * 0.6;
      if (!elsewhere) titleWanted++; // an unexplained word was probably meant for the title
    }
  }
  const coverage = qWords.length ? covered / qWords.length : 0;

  // How much of the title do the typed words explain? "Lag Ja Gale" explains
  // all of "Lag Ja Gale" but only part of "Lag Ja Gale Se Phir".
  let explained = 0;
  for (const t of title) if (bestIn(t, qWords, false) > 0 || (qWords.length && wordMatch(qWords[lastIndex], t, true) > 0)) explained++;
  const titleFit = title.length ? explained / title.length : 0;
  const exactTitle = titleWanted > 0 && titleFit === 1 && titleHits >= titleWanted - 0.2;

  let match = titleHits > 0 ? 0.66 * coverage + 0.34 * titleFit : 0.62 * coverage;
  if (exactTitle) match += 0.1;

  // Popularity on a scale where under a hundred plays counts as nothing and
  // hundreds of millions counts as everything. It carries real weight: when
  // several songs share a title, people almost always mean the famous one.
  const popularity = Math.min(1, Math.max(0, Math.log10((track.plays || 0) + 1) - 2) / 6.6);

  let score = 0.52 * match + 0.38 * popularity + 0.06 * prior;
  // A strong match that nobody listens to is usually an amateur upload.
  if (!track.plays) score -= 0.06;
  if (track.language && languages.includes(track.language)) score += 0.02;

  const versionText = plain(track.title.replace(/[()[\]\-–]/g, ' '));
  const flat = ' ' + qWords.join(' ') + ' ';
  if (hasPhrase(versionText, NOT_ORIGINAL, flat.trim())) score -= 0.55;
  else if (hasPhrase(versionText, REWORKED, flat.trim())) score -= 0.3;
  else if (hasPhrase(versionText, ALTERNATE, flat.trim())) score -= 0.1;

  return { track, score, match: Math.min(1, coverage), title: titleText, artists: track.artist.split(',').map((a) => plain(a)).filter(Boolean) };
}

/** The same recording is listed again and again (single, soundtrack, compilations). Keep the best copy of each. */
function mergeCopies(list: Scored[]): Scored[] {
  const kept: Scored[] = [];
  const byTitle = new Map<string, Scored[]>();
  for (const s of list) {
    const group = byTitle.get(s.title);
    if (!group) {
      byTitle.set(s.title, [s]);
      kept.push(s);
      continue;
    }
    const twin = group.find((g) => {
      const sameLength = !g.track.duration || !s.track.duration || Math.abs(g.track.duration - s.track.duration) <= 3;
      const sharedArtist = g.artists.some((a) => s.artists.includes(a));
      const sameVersion = plain(g.track.title) === plain(s.track.title) || sameLength;
      return sharedArtist && sameLength && sameVersion;
    });
    if (twin) {
      // Prefer the copy that can play immediately.
      if (!twin.track.streams?.length && s.track.streams?.length) twin.track = s.track;
      continue;
    }
    group.push(s);
    kept.push(s);
  }
  return kept;
}

export function rankSongs(query: string, pools: Track[][], languages: string[] = []): { ranked: Scored[]; best: number } {
  const qWords = words(query);
  const seen = new Map<string, Scored>();
  for (const pool of pools) {
    pool.forEach((track, position) => {
      // Where a server placed a song is a weak hint: it knows things we do not (lyrics, for instance).
      const prior = 1 / (1 + position * 0.18);
      const had = seen.get(track.id);
      if (had) {
        if (prior > 0.9) had.score += 0.01;
        if (!had.track.streams?.length && track.streams?.length) had.track = track;
        if (!had.track.plays && track.plays) had.track = { ...had.track, plays: track.plays };
        return;
      }
      seen.set(track.id, scoreSong(query, qWords, track, prior, languages));
    });
  }
  const all = [...seen.values()].sort((a, b) => b.score - a.score);
  const ranked = mergeCopies(all);
  return { ranked, best: ranked.length ? ranked[0].match : 0 };
}

const enc = encodeURIComponent;

function listOf(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function songsFrom(ask: Ask, server: 'main' | 'backup', query: string, limit: number): Promise<Track[]> {
  const page = server === 'main' ? 1 : 0;
  const data = await ask(server, `/search/songs?query=${enc(query)}&page=${page}&limit=${limit}`);
  return toTracks(listOf(data));
}

/**
 * Find songs for what was typed. Asks both servers together; if nothing fits
 * well and several words were typed, tries again leaving one word out (people
 * add an artist or film name the catalog's own search trips over).
 */
export async function findSongs(query: string, ask: Ask, languages: string[] = [], want = 30): Promise<SongSearch> {
  const q = query.trim();
  const settle = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [fromBackup, fromMain, quick] = await Promise.all([
    settle(songsFrom(ask, 'backup', q, 40), [] as Track[]),
    settle(songsFrom(ask, 'main', q, 30), [] as Track[]),
    settle(ask('backup', `/search?query=${enc(q)}`), null),
  ]);
  if (!fromBackup.length && !fromMain.length && !quick) throw new Error('no search source answered');

  const pools: Track[][] = [fromBackup, fromMain];
  const quickSongs = toTracks(listOf(quick?.songs));
  if (quickSongs.length) pools.push(quickSongs);

  let { ranked, best } = rankSongs(q, pools, languages);

  const qWords = words(q);
  if (best < 0.8 && qWords.length >= 3) {
    const shorter = [qWords.slice(0, -1).join(' '), qWords.slice(1).join(' ')];
    const more = await Promise.all(shorter.map((s) => settle(songsFrom(ask, 'backup', s, 25), [] as Track[])));
    const again = rankSongs(q, [...pools, ...more], languages);
    ranked = again.ranked;
    best = again.best;
  }

  // Is this an artist's name rather than a song?
  const intent: Intent = {};
  const top = listOf(quick?.topQuery)[0];
  if (top && top.type === 'artist' && top.id) {
    intent.artistId = String(top.id);
    intent.artistName = String(top.title || top.name || '');
  }

  // Drop the long tail of things that barely relate to what was typed.
  const floor = ranked.length ? Math.max(0.18, ranked[0].score * 0.34) : 0;
  const songs = ranked.filter((s, i) => i < 8 || s.score >= floor).slice(0, want).map((s) => s.track);
  return { songs, intent };
}

/** Order albums, playlists or artists by how well their name fits what was typed, keeping the server's order among equals. */
export function rankByName<T>(query: string, items: T[], nameOf: (item: T) => string): T[] {
  const qWords = words(query);
  if (!qWords.length) return items;
  const last = qWords.length - 1;
  const scored = items.map((item, index) => {
    const name = words(cleanTitle(nameOf(item)));
    let hit = 0;
    qWords.forEach((w, i) => { hit += bestIn(w, name, i === last); });
    let explained = 0;
    for (const n of name) if (bestIn(n, qWords, false) > 0) explained++;
    const fit = name.length ? explained / name.length : 0;
    return { item, index, score: (hit / qWords.length) * 0.7 + fit * 0.3 };
  });
  scored.sort((a, b) => (Math.abs(b.score - a.score) > 0.08 ? b.score - a.score : a.index - b.index));
  return scored.map((s) => s.item);
}

// Things made from your own listening, all worked out on this device:
//
//   Mixes        four ready-made queues ("Daily mix", "Discover", "On repeat",
//                "Rediscover") built from what you play and like.
//   New releases recent songs by the artists you follow.
//   Stats        how much you listened this week, and to what.
//
// Nothing here is sent anywhere. The catalog is only asked the same public
// question the "radio" feature asks: "what goes well after this song?"

import type { Track } from './types';
import { cached, getArtistLatest, getSimilar } from './api';
import { counts, daily, dayKey, following, history, liked, mostPlayed } from './library';
import { spread } from './station';
import { cleanTitle, firstArtist, plain } from './util';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type MixKind = 'daily' | 'discover' | 'repeat' | 'rediscover';

export interface MixInfo {
  kind: MixKind;
  title: string;
  /** One short line under the name. */
  line: string;
  hue: number;
}

export const MIXES: MixInfo[] = [
  { kind: 'daily', title: 'Daily mix', line: 'New every day, from what you play', hue: 232 },
  { kind: 'discover', title: 'Discover', line: "Songs you haven't played here", hue: 162 },
  { kind: 'repeat', title: 'On repeat', line: 'What you play the most', hue: 14 },
  { kind: 'rediscover', title: 'Rediscover', line: "Favourites you haven't heard lately", hue: 292 },
];

export const mixInfo = (kind: string): MixInfo | undefined => MIXES.find((m) => m.kind === kind);

/** The same "random" order all day, a new one tomorrow. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixUp<T>(list: readonly T[], rnd: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function songsOnly(list: Track[]): Track[] {
  const seen = new Set<string>();
  return list.filter((t) => t.kind === 'song' && !seen.has(t.id) && (seen.add(t.id), true));
}

/** A handful of songs that say what this person likes, from different artists where possible. */
function seedSongs(rnd: () => number): Track[] {
  const out: Track[] = [];
  const ids = new Set<string>();
  const artists = new Set<string>();
  const add = (t: Track, strict: boolean) => {
    if (t.kind !== 'song' || ids.has(t.id)) return;
    const a = plain(firstArtist(t.artist));
    if (strict && artists.has(a)) return;
    ids.add(t.id);
    artists.add(a);
    out.push(t);
  };
  const recent = history.value.slice(0, 40).map((p) => p.t);
  const pools = [mixUp(mostPlayed.value.slice(0, 14), rnd), mixUp(recent, rnd), mixUp(liked.value.slice(0, 80), rnd)];
  for (const pool of pools) for (const t of pool.slice(0, 4)) add(t, true);
  if (out.length < 3) for (const pool of pools) for (const t of pool) add(t, false);
  return out.slice(0, 5);
}

/** Is there enough to go on to make this mix at all? */
export function canMix(kind: MixKind): boolean {
  if (kind === 'repeat') return mostPlayed.value.length >= 5;
  if (kind === 'rediscover') return rediscover().length >= 8;
  return songsOnly([...history.value.map((p) => p.t), ...liked.value]).length >= 3;
}

function rediscover(): Track[] {
  const lastAt = new Map<string, number>();
  for (const p of history.value) if (!lastAt.has(p.t.id)) lastAt.set(p.t.id, p.at);
  const cutoff = Date.now() - 21 * DAY;
  const pool = songsOnly([...liked.value, ...history.value.map((p) => p.t)]).filter((t) => (lastAt.get(t.id) || 0) < cutoff);
  return spread(mixUp(pool, seeded('rediscover' + dayKey())).slice(0, 30));
}

/** The two mixes that need nothing from the network. */
export function localMix(kind: MixKind): Track[] | null {
  if (kind === 'repeat') return mostPlayed.value.slice(0, 30);
  if (kind === 'rediscover') return rediscover();
  return null;
}

export const mixKey = (kind: MixKind) => `mix:${kind}:${dayKey()}`;

async function build(kind: 'daily' | 'discover'): Promise<Track[]> {
  const rnd = seeded(kind + dayKey());
  const seeds = seedSongs(rnd);
  if (!seeds.length) return [];
  const answers = await Promise.allSettled(seeds.map((s) => getSimilar(s.id, 24)));
  const pools = answers.map((r) => (r.status === 'fulfilled' ? mixUp(r.value, rnd) : []));
  if (!pools.some((p) => p.length)) throw new Error("Couldn't build this mix just now. Please try again in a moment.");

  const known = new Set<string>(Object.keys(counts.value));
  for (const p of history.value) known.add(p.t.id);
  for (const t of liked.value) known.add(t.id);

  // Take one from each seed's list in turn, so the mix leans on all of them.
  const ids = new Set<string>();
  const titles = new Set<string>();
  const fresh: Track[] = [];
  for (let i = 0; fresh.length < 40 && pools.some((p) => p.length); i++) {
    const t = pools[i % pools.length].shift();
    if (!t || t.kind !== 'song' || ids.has(t.id)) continue;
    const title = plain(t.title);
    if (!title || titles.has(title)) continue;
    if (t.duration && (t.duration < 70 || t.duration > 900)) continue;
    if (kind === 'discover' && known.has(t.id)) continue;
    ids.add(t.id);
    titles.add(title);
    fresh.push(t);
  }
  if (kind === 'discover') return spread(fresh).slice(0, 30);

  // Daily mix: mostly new company, with a favourite of yours every few songs.
  const familiar = mixUp(songsOnly([...seeds, ...mostPlayed.value.slice(0, 20), ...liked.value.slice(0, 40)]), rnd)
    .filter((t) => !ids.has(t.id) && !titles.has(plain(t.title)))
    .slice(0, 9);
  const out: Track[] = [];
  while (out.length < 30 && (fresh.length || familiar.length)) {
    const next = out.length % 3 === 0 && familiar.length ? familiar.shift() : fresh.shift() || familiar.shift();
    if (next) out.push(next);
  }
  return spread(out);
}

/** The songs of a mix. The two built from the catalog are kept for the day once made. */
export function getMix(kind: MixKind): Promise<Track[]> {
  const local = localMix(kind);
  if (local) return Promise.resolve(local);
  return cached(mixKey(kind), 8 * HOUR, () => build(kind as 'daily' | 'discover'));
}

// ---------------------------------------------------------------- new from artists you follow

/**
 * "Newest first" from the catalog is mostly record-label compilations that
 * repackage old hits under this year's date. A song only counts as new when it
 * was released on its own (a single), or as part of a film soundtrack.
 */
const REWORK = /\b(mash ?up|remix|lo-?fi|flip|slowed|reverb|sped up|nightcore|8d|vocals only|instrumental|karaoke|cover|tribute|version|unplugged|reprise|dj|mix|edit|medley|jukebox|bgm|ringtone)\b/i;

function isOwnRelease(t: Track, artistName: string, thisYear: number): boolean {
  if (t.kind !== 'song' || !t.year || Number(t.year) < thisYear - 1) return false;
  if (!plain(t.artist).includes(plain(artistName))) return false;
  // Remixes, mash-ups ("Song A X Song B") and other reworkings of older songs are not new music.
  if (REWORK.test(t.title) || / x /i.test(t.title)) return false;
  const album = plain(cleanTitle(t.album || ''));
  if (!album) return false;
  if (album === plain(cleanTitle(t.title))) return true;
  if (/soundtrack|original motion picture|\bost\b/i.test(t.album || '')) return true;
  const film = /\(from\s+["“']?([^"”')]+)/i.exec(t.title);
  return !!film && album.includes(plain(film[1]));
}

export const newKey = () => 'newFromFollowed:' + following.value.slice(0, 8).map((a) => a.id).join(',');

export function newFromFollowed(signal?: AbortSignal): Promise<Track[]> {
  const artists = following.value.slice(0, 8);
  if (!artists.length) return Promise.resolve([]);
  return cached(newKey(), 3 * HOUR, async () => {
    const thisYear = new Date().getFullYear();
    const answers = await Promise.allSettled(artists.map((a) => getArtistLatest(a.id, signal)));
    const perArtist = answers.map((r, i) => (r.status === 'fulfilled' ? r.value.filter((t) => isOwnRelease(t, artists[i].name, thisYear)) : []));
    // One from each artist in turn, so a single busy artist doesn't fill the shelf.
    const out: Track[] = [];
    const ids = new Set<string>();
    const titles = new Set<string>();
    for (let round = 0; round < 6 && out.length < 16; round++) {
      for (const list of perArtist) {
        const t = list[round];
        if (!t || ids.has(t.id) || titles.has(plain(t.title))) continue;
        ids.add(t.id);
        titles.add(plain(t.title));
        out.push(t);
      }
    }
    return out;
  }, true);
}

// ---------------------------------------------------------------- listening stats

export interface DayStat { key: string; label: string; seconds: number; plays: number; today: boolean }

export interface Stats {
  /** The last seven days, oldest first. */
  days: DayStat[];
  weekSeconds: number;
  weekPlays: number;
  /** Days in a row with listening, counting today (or up to yesterday if today is still quiet). */
  streak: number;
  totalPlays: number;
  topSongs: Array<{ track: Track; plays: number }>;
  topArtists: Array<{ name: string; plays: number; image: string }>;
}

export function computeStats(): Stats {
  const map = daily.value;
  const today = new Date();
  const days: DayStat[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = dayKey(d);
    const got = map[key] || [0, 0];
    days.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), seconds: got[0], plays: got[1], today: back === 0 });
  }
  const listened = (key: string) => { const v = map[key]; return !!v && (v[1] > 0 || v[0] >= 60); };
  let streak = 0;
  for (let back = 0; back < 400; back++) {
    const key = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back));
    if (listened(key)) streak++;
    else if (back > 0) break; // today may simply not have started yet
  }

  const c = counts.value;
  const byId = new Map<string, Track>();
  for (const p of history.value) if (p.t.kind === 'song') byId.set(p.t.id, p.t);
  for (const t of liked.value) if (!byId.has(t.id)) byId.set(t.id, t);
  let totalPlays = 0;
  const artists = new Map<string, { name: string; plays: number; image: string; best: number }>();
  const songs: Array<{ track: Track; plays: number }> = [];
  for (const id in c) {
    const plays = c[id];
    totalPlays += plays;
    const track = byId.get(id);
    if (!track) continue;
    songs.push({ track, plays });
    const name = firstArtist(track.artist);
    const key = plain(name);
    if (!key) continue;
    const had = artists.get(key);
    if (!had) artists.set(key, { name, plays, image: track.image, best: plays });
    else {
      had.plays += plays;
      if (plays > had.best) { had.best = plays; had.image = track.image; }
    }
  }
  songs.sort((a, b) => b.plays - a.plays);
  const topArtists = [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, 5).map(({ name, plays, image }) => ({ name, plays, image }));
  return {
    days,
    weekSeconds: days.reduce((s, d) => s + d.seconds, 0),
    weekPlays: days.reduce((s, d) => s + d.plays, 0),
    streak,
    totalPlays,
    topSongs: songs.slice(0, 5),
    topArtists,
  };
}

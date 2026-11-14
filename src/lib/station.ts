// "Keep playing things like this." Used when the queue runs out, for
// "Start radio" on any song, and for the mood buttons on Home.
//
// First choice is the catalog's own "song radio" list. Only the backup server
// offers it, so when it is unavailable a station is built from three sources
// that always work: more songs by the same artist, the rest of the album, and
// editor-made playlists that feature the artist.
// Rules either way: never repeat a song already heard this visit, stay in the
// song's language, and avoid two songs by the same artist back to back.

import type { Track } from './types';
import { getAlbum, getPlaylist, getSimilar, searchPlaylists, searchSongs } from './api';
import { firstArtist, plain, shuffled } from './util';

/** Ids heard or queued during this visit, so stations never loop. */
const heard = new Set<string>();
const heardTitles = new Set<string>();

export function markHeard(track: Track): void {
  heard.add(track.id);
  heardTitles.add(plain(track.title));
}

function usable(t: Track, seed: Track, exclude: Set<string>, usedTitles: Set<string>): boolean {
  if (t.kind !== 'song' || exclude.has(t.id) || heard.has(t.id)) return false;
  if (t.duration && (t.duration < 70 || t.duration > 900)) return false;
  const title = plain(t.title);
  if (!title || usedTitles.has(title) || heardTitles.has(title)) return false;
  if (seed.language && t.language && t.language !== seed.language) return false;
  return true;
}

/** Reorder so the same lead artist does not play twice in a row, where the list allows it. */
function spread(list: Track[]): Track[] {
  const rest = list.slice();
  const out: Track[] = [];
  let last = '';
  while (rest.length) {
    let i = rest.findIndex((t) => plain(firstArtist(t.artist)) !== last);
    if (i < 0) i = 0;
    const [t] = rest.splice(i, 1);
    out.push(t);
    last = plain(firstArtist(t.artist));
  }
  return out;
}

export async function moreLike(seed: Track, exclude: Set<string>, want = 12): Promise<Track[]> {
  // Best source: the catalog's own "what plays after this" list.
  const usedFirst = new Set<string>([plain(seed.title)]);
  const similar = await getSimilar(seed.id, 30).catch(() => [] as Track[]);
  const fromRadio: Track[] = [];
  for (const t of similar) {
    if (!usable(t, seed, exclude, usedFirst)) continue;
    usedFirst.add(plain(t.title));
    fromRadio.push(t);
  }
  if (fromRadio.length >= 5) return spread(fromRadio).slice(0, want);

  // Otherwise build one ourselves, and keep whatever the radio list did give.
  const built = await buildLike(seed, new Set([...exclude, ...fromRadio.map((t) => t.id)]), want - fromRadio.length);
  const titles = new Set(fromRadio.map((t) => plain(t.title)));
  return spread([...fromRadio, ...built.filter((t) => !titles.has(plain(t.title)))]).slice(0, want);
}

async function buildLike(seed: Track, exclude: Set<string>, want: number): Promise<Track[]> {
  const artist = firstArtist(seed.artist);
  const [byArtist, album, lists] = await Promise.allSettled([
    artist ? searchSongs(artist, 1, 30) : Promise.resolve([] as Track[]),
    seed.albumId ? getAlbum(seed.albumId) : Promise.resolve(null),
    artist ? searchPlaylists(artist, undefined, 8) : Promise.resolve([]),
  ]);

  // Up to two playlists of a sensible size → songs that go well together.
  let fromLists: Track[] = [];
  if (lists.status === 'fulfilled' && lists.value.length) {
    const good = lists.value.filter((p) => !p.songCount || (p.songCount >= 12 && p.songCount <= 200));
    const chosen = shuffled(good.length ? good : lists.value).slice(0, 2);
    const loaded = await Promise.allSettled(chosen.map((p) => getPlaylist(p.id)));
    for (const one of loaded) if (one.status === 'fulfilled') fromLists = fromLists.concat(one.value.songs);
  }

  const usedTitles = new Set<string>([plain(seed.title)]);
  const take = (list: Track[]) => {
    const out: Track[] = [];
    for (const t of list) {
      if (!usable(t, seed, exclude, usedTitles)) continue;
      usedTitles.add(plain(t.title));
      out.push(t);
    }
    return out;
  };

  const poolLists = take(shuffled(fromLists));
  const poolArtist = take(shuffled(byArtist.status === 'fulfilled' ? byArtist.value.slice(0, 20) : []));
  const poolAlbum = take(album.status === 'fulfilled' && album.value ? shuffled(album.value.songs) : []).slice(0, 2);

  // Weave: mostly "goes well with", some "same artist", a little "same album".
  const seedArtist = plain(artist);
  const picks: Track[] = [];
  let seedShare = 0;
  let lastArtist = seedArtist;
  const pull = (pool: Track[]): boolean => {
    for (let i = 0; i < pool.length; i++) {
      const a = plain(firstArtist(pool[i].artist));
      const isSeed = a === seedArtist;
      if (a === lastArtist && pool.length > 1 && i < pool.length - 1) continue;
      if (isSeed && seedShare >= Math.ceil(want / 2)) continue;
      const [t] = pool.splice(i, 1);
      picks.push(t);
      lastArtist = a;
      if (isSeed) seedShare++;
      return true;
    }
    return false;
  };
  const pattern = [poolLists, poolArtist, poolLists, poolLists, poolArtist, poolAlbum];
  let dry = 0;
  for (let step = 0; picks.length < want && dry < pattern.length; step++) {
    if (pull(pattern[step % pattern.length])) dry = 0;
    else dry++;
  }

  if (picks.length < 4) {
    // Thin result (a rare artist): fall back to what is popular in that language.
    try {
      const extra = await searchSongs(`${seed.language || 'hindi'} hits`, 1, 30);
      for (const t of shuffled(extra)) {
        if (picks.length >= want) break;
        if (usable(t, seed, exclude, usedTitles) && !picks.some((p) => p.id === t.id)) {
          usedTitles.add(plain(t.title));
          picks.push(t);
        }
      }
    } catch { /* give what we have */ }
  }
  return picks;
}

/** A station that starts from one song: the song itself, then things like it. */
export async function stationFrom(seed: Track): Promise<Track[]> {
  const more = await moreLike(seed, new Set([seed.id]), 14);
  return [seed, ...more];
}

export interface Mood {
  key: string;
  name: string;
  /** One short line shown under the name. */
  line: string;
  /** Playlist searches per language; {lang} is replaced with the language name. */
  queries: string[];
  /** Used when the person's languages return nothing. */
  fallback: string;
}

export const MOODS: Mood[] = [
  { key: 'calm', name: 'Calm', line: 'Slow, soft, unhurried', queries: ['{lang} chill', 'lofi {lang}', 'acoustic'], fallback: 'chill' },
  { key: 'focus', name: 'Focus', line: 'Steady and wordless', queries: ['focus', 'instrumental', 'soothing piano'], fallback: 'focus' },
  { key: 'sleep', name: 'Sleep', line: 'Drift off gently', queries: ['sleep', 'ambient'], fallback: 'sleep' },
  { key: 'romance', name: 'Romance', line: 'Love songs', queries: ['romantic {lang}', '{lang} love songs'], fallback: 'romantic hits' },
  { key: 'rain', name: 'Rainy day', line: 'Monsoon moods', queries: ['monsoon', 'baarish'], fallback: 'monsoon' },
  { key: 'retro', name: 'Old is gold', line: 'Evergreen classics', queries: ['90s {lang}', 'evergreen {lang}', 'retro {lang}'], fallback: '90s hits' },
  { key: 'energy', name: 'Energy', line: 'Lift the room', queries: ['workout', 'party {lang}'], fallback: 'workout' },
  { key: 'drive', name: 'Long drive', line: 'Windows down', queries: ['road trip', 'long drive {lang}'], fallback: 'road trip' },
  { key: 'devotional', name: 'Devotional', line: 'Bhajans and chants', queries: ['devotional', 'bhakti'], fallback: 'devotional' },
  { key: 'sufi', name: 'Sufi & ghazal', line: 'Poetry in song', queries: ['sufi', 'ghazal'], fallback: 'sufi' },
];

/** A shuffled set of songs for a mood, drawn from a few editor-made playlists. */
export async function moodTracks(mood: Mood, languages: string[]): Promise<Track[]> {
  const langs = languages.length ? languages : ['hindi'];
  const queries = new Set<string>();
  for (const q of mood.queries) {
    if (q.includes('{lang}')) for (const l of langs.slice(0, 2)) queries.add(q.replace('{lang}', l));
    else queries.add(q);
  }
  const found = await Promise.allSettled([...queries].slice(0, 4).map((q) => searchPlaylists(q, undefined, 8)));
  let lists = found.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  // Prefer the person's languages, but never end up with nothing.
  const inLang = lists.filter((p) => !p.language || langs.includes(p.language));
  if (inLang.length >= 2) lists = inLang;
  if (!lists.length) lists = await searchPlaylists(mood.fallback, undefined, 8).catch(() => []);
  const seenList = new Set<string>();
  lists = lists.filter((p) => !seenList.has(p.id) && (seenList.add(p.id), true));
  const order = shuffled(lists);
  const seen = new Set<string>();
  const titles = new Set<string>();
  const songs: Track[] = [];
  // Three playlists are usually plenty; some turn out nearly empty, so take three more if needed.
  for (let from = 0; from < order.length && from < 9 && songs.length < 20; from += 3) {
    const loaded = await Promise.allSettled(order.slice(from, from + 3).map((p) => getPlaylist(p.id)));
    for (const one of loaded) {
      if (one.status !== 'fulfilled') continue;
      for (const t of one.value.songs) {
        const title = plain(t.title);
        if (seen.has(t.id) || titles.has(title)) continue;
        seen.add(t.id);
        titles.add(title);
        songs.push(t);
      }
    }
  }
  if (!songs.length) {
    const direct = await searchSongs(mood.fallback, 1, 30).catch(() => [] as Track[]);
    return shuffled(direct);
  }
  return shuffled(songs).slice(0, 60);
}

// Song words, from the free LRCLIB library. Prefers time-stamped ("synced")
// words so the current line can be highlighted; falls back to plain text.

import type { LyricLine, Lyrics, Track } from './types';
import { cached } from './api';
import { cleanTitle, firstArtist } from './util';

const BASE = 'https://lrclib.net/api';
const DAY = 24 * 60 * 60 * 1000;

interface Hit {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

async function ask(path: string, signal?: AbortSignal): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  const onOuter = () => ctl.abort();
  signal?.addEventListener('abort', onOuter, { once: true });
  try {
    const res = await fetch(BASE + path, { signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('lyrics ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
}

/** "[01:12.50] words" lines → [{t: 72.5, text: "words"}], in time order. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  const stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const row of lrc.split(/\r?\n/)) {
    stamp.lastIndex = 0;
    const times: number[] = [];
    let end = 0;
    let m: RegExpExecArray | null;
    while ((m = stamp.exec(row)) && m.index === end) {
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      end = stamp.lastIndex;
    }
    if (!times.length) continue;
    const text = row.slice(end).trim();
    for (const t of times) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function toLyrics(hit: Hit | null | undefined): Lyrics | null {
  if (!hit) return null;
  const synced = hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : [];
  const plainText = (hit.plainLyrics || '').trim();
  if (synced.length < 3 && !plainText) return null;
  return { synced: synced.length >= 3 ? synced : null, plain: plainText || synced.map((l) => l.text).join('\n') };
}

function best(hits: Hit[], duration: number): Hit | null {
  let pick: Hit | null = null;
  let score = -1;
  for (const h of hits) {
    if (h.instrumental || (!h.syncedLyrics && !h.plainLyrics)) continue;
    let s = h.syncedLyrics ? 2 : 1;
    if (duration && h.duration) {
      const off = Math.abs(h.duration - duration);
      if (off <= 3) s += 3;
      else if (off <= 8) s += 1.5;
      else if (off > 25) s -= 1.5;
    }
    if (s > score) { score = s; pick = h; }
  }
  return score >= 1 ? pick : null;
}

/** null means "we looked and there are none". Remembered for a day, also across restarts. */
export function getLyrics(track: Track, signal?: AbortSignal): Promise<Lyrics | null> {
  return cached('lyrics:' + track.id, DAY, async () => {
    const title = cleanTitle(track.title);
    const artist = firstArtist(track.artist);
    const e = encodeURIComponent;
    if (!title) return null;

    // 1. Exact lookup (fast, but needs the names to match closely).
    if (artist && track.duration) {
      const exact = await ask(`/get?track_name=${e(title)}&artist_name=${e(artist)}&duration=${Math.round(track.duration)}`, signal).catch(() => null);
      const got = toLyrics(exact);
      if (got?.synced) return got;
    }
    // 2. Search by title + artist, then by title alone; take the closest in length.
    const tries = artist ? [`/search?track_name=${e(title)}&artist_name=${e(artist)}`, `/search?q=${e(title + ' ' + artist)}`] : [`/search?q=${e(title)}`];
    for (const path of tries) {
      const hits = await ask(path, signal).catch(() => null);
      if (Array.isArray(hits) && hits.length) {
        const got = toLyrics(best(hits, track.duration));
        if (got) return got;
      }
    }
    return null;
  }, true);
}

/** Which synced line is being sung at this moment (-1 before the first). */
export function lineAt(lines: LyricLine[], seconds: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= seconds + 0.15) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

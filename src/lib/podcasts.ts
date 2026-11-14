// Podcasts, from Apple's public podcast directory (no key or account needed).
// Episodes play straight from each podcast's own host.

import type { Show, ShowRef, Track } from './types';
import { cached, ApiError } from './api';
import { decode } from './util';

const HOUR = 60 * 60 * 1000;

async function ask(url: string, signal?: AbortSignal): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const onOuter = () => ctl.abort();
  signal?.addEventListener('abort', onOuter, { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('podcasts ' + res.status);
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    const offline = navigator.onLine === false;
    throw new ApiError(offline ? 'You are offline. Check your internet and try again.' : "Couldn't reach the podcast directory. Please try again in a moment.", offline);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
}

function showFromSearch(r: any): ShowRef | null {
  const id = String(r?.collectionId ?? r?.trackId ?? '');
  const title = decode(r?.collectionName ?? r?.trackName);
  if (!id || !title) return null;
  return {
    type: 'show',
    id,
    title,
    author: decode(r.artistName),
    image: r.artworkUrl600 || r.artworkUrl100 || r.artworkUrl60 || '',
    genre: decode(r.primaryGenreName),
    episodeCount: typeof r.trackCount === 'number' ? r.trackCount : undefined,
  };
}

/** The most popular podcasts in India right now. */
export function topShows(signal?: AbortSignal): Promise<ShowRef[]> {
  return cached('pod:top', 6 * HOUR, async () => {
    const data = await ask('https://itunes.apple.com/in/rss/toppodcasts/limit=40/json', signal);
    const entries: any[] = Array.isArray(data?.feed?.entry) ? data.feed.entry : [];
    const out: ShowRef[] = [];
    for (const e of entries) {
      const id = String(e?.id?.attributes?.['im:id'] ?? '');
      const title = decode(e?.['im:name']?.label);
      if (!id || !title) continue;
      const images: any[] = Array.isArray(e['im:image']) ? e['im:image'] : [];
      out.push({
        type: 'show',
        id,
        title,
        author: decode(e?.['im:artist']?.label),
        image: images.length ? String(images[images.length - 1].label || '') : '',
        genre: decode(e?.category?.attributes?.label),
      });
    }
    if (!out.length) throw new ApiError("Couldn't load podcasts right now.");
    return out;
  }, true);
}

export function searchShows(query: string, signal?: AbortSignal): Promise<ShowRef[]> {
  const q = query.trim();
  return cached('pod:s:' + q.toLowerCase(), HOUR, async () => {
    const data = await ask(`https://itunes.apple.com/search?media=podcast&country=in&limit=30&term=${encodeURIComponent(q)}`, signal);
    const out: ShowRef[] = [];
    const seen = new Set<string>();
    for (const r of Array.isArray(data?.results) ? data.results : []) {
      const s = showFromSearch(r);
      if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
    return out;
  });
}

/** A show with its most recent episodes (newest first). */
export function getShow(id: string, signal?: AbortSignal): Promise<Show> {
  return cached('pod:show:' + id, HOUR, async () => {
    const data = await ask(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&media=podcast&entity=podcastEpisode&limit=120`, signal);
    const rows: any[] = Array.isArray(data?.results) ? data.results : [];
    const head = rows.find((r) => r?.kind === 'podcast' || r?.wrapperType === 'track');
    const ref = showFromSearch(head);
    if (!ref) throw new ApiError('This podcast could not be opened.');
    const episodes: Track[] = [];
    for (const r of rows) {
      if (r?.wrapperType !== 'podcastEpisode' && r?.kind !== 'podcast-episode') continue;
      const url = String(r.episodeUrl || '');
      const epId = String(r.trackId ?? r.episodeGuid ?? '');
      const title = decode(r.trackName);
      if (!url || !epId || !title || url.indexOf('http') !== 0) continue;
      if (r.episodeContentType && r.episodeContentType !== 'audio') continue;
      episodes.push({
        id: 'ep' + epId,
        kind: 'episode',
        title,
        artist: ref.title,
        album: ref.title,
        image: r.artworkUrl600 || r.artworkUrl160 || ref.image,
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
        url: url.replace(/^http:\/\//, 'https://'),
        showId: ref.id,
        note: decode(r.shortDescription || r.description || '').replace(/\s+/g, ' ').slice(0, 320),
        date: typeof r.releaseDate === 'string' ? r.releaseDate : undefined,
      });
    }
    episodes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { ...ref, about: undefined, episodes };
  });
}

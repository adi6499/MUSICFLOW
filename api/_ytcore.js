// Reads a public YouTube Music (or YouTube) playlist: its name and the songs in
// it. Only titles, artists and lengths are read; Music Flow then looks the same
// songs up in its own catalog. Nothing is streamed or downloaded from YouTube.
//
// This one file is shared by three callers:
//   * api/yt-playlist.js   (the website's small server function)
//   * scripts/dev-api.ts   (the same thing while developing on this PC)
//   * src/lib/ytimport.ts  (inside the Android app, through the app's own network bridge)
// Each passes in its own `post(url, body)` function.

const ENDPOINT = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
const CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'IN' },
};
const ID_RE = /^[A-Za-z0-9_-]{10,80}$/;
const MAX_PAGES = 30;
const MAX_SONGS = 2000;

/** Accepts a full link or a bare playlist id. Returns '' when it is neither. */
export function playlistIdFrom(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let id = '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s);
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) {
      id = u.searchParams.get('list') || '';
      if (!id) {
        const m = /\/browse\/VL([A-Za-z0-9_-]+)/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
  } catch {
    /* not a link */
  }
  if (!id && ID_RE.test(s)) id = s;
  id = id.replace(/^VL/, '');
  return ID_RE.test(id) ? id : '';
}

/** Collect every object stored under `key`, anywhere in the answer, in order. */
function findAll(root, key, out = []) {
  const stack = [root];
  // Depth-first, but children are pushed reversed so results stay in page order.
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const keys = Object.keys(node);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k === key) out.push(node[k]);
      else stack.push(node[k]);
    }
  }
  return out;
}

function runsText(column) {
  const runs = column?.text?.runs;
  return Array.isArray(runs) ? runs : [];
}

function seconds(text) {
  const parts = String(text || '').trim().split(':').map((p) => parseInt(p, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function toSong(item) {
  const flex = (Array.isArray(item?.flexColumns) ? item.flexColumns : []).map((c) => c?.musicResponsiveListItemFlexColumnRenderer);
  const fixed = (Array.isArray(item?.fixedColumns) ? item.fixedColumns : []).map((c) => c?.musicResponsiveListItemFixedColumnRenderer);
  const titleRuns = runsText(flex[0]);
  const title = titleRuns.map((r) => r.text || '').join('').trim();
  if (!title) return null;

  const second = runsText(flex[1]);
  let artists = second
    .filter((r) => String(r?.navigationEndpoint?.browseEndpoint?.browseId || '').startsWith('UC'))
    .map((r) => String(r.text || '').trim());
  if (!artists.length) {
    // No links (uploads, some regional songs): take the names before the first "•".
    const names = [];
    for (const r of second) {
      const t = String(r.text || '').trim();
      if (t === '•') break;
      if (t && t !== '&' && t !== ',') names.push(t.replace(/^[,&]\s*|\s*[,&]$/g, ''));
    }
    artists = names.filter(Boolean);
  }

  const album = runsText(flex[2]).map((r) => r.text || '').join('').trim();
  let duration = 0;
  for (const f of fixed) {
    const d = seconds(runsText(f).map((r) => r.text || '').join(''));
    if (d) { duration = d; break; }
  }
  const videoId =
    item?.playlistItemData?.videoId ||
    titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    '';
  return { title, artists, album, duration, videoId: String(videoId) };
}

function playlistTitle(data) {
  const heads = [
    ...findAll(data, 'musicResponsiveHeaderRenderer'),
    ...findAll(data, 'musicDetailHeaderRenderer'),
    ...findAll(data, 'musicImmersiveHeaderRenderer'),
  ];
  for (const h of heads) {
    const t = (h?.title?.runs || []).map((r) => r.text || '').join('').trim();
    if (t) return t;
  }
  const micro = data?.microformat?.microformatDataRenderer?.title;
  return typeof micro === 'string' ? micro.replace(/\s*-\s*YouTube Music\s*$/i, '').trim() : '';
}

function nextToken(data) {
  const cmds = findAll(data, 'continuationItemRenderer');
  for (const c of cmds) {
    const t = c?.continuationEndpoint?.continuationCommand?.token;
    if (t) return { token: String(t), legacy: false };
  }
  const old = findAll(data, 'nextContinuationData');
  for (const c of old) if (c?.continuation) return { token: String(c.continuation), legacy: true };
  return null;
}

/**
 * @param {string} id  playlist id (from playlistIdFrom)
 * @param {(url: string, body: object) => Promise<any>} post  sends JSON, returns parsed JSON
 * @returns {Promise<{id: string, title: string, songs: Array<{title: string, artists: string[], album: string, duration: number, videoId: string}>}>}
 */
export async function readPlaylist(id, post) {
  if (!ID_RE.test(id)) throw new Error('That does not look like a playlist link.');
  const first = await post(ENDPOINT, { context: CONTEXT, browseId: 'VL' + id });
  if (!first || typeof first !== 'object') throw new Error('YouTube Music did not answer.');
  const title = playlistTitle(first) || 'Imported playlist';
  const songs = [];
  const seen = new Set();
  const take = (data) => {
    let added = 0;
    for (const item of findAll(data, 'musicResponsiveListItemRenderer')) {
      const song = toSong(item);
      if (!song) continue;
      const key = song.videoId || song.title + '|' + song.artists.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      songs.push(song);
      added++;
    }
    return added;
  };
  take(first);
  let next = nextToken(first);
  for (let page = 0; next && page < MAX_PAGES && songs.length < MAX_SONGS; page++) {
    const url = next.legacy
      ? `${ENDPOINT}&ctoken=${encodeURIComponent(next.token)}&continuation=${encodeURIComponent(next.token)}&type=next`
      : ENDPOINT;
    const body = next.legacy ? { context: CONTEXT } : { context: CONTEXT, continuation: next.token };
    let data;
    try { data = await post(url, body); } catch { break; }
    if (!take(data)) break;
    next = nextToken(data);
  }
  if (!songs.length) {
    throw new Error('No songs were found. The playlist may be private, empty, or the link may be wrong.');
  }
  return { id, title, songs: songs.slice(0, MAX_SONGS) };
}

/** A `post` for Node (server function and local development). */
export async function nodePost(url, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('YouTube Music answered ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

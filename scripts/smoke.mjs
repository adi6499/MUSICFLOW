// A health check for everything Sukoon depends on that lives on the internet.
// Run with:  npm test
// It asks each service one small real question and prints a tick or a cross.
// If the app ever "stops working", run this first: it tells you which outside
// service changed, in about ten seconds.

import { readPlaylist, nodePost, playlistIdFrom } from '../api/_ytcore.js';

const MAIN = 'https://spoton-sigma.vercel.app/api';
const BACKUP = 'https://jiosaavn-api-sage.vercel.app/api';
const SONG = 'rjkrTnma'; // a long-standing, very popular song

let failed = 0;
let critical = 0;

async function json(url, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal, headers: { Origin: 'https://sukoon.example', ...(opts?.headers || {}) } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { data: await res.json(), cors: res.headers.get('access-control-allow-origin') };
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, must, run) {
  const t0 = Date.now();
  try {
    const note = await run();
    console.log(`  ok    ${name.padEnd(46)} ${String(Date.now() - t0).padStart(5)} ms  ${note || ''}`);
  } catch (e) {
    failed++;
    if (must) critical++;
    console.log(`  FAIL  ${name.padEnd(46)} ${String(Date.now() - t0).padStart(5)} ms  ${e.message}${must ? '' : '  (the app copes without this)'}`);
  }
}

const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const list = (d) => (Array.isArray(d) ? d : d?.results || d?.songs || []);

console.log('\nSong catalog — main server');
await check('search songs (with audio addresses)', true, async () => {
  const { data, cors } = await json(`${MAIN}/search/songs?query=kesariya&page=1&limit=5`);
  const songs = list(data.data);
  need(songs.length > 0, 'no results');
  need(songs[0].downloadUrl?.length > 0, 'songs arrive without audio addresses');
  need(cors === '*', 'browsers are not allowed to call it (CORS)');
  return `${songs.length} songs`;
});
await check('one song by id', true, async () => {
  const { data } = await json(`${MAIN}/songs?id=${SONG}`);
  need(list(data.data)[0]?.downloadUrl?.length > 0, 'no audio addresses');
});
await check('album', true, async () => {
  const { data } = await json(`${MAIN}/albums?id=38845390`);
  need(data.data?.songs?.length > 0, 'album has no songs');
  return `${data.data.songs.length} songs`;
});
await check('playlist search', true, async () => {
  const { data } = await json(`${MAIN}/search/playlists?query=romantic%20hindi&page=1&limit=3`);
  need(list(data.data).length > 0, 'no playlists found');
});
await check('playlist songs (either server is enough)', true, async () => {
  // The app asks the backup first and falls back to the main server, keeping the fuller list.
  const id = '79486682';
  const [a, b] = await Promise.allSettled([
    json(`${BACKUP}/playlists?id=${id}&page=0&limit=100`),
    json(`${MAIN}/playlists?id=${id}&limit=200`),
  ]);
  const backup = a.status === 'fulfilled' ? a.value.data.data?.songs?.length || 0 : 0;
  const main = b.status === 'fulfilled' ? b.value.data.data?.songs?.length || 0 : 0;
  need(backup > 0 || main > 0, 'neither server returned the songs');
  return `backup ${backup} songs, main ${main} songs`;
});
await check('artist', true, async () => {
  const { data } = await json(`${MAIN}/artists?id=459320`);
  need(data.data?.topSongs?.length > 0, 'artist has no top songs');
});
await check('home feed', false, async () => {
  const { data } = await json(`${MAIN}/modules?language=hindi,english`);
  need(data.data?.new_trending?.length > 0, 'no trending section');
  return `${Object.keys(data.data).length} sections`;
});

console.log('\nSong catalog — backup server');
await check('search songs', false, async () => {
  const { data, cors } = await json(`${BACKUP}/search/songs?query=kesariya&page=0&limit=5`);
  need(list(data.data).length > 0, 'no results');
  need(cors === '*', 'browsers are not allowed to call it (CORS)');
});
await check('one song by id', false, async () => {
  const { data } = await json(`${BACKUP}/songs/${SONG}`);
  need(list(data.data)[0]?.downloadUrl?.length > 0, 'no audio addresses');
});
await check('similar songs (drives radio and auto-play)', false, async () => {
  const { data } = await json(`${BACKUP}/songs/${SONG}/suggestions?limit=10`);
  need(list(data.data).length >= 5, 'fewer than 5 suggestions');
  return `${list(data.data).length} songs`;
});

console.log('\nAudio and artwork');
await check('audio file is reachable and seekable', true, async () => {
  const { data } = await json(`${MAIN}/songs?id=${SONG}`);
  const url = list(data.data)[0].downloadUrl.at(-1).url;
  const res = await fetch(url, { headers: { Range: 'bytes=0-1023', Origin: 'https://sukoon.example' } });
  need(res.status === 206, 'does not support seeking (status ' + res.status + ')');
  need(res.headers.get('access-control-allow-origin') === '*', 'equalizer would be blocked (CORS)');
  return res.headers.get('content-type');
});

console.log('\nLyrics, podcasts, playlist import');
await check('lyrics (LRCLIB)', false, async () => {
  const { data } = await json('https://lrclib.net/api/search?track_name=Kesariya&artist_name=Arijit%20Singh');
  need(Array.isArray(data) && data.length > 0, 'no lyrics found');
  return data.some((d) => d.syncedLyrics) ? 'synced available' : 'plain only';
});
await check('podcast chart (Apple directory)', false, async () => {
  const { data } = await json('https://itunes.apple.com/in/rss/toppodcasts/limit=5/json');
  need(data.feed?.entry?.length > 0, 'empty chart');
});
await check('podcast episodes', false, async () => {
  const { data } = await json('https://itunes.apple.com/lookup?id=135067274&media=podcast&entity=podcastEpisode&limit=5');
  need(data.results?.some((r) => r.episodeUrl), 'no playable episodes');
});
await check('YouTube Music playlist reader', false, async () => {
  const id = playlistIdFrom('https://music.youtube.com/playlist?list=RDCLAK5uy_n9Fbdw7e6ap-98_A-8JYBmPv64v-Uaq1g');
  const pl = await readPlaylist(id, nodePost);
  need(pl.songs.length > 5, 'too few songs read');
  return `"${pl.title}", ${pl.songs.length} songs`;
});

console.log(
  failed === 0
    ? '\nEverything Sukoon relies on is answering correctly.\n'
    : critical
      ? `\n${failed} check(s) failed, ${critical} of them essential — music will not play until the main server is back.\n`
      : `\n${failed} non-essential check(s) failed — music still plays; the feature named above is degraded.\n`,
);
process.exit(critical ? 1 : 0);

// ============================================================================
// MUSICFLOW — STATION  (what plays next, and what "Radio" / "Related" mean)
//
// One engine for every automatic queue: when the queue runs out, song / artist /
// genre radio, the Related tab and the Radio tab stations.
//
// Sources, all from the catalog, all in the station's language:
//   A  the seed artist's real top songs            (/artists?id=)
//   B  the other artists on the seed (co-artists)   (their top songs)
//   C  the seed's album                              (/albums?id=)
//   D  curated playlists for the artist / genre      (/search/playlists → /playlists?id=)
//   E  related artists (RecommendationEngine graph)  (their top songs)
//   F  catalog search (genre stations only)
//
// Rules:
//   • never the seed (any copy of it), anything in the queue, or anything already
//     queued by a station in this session — hard rule, no exceptions
//   • songs from recent history are used only when nothing unheard is left
//   • one copy per recording; no teasers / karaoke / lofi flips unless the seed is one
//   • one language — the seed's, or the language most of the artist's songs are in
//   • no two songs in a row by the same artist
//   • a mix: about a third from the seed artist, the rest spread over the other sources
// ============================================================================

const Station = (() => {
  const SESSION_KEY = 'mf_station_played';
  const FETCH_TIMEOUT_MS = 7000;
  const HISTORY_LOOKBACK = 100;

  const QUOTAS = { A: 0.30, D: 0.32, B: 0.12, E: 0.16, C: 0.10, F: 0.40 };
  const ORDER = ['A', 'D', 'B', 'A', 'D', 'E', 'C', 'A', 'D', 'F', 'E', 'B', 'A', 'D', 'C', 'F'];

  const played = new Set();
  const artistCache = new Map();
  const playlistCache = new Map();
  const albumCache = new Map();

  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) JSON.parse(raw).forEach(id => played.add(String(id)));
    }
  } catch (_) {}

  function persistPlayed() {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(played).slice(-400)));
    } catch (_) {}
  }

  // ---------------------------------------------------------------- helpers
  const TD = () => (typeof TrackDeduplicator !== 'undefined') ? TrackDeduplicator : null;
  const DN = () => (typeof DataNormalizer !== 'undefined') ? DataNormalizer : null;
  const RE = () => (typeof RecommendationEngine !== 'undefined') ? RecommendationEngine : null;
  const api = () => (typeof API !== 'undefined') ? API : null;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function artistsOf(song) {
    const raw = String((song && (song.artists || song.primaryArtist)) || '');
    return raw.split(/[,&;/|•]|\bfeat\.?\b|\bft\.?\b|\bwith\b/i).map(x => norm(x)).filter(x => x && x.length > 1 && !/^unknown/.test(x) && x !== 'various artists');
  }

  function primaryArtist(song) {
    return artistsOf(song)[0] || '';
  }

  function languageOf(song) {
    if (!song) return 'unknown';
    const d = DN();
    const raw = song.language || song.lang || '';
    const n = d && d.normalizeLanguage ? d.normalizeLanguage(raw) : norm(raw);
    if (n && n !== 'unknown') return n;
    const re = RE();
    if (re && typeof re.inferTrackLanguage === 'function') { try { return re.inferTrackLanguage(song) || 'unknown'; } catch (_) {} }
    return 'unknown';
  }

  function titleKey(song) {
    const td = TD();
    const name = String((song && (song.name || song.title)) || '');
    return norm(td && td.cleanTrackTitle ? td.cleanTrackTitle(name) : name);
  }

  const VERSION_WORDS = /lofi|lo-fi|flip|slowed|reverb|sped up|remix|mashup|unplugged|acoustic|instrumental|karaoke|cover|reprise|female version|male version/i;
  const JUNK_WORDS = /teaser|trailer|promo|dialogue|jingle|ringtone|\bbgm\b|audio launch|making of|commentary|podcast|megamix|jukebox|full album|nonstop|non-stop/i;

  function isVersionTrack(song) {
    return VERSION_WORDS.test(String((song && (song.name || song.title)) || '')) || /lofi|lo-fi|slowed|reverb/i.test(String((song && song.album) || ''));
  }

  function isLegit(song, seedStyle) {
    if (!song || !song.id) return false;
    const name = String(song.name || song.title || '');
    const album = String(song.album || '');
    if (!name.trim()) return false;
    if (JUNK_WORDS.test(name) || /jukebox|megamix|nonstop/i.test(album)) return false;
    const dur = Number(song.duration) || 0;
    if (dur > 0 && dur < 60) return false;
    if (dur > 900) return false;
    if (isVersionTrack(song) && !seedStyle) return false;   // a normal seed never gets flips / karaoke
    return true;
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise(resolve => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } }, () => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
    });
  }

  function shuffleTop(list, n) {
    // Keep the most popular at the front but vary their order from station to station
    const head = list.slice(0, n), tail = list.slice(n);
    for (let i = head.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [head[i], head[j]] = [head[j], head[i]]; }
    return head.concat(tail);
  }

  const byPlays = (a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0);

  // The word a station is really about: "lofi chill beats" → lofi, "Arijit Singh" → arijit, "pop hits" → pop
  const FILLER = new Set(['hits', 'hit', 'songs', 'song', 'beats', 'classics', 'best', 'top', 'music', 'mix', 'radio', 'playlist', 'new', 'latest', 'the', 'and']);
  function keyWord(s) {
    const words = norm(s).split(' ').filter(Boolean);
    return words.find(w => w.length > 2 && !FILLER.has(w)) || words.filter(w => w.length > 2).sort((a, b) => b.length - a.length)[0] || words[0] || '';
  }

  // ---------------------------------------------------------------- sources
  async function artistTop(name) {
    const key = norm(name);
    if (!key) return { songs: [], albums: [] };
    if (artistCache.has(key)) return artistCache.get(key);
    const a = api();
    let out = { songs: [], albums: [] };
    try {
      if (a && typeof a.getArtistTopSongs === 'function') out = (await withTimeout(a.getArtistTopSongs(name), FETCH_TIMEOUT_MS, out)) || out;
    } catch (_) {}
    if (!out || !Array.isArray(out.songs)) out = { songs: [], albums: [] };
    artistCache.set(key, out);
    return out;
  }

  async function playlistSongs(query, language, maxPlaylists = 2) {
    const key = norm(query) + '|' + language;
    if (playlistCache.has(key)) return playlistCache.get(key);
    const a = api();
    const songs = [];
    try {
      if (a && typeof a.searchPlaylists === 'function' && typeof a.getPlaylistDetails === 'function') {
        const lists = await withTimeout(a.searchPlaylists(query, 6), FETCH_TIMEOUT_MS, []);
        const must = keyWord(query);
        const picked = (lists || []).filter(pl => {
          if (!pl || !pl.id) return false;
          const n = norm(pl.name || pl.title);
          const plLang = norm(pl.language || '');
          const langOk = language === 'unknown' || !plLang || plLang === language;
          return langOk && (!must || n.includes(must));
        }).slice(0, maxPlaylists);
        const details = await Promise.all(picked.map(pl => withTimeout(a.getPlaylistDetails(pl.id), FETCH_TIMEOUT_MS, null)));
        details.forEach(d => { if (d && Array.isArray(d.songs)) songs.push(...d.songs); });
      }
    } catch (_) {}
    playlistCache.set(key, songs);
    return songs;
  }

  async function albumSongs(albumId) {
    if (!albumId) return [];
    const key = String(albumId);
    if (albumCache.has(key)) return albumCache.get(key);
    const a = api();
    let songs = [];
    try {
      if (a && typeof a.getAlbumDetails === 'function') {
        const d = await withTimeout(a.getAlbumDetails(albumId), FETCH_TIMEOUT_MS, null);
        if (d && Array.isArray(d.songs)) songs = d.songs;
      }
    } catch (_) {}
    albumCache.set(key, songs);
    return songs;
  }

  async function catalogSearch(query, limit = 30) {
    const a = api();
    try {
      if (a && typeof a.searchSongs === 'function') return (await withTimeout(a.searchSongs(query, 1, limit, { lite: true }), FETCH_TIMEOUT_MS, [])) || [];
    } catch (_) {}
    return [];
  }

  function relatedArtists(name, max = 2) {
    const re = RE();
    const graph = re && re.RELATED_ARTISTS_GRAPH ? re.RELATED_ARTISTS_GRAPH : {};
    return (graph[norm(name)] || []).slice(0, max);
  }

  // ---------------------------------------------------------------- build
  /**
   * @param seed  a song, or { artistName } for an artist station, or { query, name } for a genre station
   * @param opts  { size, mode: 'song' | 'artist' | 'genre', exclude: [ids], excludeSongs: [songs] }
   */
  async function build(seed, opts = {}) {
    if (!seed) return [];
    const trace = typeof opts.trace === 'function' ? opts.trace : null;
    const size = Math.max(5, Number(opts.size) || 25);
    const mode = opts.mode || (seed.artistName ? 'artist' : (seed.query ? 'genre' : 'song'));
    const td = TD();
    const seedSong = mode === 'song' ? seed : null;
    const seedId = seedSong ? String(seedSong.id || '') : '';
    let lang = seedSong ? languageOf(seedSong) : (seed.language ? norm(seed.language) : 'unknown');
    const seedStyle = seedSong
      ? isVersionTrack(seedSong)
      : /lofi|lo-fi|remix|unplugged|acoustic|instrumental|slowed|reverb/i.test(String(seed.query || seed.name || ''));

    // Who is this station about?
    const seedArtists = seedSong ? artistsOf(seedSong) : (mode === 'artist' ? [norm(seed.artistName)] : []);
    const lead = seedArtists[0] || '';
    const coArtists = seedArtists.slice(1, 3);

    // Hard exclusions: the seed (and any copy of it), the queue, everything a station queued this session
    const hardIds = new Set((opts.exclude || []).map(x => String(x)));
    const hardTitles = new Set();
    if (seedId) hardIds.add(seedId);
    if (seedSong) hardTitles.add(titleKey(seedSong));
    (opts.excludeSongs || []).forEach(s => { if (s && s.id) hardIds.add(String(s.id)); if (s) hardTitles.add(titleKey(s)); });
    played.forEach(id => hardIds.add(String(id)));
    // Soft exclusions: recently played — only used when nothing unheard is left
    const heardIds = new Set();
    const heardTitles = new Set();
    try {
      const hist = (typeof Storage !== 'undefined' && Storage.getHistory) ? (Storage.getHistory() || []) : [];
      hist.slice(0, HISTORY_LOOKBACK).forEach(h => { if (h && h.id) { heardIds.add(String(h.id)); heardTitles.add(titleKey(h)); } });
    } catch (_) {}

    // Fetch the sources in parallel
    const tasks = {};
    if (mode === 'genre') {
      const q = String(seed.query || seed.name || '');
      tasks.D = playlistSongs(q, lang, 3);
      tasks.F = catalogSearch(q, 40);
    } else {
      if (lead) {
        tasks.A = artistTop(lead).then(r => r.songs);
        tasks.D = playlistSongs(seedSong ? (seedSong.primaryArtist || lead) : seed.artistName, lang, 2);
      }
      if (coArtists.length) tasks.B = Promise.all(coArtists.map(n => artistTop(n).then(r => r.songs))).then(lists => lists.flat());
      if (seedSong && seedSong.albumId) tasks.C = albumSongs(seedSong.albumId);
      const rel = relatedArtists(lead, 2);
      if (rel.length) tasks.E = Promise.all(rel.map(n => artistTop(n).then(r => r.songs))).then(lists => lists.flat());
    }
    const keys = Object.keys(tasks);
    const settled = await Promise.all(keys.map(k => withTimeout(tasks[k], FETCH_TIMEOUT_MS + 500, [])));
    const raw = {};
    keys.forEach((k, i) => { raw[k] = Array.isArray(settled[i]) ? settled[i].filter(Boolean) : []; });
    if (trace) trace('raw', Object.fromEntries(keys.map(k => [k, raw[k].map(s => s.name)])));

    // Which language is this station in? The seed's, else the one most of the lead source is in.
    if (lang === 'unknown') {
      const sample = mode === 'genre' ? [...(raw.D || []), ...(raw.F || [])] : (raw.A || []);
      const counts = {};
      sample.forEach(s => { const l = languageOf(s); if (l !== 'unknown') counts[l] = (counts[l] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= Math.max(3, sample.length * 0.5)) lang = top[0];
    }

    // Clean each source: legit, in language, not hard-excluded, one per recording, popular first
    const fresh = {}, heard = {};
    const styleWord = mode === 'genre' ? keyWord(String(seed.query || seed.name || '')) : '';
    keys.forEach(k => {
      let list = raw[k].filter(s => isLegit(s, seedStyle));
      if (k === 'F' && styleWord) {
        // a genre search must really be about the genre: keep songs that carry the word in their
        // title or album when enough of them do (so "lofi" does not drift into plain bhajans)
        const strict = list.filter(s => norm(String(s.name || '') + ' ' + String(s.album || '')).includes(styleWord));
        if (strict.length >= 8) list = strict;
      }
      if (lang !== 'unknown') list = list.filter(s => { const l = languageOf(s); return l === 'unknown' || l === lang; });
      list = list.filter(s => !hardIds.has(String(s.id)) && !hardTitles.has(titleKey(s)));
      if (td && td.deduplicate) list = td.deduplicate(list, '');
      list.sort(byPlays);
      const f = list.filter(s => !heardIds.has(String(s.id)) && !heardTitles.has(titleKey(s)));
      const h = list.filter(s => heardIds.has(String(s.id)) || heardTitles.has(titleKey(s)));
      fresh[k] = shuffleTop(f, Math.min(f.length, Math.ceil(size * (QUOTAS[k] || 0.2)) * 2));
      heard[k] = h;
    });
    if (trace) trace('pools', { lang, fresh: Object.fromEntries(keys.map(k => [k, fresh[k].map(s => s.name)])), heard: Object.fromEntries(keys.map(k => [k, heard[k].map(s => s.name)])) });

    // Assemble: quotas per source, interleaved, no two in a row by the same artist. Unheard songs
    // first; recently played ones only if the station would otherwise run dry.
    const out = [];
    const seenIds = new Set();
    const seenTitles = new Set();
    const leadCap = Math.ceil(size / 2);           // the seed artist never takes more than half the station
    let leadCount = 0;
    const isLead = (s) => !!lead && primaryArtist(s) === lead;
    const blocked = (s) => {
      const prev = out[out.length - 1];
      if (prev && primaryArtist(prev) && primaryArtist(prev) === primaryArtist(s)) return true;
      if (isLead(s) && leadCount >= leadCap) return true;
      return false;
    };
    const push = (s, k, quota) => {
      seenIds.add(String(s.id)); seenTitles.add(titleKey(s)); out.push(s);
      if (isLead(s)) leadCount++;
      if (quota && k) quota[k]--;
    };
    const assemble = (pools) => {
      const quota = {};
      keys.forEach(k => { quota[k] = Math.max(2, Math.round(size * (QUOTAS[k] || 0.2))); });
      const take = (k) => {
        const pool = pools[k] || [];
        let rotations = 0;
        while (pool.length) {
          const s = pool.shift();
          if (seenIds.has(String(s.id)) || seenTitles.has(titleKey(s))) continue;
          if (blocked(s)) {
            if (trace) trace('blocked', k, s.name, 'rot', rotations, 'left', pool.length);
            if (rotations < pool.length) { pool.push(s); rotations++; continue; }
            pool.unshift(s);          // everything left here is blocked right now; try another source
            return false;
          }
          if (trace) trace('take', k, s.name);
          push(s, k, quota); return true;
        }
        return false;
      };
      let guard = 0;
      while (out.length < size && guard++ < size * 6) {
        let progressed = false;
        for (const k of ORDER) {
          if (out.length >= size) break;
          if (!pools[k] || quota[k] <= 0) continue;
          if (take(k)) progressed = true;
        }
        if (!progressed) {
          // quotas spent: top up with whatever is left, most popular first, still avoiding a
          // repeat of the artist who just played whenever any other artist is available
          const rest = keys.flatMap(k => pools[k] || []).sort(byPlays)
            .filter(s => !seenIds.has(String(s.id)) && !seenTitles.has(titleKey(s)));
          if (!rest.length) break;
          let added = false;
          while (out.length < size && rest.length) {
            let idx = rest.findIndex(s => !blocked(s));
            if (idx === -1) idx = rest.findIndex(s => { const prev = out[out.length - 1]; return !prev || primaryArtist(prev) !== primaryArtist(s); });
            if (idx === -1) idx = 0;
            const s = rest.splice(idx, 1)[0];
            if (seenIds.has(String(s.id)) || seenTitles.has(titleKey(s))) continue;
            push(s, null, null); added = true;
          }
          if (!added) break;
        }
      }
    };
    assemble(fresh);
    if (out.length < size) assemble(heard);
    return spread(out);
  }

  // Last safety net: swap songs so the same artist never plays twice in a row where that is possible.
  function spread(list) {
    for (let i = 1; i < list.length; i++) {
      if (primaryArtist(list[i]) !== primaryArtist(list[i - 1])) continue;
      for (let j = 0; j < list.length; j++) {
        if (Math.abs(j - i) <= 1) continue;
        const a = primaryArtist(list[j]);
        if (a === primaryArtist(list[i - 1])) continue;
        if (i + 1 < list.length && a === primaryArtist(list[i + 1])) continue;
        const moved = primaryArtist(list[i]);
        if (j > 0 && primaryArtist(list[j - 1]) === moved) continue;
        if (j + 1 < list.length && primaryArtist(list[j + 1]) === moved) continue;
        [list[i], list[j]] = [list[j], list[i]];
        break;
      }
    }
    return list;
  }

  function markQueued(songs) {
    (Array.isArray(songs) ? songs : [songs]).forEach(s => { if (s && s.id) played.add(String(s.id)); });
    persistPlayed();
  }

  function reset() { played.clear(); persistPlayed(); artistCache.clear(); playlistCache.clear(); albumCache.clear(); }

  return { build, markQueued, reset, languageOf, artistsOf, isLegit, titleKey, _played: played };
})();

if (typeof window !== 'undefined') {
  window.Station = Station;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Station;
}

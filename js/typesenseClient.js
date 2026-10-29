// ==========================================================================
// MUSICFLOW — TYPESENSE SEARCH CLIENT & MULTI-SEARCH ENGINE (HARDENED)
// ==========================================================================

const TypesenseClient = (() => {

  const Config = {
    host: (typeof window !== 'undefined' && window.TYPESENSE_HOST) || 'localhost',
    port: (typeof window !== 'undefined' && window.TYPESENSE_PORT) || 8108,
    protocol: (typeof window !== 'undefined' && window.TYPESENSE_PROTOCOL) || 'http',
    searchKey: (typeof window !== 'undefined' && window.TYPESENSE_SEARCH_KEY) || 'mf_search_dev_key',
    timeoutMs: 2000
  };

  // Dynamically load search-only credentials from trusted server if running in browser
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const configUrl = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.buildUrl === 'function')
      ? ApiConfig.buildUrl('/api/typesense/config')
      : '/api/typesense/config';
    fetch(configUrl)
      .then(res => res.json())
      .then(cfg => {
        if (cfg) {
          if (cfg.host) Config.host = cfg.host;
          if (cfg.port) Config.port = cfg.port;
          if (cfg.protocol) Config.protocol = cfg.protocol;
          if (cfg.searchKey) Config.searchKey = cfg.searchKey;
        }
      })
      .catch(() => {});
  }

  let isServerHealthy = null;
  let lastHealthCheck = 0;

  function getBaseUrl() {
    return `${Config.protocol}://${Config.host}:${Config.port}`;
  }

  async function checkHealth() {
    const now = Date.now();
    if (isServerHealthy !== null && (now - lastHealthCheck) < 30000) {
      return isServerHealthy;
    }

    // In production mobile app or remote host without custom Typesense endpoint, disable direct localhost health check
    const isMobileOrProd = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.isProduction === 'function' && ApiConfig.isProduction());
    const isLocalHostConfig = (Config.host === 'localhost' || Config.host === '127.0.0.1');

    if (isMobileOrProd && isLocalHostConfig) {
      isServerHealthy = false;
      lastHealthCheck = now;
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${getBaseUrl()}/health`, {
        signal: controller.signal,
        headers: { 'X-TYPESENSE-API-KEY': Config.searchKey }
      });
      clearTimeout(timeout);
      isServerHealthy = res.ok;
    } catch (_) {
      isServerHealthy = false;
    }
    lastHealthCheck = now;
    return isServerHealthy;
  }

  // Request trusted backend to initialize collections using server-side admin key
  async function initCollections() {
    try {
      const initUrl = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.buildUrl === 'function')
        ? ApiConfig.buildUrl('/api/typesense/init-collections')
        : '/api/typesense/init-collections';
      const res = await fetch(initUrl, { method: 'POST' });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  function formatSongFromDoc(doc) {
    if (!doc) return null;
    return {
      id: String(doc.id),
      name: doc.title,
      artists: doc.artist,
      primaryArtist: doc.primary_artist || (doc.artist || '').split(',')[0].trim(),
      album: doc.album || '',
      year: String(doc.year || '2024'),
      duration: doc.duration || 200,
      image: doc.cover_art || 'assets/logo.png',
      audioUrl: doc.audio_url || doc.stream_url || '',
      streamUrl: doc.stream_url || doc.audio_url || '',
      hasLyrics: Boolean(doc.has_lyrics),
      language: doc.language || 'hindi',
      provider: doc.provider || 'Typesense'
    };
  }

  async function searchAll(rawQuery) {
    if (!rawQuery || !rawQuery.trim()) return null;
    const healthy = await checkHealth();
    if (!healthy) {
      return null; // Signals fallback to local/upstream API
    }

    const cleanQ = rawQuery.trim();

    const multiSearchBody = {
      searches: [
        {
          collection: 'songs',
          q: cleanQ,
          query_by: 'title,primary_artist,artist,album,normalized_title,normalized_artist,normalized_album',
          query_by_weights: '12,10,8,6,10,8,5',
          sort_by: '_text_match:desc,popularity:desc',
          num_typos: '2',
          typo_tokens_threshold: 1,
          drop_tokens_threshold: 1,
          prioritize_exact_match: true,
          prefix: true,
          infix: 'always',
          per_page: 30
        },
        {
          collection: 'artists',
          q: cleanQ,
          query_by: 'name,normalized_name',
          query_by_weights: '12,8',
          sort_by: '_text_match:desc,popularity:desc',
          num_typos: '2',
          prioritize_exact_match: true,
          prefix: true,
          per_page: 10
        },
        {
          collection: 'albums',
          q: cleanQ,
          query_by: 'title,artist',
          query_by_weights: '12,8',
          sort_by: '_text_match:desc,popularity:desc',
          num_typos: '2',
          prioritize_exact_match: true,
          prefix: true,
          per_page: 10
        }
      ]
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Config.timeoutMs);

      const res = await fetch(`${getBaseUrl()}/multi_search`, {
        method: 'POST',
        headers: {
          'X-TYPESENSE-API-KEY': Config.searchKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(multiSearchBody),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const data = await res.json();
      const results = data.results || [];

      const songHits = (results[0]?.hits || []).map(h => formatSongFromDoc(h.document));
      const artistHits = (results[1]?.hits || []).map(h => ({
        id: h.document.id,
        name: h.document.name,
        title: h.document.name,
        image: h.document.image || 'assets/logo.png',
        role: h.document.role || 'Singer'
      }));
      const albumHits = (results[2]?.hits || []).map(h => ({
        id: h.document.id,
        title: h.document.title,
        name: h.document.title,
        artist: h.document.artist,
        image: h.document.image || 'assets/logo.png',
        year: h.document.year || 2024
      }));

      return {
        query: rawQuery,
        candidateSongs: songHits,
        candidateArtists: artistHits,
        candidateAlbums: albumHits,
        provider: 'typesense'
      };
    } catch (e) {
      console.warn('[Typesense] Search error, using fallback:', e.message);
      return null;
    }
  }

  // Global Autocomplete from Typesense Index
  async function getAutocompleteSuggestions(prefix) {
    if (!prefix || prefix.trim().length < 2) return [];
    const healthy = await checkHealth();
    if (!healthy) return [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);

      const multiSearchBody = {
        searches: [
          {
            collection: 'songs',
            q: prefix.trim(),
            query_by: 'title,artist,primary_artist',
            query_by_weights: '10,7,7',
            prioritize_exact_match: true,
            prefix: true,
            per_page: 4
          },
          {
            collection: 'artists',
            q: prefix.trim(),
            query_by: 'name',
            prefix: true,
            per_page: 3
          }
        ]
      };

      const res = await fetch(`${getBaseUrl()}/multi_search`, {
        method: 'POST',
        headers: {
          'X-TYPESENSE-API-KEY': Config.searchKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(multiSearchBody),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) return [];
      const data = await res.json();
      const songHits = data.results?.[0]?.hits || [];
      const artistHits = data.results?.[1]?.hits || [];

      const suggestions = [];
      artistHits.forEach(h => {
        if (h.document?.name) {
          suggestions.push({
            type: 'artist',
            text: h.document.name,
            subtitle: 'Artist',
            icon: 'person'
          });
        }
      });

      songHits.forEach(h => {
        if (h.document?.title) {
          suggestions.push({
            type: 'song',
            text: h.document.title,
            subtitle: h.document.artist || '',
            icon: 'music_note'
          });
        }
      });

      return suggestions;
    } catch (_) {
      return [];
    }
  }

  // Real-time catalog auto-sync via trusted backend service (Client never holds admin key)
  async function syncTrack(song) {
    if (!song || !song.id) return;

    try {
      const songTitle = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getTrackTitle(song) : (song.name || song.title || '');
      const songArtists = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getArtistName(song) : (song.artists || song.primaryArtist || 'Unknown Artist');
      const primaryArtist = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getPrimaryArtist(song) : (song.primaryArtist || songArtists.split(',')[0].trim());
      const songAlbum = (typeof DataNormalizer !== 'undefined') ? DataNormalizer.getAlbumName(song.album || song) : (song.album || '');

      const doc = {
        id: String(song.id),
        title: songTitle,
        artist: songArtists,
        primary_artist: primaryArtist,
        album: songAlbum,
        year: parseInt(song.year || '2024', 10) || 2024,
        duration: parseInt(song.duration || '200', 10) || 200,
        popularity: song.hasLyrics ? 95 : 80,
        cover_art: song.image || '',
        audio_url: song.audioUrl || song.streamUrl || '',
        stream_url: song.streamUrl || song.audioUrl || '',
        has_lyrics: Boolean(song.hasLyrics),
        language: song.language || 'hindi',
        provider: song.provider || 'JioSaavn',
        normalized_title: (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(songTitle) : songTitle.toLowerCase(),
        normalized_artist: (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(songArtists) : songArtists.toLowerCase(),
        normalized_album: (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(songAlbum) : songAlbum.toLowerCase()
      };

      const syncUrl = (typeof ApiConfig !== 'undefined' && typeof ApiConfig.buildUrl === 'function')
        ? ApiConfig.buildUrl('/api/typesense/sync-track')
        : '/api/typesense/sync-track';
      fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc })
      }).catch(() => {});
    } catch (_) {}
  }

  return {
    Config,
    checkHealth,
    initCollections,
    searchAll,
    getAutocompleteSuggestions,
    syncTrack
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TypesenseClient;
}

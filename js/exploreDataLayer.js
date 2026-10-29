// ============================================================================
// MUSICFLOW — EXPLORE DATA LAYER & DISCOVERY AGGREGATOR (Phase 7)
// Aggregates Genres, Languages, Charts, New Releases, Discover Artists,
// Genre Details & Radios with Stale-While-Revalidate Caching.
// ============================================================================

const ExploreDataLayer = (() => {

  const CACHE_KEY = 'mf_explore_feed_cache_v1';
  const CACHE_TTL_MS = 300000; // 5 minutes

  // Curated Catalog Genres with Visual Themes
  const FEATURED_GENRES = [
    { id: 'bollywood', name: 'Bollywood', query: 'Bollywood Top Hits', gradient: 'linear-gradient(135deg, #8a2387 0%, #e94057 50%, #f27121 100%)', icon: 'local_fire_department' },
    { id: 'pop', name: 'Pop', query: 'Global Pop Hits', gradient: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)', icon: 'music_note' },
    { id: 'hiphop', name: 'Hip-Hop & Rap', query: 'Hip Hop Rap Hits', gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)', icon: 'headphones' },
    { id: 'lofi', name: 'Lo-Fi & Chill', query: 'Lo-Fi Chill Beats', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', icon: 'spa' },
    { id: 'rock', name: 'Rock & Metal', query: 'Rock Classics', gradient: 'linear-gradient(135deg, #2b5876 0%, #4e4376 100%)', icon: 'album' },
    { id: 'punjabi', name: 'Punjabi Hits', query: 'Punjabi Top Hits', gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', icon: 'bolt' },
    { id: 'romantic', name: 'Romantic', query: 'Romantic Hits', gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)', icon: 'favorite' },
    { id: 'dance', name: 'Dance / EDM', query: 'Electronic Dance EDM', gradient: 'linear-gradient(135deg, #00b4db 0%, #0083b0 100%)', icon: 'equalizer' },
    { id: 'classical', name: 'Classical & Devotional', query: 'Classical Melodies', gradient: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)', icon: 'self_improvement' },
    { id: 'new releases', name: 'New Releases', query: 'Latest Hit Songs 2025 Trending', gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', icon: 'new_releases' },
    { id: 'top charts', name: 'Top Charts', query: 'Top 50 Trending Hit Songs', gradient: 'linear-gradient(135deg, #f857a6 0%, #ff5858 100%)', icon: 'trending_up' },
    { id: 'moods & moments', name: 'Moods & Moments', query: 'Feel Good Chill Pop Melodies', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', icon: 'mood' },
    { id: 'top playlists', name: 'Top Playlists', query: 'Superhit Playlists Best Songs', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', icon: 'queue_music' }
  ];

  // Ambient Soundscapes
  const AMBIENT_SOUNDSCAPES = [
    { id: 'ocean', name: 'Ocean Waves', sub: 'Coastal tide', icon: 'waves', color: '#74b9ff' },
    { id: 'rain', name: 'Gentle Rain', sub: 'Soft rain drops', icon: 'rainy', color: '#74b9ff' },
    { id: 'forest', name: 'Forest Wind', sub: 'Mountain breeze', icon: 'forest', color: '#a8e6cf' },
    { id: 'campfire', name: 'Campfire', sub: 'Warm crackles', icon: 'local_fire_department', color: '#ff7675' }
  ];

  // 1. Fetch Explore Feed Aggregation
  async function aggregateExploreFeed() {
    const APIClient = (typeof API !== 'undefined') ? API : (typeof require !== 'undefined' ? require('./api.js') : null);
    const StorageClient = (typeof Storage !== 'undefined') ? Storage : (typeof require !== 'undefined' ? require('./storage.js') : null);

    let catalogFeed = null;
    try {
      const langs = StorageClient ? StorageClient.getLanguages() : ['hindi', 'english'];
      catalogFeed = await APIClient.getHomeFeed(langs);
    } catch (e) {
      console.warn('[ExploreDataLayer] Catalog feed warning:', e);
    }

    const charts = catalogFeed?.charts || [];
    const albums = catalogFeed?.albums || [];
    const trendingSongs = (catalogFeed?.trending?.songs || catalogFeed?.quickPicks || []).map(APIClient?.normalizeSong || (s => s));

    return {
      genres: FEATURED_GENRES,
      soundscapes: AMBIENT_SOUNDSCAPES,
      charts: charts.slice(0, 10),
      albums: albums.slice(0, 10),
      trendingSongs: trendingSongs.slice(0, 12),
      generatedAt: Date.now()
    };
  }

  // 2. Fetch Genre Details for Dedicated Genre Deep Dive Screen
  async function getGenreDetails(genreIdOrName) {
    const APIClient = (typeof API !== 'undefined') ? API : (typeof require !== 'undefined' ? require('./api.js') : null);
    const normalizedKey = String(genreIdOrName || '').toLowerCase().trim();
    const matchedGenre = FEATURED_GENRES.find(g => g.id === normalizedKey || g.name.toLowerCase() === normalizedKey);
    const query = matchedGenre ? matchedGenre.query : `${genreIdOrName} Top Hits`;
    const title = matchedGenre ? matchedGenre.name : genreIdOrName;
    const gradient = matchedGenre ? matchedGenre.gradient : 'linear-gradient(135deg, #1E1E22 0%, #2A2A30 100%)';

    try {
      let songs = await APIClient.searchSongs(query, 1, 30);
      let normalizedSongs = (songs || []).map(APIClient.normalizeSong);

      // Filter out any songs whose literal title matches the genre/category query (e.g. tracks literally named "New Releases")
      normalizedSongs = normalizedSongs.filter(s => {
        const lowerName = String(s.name || s.title || '').toLowerCase().trim();
        return lowerName !== normalizedKey && lowerName !== 'new releases' && lowerName !== 'top charts' && lowerName !== 'moods & moments';
      });

      // If New Releases had filtered results or fewer than 10 songs, enrich with trending tracks
      if (normalizedKey.includes('new release') && normalizedSongs.length < 15) {
        try {
          const StorageClient = (typeof Storage !== 'undefined') ? Storage : null;
          const langs = StorageClient ? StorageClient.getLanguages() : ['hindi'];
          const homeFeed = await APIClient.getHomeFeed(langs);
          const fresh = (homeFeed?.trending?.songs || homeFeed?.quickPicks || []).map(APIClient.normalizeSong);
          const seenIds = new Set(normalizedSongs.map(s => String(s.id)));
          for (const item of fresh) {
            if (item && item.id && !seenIds.has(String(item.id))) {
              seenIds.add(String(item.id));
              normalizedSongs.push(item);
            }
          }
        } catch (_) {}
      }

      return {
        id: genreIdOrName,
        title,
        gradient,
        icon: matchedGenre?.icon || 'music_note',
        songs: normalizedSongs.slice(0, 25),
        topArtists: extractTopArtists(normalizedSongs)
      };
    } catch (e) {
      console.warn('[ExploreDataLayer] Genre details error:', e);
      return { id: genreIdOrName, title, gradient, songs: [], topArtists: [] };
    }
  }

  function extractTopArtists(songs) {
    const map = new Map();
    for (const s of songs) {
      const art = (s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim();
      if (!art || art.toLowerCase() === 'various artists') continue;
      if (!map.has(art)) {
        map.set(art, { name: art, image: s.image || 'assets/logo.png', count: 1 });
      } else {
        map.get(art).count++;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }

  // 3. Stale-While-Revalidate Explore Loader
  async function loadExplore(onDataReady) {
    let cached = null;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          cached = JSON.parse(raw);
          if (cached && (Date.now() - cached.generatedAt < CACHE_TTL_MS)) {
            onDataReady(cached, true);
          }
        }
      } catch (_) {}
    }

    try {
      const freshData = await aggregateExploreFeed();
      if (freshData) {
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(freshData));
          } catch (_) {}
        }
        onDataReady(freshData, false);
      }
    } catch (e) {
      console.warn('[ExploreDataLayer] Fresh load error:', e);
      if (!cached) {
        onDataReady({ genres: FEATURED_GENRES, soundscapes: AMBIENT_SOUNDSCAPES, charts: [], albums: [], trendingSongs: [] }, false);
      }
    }
  }

  return {
    FEATURED_GENRES,
    AMBIENT_SOUNDSCAPES,
    aggregateExploreFeed,
    getGenreDetails,
    loadExplore
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExploreDataLayer;
}

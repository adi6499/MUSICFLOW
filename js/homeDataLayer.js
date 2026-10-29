// ============================================================================
// MUSICFLOW — HOME DATA LAYER & AGGREGATOR (Phase 8)
// Personalization Lifecycle, Continue Listening Progress, Dynamic Section
// Assembly, Stale-While-Revalidate Caching, Song-First Quick Picks (12-20 tracks),
// Personalized Daily Mixes, and Cross-Section Deduplication.
// ============================================================================

const HomeDataLayer = (() => {

  const CACHE_KEY = 'mf_home_feed_cache_v2';
  const CACHE_TTL_MS = 180000; // 3 minutes

  // Section Availability State
  const SECTION_STATE = {
    AVAILABLE: 'AVAILABLE',
    EMPTY: 'EMPTY',
    LOADING: 'LOADING',
    ERROR: 'ERROR',
    UNAVAILABLE: 'UNAVAILABLE'
  };

  // User Profile Maturity State
  const PROFILE_STATE = {
    NEW_USER: 'NEW_USER',
    DEVELOPING: 'DEVELOPING',
    ESTABLISHED: 'ESTABLISHED'
  };

  function getProfileState(history = [], favorites = [], signals = {}) {
    const totalEngagements = history.length + favorites.length + (signals.totalSignals || 0);
    if (totalEngagements === 0) return PROFILE_STATE.NEW_USER;
    if (totalEngagements < 5) return PROFILE_STATE.DEVELOPING;
    return PROFILE_STATE.ESTABLISHED;
  }

  // Cross-Section Deduplicator: Prevents duplicate songs across shelves
  function applyCrossSectionDeduplication(sections) {
    const seenSongIds = new Set();

    return sections.map(section => {
      if (!section.items || !Array.isArray(section.items)) return section;

      // Allow Continue Listening to retain its tracks
      if (section.id === 'continue_listening') {
        section.items.forEach(s => s && s.id && seenSongIds.add(String(s.id)));
        return section;
      }

      const deduplicatedItems = [];
      for (const item of section.items) {
        const id = String(item.id || item.song?.id || '');
        if (id && !seenSongIds.has(id)) {
          deduplicatedItems.push(item);
          seenSongIds.add(id);
        }
      }

      return {
        ...section,
        items: deduplicatedItems.length > 0 ? deduplicatedItems : section.items.slice(0, 4)
      };
    });
  }

  // 1. CONTINUE LISTENING BUILDER
  function buildContinueListening(history = [], milestones = {}) {
    if (!history || history.length === 0) return [];

    const items = [];
    const seen = new Set();

    for (const song of history) {
      if (!song || !song.id || seen.has(song.id)) continue;
      seen.add(song.id);

      const milestone = milestones[song.id] || null;
      let progressPercent = 0;
      let isInterrupted = false;

      if (milestone && milestone.lastPercentage) {
        progressPercent = Math.min(95, Math.max(5, Math.round(milestone.lastPercentage)));
        // Resumable if between 10% and 85%
        isInterrupted = progressPercent >= 10 && progressPercent <= 85;
      } else {
        // Recent play fallback progress
        progressPercent = 45;
        isInterrupted = true;
      }

      items.push({
        ...song,
        playbackProgress: progressPercent,
        isResumable: isInterrupted,
        reason: isInterrupted ? `Resume from ${progressPercent}%` : 'Recently played'
      });

      if (items.length >= 8) break;
    }

    return items;
  }

  // 2. DISCOVER SOMETHING NEW BUILDER (High novelty, low repetition)
  function buildDiscoverNew(candidatePool = [], history = [], favorites = []) {
    if (!candidatePool || candidatePool.length === 0) return [];
    const knownIds = new Set([...history, ...favorites].map(s => String(s.id)));
    const TD = (typeof TrackDeduplicator !== 'undefined') ? TrackDeduplicator : { cleanArtistName: (a) => a, deduplicate: (arr) => arr };

    const unplayedCandidates = candidatePool.filter(c => !knownIds.has(String(c.id)));
    const pool = unplayedCandidates.length > 0 ? unplayedCandidates : candidatePool;

    const sortedByNovelty = [...pool].sort((a, b) => (b.popularity || 60) - (a.popularity || 60));
    const dedup = TD.deduplicate(sortedByNovelty);

    const results = [];
    const artistCount = {};
    for (const song of dedup) {
      const art = TD.cleanArtistName(song.artists || song.primaryArtist);
      if ((artistCount[art] || 0) < 2) {
        results.push({
          ...song,
          reason: 'Discover something new',
          isDiscovery: true
        });
        artistCount[art] = (artistCount[art] || 0) + 1;
      }
      if (results.length >= 10) break;
    }

    return results;
  }

  // 3. OFFLINE HOME BUILDER
  async function buildOfflineHome() {
    let localSongs = [];
    let downloads = [];
    let history = [];
    let favorites = [];

    const StorageClient = (typeof Storage !== 'undefined') ? Storage : (typeof require !== 'undefined' ? require('./storage.js') : null);

    if (StorageClient) {
      history = (typeof StorageClient.getHistory === 'function') ? (StorageClient.getHistory() || []) : [];
      favorites = (typeof StorageClient.getFavorites === 'function') ? (StorageClient.getFavorites() || []) : [];
      localSongs = (typeof StorageClient.getLocalSongs === 'function') ? (StorageClient.getLocalSongs() || []) : [];
      downloads = (typeof StorageClient.getDownloads === 'function') ? (StorageClient.getDownloads() || []) : [];
    }

    const sections = [];

    // Continue / Recent
    if (history.length > 0) {
      sections.push({
        id: 'continue_listening',
        title: 'Continue Listening',
        tag: 'OFFLINE CACHE',
        type: 'horizontal_cards',
        items: history.slice(0, 8)
      });
    }

    // Downloaded Music
    if (downloads.length > 0) {
      sections.push({
        id: 'offline_downloads',
        title: 'Downloaded Songs',
        tag: 'OFFLINE READY',
        type: 'horizontal_cards',
        items: downloads.slice(0, 12)
      });
    }

    // Local Music
    if (localSongs.length > 0) {
      sections.push({
        id: 'offline_local',
        title: 'Device Music',
        tag: 'LOCAL FILES',
        type: 'horizontal_cards',
        items: localSongs.slice(0, 12)
      });
    }

    // Liked Songs
    if (favorites.length > 0) {
      sections.push({
        id: 'offline_favorites',
        title: 'Your Liked Songs',
        tag: 'SAVED',
        type: 'horizontal_cards',
        items: favorites.slice(0, 12)
      });
    }

    return {
      isOffline: true,
      profileState: PROFILE_STATE.DEVELOPING,
      sections
    };
  }

  // 4. MAIN HOME AGGREGATION PIPELINE
  async function aggregateHomeFeed(options = {}) {
    // Check if network is offline
    if (typeof OfflineManager !== 'undefined' && OfflineManager.isOffline()) {
      return buildOfflineHome();
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return buildOfflineHome();
    }

    const APIClient = (typeof API !== 'undefined') ? API : (typeof require !== 'undefined' ? require('./api.js') : null);
    const StorageClient = (typeof Storage !== 'undefined') ? Storage : (typeof require !== 'undefined' ? require('./storage.js') : null);
    const RecEngine = (typeof RecommendationEngine !== 'undefined') ? RecommendationEngine : (typeof require !== 'undefined' ? require('./recommendationEngine.js') : null);

    const history = StorageClient ? (StorageClient.getHistory() || []) : [];
    const favorites = StorageClient ? (StorageClient.getFavorites() || []) : [];
    const userSignals = StorageClient ? (StorageClient.getUserTasteSignals() || {}) : {};
    const milestones = userSignals.milestones || {};
    const profileState = getProfileState(history, favorites, userSignals);
    const activeMood = options.mood || 'all';
    const langs = (StorageClient && typeof StorageClient.getLanguages === 'function') ? (StorageClient.getLanguages() || []) : (options.selectedLanguages || ['hindi', 'english']);

    // Fetch Base Catalog Feed
    let catalogFeed = null;
    try {
      catalogFeed = await APIClient.getHomeFeed(langs);
    } catch (err) {
      console.warn('[HomeDataLayer] Base catalog feed fetch warning:', err);
    }

    const rawQuickPicks = (catalogFeed?.quickPicks || []).map(APIClient?.normalizeSong || (s => s));
    const trendingSongs = (catalogFeed?.trending?.songs || []).map(APIClient?.normalizeSong || (s => s));
    const charts = catalogFeed?.charts || [];
    const albums = catalogFeed?.albums || [];

    const candidatePool = [...rawQuickPicks, ...trendingSongs];
    const sections = [];

    // SECTION 1: Continue Listening (For Developing and Established users)
    if (profileState !== PROFILE_STATE.NEW_USER && history.length > 0) {
      const continueItems = buildContinueListening(history, milestones);
      if (continueItems.length > 0) {
        sections.push({
          id: 'continue_listening',
          title: 'Continue Listening',
          tag: 'RESUME',
          type: 'continue_cards',
          items: continueItems
        });
      }
    }

    // SECTION 2: Quick Picks (12-20 Song-First Quality Tracks, 0% Playlist Contamination)
    let quickPicksItems = [];
    if (RecEngine && candidatePool.length > 0) {
      quickPicksItems = RecEngine.buildQuickPicks(history, favorites, candidatePool, activeMood, 16, { selectedLanguages: langs });
    } else {
      quickPicksItems = rawQuickPicks.length > 0 ? rawQuickPicks.slice(0, 16) : trendingSongs.slice(0, 16);
    }

    if (quickPicksItems.length > 0) {
      sections.push({
        id: 'quick_picks',
        title: 'Quick picks',
        tag: 'START RADIO FROM A SONG',
        type: 'quick_picks_carousel',
        items: quickPicksItems
      });
    }

    // SECTION 3: Made For You (Personalized Hybrid Ranker)
    if (profileState === PROFILE_STATE.ESTABLISHED && RecEngine && candidatePool.length > 0) {
      const personalized = RecEngine.getPersonalizedRecommendations(history, favorites, candidatePool, { limit: 12, mood: activeMood, selectedLanguages: langs });
      if (personalized.length > 0) {
        sections.push({
          id: 'made_for_you',
          title: 'Made For You',
          tag: 'PERSONALIZED MIX',
          type: 'horizontal_cards',
          items: personalized.map(p => ({ ...p.song, reason: p.reason }))
        });
      }
    }

    // SECTION 4: Because You Listened To [Seed Artist / Song]
    const seedTrack = history[0] || favorites[0] || null;
    if (seedTrack && RecEngine && candidatePool.length > 0) {
      const seedArtist = (typeof DataNormalizer !== 'undefined')
        ? DataNormalizer.getPrimaryArtist(seedTrack)
        : (seedTrack.primaryArtist || seedTrack.artists || 'Artist');
      const similarTracks = RecEngine.getSimilarTracks(seedTrack, candidatePool, 10);
      if (similarTracks.length > 0) {
        sections.push({
          id: 'because_you_listened',
          title: `Because you listened to ${seedArtist || seedTrack.name || 'this track'}`,
          tag: 'SIMILAR STYLE',
          type: 'horizontal_cards',
          seedTrack: seedTrack,
          items: similarTracks.map(s => ({ ...s.song, reason: s.reason }))
        });
      }
    }

    // SECTION 5: Your Favorite Artists (From My Music / History)
    const followedArtists = (StorageClient && typeof StorageClient.getArtists === 'function')
      ? StorageClient.getArtists()
      : [];
    if (followedArtists.length > 0) {
      sections.push({
        id: 'favorite_artists',
        title: 'Your Favorite Artists',
        tag: 'DISCOGRAPHY',
        type: 'artist_circles',
        items: followedArtists.slice(0, 10)
      });
    }

    // SECTION 6: Discover Something New
    if (candidatePool.length > 0) {
      const discoverItems = buildDiscoverNew(candidatePool, history, favorites);
      if (discoverItems.length > 0) {
        sections.push({
          id: 'discover_new',
          title: 'Discover Something New',
          tag: 'FRESH PICKS',
          type: 'horizontal_cards',
          items: discoverItems
        });
      }
    }

    // SECTION 7: New Releases
    if (trendingSongs.length > 0) {
      sections.push({
        id: 'new_releases',
        title: 'New Releases',
        tag: 'FRESH MUSIC',
        type: 'vertical_list',
        items: trendingSongs.slice(0, 30)
      });
    }

    // SECTION 8: Trending Charts & Playlists
    if (charts.length > 0) {
      sections.push({
        id: 'trending_charts',
        title: 'Trending Charts & Playlists',
        tag: 'TOP CHARTS',
        type: 'chart_cards',
        items: charts.slice(0, 8)
      });
    }

    // SECTION 9: Top Albums
    let topAlbums = Array.isArray(albums) ? [...albums] : [];
    if (topAlbums.length === 0 && candidatePool.length > 0) {
      const seen = new Set();
      for (const s of candidatePool) {
        const aName = s.album?.name || s.album || s.name;
        if (aName && typeof aName === 'string' && !seen.has(aName.toLowerCase())) {
          seen.add(aName.toLowerCase());
          topAlbums.push({
            id: s.album?.id || `alb_${s.id}`,
            name: aName,
            title: aName,
            type: 'album',
            artists: s.artists || s.primaryArtist || 'MusicFlow',
            artist: s.artists || s.primaryArtist || 'MusicFlow',
            image: s.image || 'assets/logo.png',
            year: s.year || ''
          });
          if (topAlbums.length >= 8) break;
        }
      }
    }

    if (topAlbums.length > 0) {
      sections.push({
        id: 'top_albums',
        title: 'Top Albums & EPs',
        tag: 'DISCOGRAPHY',
        type: 'album_cards',
        items: topAlbums.slice(0, 8)
      });
    }

    // Apply Cross-Section Deduplication
    const finalSections = applyCrossSectionDeduplication(sections);

    return {
      isOffline: false,
      profileState,
      generatedAt: Date.now(),
      sections: finalSections
    };
  }

  // Stale-While-Revalidate Caching Pipeline
  async function loadHome(onDataReady, options = {}) {
    let hasRenderedCache = false;
    let cached = null;

    // 1. Immediately return cached data synchronously if available
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          cached = JSON.parse(raw);
          if (cached && cached.sections && Array.isArray(cached.sections) && cached.sections.length > 0) {
            onDataReady(cached, true); // true = from cache
            hasRenderedCache = true;
          }
        }
      } catch (_) {}
    }

    // 2. If no cache exists, immediately render local offline state so UI is never blank
    if (!hasRenderedCache) {
      try {
        const localOffline = await buildOfflineHome();
        if (localOffline && localOffline.sections && localOffline.sections.length > 0) {
          onDataReady(localOffline, true);
        }
      } catch (_) {}
    }

    // 3. Fetch fresh data in the background and update UI
    try {
      const freshData = await aggregateHomeFeed(options);
      if (freshData && freshData.sections && freshData.sections.length > 0) {
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(freshData));
          } catch (_) {}
        }
        onDataReady(freshData, false); // false = fresh
      }
    } catch (e) {
      console.warn('[HomeDataLayer] Fresh home load error:', e);
      if (!hasRenderedCache) {
        const offlineFallback = await buildOfflineHome();
        onDataReady(offlineFallback, false);
      }
    }
  }

  return {
    SECTION_STATE,
    PROFILE_STATE,
    getProfileState,
    buildContinueListening,
    buildDiscoverNew,
    buildOfflineHome,
    aggregateHomeFeed,
    loadHome
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HomeDataLayer;
}

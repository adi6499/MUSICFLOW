// ==========================================================================
// MUSICFLOW — OFFLINE MANAGER 2.0 (Phase 9.2)
// Authoritative network state detection, local-first search & library indexing,
// non-blocking offline mode, event outbox sync, and network recovery pipeline.
// ==========================================================================

const OfflineManager = (() => {
  const NETWORK_STATE = {
    ONLINE: 'ONLINE',
    OFFLINE: 'OFFLINE',
    UNKNOWN: 'UNKNOWN'
  };

  const OUTBOX_KEY = 'mf_offline_outbox';
  let currentState = (typeof navigator !== 'undefined' && navigator.onLine === false)
    ? NETWORK_STATE.OFFLINE
    : NETWORK_STATE.ONLINE;

  let debounceTimer = null;
  let isFlushingOutbox = false;

  // Event Listeners
  const listeners = {
    networkChange: [],
    outboxFlushed: []
  };

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.warn(`[OfflineManager] event ${event} error:`, e); }
      });
    }
  }

  // --- INITIALIZATION & NETWORK EVENT BINDING ---
  function init() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => _handleNetworkTransition(true));
      window.addEventListener('offline', () => _handleNetworkTransition(false));
    }
    _updateUIIndicator();
  }

  function _handleNetworkTransition(isOnline) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const newState = isOnline ? NETWORK_STATE.ONLINE : NETWORK_STATE.OFFLINE;
      if (currentState !== newState) {
        currentState = newState;
        console.log(`[OfflineManager] Network state changed: ${currentState}`);
        _updateUIIndicator();
        emit('networkChange', currentState);

        if (currentState === NETWORK_STATE.ONLINE) {
          await flushOutbox();
        }
      }
    }, 300);
  }

  function _updateUIIndicator() {
    if (typeof document === 'undefined') return;
    const indicator = document.getElementById('offline-pill-indicator');
    if (indicator) {
      if (currentState === NETWORK_STATE.OFFLINE) {
        indicator.style.display = 'inline-flex';
        indicator.setAttribute('aria-label', 'Application is in Offline Mode');
      } else {
        indicator.style.display = 'none';
      }
    }
  }

  function getNetworkState() {
    return currentState;
  }

  function isOnline() {
    return currentState === NETWORK_STATE.ONLINE;
  }

  function isOffline() {
    return currentState === NETWORK_STATE.OFFLINE;
  }

  function setSimulatedState(state) {
    if (state === NETWORK_STATE.ONLINE || state === NETWORK_STATE.OFFLINE) {
      currentState = state;
      _updateUIIndicator();
      emit('networkChange', currentState);
    }
  }

  // --- OFFLINE EVENT OUTBOX (Recommendation & Playback Signals) ---
  function recordOfflineEvent(eventType, payload = {}) {
    if (!eventType) return null;
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: eventType,
      payload,
      recordedAt: Date.now()
    };

    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(OUTBOX_KEY);
        const outbox = raw ? JSON.parse(raw) : [];
        outbox.push(event);
        if (outbox.length > 200) outbox.shift(); // Bound outbox at 200 events
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      }
    } catch (e) {
      console.warn('[OfflineManager] Outbox record error:', e);
    }

    return event;
  }

  function getOutbox() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(OUTBOX_KEY);
        return raw ? JSON.parse(raw) : [];
      }
    } catch (_) {}
    return [];
  }

  function clearOutbox() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(OUTBOX_KEY);
      }
    } catch (_) {}
  }

  async function flushOutbox() {
    if (isFlushingOutbox) return;
    const outbox = getOutbox();
    if (outbox.length === 0) return;

    isFlushingOutbox = true;
    console.log(`[OfflineManager] Flushing ${outbox.length} offline events to RecommendationEngine...`);

    let RecEngine = (typeof global !== 'undefined' && global.RecommendationEngine)
      ? global.RecommendationEngine
      : (typeof window !== 'undefined' && window.RecommendationEngine ? window.RecommendationEngine : (typeof RecommendationEngine !== 'undefined' ? RecommendationEngine : null));

    try {
      for (const evt of outbox) {
        if (RecEngine && typeof RecEngine.recordInteraction === 'function') {
          RecEngine.recordInteraction(evt.type, evt.payload);
        }
      }
      clearOutbox();
      emit('outboxFlushed', outbox.length);
    } catch (err) {
      console.warn('[OfflineManager] Outbox flush error:', err);
    } finally {
      isFlushingOutbox = false;
    }
  }

  // --- COMPREHENSIVE OFFLINE LIBRARY & SEARCH INDEX ---
  function getOfflineCatalog() {
    if (typeof Storage === 'undefined') return [];
    const downloads = Storage.getDownloads ? Storage.getDownloads() : [];
    const localSongs = Storage.getLocalSongs ? Storage.getLocalSongs() : [];
    const favorites = Storage.getFavorites ? Storage.getFavorites() : [];
    const history = Storage.getHistory ? Storage.getHistory() : [];

    const catalog = new Map();

    // 1. Downloaded tracks (Top Priority)
    downloads.forEach(s => {
      if (s && s.id) {
        catalog.set(String(s.id), {
          ...s,
          source: 'DOWNLOADED',
          isOfflinePlayable: true
        });
      }
    });

    // 2. Local Device Tracks (High Priority)
    localSongs.forEach(s => {
      if (s && s.id) {
        if (!catalog.has(String(s.id))) {
          catalog.set(String(s.id), {
            ...s,
            source: 'LOCAL',
            isOfflinePlayable: true
          });
        }
      }
    });

    // 3. Favorites / Liked Songs
    favorites.forEach(s => {
      if (s && s.id) {
        const existing = catalog.get(String(s.id));
        if (existing) {
          existing.isFavorite = true;
        } else {
          catalog.set(String(s.id), {
            ...s,
            source: 'ONLINE_ONLY',
            isOfflinePlayable: false,
            isFavorite: true
          });
        }
      }
    });

    // 4. History tracks
    history.forEach(s => {
      if (s && s.id && !catalog.has(String(s.id))) {
        catalog.set(String(s.id), {
          ...s,
          source: 'ONLINE_ONLY',
          isOfflinePlayable: false
        });
      }
    });

    return Array.from(catalog.values());
  }

  function searchOffline(query, limit = 50) {
    if (!query || !query.trim()) {
      return { songs: [], artists: [], albums: [], playlists: [] };
    }

    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const catalog = (typeof OfflineManager !== 'undefined' && OfflineManager.getOfflineCatalog)
      ? OfflineManager.getOfflineCatalog()
      : getOfflineCatalog();

    const matchedSongs = [];
    const artistMap = new Map();
    const albumMap = new Map();

    catalog.forEach(song => {
      const name = (song.name || '').toLowerCase();
      const artists = (song.artists || song.primaryArtist || '').toLowerCase();
      const album = (song.album || '').toLowerCase();
      const fullText = `${name} ${artists} ${album}`;

      let score = 0;
      if (name === q) score += 1000;
      else if (name.startsWith(q)) score += 500;
      else if (name.includes(q)) score += 250;

      if (artists === q) score += 400;
      else if (artists.includes(q)) score += 150;

      if (album === q) score += 300;
      else if (album.includes(q)) score += 100;

      // Compound token match (e.g. "weeknd after")
      if (tokens.length > 1 && tokens.every(t => fullText.includes(t))) {
        score += 350;
      }

      if (score > 0) {
        matchedSongs.push({ song, score });
      }

      // Group artists
      const firstArtist = (song.artists || song.primaryArtist || '').split(/[,&/]/)[0].trim();
      if (firstArtist && (firstArtist.toLowerCase().includes(q) || tokens.some(t => firstArtist.toLowerCase().includes(t)))) {
        const key = firstArtist.toLowerCase();
        if (!artistMap.has(key)) {
          artistMap.set(key, { id: `art_${key}`, name: firstArtist, image: song.image || 'assets/logo.png', role: 'Artist' });
        }
      }

      // Group albums
      if (song.album && (song.album.toLowerCase().includes(q) || tokens.some(t => song.album.toLowerCase().includes(t)))) {
        const key = song.album.toLowerCase();
        if (!albumMap.has(key)) {
          albumMap.set(key, { id: `alb_${key}`, name: song.album, artist: song.artists || '', image: song.image || 'assets/logo.png' });
        }
      }
    });

    matchedSongs.sort((a, b) => {
      if (a.song.isOfflinePlayable !== b.song.isOfflinePlayable) {
        return a.song.isOfflinePlayable ? -1 : 1;
      }
      return b.score - a.score;
    });

    const playlists = (typeof Storage !== 'undefined' && typeof Storage.getPlaylists === 'function')
      ? Storage.getPlaylists().filter(p => p.name.toLowerCase().includes(q) || tokens.some(t => p.name.toLowerCase().includes(t)))
      : [];

    return {
      songs: matchedSongs.slice(0, limit).map(m => m.song),
      artists: Array.from(artistMap.values()),
      albums: Array.from(albumMap.values()),
      playlists: playlists.slice(0, 5)
    };
  }

  function on(event, callback) {
    if (listeners[event]) listeners[event].push(callback);
  }

  function off(event, callback) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(cb => cb !== callback);
    }
  }

  return {
    NETWORK_STATE,
    init,
    getNetworkState,
    isOnline,
    isOffline,
    setSimulatedState,
    recordOfflineEvent,
    getOutbox,
    clearOutbox,
    flushOutbox,
    getOfflineCatalog,
    searchOffline,
    on,
    off
  };
})();

// Export for Web and Node testing
if (typeof window !== 'undefined') {
  window.OfflineManager = OfflineManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineManager;
}

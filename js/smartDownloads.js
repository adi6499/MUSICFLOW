// ==========================================================================
// MUSICFLOW — SMART DOWNLOADS & STORAGE MANAGEMENT (Phase 9.3)
// Storage-aware offline music intelligence, recommendation candidate flow,
// storage limits & breakdown, auto-cleanup policies, and Wi-Fi rules.
// ==========================================================================

const SmartDownloadManager = (() => {
  let isEvaluating = false;
  const rejectedCandidateIds = new Set();

  const listeners = {
    smartStateChanged: [],
    storageLimitReached: [],
    cleanupCompleted: []
  };

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.warn(`[SmartDownloadManager] event ${event} error:`, e); }
      });
    }
  }

  // --- INITIALIZATION ---
  function init() {
    if (typeof OfflineManager !== 'undefined') {
      OfflineManager.on('networkChange', (state) => {
        if (state === 'ONLINE') {
          evaluateAndEnqueueSmartDownloads();
        }
      });
    }

    if (typeof DownloadManager !== 'undefined') {
      DownloadManager.on('completed', () => {
        _checkStorageLimit();
      });
    }
  }

  // --- NETWORK & WIFI ELIGIBILITY ---
  function isNetworkEligible() {
    // 1. Check OfflineManager / navigator
    const isOnline = (typeof OfflineManager !== 'undefined')
      ? OfflineManager.isOnline()
      : (typeof navigator === 'undefined' || navigator.onLine !== false);

    if (!isOnline) return false;

    // 2. Check Wi-Fi Only constraint
    const isWifiOnly = (typeof Storage !== 'undefined') ? Storage.isDownloadWifiOnly() : true;
    if (!isWifiOnly) return true;

    // 3. Inspect Network Information API if available
    if (typeof navigator !== 'undefined' && navigator.connection) {
      const conn = navigator.connection;
      // If cellular or metered data is active, reject
      if (conn.type && conn.type !== 'wifi' && conn.type !== 'ethernet' && conn.type !== 'unknown') {
        return false;
      }
      if (conn.saveData) {
        return false;
      }
    }

    return true;
  }

  function canSmartDownload() {
    if (typeof Storage === 'undefined') return false;
    if (!Storage.isSmartDownloadsEnabled()) return false;
    if (!isNetworkEligible()) return false;

    const metrics = getStorageMetrics();
    if (metrics.isLimitReached) {
      emit('storageLimitReached', metrics);
      return false;
    }

    return true;
  }

  // --- STORAGE MEASUREMENT & BREAKDOWN ---
  function getStorageMetrics() {
    if (typeof Storage === 'undefined') {
      return { downloadedCount: 0, downloadedMb: 0, localCount: 0, localMb: 0, totalUsedMb: 0, limitMb: 2048, percentUsed: 0, isLimitReached: false };
    }

    const downloads = Storage.getDownloads();
    const localSongs = Storage.getLocalSongs();
    const limitMb = Storage.getDownloadStorageLimitMb();

    // Calculate actual downloaded MB (~8.5MB per track baseline or sum of track.size)
    let downloadedMb = 0;
    downloads.forEach(s => {
      const trackMb = s.size ? (s.size / (1024 * 1024)) : 8.5;
      downloadedMb += trackMb;
    });

    let localMb = 0;
    localSongs.forEach(s => {
      const trackMb = s.size ? (s.size / (1024 * 1024)) : 8.5;
      localMb += trackMb;
    });

    const totalUsedMb = parseFloat((downloadedMb + localMb).toFixed(1));
    const percentUsed = Math.min(100, Math.round((totalUsedMb / limitMb) * 100));
    const isLimitReached = totalUsedMb >= limitMb;

    return {
      downloadedCount: downloads.length,
      downloadedMb: parseFloat(downloadedMb.toFixed(1)),
      localCount: localSongs.length,
      localMb: parseFloat(localMb.toFixed(1)),
      totalUsedMb,
      limitMb,
      percentUsed,
      isLimitReached
    };
  }

  function _checkStorageLimit() {
    const metrics = getStorageMetrics();
    if (metrics.isLimitReached) {
      emit('storageLimitReached', metrics);
    }
  }

  // --- CANDIDATE GENERATION FROM REAL TASTE SIGNALS ---
  function generateSmartCandidates(limit = 25) {
    if (typeof Storage === 'undefined') return [];

    const candidates = [];
    const seenIds = new Set();

    // 1. Filter out existing items
    const downloads = Storage.getDownloads();
    downloads.forEach(s => seenIds.add(String(s.id)));

    const localSongs = Storage.getLocalSongs();
    localSongs.forEach(s => seenIds.add(String(s.id)));

    if (typeof DownloadManager !== 'undefined') {
      const tasks = DownloadManager.getTasks();
      tasks.forEach(t => seenIds.add(String(t.id)));
    }

    rejectedCandidateIds.forEach(id => seenIds.add(String(id)));

    // 2. Candidate Source A: Auto-download Liked Songs if enabled
    if (Storage.isAutoDownloadLikesEnabled()) {
      const favs = Storage.getFavorites();
      favs.forEach(s => {
        const id = String(s.id);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          candidates.push({
            ...s,
            reason: 'From your Liked Songs',
            smartScore: 100
          });
        }
      });
    }

    // 3. Candidate Source B: Frequently played & high milestone tracks
    const taste = Storage.getUserTasteSignals ? Storage.getUserTasteSignals() : {};
    const milestones = taste.milestones || {};
    const history = Storage.getHistory();

    history.forEach(s => {
      const id = String(s.id);
      if (!seenIds.has(id)) {
        const m = milestones[id];
        if (m && (m.plays >= 2 || m.completions >= 1)) {
          seenIds.add(id);
          candidates.push({
            ...s,
            reason: 'Downloaded because you play it often',
            smartScore: 80 + Math.min(20, m.plays * 2)
          });
        }
      }
    });

    // 4. Candidate Source C: High affinity recommendations from RecommendationEngine
    if (typeof RecommendationEngine !== 'undefined' && typeof RecommendationEngine.getPersonalizedRecommendations === 'function') {
      try {
        const recs = RecommendationEngine.getPersonalizedRecommendations([], 20);
        recs.forEach(s => {
          const id = String(s.id);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            candidates.push({
              ...s,
              reason: 'Recommended based on your taste',
              smartScore: 60
            });
          }
        });
      } catch (_) {}
    }

    candidates.sort((a, b) => b.smartScore - a.smartScore);
    return candidates.slice(0, limit);
  }

  // --- SMART DOWNLOAD EVALUATION & ENQUEUE ---
  function evaluateAndEnqueueSmartDownloads() {
    if (isEvaluating) return 0;
    if (!canSmartDownload()) return 0;

    isEvaluating = true;
    let enqueuedCount = 0;

    try {
      const maxTracks = Storage.getSmartDownloadsSettings().maxSmartTracks || 25;
      const candidates = generateSmartCandidates(maxTracks);

      if (candidates.length > 0 && typeof DownloadManager !== 'undefined') {
        const metrics = getStorageMetrics();
        let remainingMb = Math.max(0, metrics.limitMb - metrics.totalUsedMb);

        for (const track of candidates) {
          const estimatedMb = track.duration ? (track.duration * 0.04) : 8.5;
          if (remainingMb < estimatedMb) {
            console.log('[SmartDownloadManager] Storage limit reached during smart candidate evaluation');
            break;
          }

          DownloadManager.enqueue(track, {
            priority: 'smart',
            reason: track.reason || 'Smart Download'
          });

          remainingMb -= estimatedMb;
          enqueuedCount++;
        }
      }
    } catch (err) {
      console.warn('[SmartDownloadManager] Evaluation error:', err);
    } finally {
      isEvaluating = false;
    }

    return enqueuedCount;
  }

  // --- AUTOMATIC CLEANUP & CANDIDATE RANKING ---
  function getCleanupCandidates(targetMbToFree = 0) {
    if (typeof Storage === 'undefined') return [];

    const downloads = Storage.getDownloads();
    const favs = Storage.getFavorites();
    const playlists = Storage.getPlaylists();
    const favIds = new Set(favs.map(s => String(s.id)));
    const plSongIds = new Set();
    playlists.forEach(pl => (pl.songs || []).forEach(s => plSongIds.add(String(s.id))));

    // Candidates for removal: NOT protected, NOT liked, NOT in any playlist
    const removable = downloads.filter(s => {
      const id = String(s.id);
      if (Storage.isDownloadProtected(id)) return false;
      if (favIds.has(id)) return false;
      if (plSongIds.has(id)) return false;
      return true;
    });

    // Rank by least recently downloaded / oldest
    removable.sort((a, b) => (a.downloadedAt || 0) - (b.downloadedAt || 0));

    if (targetMbToFree <= 0) return removable;

    const selected = [];
    let freedMb = 0;
    for (const track of removable) {
      selected.push(track);
      freedMb += track.size ? (track.size / (1024 * 1024)) : 8.5;
      if (freedMb >= targetMbToFree) break;
    }

    return selected;
  }

  function previewCleanup(policy = 'least_played') {
    const downloads = (typeof Storage !== 'undefined') ? Storage.getDownloads() : [];
    let candidates = [];

    if (policy === 'older_30_days') {
      const threshold = Date.now() - (30 * 24 * 60 * 60 * 1000);
      candidates = downloads.filter(s => (s.downloadedAt || 0) < threshold && !Storage.isDownloadProtected(s.id));
    } else if (policy === 'older_90_days') {
      const threshold = Date.now() - (90 * 24 * 60 * 60 * 1000);
      candidates = downloads.filter(s => (s.downloadedAt || 0) < threshold && !Storage.isDownloadProtected(s.id));
    } else {
      candidates = getCleanupCandidates(0);
    }

    let willRemoveMb = 0;
    candidates.forEach(s => { willRemoveMb += s.size ? (s.size / (1024 * 1024)) : 8.5; });

    const willKeepCount = Math.max(0, downloads.length - candidates.length);
    let totalDlMb = 0;
    downloads.forEach(s => { totalDlMb += s.size ? (s.size / (1024 * 1024)) : 8.5; });
    const willKeepMb = Math.max(0, totalDlMb - willRemoveMb);

    return {
      candidatesToRemove: candidates,
      willRemoveCount: candidates.length,
      willRemoveMb: parseFloat(willRemoveMb.toFixed(1)),
      willKeepCount,
      willKeepMb: parseFloat(willKeepMb.toFixed(1))
    };
  }

  async function executeCleanup(candidates = null) {
    const toRemove = candidates || getCleanupCandidates(0);
    if (!toRemove || toRemove.length === 0) return 0;

    let removedCount = 0;
    for (const track of toRemove) {
      if (typeof Storage !== 'undefined') {
        Storage.removeDownload(track.id);
        removedCount++;
      }
    }

    emit('cleanupCompleted', removedCount);
    return removedCount;
  }

  // --- REJECTION & FEEDBACK ---
  function rejectCandidate(songId) {
    if (songId) {
      rejectedCandidateIds.add(String(songId));
    }
  }

  // --- REACTIVE HOOKS ---
  function handleLikeEvent(song) {
    if (!song || !song.id) return;
    if (typeof Storage !== 'undefined' && Storage.isAutoDownloadLikesEnabled()) {
      if (canSmartDownload() && !Storage.isDownloaded(song.id)) {
        if (typeof DownloadManager !== 'undefined') {
          DownloadManager.enqueue(song, {
            priority: 'smart',
            reason: 'From your Liked Songs'
          });
        }
      }
    }
  }

  function handlePlaylistDownloaded(playlist) {
    if (!playlist || !playlist.songs || !Array.isArray(playlist.songs)) return;
    if (typeof DownloadManager !== 'undefined') {
      playlist.songs.forEach(song => {
        if (!Storage.isDownloaded(song.id)) {
          DownloadManager.enqueue(song, {
            priority: 'explicit',
            reason: `From playlist ${playlist.name || ''}`
          });
        }
      });
    }
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
    init,
    isNetworkEligible,
    canSmartDownload,
    getStorageMetrics,
    generateSmartCandidates,
    evaluateAndEnqueueSmartDownloads,
    getCleanupCandidates,
    previewCleanup,
    executeCleanup,
    rejectCandidate,
    handleLikeEvent,
    handlePlaylistDownloaded,
    on,
    off
  };
})();

// Export for Web and Node testing
if (typeof window !== 'undefined') {
  window.SmartDownloadManager = SmartDownloadManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SmartDownloadManager;
}

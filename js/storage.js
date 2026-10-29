// ==========================================================================
// MUSICFLOW — LOCAL STORAGE & STATE REPOSITORY
// ==========================================================================

const Storage = (() => {
  const KEYS = {
    FAVORITES: 'mf_favorites',
    HISTORY: 'mf_history',
    PLAYLISTS: 'mf_playlists',
    SEARCH_HISTORY: 'mf_search_history',
    AUDIO_QUALITY: 'mf_audio_quality',
    USER_NAME: 'mf_user_name',
    USER_AVATAR: 'mf_user_avatar',
    LAST_SESSION: 'mf_last_session',
    EQUALIZER: 'mf_equalizer',
    PERFORMANCE_MODE: 'mf_perf_mode',
    AMBIENT_LIGHTING: 'mf_ambient_glow',
    LANGUAGES: 'mf_music_languages',
    SMART_DOWNLOADS_SETTINGS: 'mf_smart_downloads_settings',
    PROTECTED_DOWNLOADS: 'mf_protected_downloads',
    SELECTED_AUDIO_OUTPUT: 'mf_selected_audio_output',
    AUDIO_EFFECTS: 'mf_audio_effects_v2',
    USER_PRESETS: 'mf_user_audio_presets',
    UPDATE_STATE: 'mf_update_state'
  };

  let _backupDebounceTimer = null;
  function syncToNativePersistentBackup() {
    if (_backupDebounceTimer) clearTimeout(_backupDebounceTimer);
    _backupDebounceTimer = setTimeout(() => {
      try {
        const fullBackup = {};
        for (const [name, storageKey] of Object.entries(KEYS)) {
          const val = localStorage.getItem(storageKey);
          if (val !== null && val !== undefined) {
            fullBackup[storageKey] = val;
          }
        }
        const jsonString = JSON.stringify(fullBackup);

        // 1. iOS Keychain Persistence Bridge (survives app uninstallation)
        if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
          window.webkit.messageHandlers.nativeMedia.postMessage({
            action: 'savePersistentBackup',
            data: jsonString
          });
        }

        // 2. Android Native Bridge (survives app uninstallation / auto-backup)
        if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.savePersistentBackup === 'function') {
          window.AndroidMediaBridge.savePersistentBackup(jsonString);
        }
      } catch (e) {
        console.warn('[Storage] syncToNativePersistentBackup error:', e);
      }
    }, 500);
  }

  function getJSON(key, fallback = []) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function setJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      syncToNativePersistentBackup();
    } catch (e) {
      console.warn(`[Storage] Failed to save ${key}:`, e);
    }
  }

  return {
    // Favorites
    getFavorites() {
      const raw = getJSON(KEYS.FAVORITES, []);
      if (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeTrack) {
        return raw.map(s => (s && typeof s === 'object' ? (DataNormalizer.normalizeTrack(s) || s) : s));
      }
      return raw;
    },

    isFavorite(songOrId) {
      if (!songOrId) return false;
      const favs = this.getFavorites();
      if (typeof songOrId === 'object') {
        const id = String(songOrId.id || songOrId.songId || songOrId._id || '').trim();
        const title = (songOrId.name || songOrId.title || '').toLowerCase().trim();
        const artist = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(songOrId) : String(songOrId.artists || songOrId.primaryArtist || '')).toLowerCase().trim();
        return favs.some(s => {
          const sId = String(s.id || s.songId || s._id || '').trim();
          if (id && sId && id === sId) return true;
          const sTitle = (s.name || s.title || '').toLowerCase().trim();
          const sArtist = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || s.primaryArtist || '')).toLowerCase().trim();
          if (title && sTitle && title === sTitle) {
            if (!artist || !sArtist || artist.includes(sArtist) || sArtist.includes(artist)) return true;
          }
          return false;
        });
      }
      const target = String(songOrId).trim().toLowerCase();
      return favs.some(s => {
        const sId = String(s.id || s.songId || s._id || '').trim().toLowerCase();
        const sTitle = (s.name || s.title || '').toLowerCase().trim();
        return sId === target || sTitle === target;
      });
    },

    toggleFavorite(song) {
      if (!song) return false;
      const favs = this.getFavorites();
      const id = String(song.id || song.songId || song._id || '').trim();
      const title = (song.name || song.title || '').toLowerCase().trim();
      const artist = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(song) : String(song.artists || song.primaryArtist || '')).toLowerCase().trim();

      const idx = favs.findIndex(s => {
        const sId = String(s.id || s.songId || s._id || '').trim();
        if (id && sId && id === sId) return true;
        const sTitle = (s.name || s.title || '').toLowerCase().trim();
        const sArtist = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(s) : String(s.artists || s.primaryArtist || '')).toLowerCase().trim();
        if (title && sTitle && title === sTitle) {
          if (!artist || !sArtist || artist.includes(sArtist) || sArtist.includes(artist)) return true;
        }
        return false;
      });

      let isFav = false;
      if (idx >= 0) {
        favs.splice(idx, 1);
        isFav = false;
      } else {
        const normalized = (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeTrack) ? (DataNormalizer.normalizeTrack(song) || song) : { ...song };
        favs.unshift(normalized);
        isFav = true;
      }

      setJSON(KEYS.FAVORITES, favs);
      return isFav;
    },

    addFavorite(song) {
      if (!song || !song.id) return false;
      if (!this.isFavorite(song)) {
        this.toggleFavorite(song);
      }
      return true;
    },

    addToFavorites(song) {
      return this.addFavorite(song);
    },

    saveToFavorites(song) {
      return this.addFavorite(song);
    },

    removeFavorite(songId) {
      if (!songId) return false;
      const favs = this.getFavorites();
      const s = favs.find(f => String(f.id) === String(songId));
      if (s) {
        this.toggleFavorite(s);
        return true;
      }
      return false;
    },

    removeFromFavorites(songId) {
      return this.removeFavorite(songId);
    },

    deleteFavorite(songId) {
      return this.removeFavorite(songId);
    },

    // Listening History
    getHistory() {
      const raw = getJSON(KEYS.HISTORY, []);
      if (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeTrack) {
        return raw.map(s => (s && typeof s === 'object' ? (DataNormalizer.normalizeTrack(s) || s) : s));
      }
      return raw;
    },

    addToHistory(song) {
      if (!song || !song.id) return;
      const normalized = (typeof DataNormalizer !== 'undefined' && DataNormalizer.normalizeTrack) ? (DataNormalizer.normalizeTrack(song) || song) : song;
      let history = this.getHistory();
      history = history.filter(s => String(s.id) !== String(song.id));
      history.unshift(normalized);
      if (history.length > 50) history = history.slice(0, 50);
      setJSON(KEYS.HISTORY, history);
    },

    addHistory(song) {
      return this.addToHistory(song);
    },

    clearHistory() {
      setJSON(KEYS.HISTORY, []);
    },

    // Search History
    getSearchHistory() {
      return getJSON(KEYS.SEARCH_HISTORY, []);
    },

    addSearchHistory(term) {
      if (!term || !term.trim()) return;
      const q = term.trim();
      let hist = this.getSearchHistory().filter(t => t.toLowerCase() !== q.toLowerCase());
      hist.unshift(q);
      if (hist.length > 10) hist = hist.slice(0, 10);
      setJSON(KEYS.SEARCH_HISTORY, hist);
    },

    clearSearchHistory() {
      setJSON(KEYS.SEARCH_HISTORY, []);
    },

    // ========================================================================
    // CUSTOM PLAYLISTS 2.0 & MY MUSIC ARCHITECTURE (Phase 8.3)
    // ========================================================================
    getPlaylists() {
      const favs = this.getFavorites();
      const raw = getJSON(KEYS.PLAYLISTS, []);
      
      // Ensure Liked Songs default playlist is always present and synchronized
      let hasFavPl = false;
      const pls = raw.map(p => {
        if (p.id === 'favorites_pl') {
          hasFavPl = true;
          return {
            ...p,
            name: 'Liked Songs',
            description: 'Your favorite tracks',
            songs: favs,
            isDefault: true,
            createdAt: p.createdAt || 0
          };
        }
        return {
          ...p,
          songs: Array.isArray(p.songs) ? p.songs : []
        };
      });

      if (!hasFavPl) {
        pls.unshift({
          id: 'favorites_pl',
          name: 'Liked Songs',
          description: 'Your favorite tracks',
          songs: favs,
          isDefault: true,
          createdAt: 0
        });
      }

      return pls;
    },

    getPlaylistById(playlistId) {
      if (!playlistId) return null;
      if (playlistId === 'favorites_pl' || playlistId === 'liked') {
        return {
          id: 'favorites_pl',
          name: 'Liked Songs',
          description: 'Your favorite tracks',
          songs: this.getFavorites(),
          isDefault: true,
          createdAt: 0
        };
      }
      const pls = this.getPlaylists();
      return pls.find(p => p.id === playlistId) || null;
    },

    createPlaylist(name, description = '', cover = '', initialSongs = []) {
      const cleanName = (name || '').trim().slice(0, 100) || 'New Playlist';
      const cleanDesc = (description || '').trim().slice(0, 300);
      const pls = this.getPlaylists();

      const newPl = {
        id: `pl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: cleanName,
        description: cleanDesc,
        cover: cover || '',
        songs: Array.isArray(initialSongs) ? [...initialSongs] : [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      pls.push(newPl);
      setJSON(KEYS.PLAYLISTS, pls);

      // Record recommendation preference signal if available
      try {
        if (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.recordInteraction) {
          RecommendationEngine.recordInteraction('playlist_create', { playlistId: newPl.id, name: cleanName });
        }
      } catch (_) {}

      return newPl;
    },

    saveQueueAsPlaylist(queue, name = 'Queue Playlist') {
      if (!Array.isArray(queue) || queue.length === 0) return null;
      const cleanName = (name || '').trim() || `Queue - ${new Date().toLocaleDateString()}`;
      return this.createPlaylist(cleanName, `Saved queue with ${queue.length} tracks`, '', queue);
    },

    editPlaylist(playlistId, updates = {}) {
      if (!playlistId || playlistId === 'favorites_pl') return false;
      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl) {
        if (updates.name !== undefined) pl.name = String(updates.name).trim().slice(0, 100) || pl.name;
        if (updates.description !== undefined) pl.description = String(updates.description).trim().slice(0, 300);
        if (updates.cover !== undefined) pl.cover = String(updates.cover);
        pl.updatedAt = Date.now();
        setJSON(KEYS.PLAYLISTS, pls);
        return true;
      }
      return false;
    },

    reorderPlaylist(playlistId, newSongs) {
      if (!playlistId || playlistId === 'favorites_pl') return false;
      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl && Array.isArray(newSongs)) {
        pl.songs = newSongs;
        pl.updatedAt = Date.now();
        setJSON(KEYS.PLAYLISTS, pls);
        return true;
      }
      return false;
    },

    duplicatePlaylist(playlistId) {
      const pl = this.getPlaylistById(playlistId);
      if (pl) {
        return this.createPlaylist(
          `${pl.name} (Copy)`,
          pl.description || '',
          pl.cover || '',
          [...(pl.songs || [])]
        );
      }
      return null;
    },

    addToPlaylist(playlistId, song) {
      if (!playlistId || !song || !song.id) return false;
      if (playlistId === 'favorites_pl') {
        return this.addFavorite(song);
      }

      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl) {
        // Prevent duplicate songs within same playlist based on canonical ID
        if (!pl.songs.some(s => String(s.id) === String(song.id))) {
          pl.songs.push({ ...song });
          pl.updatedAt = Date.now();
          setJSON(KEYS.PLAYLISTS, pls);

          // Record recommendation signal
          try {
            if (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.recordInteraction) {
              RecommendationEngine.recordInteraction('playlist_add', { songId: song.id, playlistId });
            }
          } catch (_) {}

          return true;
        }
      }
      return false;
    },

    addSongToPlaylist(playlistId, song) {
      return this.addToPlaylist(playlistId, song);
    },

    removeFromPlaylist(playlistId, songId) {
      if (!playlistId || !songId) return false;
      if (playlistId === 'favorites_pl') {
        return this.removeFavorite(songId);
      }

      const pls = this.getPlaylists();
      const pl = pls.find(p => p.id === playlistId);
      if (pl) {
        const initLen = pl.songs.length;
        pl.songs = pl.songs.filter(s => String(s.id) !== String(songId));
        if (pl.songs.length !== initLen) {
          pl.updatedAt = Date.now();
          setJSON(KEYS.PLAYLISTS, pls);
          return true;
        }
      }
      return false;
    },

    deletePlaylist(playlistId) {
      if (!playlistId || playlistId === 'favorites_pl') return false;
      let pls = this.getPlaylists();
      const initLen = pls.length;
      pls = pls.filter(p => p.id !== playlistId);
      if (pls.length !== initLen) {
        setJSON(KEYS.PLAYLISTS, pls);
        return true;
      }
      return false;
    },

    exportPlaylist(playlistId, format = 'json') {
      const pl = this.getPlaylistById(playlistId);
      if (!pl) return null;

      if (format === 'csv') {
        let csv = 'ID,Name,Artist,Album,Duration\n';
        pl.songs.forEach(s => {
          const esc = (t) => `"${String(t || '').replace(/"/g, '""')}"`;
          csv += `${esc(s.id)},${esc(s.name)},${esc(s.artists || s.primaryArtist)},${esc(s.album)},${s.duration || 0}\n`;
        });
        return csv;
      }

      // JSON format
      return JSON.stringify({
        musicflow_playlist_version: 1,
        id: pl.id,
        name: pl.name,
        description: pl.description || '',
        exportedAt: new Date().toISOString(),
        trackCount: pl.songs.length,
        tracks: pl.songs.map(s => ({
          id: s.id,
          name: s.name,
          artists: s.artists || s.primaryArtist,
          album: s.album,
          duration: s.duration,
          image: s.image
        }))
      }, null, 2);
    },

    importPlaylist(jsonString) {
      try {
        const data = typeof jsonString === 'object' ? jsonString : JSON.parse(jsonString);
        if (!data || !data.name) return null;
        const tracks = Array.isArray(data.tracks) ? data.tracks : (Array.isArray(data.songs) ? data.songs : []);
        return this.createPlaylist(data.name, data.description || 'Imported Playlist', data.cover || '', tracks);
      } catch (e) {
        console.error('[Storage] importPlaylist error:', e);
        return null;
      }
    },

    sortPlaylistTracks(songs, sortMode = 'custom') {
      if (!Array.isArray(songs)) return [];
      const list = [...songs];
      if (sortMode === 'alpha' || sortMode === 'title') {
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
      if (sortMode === 'artist') {
        return list.sort((a, b) => (a.artists || a.primaryArtist || '').localeCompare(b.artists || b.primaryArtist || ''));
      }
      if (sortMode === 'recent') {
        return list.reverse();
      }
      if (sortMode === 'duration') {
        return list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      }
      // 'custom' / default
      return list;
    },

    // History Item Removal
    removeHistoryItem(songId) {
      let hist = this.getHistory();
      hist = hist.filter(s => String(s.id) !== String(songId));
      setJSON(KEYS.HISTORY, hist);
    },

    // Saved Albums Library
    getSavedAlbums() {
      return getJSON('mf_saved_albums', []);
    },

    // User Artists (Followed / Top Artists from Favorites & History)
    getArtists() {
      const followed = getJSON('mf_followed_artists', []);
      if (followed && followed.length > 0) return followed;

      const favs = this.getFavorites();
      const hist = this.getHistory();
      const allSongs = [...favs, ...hist];
      const artistMap = new Map();

      for (const s of allSongs) {
        const mainArtist = (typeof DataNormalizer !== 'undefined')
          ? DataNormalizer.getPrimaryArtist(s)
          : String(s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim();
        if (!mainArtist || mainArtist.toLowerCase() === 'various artists' || mainArtist.toLowerCase() === 'unknown artist') continue;

        if (!artistMap.has(mainArtist)) {
          artistMap.set(mainArtist, {
            name: mainArtist,
            image: s.image || 'assets/logo.png',
            count: 1
          });
        } else {
          artistMap.get(mainArtist).count++;
        }
      }

      return Array.from(artistMap.values()).sort((a, b) => b.count - a.count);
    },

    followArtist(artistName, image = '') {
      if (!artistName) return;
      const followed = getJSON('mf_followed_artists', []);
      if (!followed.some(a => (a.name || a).toLowerCase() === artistName.toLowerCase())) {
        followed.push({ name: artistName, image: image || 'assets/logo.png' });
        setJSON('mf_followed_artists', followed);
      }
    },

    isAlbumSaved(albumId) {
      if (!albumId) return false;
      return this.getSavedAlbums().some(a => String(a.id) === String(albumId));
    },

    saveAlbum(album) {
      if (!album || !album.id) return false;
      const albums = this.getSavedAlbums();
      if (!albums.some(a => String(a.id) === String(album.id))) {
        albums.unshift({ ...album, savedAt: Date.now() });
        setJSON('mf_saved_albums', albums);
        return true;
      }
      return false;
    },

    removeSavedAlbum(albumId) {
      let albums = this.getSavedAlbums();
      albums = albums.filter(a => String(a.id) !== String(albumId));
      setJSON('mf_saved_albums', albums);
    },

    toggleSaveAlbum(album) {
      if (!album || !album.id) return false;
      if (this.isAlbumSaved(album.id)) {
        this.removeSavedAlbum(album.id);
        return false;
      } else {
        this.saveAlbum(album);
        return true;
      }
    },

    // Followed Artists Library
    getFollowedArtists() {
      return getJSON('mf_followed_artists', []);
    },

    isArtistFollowed(artistNameOrId) {
      if (!artistNameOrId) return false;
      const target = String(artistNameOrId).toLowerCase().trim();
      return this.getFollowedArtists().some(a =>
        String(a.id).toLowerCase() === target ||
        (a.name && a.name.toLowerCase().trim() === target)
      );
    },

    followArtist(artist) {
      if (!artist) return false;
      const artists = this.getFollowedArtists();
      const name = artist.name || artist.title || 'Artist';
      const id = String(artist.id || name);
      if (!this.isArtistFollowed(id)) {
        artists.unshift({
          id,
          name,
          image: artist.image || 'assets/logo.png',
          followedAt: Date.now()
        });
        setJSON('mf_followed_artists', artists);
        return true;
      }
      return false;
    },

    unfollowArtist(artistNameOrId) {
      const target = String(artistNameOrId).toLowerCase().trim();
      let artists = this.getFollowedArtists();
      artists = artists.filter(a =>
        String(a.id).toLowerCase() !== target &&
        (!a.name || a.name.toLowerCase().trim() !== target)
      );
      setJSON('mf_followed_artists', artists);
    },

    toggleFollowArtist(artist) {
      if (!artist) return false;
      const id = artist.id || artist.name;
      if (this.isArtistFollowed(id)) {
        this.unfollowArtist(id);
        return false;
      } else {
        this.followArtist(artist);
        return true;
      }
    },

    // Downloads & Local Offline Storage
    getDownloads() {
      return getJSON('mf_downloads', []);
    },

    isDownloaded(songId) {
      if (!songId) return false;
      return this.getDownloads().some(s => String(s.id) === String(songId));
    },

    addDownload(song) {
      if (!song || !song.id) return;
      const dl = this.getDownloads();
      if (!dl.some(s => String(s.id) === String(song.id))) {
        dl.unshift({
          ...song,
          source: 'DOWNLOADED',
          onlineId: song.id,
          downloadedAt: Date.now()
        });
        setJSON('mf_downloads', dl);
      }
    },

    saveDownload(song) {
      return this.addDownload(song);
    },

    removeDownload(songId) {
      let dl = this.getDownloads();
      dl = dl.filter(s => String(s.id) !== String(songId));
      setJSON('mf_downloads', dl);
      if (typeof IndexedDbStorage !== 'undefined') {
        IndexedDbStorage.deleteDownloadedAudio(songId);
        IndexedDbStorage.removeDownloadTask(songId);
      }
    },

    async clearAllDownloads() {
      setJSON('mf_downloads', []);
      if (typeof IndexedDbStorage !== 'undefined') {
        await IndexedDbStorage.clearAllDownloadedAudio();
      }
    },

    async getDownloadedAudioUrl(songId) {
      if (typeof IndexedDbStorage !== 'undefined') {
        return await IndexedDbStorage.getDownloadedAudioUrl(songId);
      }
      return null;
    },

    getStorageUsage() {
      const dl = this.getDownloads();
      const local = this.getLocalSongs();
      const songCount = dl.length;
      // Estimate ~8.5MB per track
      const estimatedMb = ((songCount + local.length) * 8.5).toFixed(1);
      return { count: songCount, mb: estimatedMb };
    },

    async getStorageBreakdown() {
      if (typeof IndexedDbStorage !== 'undefined') {
        return await IndexedDbStorage.getStorageBreakdown();
      }
      const usage = this.getStorageUsage();
      return { totalMb: usage.mb, downloadedCount: usage.count, localCount: this.getLocalSongs().length };
    },

    // --- SMART DOWNLOADS & OFFLINE SETTINGS (Phase 9.3) ---
    getSmartDownloadsSettings() {
      return getJSON(KEYS.SMART_DOWNLOADS_SETTINGS, {
        enabled: false,
        wifiOnly: true,
        quality: '320kbps',
        storageLimitMb: 2048,
        autoCleanupPolicy: 'never',
        autoDownloadLikes: false,
        autoDownloadPlaylists: false,
        maxSmartTracks: 25
      });
    },

    setSmartDownloadsSettings(settings) {
      const current = this.getSmartDownloadsSettings();
      const updated = { ...current, ...(settings || {}) };
      setJSON(KEYS.SMART_DOWNLOADS_SETTINGS, updated);
      return updated;
    },

    isSmartDownloadsEnabled() {
      return !!this.getSmartDownloadsSettings().enabled;
    },

    setSmartDownloadsEnabled(enabled) {
      return this.setSmartDownloadsSettings({ enabled: !!enabled });
    },

    isDownloadWifiOnly() {
      return this.getSmartDownloadsSettings().wifiOnly !== false;
    },

    setDownloadWifiOnly(wifiOnly) {
      return this.setSmartDownloadsSettings({ wifiOnly: !!wifiOnly });
    },

    getDownloadStorageLimitMb() {
      return Number(this.getSmartDownloadsSettings().storageLimitMb) || 2048;
    },

    setDownloadStorageLimitMb(limitMb) {
      return this.setSmartDownloadsSettings({ storageLimitMb: Number(limitMb) || 2048 });
    },

    getAutoCleanupPolicy() {
      return this.getSmartDownloadsSettings().autoCleanupPolicy || 'never';
    },

    setAutoCleanupPolicy(policy) {
      return this.setSmartDownloadsSettings({ autoCleanupPolicy: policy || 'never' });
    },

    isAutoDownloadLikesEnabled() {
      return !!this.getSmartDownloadsSettings().autoDownloadLikes;
    },

    setAutoDownloadLikesEnabled(enabled) {
      return this.setSmartDownloadsSettings({ autoDownloadLikes: !!enabled });
    },

    isAutoDownloadPlaylistsEnabled() {
      return !!this.getSmartDownloadsSettings().autoDownloadPlaylists;
    },

    setAutoDownloadPlaylistsEnabled(enabled) {
      return this.setSmartDownloadsSettings({ autoDownloadPlaylists: !!enabled });
    },

    getProtectedDownloads() {
      return getJSON(KEYS.PROTECTED_DOWNLOADS, []);
    },

    isDownloadProtected(songId) {
      if (!songId) return false;
      const prot = this.getProtectedDownloads();
      return prot.includes(String(songId));
    },

    setDownloadProtected(songId, isProtected) {
      if (!songId) return;
      const prot = this.getProtectedDownloads();
      const idStr = String(songId);
      const idx = prot.indexOf(idStr);
      if (isProtected && idx === -1) {
        prot.push(idStr);
      } else if (!isProtected && idx >= 0) {
        prot.splice(idx, 1);
      }
      setJSON(KEYS.PROTECTED_DOWNLOADS, prot);
      return isProtected;
    },

    toggleProtectedDownload(songId) {
      const isProt = this.isDownloadProtected(songId);
      return this.setDownloadProtected(songId, !isProt);
    },

    // --- Audio Output Device Routing ---
    getSelectedAudioOutput() {
      return getJSON(KEYS.SELECTED_AUDIO_OUTPUT, { id: 'default', label: 'Default System Output', type: 'default' });
    },

    setSelectedAudioOutput(id, label, type) {
      const data = { id: id || 'default', label: label || 'Audio Device', type: type || 'default' };
      setJSON(KEYS.SELECTED_AUDIO_OUTPUT, data);
      return data;
    },

    // --- Local Device Tracks (Persistent + Session) ---
    getLocalSongs() {
      return getJSON('mf_local_tracks_meta', []);
    },

    saveLocalSong(track, fileBlob = null) {
      if (!track) return;
      const localList = this.getLocalSongs();
      const id = String(track.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
      const existingIdx = localList.findIndex(t => t.id === id || (t.filename && t.filename === track.filename));

      const entry = {
        ...track,
        id,
        source: 'LOCAL',
        addedAt: Date.now()
      };

      if (fileBlob) {
        if (!this._localFileBlobMap) this._localFileBlobMap = new Map();
        this._localFileBlobMap.set(id, fileBlob);
      }

      if (existingIdx >= 0) {
        localList[existingIdx] = entry;
      } else {
        localList.unshift(entry);
      }
      setJSON('mf_local_tracks_meta', localList);

      if (typeof IndexedDbStorage !== 'undefined') {
        IndexedDbStorage.saveLocalTrack(entry, fileBlob);
      }
      return entry;
    },

    async getLocalAudioUrl(songId) {
      if (!songId) return null;
      const id = String(songId);
      if (this._localFileBlobMap && this._localFileBlobMap.has(id)) {
        const fileOrBlob = this._localFileBlobMap.get(id);
        if (fileOrBlob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          return URL.createObjectURL(fileOrBlob);
        }
      }
      if (typeof IndexedDbStorage !== 'undefined' && typeof IndexedDbStorage.getLocalTrackAudioUrl === 'function') {
        const url = await IndexedDbStorage.getLocalTrackAudioUrl(id);
        if (url) return url;
      }
      const songs = this.getLocalSongs();
      const s = songs.find(track => String(track.id) === id);
      if (s && (s.localBlobUrl || s.streamUrl)) {
        return s.localBlobUrl || s.streamUrl;
      }
      return null;
    },

    async getLocalTrackBlob(songId) {
      if (!songId) return null;
      const id = String(songId);
      if (this._localFileBlobMap && this._localFileBlobMap.has(id)) {
        return this._localFileBlobMap.get(id);
      }
      if (typeof IndexedDbStorage !== 'undefined' && typeof IndexedDbStorage.getLocalTrack === 'function') {
        const rec = await IndexedDbStorage.getLocalTrack(id);
        if (rec && rec.fileBlob) return rec.fileBlob;
      }
      return null;
    },

    removeLocalSong(songId) {
      const id = String(songId);
      if (this._localFileBlobMap) {
        this._localFileBlobMap.delete(id);
      }
      let localList = this.getLocalSongs();
      localList = localList.filter(s => String(s.id) !== id);
      setJSON('mf_local_tracks_meta', localList);
      if (typeof IndexedDbStorage !== 'undefined') {
        IndexedDbStorage.removeLocalTrack(songId);
      }
    },

    clearAllLocalSongs() {
      if (this._localFileBlobMap) {
        this._localFileBlobMap.clear();
      }
      setJSON('mf_local_tracks_meta', []);
      if (typeof IndexedDbStorage !== 'undefined') {
        IndexedDbStorage.clearAllLocalTracks();
      }
    },

    getLocalAlbums() {
      const songs = this.getLocalSongs();
      const albumMap = new Map();
      songs.forEach(s => {
        const albumName = s.album || 'Local Album';
        const artistName = s.albumArtist || s.artists || 'Various Artists';
        const key = `${albumName.toLowerCase()}__${artistName.toLowerCase()}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `local_alb_${key.replace(/[^a-z0-9]/g, '_')}`,
            name: albumName,
            artist: artistName,
            year: s.year || '',
            image: s.image || 'assets/logo.png',
            songCount: 0,
            songs: []
          });
        }
        const alb = albumMap.get(key);
        alb.songCount++;
        alb.songs.push(s);
      });
      return Array.from(albumMap.values());
    },

    getLocalArtists() {
      const songs = this.getLocalSongs();
      const artistMap = new Map();
      songs.forEach(s => {
        const first = (typeof DataNormalizer !== 'undefined')
          ? DataNormalizer.getPrimaryArtist(s)
          : (String(s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim() || 'Unknown Artist');
        const key = first.toLowerCase();
        if (!artistMap.has(key)) {
          artistMap.set(key, {
            id: `local_art_${key.replace(/[^a-z0-9]/g, '_')}`,
            name: first,
            image: s.image || 'assets/logo.png',
            songCount: 0,
            songs: []
          });
        }
        const art = artistMap.get(key);
        art.songCount++;
        art.songs.push(s);
      });
      return Array.from(artistMap.values());
    },

    getLocalFolders() {
      const songs = this.getLocalSongs();
      const folderMap = new Map();
      songs.forEach(s => {
        const folder = s.folderName || 'Root Music Folder';
        const key = folder.toLowerCase();
        if (!folderMap.has(key)) {
          folderMap.set(key, {
            id: `local_fld_${key.replace(/[^a-z0-9]/g, '_')}`,
            name: folder,
            songCount: 0,
            songs: []
          });
        }
        const fld = folderMap.get(key);
        fld.songCount++;
        fld.songs.push(s);
      });
      return Array.from(folderMap.values());
    },

    // Combined offline catalog for instant 0ms offline search and queue
    getOfflineCatalog() {
      const dl = this.getDownloads();
      const local = this.getLocalSongs();
      const seen = new Set();
      const combined = [];
      [...dl, ...local].forEach(s => {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          combined.push(s);
        }
      });
      return combined;
    },

    // Session State Persistence (Queue, Index, Position)
    saveSession(queue = [], currentIndex = -1, position = 0) {
      const sanitizedQueue = Array.isArray(queue) ? queue.slice(0, 50).map(s => ({
        id: s.id,
        name: s.name,
        album: s.album,
        artists: s.artists,
        primaryArtist: s.primaryArtist,
        image: s.image,
        audioUrl: s.audioUrl,
        streamUrl: s.streamUrl,
        duration: s.duration,
        source: s.source || 'STREAMING'
      })) : [];
      setJSON(KEYS.LAST_SESSION, {
        queue: sanitizedQueue,
        currentIndex: Math.max(-1, Math.min(currentIndex, sanitizedQueue.length - 1)),
        position: Math.max(0, Math.round(position || 0)),
        savedAt: Date.now()
      });
    },

    getSession() {
      return getJSON(KEYS.LAST_SESSION, {
        queue: [],
        currentIndex: -1,
        position: 0,
        savedAt: 0
      });
    },

    // ========================================================================
    // PHASE 5 — USER TASTE SIGNALS, MILESTONES & SKIP TRACKING
    // ========================================================================
    recordPlayMilestone(song, percentage) {
      if (!song || !song.id) return;
      const milestones = getJSON('mf_play_milestones', {});
      const id = String(song.id);
      const prev = milestones[id] || { plays: 0, completions: 0, highestPct: 0, lastPlayed: 0 };
      
      prev.plays = (prev.plays || 0) + 1;
      prev.highestPct = Math.max(prev.highestPct || 0, percentage);
      if (percentage >= 80) {
        prev.completions = (prev.completions || 0) + 1;
      }
      prev.lastPlayed = Date.now();
      prev.artist = song.artists || song.primaryArtist || '';
      prev.language = song.language || '';
      prev.name = song.name || '';
      milestones[id] = prev;
      setJSON('mf_play_milestones', milestones);
    },

    recordSkip(song) {
      if (!song || !song.id) return;
      try {
        const skips = getJSON('mf_skips', []);
        const artStr = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(song) : String(song.artists || song.primaryArtist || '')).toLowerCase();
        skips.unshift({
          id: String(song.id),
          artist: artStr,
          name: song.name || song.title || '',
          language: song.language || '',
          skippedAt: Date.now()
        });
        // Keep last 100 skips
        setJSON('mf_skips', skips.slice(0, 100));
      } catch (err) {
        console.warn('[Storage] recordSkip non-critical error:', err);
      }
    },

    getSkips() {
      return getJSON('mf_skips', []);
    },

    recordDeliveredRecommendation(songId) {
      if (!songId) return;
      const history = getJSON('mf_rec_delivered', []);
      history.unshift({ id: String(songId), time: Date.now() });
      setJSON('mf_rec_delivered', history.slice(0, 50));
    },

    getRecentDeliveredRecommendations() {
      return getJSON('mf_rec_delivered', []);
    },

    getUserTasteSignals() {
      const favorites = this.getFavorites();
      const history = this.getHistory();
      const playlists = this.getPlaylists();
      const followedArtists = this.getFollowedArtists();
      const milestones = getJSON('mf_play_milestones', {});
      const skips = this.getSkips();

      // Aggregate artist weights, genre/language weights, and skipped tracks
      const artistScores = {};
      const languageScores = {};
      const skippedSongCounts = {};
      const skippedArtistCounts = {};

      // 1. Liked songs (+1.5 per like)
      favorites.forEach(s => {
        const art = (typeof DataNormalizer !== 'undefined')
          ? DataNormalizer.getPrimaryArtist(s).toLowerCase()
          : String(s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim().toLowerCase();
        if (art && art !== 'unknown artist') artistScores[art] = (artistScores[art] || 0) + 1.5;
        if (s.language) {
          const l = String(s.language).toLowerCase();
          languageScores[l] = (languageScores[l] || 0) + 1.5;
        }
      });

      // 2. Play history with time decay (recent plays weighted higher)
      const now = Date.now();
      history.slice(0, 40).forEach((s, idx) => {
        const art = (typeof DataNormalizer !== 'undefined')
          ? DataNormalizer.getPrimaryArtist(s).toLowerCase()
          : String(s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim().toLowerCase();
        // Time decay: 1.0 down to 0.4
        const decay = Math.max(0.4, 1.0 - (idx * 0.015));
        const milestoneData = milestones[String(s.id)];
        const completionBonus = (milestoneData && milestoneData.completions > 0) ? 1.3 : 0.8;
        const weight = decay * completionBonus;

        if (art && art !== 'unknown artist') artistScores[art] = (artistScores[art] || 0) + weight;
        if (s.language) {
          const l = String(s.language).toLowerCase();
          languageScores[l] = (languageScores[l] || 0) + weight;
        }
      });

      // 3. Playlists (+1.2 per playlist track)
      playlists.forEach(pl => {
        (pl.songs || []).forEach(s => {
          const art = (typeof DataNormalizer !== 'undefined')
            ? DataNormalizer.getPrimaryArtist(s).toLowerCase()
            : String(s.primaryArtist || s.artists || '').split(/[,&/]/)[0].trim().toLowerCase();
          if (art && art !== 'unknown artist') artistScores[art] = (artistScores[art] || 0) + 1.2;
        });
      });

      // 4. Followed Artists (+2.0)
      followedArtists.forEach(a => {
        const art = (a.name || '').trim().toLowerCase();
        if (art) artistScores[art] = (artistScores[art] || 0) + 2.0;
      });

      // 5. Skips penalties (tracks and artists)
      skips.forEach(sk => {
        skippedSongCounts[sk.id] = (skippedSongCounts[sk.id] || 0) + 1;
        if (sk.artist) {
          skippedArtistCounts[sk.artist] = (skippedArtistCounts[sk.artist] || 0) + 1;
        }
      });

      return {
        artistScores,
        languageScores,
        skippedSongCounts,
        skippedArtistCounts,
        milestones,
        totalSignals: favorites.length + history.length + followedArtists.length
      };
    },

    // Preferred Audio Quality
    getAudioQuality() {
      return localStorage.getItem(KEYS.AUDIO_QUALITY) || '320kbps';
    },

    setAudioQuality(quality) {
      localStorage.setItem(KEYS.AUDIO_QUALITY, quality);
    },

    // User Profile
    getUserName() {
      // Empty until the user sets a name: Home then greets by time of day instead of a demo name.
      return localStorage.getItem(KEYS.USER_NAME) || '';
    },

    setUserName(name) {
      localStorage.setItem(KEYS.USER_NAME, name);
    },

    getUserAvatar() {
      return localStorage.getItem(KEYS.USER_AVATAR) || 'assets/logo.png';
    },

    setUserAvatar(url) {
      localStorage.setItem(KEYS.USER_AVATAR, url);
    },

    getUserProfile() {
      return {
        name: this.getUserName(),
        avatar: this.getUserAvatar()
      };
    },

    setUserProfile(name, avatar) {
      if (name) this.setUserName(name);
      if (avatar) this.setUserAvatar(avatar);
    },

    // Equalizer & Audio Effects Settings
    getEqualizerSettings() {
      const fx = this.getAudioEffects();
      return {
        enabled: fx.enabled,
        preset: fx.preset,
        bands: fx.bands ? fx.bands.slice(0, 5) : [0, 0, 0, 0, 0],
        bassBoost: fx.bassBoost || 0,
        virtualizer: fx.spatial === 'HIGH' ? 80 : (fx.spatial === 'MEDIUM' ? 50 : (fx.spatial === 'LOW' ? 25 : 0))
      };
    },

    saveEqualizerSettings(settings) {
      const current = this.getAudioEffects();
      const updated = {
        ...current,
        enabled: settings.enabled !== undefined ? settings.enabled : current.enabled,
        preset: settings.preset || current.preset,
        bassBoost: settings.bassBoost !== undefined ? settings.bassBoost : current.bassBoost
      };
      if (Array.isArray(settings.bands)) {
        updated.bands = settings.bands.length === 7 ? settings.bands : [...settings.bands, 0, 0].slice(0, 7);
      }
      this.setAudioEffects(updated);
    },

    getEqualizer() {
      return this.getEqualizerSettings();
    },

    setEqualizer(eqData) {
      this.saveEqualizerSettings(eqData);
    },

    // Audio Effects Engine 2.0 (7-Band EQ, 3D Spatial, Bass/Treble/Vocal, Normalization, Crossfade)
    getAudioEffects() {
      return getJSON(KEYS.AUDIO_EFFECTS, {
        enabled: false,
        preset: 'Flat',
        bands: [0, 0, 0, 0, 0, 0, 0],
        bassBoost: 0,
        trebleBoost: 0,
        vocalBoost: 0,
        spatial: 'OFF',
        normalization: false,
        crossfade: 0
      });
    },

    setAudioEffects(fxData) {
      if (!fxData || typeof fxData !== 'object') return;
      const current = this.getAudioEffects();
      const merged = { ...current, ...fxData };
      setJSON(KEYS.AUDIO_EFFECTS, merged);
    },

    // User Custom Audio Presets
    getUserPresets() {
      return getJSON(KEYS.USER_PRESETS, {});
    },

    saveUserPreset(name, presetData) {
      if (!name || typeof name !== 'string') return;
      const presets = this.getUserPresets();
      presets[name.trim()] = {
        ...presetData,
        savedAt: Date.now()
      };
      setJSON(KEYS.USER_PRESETS, presets);
    },

    deleteUserPreset(name) {
      if (!name || typeof name !== 'string') return;
      const presets = this.getUserPresets();
      delete presets[name.trim()];
      setJSON(KEYS.USER_PRESETS, presets);
    },

    resetAudioEffects() {
      const defaults = {
        enabled: false,
        preset: 'Flat',
        bands: [0, 0, 0, 0, 0, 0, 0],
        bassBoost: 0,
        trebleBoost: 0,
        vocalBoost: 0,
        spatial: 'OFF',
        normalization: false,
        crossfade: 0
      };
      setJSON(KEYS.AUDIO_EFFECTS, defaults);
      return defaults;
    },

    // Music Languages
    getLanguages() {
      return getJSON(KEYS.LANGUAGES, ['hindi', 'english', 'punjabi']);
    },

    setLanguages(langs) {
      setJSON(KEYS.LANGUAGES, langs);
    },

    // Performance Mode ('auto', 'high', 'lite')
    getPerformanceMode() {
      return localStorage.getItem(KEYS.PERFORMANCE_MODE) || 'auto';
    },

    setPerformanceMode(mode) {
      localStorage.setItem(KEYS.PERFORMANCE_MODE, mode);
    },

    // Ambient Glow ('on', 'off')
    getAmbientLighting() {
      return localStorage.getItem(KEYS.AMBIENT_LIGHTING) !== 'off';
    },

    setAmbientLighting(enabled) {
      localStorage.setItem(KEYS.AMBIENT_LIGHTING, enabled ? 'on' : 'off');
    },

    // Session State (Queue & Current Track for Instant Restore)
    saveSession(queue, currentIndex, currentTime) {
      try {
        const session = {
          queue: (queue || []).slice(0, 50),
          currentIndex: currentIndex || 0,
          currentTime: currentTime || 0
        };
        setJSON(KEYS.LAST_SESSION, session);
      } catch (_) {}
    },

    restoreSession() {
      return getJSON(KEYS.LAST_SESSION, null);
    },

    // In-App Update System State
    getUpdateState() {
      return getJSON(KEYS.UPDATE_STATE, {
        lastChecked: 0,
        lastResult: null,
        dismissedVersion: null
      });
    },

    setUpdateState(data) {
      const current = this.getUpdateState();
      setJSON(KEYS.UPDATE_STATE, { ...current, ...data });
    },

    getDismissedVersion() {
      const state = this.getUpdateState();
      return state.dismissedVersion || null;
    },

    setDismissedVersion(ver) {
      this.setUpdateState({ dismissedVersion: ver ? String(ver).trim() : null });
    },

    setLastUpdateCheck(timestamp, result) {
      this.setUpdateState({
        lastChecked: timestamp || Date.now(),
        lastResult: result || null
      });
    },

    getTheme() {
      return getJSON('mf_user_theme', { id: 'red', name: 'MusicFlow Red', color: '#FF1744', isDefault: true });
    },

    setTheme(theme) {
      setJSON('mf_user_theme', theme);
    },

    getItem(key, fallback = null) {
      return getJSON(key, fallback);
    },

    setItem(key, val) {
      setJSON(key, val);
    },

    removeItem(key) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      } catch (_) {}
    },

    getStreamingQuality() {
      return this.getAudioQuality ? this.getAudioQuality() : '320';
    },

    isPerformanceMode() {
      const mode = this.getPerformanceMode ? this.getPerformanceMode() : 'auto';
      return mode === 'high' || mode === 'lite' || mode === true;
    },

    getAutoCleanupDays() {
      const s = getJSON(KEYS.SMART_DOWNLOADS_SETTINGS, {});
      return s.autoCleanupDays !== undefined ? Number(s.autoCleanupDays) : 30;
    },

    getStorageLimitMb() {
      const s = getJSON(KEYS.SMART_DOWNLOADS_SETTINGS, {});
      return s.storageLimitMb !== undefined ? Number(s.storageLimitMb) : 2048;
    },

    recordTasteSignal(signal) {
      if (this.recordTasteSignals) {
        return this.recordTasteSignals(signal);
      }
      return null;
    },

    async saveDownloadedAudio(trackId, blob) {
      if (typeof IndexedDbStorage !== 'undefined' && IndexedDbStorage.saveAudioBlob) {
        return IndexedDbStorage.saveAudioBlob(trackId, blob);
      }
      return null;
    },

    async saveAudioBlob(trackId, blob) {
      return this.saveDownloadedAudio(trackId, blob);
    },

    async getDownloadedAudio(trackId) {
      if (typeof IndexedDbStorage !== 'undefined' && IndexedDbStorage.getAudioBlob) {
        return IndexedDbStorage.getAudioBlob(trackId);
      }
      return null;
    },

    async getAudioBlob(trackId) {
      return this.getDownloadedAudio(trackId);
    },

    async deleteDownloadedAudio(trackId) {
      if (typeof IndexedDbStorage !== 'undefined' && IndexedDbStorage.deleteAudioBlob) {
        return IndexedDbStorage.deleteAudioBlob(trackId);
      }
      return null;
    },

    async deleteAudioBlob(trackId) {
      return this.deleteDownloadedAudio(trackId);
    },

    async clearAllDownloadedAudio() {
      if (typeof IndexedDbStorage !== 'undefined' && IndexedDbStorage.clearAllAudioBlobs) {
        return IndexedDbStorage.clearAllAudioBlobs();
      }
      return null;
    },

    async clearAllAudioBlobs() {
      return this.clearAllDownloadedAudio();
    },

    saveLocalTrack(track) {
      if (!track || !track.id) return;
      const tracks = getJSON('mf_local_tracks', []);
      const idx = tracks.findIndex(t => String(t.id) === String(track.id));
      if (idx >= 0) tracks[idx] = track;
      else tracks.unshift(track);
      setJSON('mf_local_tracks', tracks);
    },

    removeLocalTrack(trackId) {
      if (!trackId) return;
      const tracks = getJSON('mf_local_tracks', []).filter(t => String(t.id) !== String(trackId));
      setJSON('mf_local_tracks', tracks);
    },

    clearAllLocalTracks() {
      setJSON('mf_local_tracks', []);
    },

    removeDownloadTask(trackId) {
      if (this.removeDownload) {
        return this.removeDownload(trackId);
      }
    },

    clear() {
      this.clearAllData();
    },

    clearAllData() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.clear();
        }
      } catch (_) {}
    },

    // Sync to Native Persistent Storage (Keychain on iOS / Auto-Backup on Android)
    syncPersistentBackup() {
      syncToNativePersistentBackup();
    },

    // Restore Persistent Data after App Reinstallation (called from native AppDelegate / Bridge)
    restorePersistentBackupBase64(base64Str) {
      if (!base64Str) return false;
      try {
        let jsonStr = '';
        try {
          const binaryStr = atob(base64Str);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          jsonStr = new TextDecoder('utf-8').decode(bytes);
        } catch (_) {
          jsonStr = atob(base64Str);
        }

        const backupObj = JSON.parse(jsonStr || '{}');
        if (backupObj && typeof backupObj === 'object') {
          let restoredCount = 0;
          for (const [key, val] of Object.entries(backupObj)) {
            const currVal = localStorage.getItem(key);
            // Restore if local key is missing or empty
            if (!currVal || currVal === '[]' || currVal === '{}' || currVal === '""') {
              localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
              restoredCount++;
            }
          }
          console.log(`[Storage] Restored ${restoredCount} persistent items from native Keychain across reinstall`);

          // Trigger library & UI refresh if available
          if (typeof App !== 'undefined' && typeof App.renderLibrary === 'function') {
            App.renderLibrary();
          }
          return true;
        }
      } catch (err) {
        console.warn('[Storage] restorePersistentBackupBase64 error:', err);
      }
      return false;
    }
  };
})();

if (typeof window !== 'undefined') {
  window.Storage = Storage;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}

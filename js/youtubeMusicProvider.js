(() => {
// ==========================================================================
// MUSICFLOW — YOUTUBE MUSIC SECONDARY MUSIC PROVIDER (HARDENED)
// Deep long-tail catalog coverage, automix radio, and playlist import with dual backend/client fallback.
// ==========================================================================

const { MusicProvider, MusicProviderTypes, ProviderHealthState, normalizeTrackSchema, providerManager } = 
  (typeof require !== 'undefined') ? require('./musicProvider.js') : {
    MusicProvider: window.MusicProvider,
    MusicProviderTypes: window.MusicProviderTypes,
    ProviderHealthState: window.ProviderHealthState,
    normalizeTrackSchema: window.normalizeTrackSchema,
    providerManager: window.providerManager
  };

const getYTMService = () => {
  if (typeof YouTubeMusicService !== 'undefined') return YouTubeMusicService;
  if (typeof window !== 'undefined' && window.YouTubeMusicService) return window.YouTubeMusicService;
  if (typeof require !== 'undefined') {
    try { return require('../../youtubeMusicService.js'); } catch (_) {}
    try { return require('./youtubeMusicService.js'); } catch (_) {}
  }
  return null;
};

class YouTubeMusicProvider extends MusicProvider {
  constructor(baseUrl = '') {
    super(MusicProviderTypes.YOUTUBE_MUSIC, 50); // Priority 50 = Secondary Provider
    this.baseUrl = baseUrl;
    this.backendAvailable = true;
  }

  setBaseUrl(url) {
    this.baseUrl = url;
  }

  getBaseUrl() {
    if (this.baseUrl && typeof this.baseUrl === 'string') return this.baseUrl;
    if (typeof ApiConfig !== 'undefined' && typeof ApiConfig.getApiBaseUrl === 'function') {
      return ApiConfig.getApiBaseUrl();
    }
    return '';
  }

  async postToBackend(endpoint, body = {}, signal) {
    const base = this.getBaseUrl();
    if (!base) {
      throw new Error('NO_API_BASE');
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${base}${cleanEndpoint}`;
    try {
      const fetchSignal = signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        signal: fetchSignal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[YouTubeMusicProvider] POST ${cleanEndpoint} fallback:`, err.message);
      this.health = ProviderHealthState.DEGRADED;
      throw err;
    }
  }

  /**
   * Search YouTube Music catalog
   */
  async search(query, options = {}) {
    const limit = options.limit || 20;
    try {
      const data = await this.postToBackend('/api/providers/ytmusic/search', { query, limit }, options.signal);
      const rawSongs = data?.songs || [];
      const rawArtists = data?.artists || [];
      const rawAlbums = data?.albums || [];
      const rawPlaylists = data?.playlists || [];

      const songs = rawSongs.map(s => normalizeTrackSchema({
        ...s,
        provider: MusicProviderTypes.YOUTUBE_MUSIC,
        audioUrl: s.streamUrl || s.url || '',
        streamUrl: s.streamUrl || s.url || ''
      }, MusicProviderTypes.YOUTUBE_MUSIC));

      return {
        songs,
        artists: rawArtists,
        albums: rawAlbums,
        playlists: rawPlaylists,
        total: songs.length
      };
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.search === 'function') {
        try {
          const sRes = await service.search(query, limit);
          const songs = (sRes?.songs || []).map(s => normalizeTrackSchema({
            ...s,
            provider: MusicProviderTypes.YOUTUBE_MUSIC,
            audioUrl: s.streamUrl || s.url || '',
            streamUrl: s.streamUrl || s.url || ''
          }, MusicProviderTypes.YOUTUBE_MUSIC));
          return {
            songs,
            artists: sRes?.artists || [],
            albums: sRes?.albums || [],
            playlists: sRes?.playlists || [],
            total: songs.length
          };
        } catch (_) {}
      }
      return { songs: [], artists: [], albums: [], playlists: [], total: 0 };
    }
  }

  /**
   * Get YouTube Music song details
   */
  async getSongDetails(songId, options = {}) {
    const cleanId = String(songId).replace(/^yt_/, '');
    try {
      const data = await this.postToBackend('/api/providers/ytmusic/song', { videoId: cleanId }, options.signal);
      if (data && (data.id || data.videoId)) {
        return normalizeTrackSchema({
          ...data,
          provider: MusicProviderTypes.YOUTUBE_MUSIC,
          audioUrl: data.streamUrl || data.url || '',
          streamUrl: data.streamUrl || data.url || ''
        }, MusicProviderTypes.YOUTUBE_MUSIC);
      }
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.importTrack === 'function') {
        try {
          const res = await service.importTrack(cleanId);
          if (res?.track) {
            return normalizeTrackSchema(res.track, MusicProviderTypes.YOUTUBE_MUSIC);
          }
        } catch (_) {}
      }
    }
    return null;
  }

  /**
   * Get YouTube Music artist discography
   */
  async getArtist(artistIdOrName, options = {}) {
    const isBrowseId = String(artistIdOrName).startsWith('UC') || String(artistIdOrName).startsWith('FEmusic_artist');
    const payload = isBrowseId ? { browseId: artistIdOrName } : { name: artistIdOrName };
    try {
      const data = await this.postToBackend('/api/providers/ytmusic/artist', payload, options.signal);
      if (data && data.songs) {
        data.songs = data.songs.map(s => normalizeTrackSchema({
          ...s,
          provider: MusicProviderTypes.YOUTUBE_MUSIC,
          audioUrl: s.streamUrl || s.url || '',
          streamUrl: s.streamUrl || s.url || ''
        }, MusicProviderTypes.YOUTUBE_MUSIC));
      }
      return data;
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.getArtist === 'function') {
        try {
          return await service.getArtist(artistIdOrName, artistIdOrName);
        } catch (_) {}
      }
      return { artist: null, songs: [], albums: [], singles: [] };
    }
  }

  /**
   * Get YouTube Music album details & tracklist
   */
  async getAlbum(albumId, options = {}) {
    try {
      const data = await this.postToBackend('/api/providers/ytmusic/album', { browseId: albumId }, options.signal);
      if (data && data.songs) {
        data.songs = data.songs.map(s => normalizeTrackSchema({
          ...s,
          provider: MusicProviderTypes.YOUTUBE_MUSIC,
          audioUrl: s.streamUrl || s.url || '',
          streamUrl: s.streamUrl || s.url || ''
        }, MusicProviderTypes.YOUTUBE_MUSIC));
      }
      return data;
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.getAlbum === 'function') {
        try {
          return await service.getAlbum(albumId);
        } catch (_) {}
      }
      return { album: null };
    }
  }

  /**
   * Generate Automix Radio playlist from seed track
   */
  async getRadioMix(seedTrack, options = {}) {
    if (!seedTrack) return [];
    const videoId = String(seedTrack.id || seedTrack.videoId || seedTrack.sourceYtVideoId || '').replace(/^yt_/, '');
    const artist = (typeof seedTrack.artists === 'string')
      ? seedTrack.artists
      : (Array.isArray(seedTrack.artists) ? seedTrack.artists.map(a => a.name || a).join(', ') : '');

    try {
      const data = await this.postToBackend('/api/providers/ytmusic/radio', {
        videoId: videoId,
        title: seedTrack.name || seedTrack.title || '',
        artist: artist,
        limit: options.limit || 25
      }, options.signal);

      const rawSongs = data?.songs || [];
      return rawSongs.map(s => normalizeTrackSchema({
        ...s,
        provider: MusicProviderTypes.YOUTUBE_MUSIC,
        audioUrl: s.streamUrl || s.url || '',
        streamUrl: s.streamUrl || s.url || ''
      }, MusicProviderTypes.YOUTUBE_MUSIC));
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.getRadioCandidates === 'function') {
        try {
          const rRes = await service.getRadioCandidates(videoId, seedTrack.name || seedTrack.title, artist, options.limit || 25);
          return (rRes?.songs || []).map(s => normalizeTrackSchema({
            ...s,
            provider: MusicProviderTypes.YOUTUBE_MUSIC,
            audioUrl: s.streamUrl || s.url || '',
            streamUrl: s.streamUrl || s.url || ''
          }, MusicProviderTypes.YOUTUBE_MUSIC));
        } catch (_) {}
      }
      return [];
    }
  }

  /**
   * Import YouTube Music playlist URL with high accuracy matching
   */
  async importPlaylist(url, options = {}) {
    const service = getYTMService();
    if (service && typeof service.importAndMatchPlaylist === 'function') {
      try {
        const data = await service.importAndMatchPlaylist(url);
        if (data && data.matchedTracks) {
          data.matchedTracks = data.matchedTracks.map(s => normalizeTrackSchema(s, s.provider || MusicProviderTypes.JIOSAAVN));
        }
        if (data && data.allTracks) {
          data.allTracks = data.allTracks.map(s => normalizeTrackSchema(s, s.provider || MusicProviderTypes.JIOSAAVN));
        }
        return data;
      } catch (svcErr) {
        console.warn('[YouTubeMusicProvider] getYTMService import error:', svcErr.message);
      }
    }

    try {
      const data = await this.postToBackend('/api/providers/ytmusic/import-playlist', { url }, options.signal);
      if (data && data.matchedTracks) {
        data.matchedTracks = data.matchedTracks.map(s => normalizeTrackSchema(s, s.provider || MusicProviderTypes.JIOSAAVN));
      }
      if (data && data.allTracks) {
        data.allTracks = data.allTracks.map(s => normalizeTrackSchema(s, s.provider || MusicProviderTypes.JIOSAAVN));
      }
      return data;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Import single YouTube Music track URL or videoId
   */
  async importTrack(urlOrId, options = {}) {
    const service = getYTMService();
    if (service && typeof service.importTrack === 'function') {
      try {
        const data = await service.importTrack(urlOrId);
        if (data && data.track) {
          data.track = normalizeTrackSchema(data.track, data.track.provider || MusicProviderTypes.YOUTUBE_MUSIC);
        }
        return data;
      } catch (svcErr) {
        console.warn('[YouTubeMusicProvider] getYTMService track import error:', svcErr.message);
      }
    }

    try {
      const data = await this.postToBackend('/api/providers/ytmusic/import-track', { url: urlOrId }, options.signal);
      if (data && data.track) {
        data.track = normalizeTrackSchema(data.track, data.track.provider || MusicProviderTypes.YOUTUBE_MUSIC);
      }
      return data;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Canonical resolveTrack method: Performs YouTube metadata -> JioSaavn match -> best source -> normalized Track
   */
  async resolveTrack(metadata, options = {}) {
    const service = getYTMService();
    if (service && typeof service.importTrack === 'function') {
      const urlOrId = metadata?.videoId || metadata?.sourceYtVideoId || metadata?.id || metadata?.url || metadata;
      try {
        const res = await service.importTrack(urlOrId);
        if (res && res.track) {
          return normalizeTrackSchema(res.track, res.track.provider || MusicProviderTypes.YOUTUBE_MUSIC);
        }
      } catch (_) {}
    }
    return normalizeTrackSchema(metadata, MusicProviderTypes.YOUTUBE_MUSIC);
  }

  /**
   * Resolve playable stream URL for a YouTube Music track/videoId
   */
  async resolveStream(videoId, options = {}) {
    const cleanId = String(videoId || '').replace(/^yt_/, '').trim();
    if (!cleanId) return null;

    try {
      const data = await this.postToBackend('/api/providers/ytmusic/stream', { videoId: cleanId }, options.signal);
      if (data && data.url) {
        return {
          url: data.url,
          mimeType: data.mimeType || 'audio/mp4',
          bitrate: data.bitrate || 160000,
          quality: data.quality || 'HIGH',
          provider: MusicProviderTypes.YOUTUBE_MUSIC,
          providerId: cleanId,
          expiresInSeconds: data.expiresInSeconds || 21600
        };
      }
    } catch (err) {
      const service = getYTMService();
      if (service && typeof service.getStreamUrl === 'function') {
        try {
          const sRes = await service.getStreamUrl(cleanId);
          if (sRes && sRes.url) {
            return {
              url: sRes.url,
              mimeType: sRes.mimeType || 'audio/mp4',
              bitrate: sRes.bitrate || 128000,
              quality: 'HIGH',
              provider: MusicProviderTypes.YOUTUBE_MUSIC,
              providerId: cleanId,
              expiresInSeconds: sRes.expiresInSeconds || 3600
            };
          }
        } catch (_) {}
      }
    }
    return null;
  }

  async checkHealth() {
    this.health = ProviderHealthState.AVAILABLE;
    return this.health;
  }
}

// Instantiate and register with central ProviderManager
const ytMusicProvider = new YouTubeMusicProvider();

if (typeof providerManager !== 'undefined' && typeof providerManager.registerProvider === 'function') {
  providerManager.registerProvider(ytMusicProvider);
}

if (typeof window !== 'undefined') {
  window.YouTubeMusicProvider = YouTubeMusicProvider;
  window.ytMusicProvider = ytMusicProvider;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { YouTubeMusicProvider, ytMusicProvider };
}
})();

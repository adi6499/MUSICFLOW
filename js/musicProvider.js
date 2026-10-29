// ==========================================================================
// MUSICFLOW — CORE MUSIC PROVIDER INTERFACE & MANAGER
// Lightweight, extensible multi-provider abstraction layer for MusicFlow.
// ==========================================================================

const MusicProviderTypes = {
  JIOSAAVN: 'jiosaavn',
  YOUTUBE_MUSIC: 'youtube_music',
  LOCAL: 'local'
};

const ProviderHealthState = {
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE'
};

/**
 * Base MusicProvider Interface
 * All music providers (JioSaavn, YouTube Music, Local) adhere to this contract.
 */
class MusicProvider {
  constructor(name, priority = 50) {
    this.name = name;
    this.priority = priority; // Higher priority preferred for playback (e.g. JioSaavn: 100, YT: 50)
    this.health = ProviderHealthState.AVAILABLE;
    this.lastHealthCheck = Date.now();
  }

  /**
   * Search catalog
   * @param {string} query
   * @param {Object} options { page, limit, type: 'all'|'songs'|'artists'|'albums'|'playlists' }
   * @returns {Promise<{ songs: Array, artists: Array, albums: Array, playlists: Array }>}
   */
  async search(query, options = {}) {
    throw new Error(`[${this.name}] search() not implemented`);
  }

  /**
   * Get track metadata & stream details
   * @param {string} trackId
   * @returns {Promise<Object|null>} Normalized track object
   */
  async getTrack(trackId) {
    throw new Error(`[${this.name}] getTrack() not implemented`);
  }

  /**
   * Get artist discography & details
   * @param {string} artistIdOrName
   * @returns {Promise<Object|null>}
   */
  async getArtist(artistIdOrName) {
    throw new Error(`[${this.name}] getArtist() not implemented`);
  }

  /**
   * Get album metadata & tracklist
   * @param {string} albumId
   * @returns {Promise<Object|null>}
   */
  async getAlbum(albumId) {
    throw new Error(`[${this.name}] getAlbum() not implemented`);
  }

  /**
   * Get playlist metadata & tracklist
   * @param {string} playlistId
   * @returns {Promise<Object|null>}
   */
  async getPlaylist(playlistId) {
    throw new Error(`[${this.name}] getPlaylist() not implemented`);
  }

  /**
   * Get related tracks / recommendations
   * @param {string} trackId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getRelatedTracks(trackId, limit = 20) {
    throw new Error(`[${this.name}] getRelatedTracks() not implemented`);
  }

  /**
   * Get track-based continuous radio queue
   * @param {Object} seedTrack
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  async getRadio(seedTrack, options = {}) {
    throw new Error(`[${this.name}] getRadio() not implemented`);
  }

  /**
   * Get lyrics (synced & plain)
   * @param {string} trackName
   * @param {string} artistName
   * @param {number} duration
   * @returns {Promise<{ synced: string|null, plain: string|null }|null>}
   */
  async getLyrics(trackName, artistName, duration = 0) {
    return null;
  }

  /**
   * Check provider connectivity and status
   * @returns {Promise<string>} ProviderHealthState
   */
  async checkHealth() {
    return this.health;
  }
}

function getNormalizer() {
  if (typeof window !== 'undefined' && window.DataNormalizer) return window.DataNormalizer;
  if (typeof global !== 'undefined' && global.DataNormalizer) return global.DataNormalizer;
  if (typeof require !== 'undefined') {
    try { return require('./dataNormalizer.js'); } catch (_) {}
  }
  return null;
}

/**
 * Normalizes raw provider payloads into canonical MusicFlow Track Schema
 */
function normalizeTrackSchema(raw, defaultProvider = 'unknown') {
  if (!raw) return null;
  const normalizer = getNormalizer();
  if (normalizer && normalizer.normalizeTrack) {
    return normalizer.normalizeTrack(raw, defaultProvider);
  }

  const provider = raw.provider || defaultProvider;
  const rawId = raw.id || raw.videoId || raw._id || raw.trackId || '';
  const providerId = String(raw.providerId || rawId || Math.random().toString(36).substring(2, 9));

  // Canonical ID format
  let canonicalId = String(raw.id || raw._id || '');
  if (!canonicalId) {
    canonicalId = provider === 'youtube_music' ? `yt_${providerId}` : providerId;
  }

  // Artists normalization
  let artistsStr = '';
  if (typeof raw.artists === 'string' && raw.artists.trim()) {
    artistsStr = raw.artists.trim();
  } else if (typeof raw.primaryArtists === 'string' && raw.primaryArtists.trim()) {
    artistsStr = raw.primaryArtists.trim();
  } else if (typeof raw.artist === 'string' && raw.artist.trim()) {
    artistsStr = raw.artist.trim();
  } else if (Array.isArray(raw.artists)) {
    artistsStr = raw.artists.map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean).join(', ');
  } else if (Array.isArray(raw.primaryArtists)) {
    artistsStr = raw.primaryArtists.map(a => typeof a === 'object' ? (a.name || a.title || '') : a).filter(Boolean).join(', ');
  } else if (typeof raw.subtitle === 'string' && raw.subtitle.trim()) {
    artistsStr = raw.subtitle.trim();
  }

  if (!artistsStr || artistsStr.toLowerCase() === 'unknown artist') {
    artistsStr = raw.name ? `${raw.name} Artist` : 'MusicFlow';
  }

  // Title normalization
  let titleStr = raw.name || raw.title || raw.song || 'Unknown Track';
  if (titleStr.toLowerCase() === 'trending' && raw.album && typeof raw.album === 'string') {
    titleStr = raw.album;
  }

  // Album normalization
  let albumStr = '';
  let albumIdStr = raw.albumId || '';
  if (typeof raw.album === 'object' && raw.album !== null) {
    albumStr = raw.album.name || raw.album.title || '';
    albumIdStr = raw.album.id || albumIdStr;
  } else if (typeof raw.album === 'string') {
    albumStr = raw.album;
  }

  // Image / Artwork extraction (HD 500x500)
  let artwork = 'assets/logo.png';
  if (typeof raw.image === 'string' && raw.image.startsWith('http')) {
    artwork = raw.image;
  } else if (typeof raw.artwork === 'string' && raw.artwork.startsWith('http')) {
    artwork = raw.artwork;
  } else if (Array.isArray(raw.image) && raw.image.length > 0) {
    const hi = raw.image.find(i => i.quality === '500x500') || raw.image[raw.image.length - 1];
    artwork = hi?.url || hi?.link || raw.image[0]?.url || raw.image[0]?.link || artwork;
  } else if (Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0) {
    const hi = raw.thumbnails[raw.thumbnails.length - 1];
    artwork = hi?.url || artwork;
  } else if (typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('http')) {
    artwork = raw.thumbnail;
  } else if (typeof raw.cover === 'string' && raw.cover.startsWith('http')) {
    artwork = raw.cover;
  }

  if (artwork.startsWith('http')) {
    artwork = artwork.replace(/50x50|150x150/, '500x500');
  }

  // Duration in seconds
  let durationSec = 0;
  if (typeof raw.duration === 'number') {
    durationSec = Math.round(raw.duration);
  } else if (typeof raw.duration === 'string') {
    if (raw.duration.includes(':')) {
      const parts = raw.duration.split(':').map(Number);
      if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
      else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      durationSec = parseInt(raw.duration, 10) || 0;
    }
  }

  // Playback availability
  const audioUrl = raw.audioUrl || raw.streamUrl || '';
  const downloadUrl = Array.isArray(raw.downloadUrl) ? raw.downloadUrl : (Array.isArray(raw.downloadUrls) ? raw.downloadUrls : []);
  const hasDirectStream = Boolean((audioUrl && audioUrl.startsWith('http')) || downloadUrl.length > 0);

  return {
    id: canonicalId,
    name: titleStr,
    title: titleStr,
    artists: artistsStr,
    primaryArtist: (artistsStr.split(/[,;&/]/)[0] || 'MusicFlow').trim(),
    album: albumStr,
    albumId: albumIdStr,
    duration: durationSec,
    rawDuration: raw.rawDuration || raw.duration || durationSec,
    image: artwork,
    audioUrl: audioUrl,
    streamUrl: raw.streamUrl || audioUrl,
    downloadUrl: downloadUrl,
    year: raw.year ? String(raw.year) : '',
    language: raw.language || 'hindi',
    hasLyrics: Boolean(raw.hasLyrics),
    provider: provider,
    providerId: providerId,
    metadataAvailable: true,
    playbackAvailable: hasDirectStream || provider === 'jiosaavn' || provider === 'local'
  };
}

/**
 * Universal Provider Manager
 * Coordinates multi-provider execution, parallel search, deduplication, and health monitoring.
 */
class ProviderManager {
  constructor() {
    this.providers = new Map();
    this.primaryProvider = null;
  }

  /**
   * Register a music provider
   * @param {MusicProvider} provider
   * @param {boolean} isPrimary
   */
  registerProvider(provider, isPrimary = false) {
    if (!provider || !provider.name) return;
    this.providers.set(provider.name, provider);
    if (isPrimary || !this.primaryProvider) {
      this.primaryProvider = provider;
    }
  }

  /**
   * Get a registered provider by name
   * @param {string} name
   * @returns {MusicProvider|null}
   */
  getProvider(name) {
    return this.providers.get(name) || null;
  }

  /**
   * Get all registered providers sorted by priority descending
   * @returns {Array<MusicProvider>}
   */
  getAllProviders() {
    return Array.from(this.providers.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Execute parallel multi-provider search with strict timeouts
   * @param {string} query
   * @param {Object} options
   * @returns {Promise<{ songs: Array, artists: Array, albums: Array, playlists: Array, providerBreakdown: Object }>}
   */
  async searchUnified(query, options = {}) {
    const timeoutMs = options.timeoutMs || 4000;
    const providersList = this.getAllProviders();

    if (providersList.length === 0) {
      return { songs: [], artists: [], albums: [], playlists: [], providerBreakdown: {} };
    }

    const promises = providersList.map(p => {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(() => { if (controller) controller.abort(); }, timeoutMs);

      return p.search(query, { ...options, signal: controller ? controller.signal : undefined })
        .then(res => {
          clearTimeout(timer);
          return { provider: p.name, result: res, error: null };
        })
        .catch(err => {
          clearTimeout(timer);
          console.warn(`[ProviderManager] ${p.name} search failed/timed out:`, err.message);
          return { provider: p.name, result: null, error: err.message };
        });
    });

    const searchResponses = await Promise.all(promises);

    let allSongs = [];
    let allArtists = [];
    let allAlbums = [];
    let allPlaylists = [];
    const providerBreakdown = {};

    searchResponses.forEach(({ provider, result, error }) => {
      providerBreakdown[provider] = {
        success: !error && Boolean(result),
        songCount: result?.songs?.length || 0,
        error: error || null
      };

      if (result) {
        if (Array.isArray(result.songs)) allSongs.push(...result.songs);
        if (Array.isArray(result.artists)) allArtists.push(...result.artists);
        if (Array.isArray(result.albums)) allAlbums.push(...result.albums);
        if (Array.isArray(result.playlists)) allPlaylists.push(...result.playlists);
      }
    });

    // Normalize all tracks
    const normalizedSongs = allSongs.map(s => normalizeTrackSchema(s, s.provider || 'unknown')).filter(Boolean);

    return {
      songs: normalizedSongs,
      artists: allArtists,
      albums: allAlbums,
      playlists: allPlaylists,
      providerBreakdown
    };
  }

  /**
   * Check health of all providers
   * @returns {Promise<Object>}
   */
  async checkHealth() {
    const status = {};
    for (const [name, provider] of this.providers.entries()) {
      try {
        const state = await provider.checkHealth();
        status[name] = state || ProviderHealthState.AVAILABLE;
      } catch (err) {
        status[name] = ProviderHealthState.UNAVAILABLE;
      }
    }
    return status;
  }
}

// Global Singleton Instance
const providerManagerInstance = new ProviderManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MusicProvider,
    MusicProviderTypes,
    ProviderHealthState,
    normalizeTrackSchema,
    ProviderManager,
    providerManager: providerManagerInstance
  };
}

if (typeof window !== 'undefined') {
  window.MusicProvider = MusicProvider;
  window.MusicProviderTypes = MusicProviderTypes;
  window.ProviderHealthState = ProviderHealthState;
  window.normalizeTrackSchema = normalizeTrackSchema;
  window.ProviderManager = ProviderManager;
  window.providerManager = providerManagerInstance;
}

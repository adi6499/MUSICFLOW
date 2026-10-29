(() => {
  const { MusicProvider, MusicProviderTypes, ProviderHealthState, normalizeTrackSchema, providerManager } = 
    (typeof require !== 'undefined') ? require('./musicProvider.js') : {
      MusicProvider: window.MusicProvider,
      MusicProviderTypes: window.MusicProviderTypes,
      ProviderHealthState: window.ProviderHealthState,
      normalizeTrackSchema: window.normalizeTrackSchema,
      providerManager: window.providerManager
    };

  class JioSaavnProvider extends MusicProvider {
  constructor() {
    super(MusicProviderTypes.JIOSAAVN, 100); // Priority 100 = Primary Playback Provider
    this.primaryHosts = [
      'https://spoton-sigma.vercel.app/api',
      'https://spoton-trpn.vercel.app/api'
    ];
    this.currentHostIndex = 0;
  }

  getPrimaryHosts() {
    const hosts = [];
    if (typeof ApiConfig !== 'undefined' && typeof ApiConfig.getJioSaavnApiBase === 'function') {
      hosts.push(ApiConfig.getJioSaavnApiBase());
    }
    if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
      hosts.push(`${window.location.origin}/api`);
    }
    hosts.push('https://spoton-sigma.vercel.app/api');
    hosts.push('https://spoton-trpn.vercel.app/api');
    return [...new Set(hosts.filter(Boolean))];
  }

  async fetchWithFallback(endpoint, params = {}, signal) {
    const query = new URLSearchParams(params).toString();
    const cleanEndpoint = endpoint.startsWith('/api/')
      ? endpoint.replace(/^\/api/, '')
      : (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
    const path = `${cleanEndpoint}${query ? '?' + query : ''}`;
    const hosts = this.getPrimaryHosts();

    for (let i = 0; i < hosts.length; i++) {
      const idx = (this.currentHostIndex + i) % hosts.length;
      const url = `${hosts[idx]}${path}`;

      try {
        const fetchSignal = signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined);
        const res = await fetch(url, { signal: fetchSignal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.currentHostIndex = idx;
        this.health = ProviderHealthState.AVAILABLE;
        return data;
      } catch (err) {
        console.warn(`[JioSaavnProvider] Host ${hosts[idx]} failed for ${cleanEndpoint}:`, err.message);
      }
    }
    this.health = ProviderHealthState.DEGRADED;
    throw new Error(`[JioSaavnProvider] All hosts failed for ${cleanEndpoint}`);
  }

  async search(query, options = {}) {
    const page = options.page || 1;
    const limit = options.limit || 30;
    const cleanQ = (query || '').trim();
    if (!cleanQ) return { songs: [], artists: [], albums: [], playlists: [] };

    try {
      const promises = [
        this.fetchWithFallback('/search/songs', { query: cleanQ, page, limit }, options.signal).catch(() => ({ data: { results: [] } })),
        this.fetchWithFallback('/search/artists', { query: cleanQ, page, limit: 10 }, options.signal).catch(() => ({ data: { results: [] } })),
        this.fetchWithFallback('/search/albums', { query: cleanQ, page, limit: 10 }, options.signal).catch(() => ({ data: { results: [] } })),
        this.fetchWithFallback('/search/playlists', { query: cleanQ, page, limit: 10 }, options.signal).catch(() => ({ data: { results: [] } }))
      ];

      const [songsRes, artistsRes, albumsRes, playlistsRes] = await Promise.all(promises);

      const rawSongs = songsRes?.data?.results || songsRes?.results || [];
      const rawArtists = artistsRes?.data?.results || artistsRes?.results || [];
      const rawAlbums = albumsRes?.data?.results || albumsRes?.results || [];
      const rawPlaylists = playlistsRes?.data?.results || playlistsRes?.results || [];

      const songs = rawSongs.map(s => normalizeTrackSchema({ ...s, provider: MusicProviderTypes.JIOSAAVN }, MusicProviderTypes.JIOSAAVN));

      return {
        songs,
        artists: rawArtists,
        albums: rawAlbums,
        playlists: rawPlaylists
      };
    } catch (err) {
      console.warn('[JioSaavnProvider] search failed:', err.message);
      return { songs: [], artists: [], albums: [], playlists: [] };
    }
  }

  async getTrack(trackId) {
    if (!trackId) return null;
    try {
      const res = await this.fetchWithFallback(`/songs/${trackId}`);
      const list = Array.isArray(res?.data) ? res.data : (res?.data ? [res.data] : (Array.isArray(res) ? res : []));
      if (list.length > 0) {
        return normalizeTrackSchema({ ...list[0], provider: MusicProviderTypes.JIOSAAVN }, MusicProviderTypes.JIOSAAVN);
      }
      return null;
    } catch (err) {
      console.warn(`[JioSaavnProvider] getTrack(${trackId}) failed:`, err.message);
      return null;
    }
  }

  async getArtist(artistIdOrName) {
    if (!artistIdOrName) return null;
    try {
      if (/^[0-9]+$/.test(String(artistIdOrName).trim())) {
        const res = await this.fetchWithFallback('/artists', { id: artistIdOrName });
        const data = res?.data || res;
        if (data) return data;
      }
      const searchRes = await this.fetchWithFallback('/search/artists', { query: artistIdOrName, limit: 3 });
      const items = searchRes?.data?.results || searchRes?.results || [];
      return items[0] || null;
    } catch (err) {
      console.warn(`[JioSaavnProvider] getArtist failed:`, err.message);
      return null;
    }
  }

  async getAlbum(albumId) {
    if (!albumId) return null;
    try {
      const res = await this.fetchWithFallback('/albums', { id: albumId, limit: 100 });
      const data = res?.data || res;
      if (data && Array.isArray(data.songs)) {
        data.songs = data.songs.map(s => normalizeTrackSchema({ ...s, provider: MusicProviderTypes.JIOSAAVN }, MusicProviderTypes.JIOSAAVN));
      }
      return data;
    } catch (err) {
      console.warn(`[JioSaavnProvider] getAlbum failed:`, err.message);
      return null;
    }
  }

  async getPlaylist(playlistId) {
    if (!playlistId) return null;
    try {
      const res = await this.fetchWithFallback('/playlists', { id: playlistId, limit: 100 });
      const data = res?.data || res;
      if (data && Array.isArray(data.songs)) {
        data.songs = data.songs.map(s => normalizeTrackSchema({ ...s, provider: MusicProviderTypes.JIOSAAVN }, MusicProviderTypes.JIOSAAVN));
      }
      return data;
    } catch (err) {
      console.warn(`[JioSaavnProvider] getPlaylist failed:`, err.message);
      return null;
    }
  }

  async getRelatedTracks(trackId, limit = 20) {
    if (!trackId) return [];
    try {
      const track = await this.getTrack(trackId);
      if (!track) return [];
      const artist = (typeof track.primaryArtist === 'string' && track.primaryArtist) || (typeof track.artists === 'string' ? track.artists : '');
      const searchRes = await this.search(`${artist} Hits`, { limit });
      return searchRes.songs.filter(s => String(s.id) !== String(trackId));
    } catch (err) {
      return [];
    }
  }

  async getRadio(seedTrack, options = {}) {
    if (!seedTrack) return [];
    const limit = options.limit || 20;
    const artist = (typeof seedTrack.primaryArtist === 'string' && seedTrack.primaryArtist) || (typeof seedTrack.artists === 'string' ? seedTrack.artists.split(',')[0].trim() : '');
    if (!artist) return [];

    try {
      const [artistSongs, hits] = await Promise.allSettled([
        this.search(artist, { limit }),
        this.search(`${artist} Best Of`, { limit })
      ]);
      const songsA = artistSongs.status === 'fulfilled' ? artistSongs.value.songs : [];
      const songsB = hits.status === 'fulfilled' ? hits.value.songs : [];
      const all = [...songsA, ...songsB].filter(s => s && String(s.id) !== String(seedTrack.id));
      
      const unique = [];
      const seen = new Set();
      for (const s of all) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          unique.push(s);
        }
      }
      return unique.slice(0, limit);
    } catch (err) {
      return [];
    }
  }

  async checkHealth() {
    try {
      const res = await this.fetchWithFallback('/search/songs', { query: 'test', limit: 1 });
      this.health = (res && (res.data || res.results)) ? ProviderHealthState.AVAILABLE : ProviderHealthState.DEGRADED;
    } catch (err) {
      this.health = 'SAAVN_PROVIDER_UNAVAILABLE';
    }
    return this.health;
  }
}

// Instantiate and register
const jioSaavnProviderInstance = new JioSaavnProvider();
if (providerManager) {
  providerManager.registerProvider(jioSaavnProviderInstance, true);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JioSaavnProvider, jioSaavnProvider: jioSaavnProviderInstance };
}

if (typeof window !== 'undefined') {
  window.JioSaavnProvider = JioSaavnProvider;
  window.jioSaavnProvider = jioSaavnProviderInstance;
}
})();

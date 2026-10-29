// ============================================================================
// MUSICFLOW — CENTRALIZED NATIVE MEDIA BRIDGE
// Connects the JavaScript/WebView Player to the Native OS Media Session Layer:
// • Android: Media3 / MediaSessionService / MediaStyle Lock Screen Notification
// • iOS: MPNowPlayingInfoCenter / MPRemoteCommandCenter / AVAudioSession
// • Browser / PWA: navigator.mediaSession fallback
// ============================================================================

var NativeMedia = (function() {
  let lastTrackId = null;
  let lastState = null;
  let lastPosition = 0;
  let lastDuration = 0;
  let lastArtworkUrl = '';

  /**
   * Safe helper to extract high-resolution image URL
   */
  function getAbsoluteArtworkUrl(song) {
    if (!song) return 'assets/logo.png';
    let url = song.image || song.albumArt || song.artwork || 'assets/logo.png';

    if (Array.isArray(url) && url.length > 0) {
      const best = url[url.length - 1];
      url = (best && typeof best === 'object') ? (best.url || best.link || '') : String(best || '');
    } else if (typeof url === 'object' && url !== null) {
      url = url.url || url.link || url.src || '';
    }

    url = String(url || '').trim();
    if (!url) url = 'assets/logo.png';

    // Upgrade thumbnail size if applicable
    if (url.includes('50x50')) url = url.replace('50x50', '500x500');
    if (url.includes('150x150')) url = url.replace('150x150', '500x500');

    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (url.startsWith('https://')) return url;

    try {
      if (typeof window !== 'undefined' && window.location) {
        return new URL(url, window.location.href).href;
      }
    } catch (_) {}

    return url;
  }

  /**
   * Safe helper to extract canonical artist name
   */
  function getCanonicalArtist(song) {
    if (!song) return 'Unknown Artist';
    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistString) {
      return DataNormalizer.getArtistString(song);
    }
    if (typeof song.artists === 'string' && song.artists.trim()) return song.artists.trim();
    if (Array.isArray(song.artists)) {
      return song.artists.map(a => (typeof a === 'object' ? (a.name || a.title || '') : String(a))).filter(Boolean).join(', ');
    }
    if (typeof song.primaryArtist === 'string' && song.primaryArtist.trim()) return song.primaryArtist.trim();
    if (typeof song.artist === 'string' && song.artist.trim()) return song.artist.trim();
    return 'Unknown Artist';
  }

  /**
   * Synchronize with standard browser mediaSession
   */
  function getMediaMetadataConstructor() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.MediaMetadata) return globalThis.MediaMetadata;
      if (typeof window !== 'undefined' && window.MediaMetadata) return window.MediaMetadata;
      if (typeof MediaMetadata !== 'undefined') return MediaMetadata;
    } catch (_) {}
    return null;
  }

  function getNavigator() {
    try {
      if (typeof window !== 'undefined' && window.navigator && 'mediaSession' in window.navigator) {
        return window.navigator;
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        return navigator;
      }
      if (typeof globalThis !== 'undefined' && globalThis.navigator && 'mediaSession' in globalThis.navigator) {
        return globalThis.navigator;
      }
    } catch (_) {}
    return null;
  }

  function updateBrowserMediaSession(meta) {
    const nav = getNavigator();
    if (!nav || !('mediaSession' in nav)) return;

    try {
      const MetaCtor = getMediaMetadataConstructor();
      if (MetaCtor) {
        nav.mediaSession.metadata = new MetaCtor({
          title: meta.title || 'MusicFlow',
          artist: meta.artist || 'Unknown Artist',
          album: meta.album || 'MusicFlow Lossless',
          artwork: [
            { src: meta.artwork, sizes: '96x96', type: 'image/png' },
            { src: meta.artwork, sizes: '128x128', type: 'image/png' },
            { src: meta.artwork, sizes: '256x256', type: 'image/png' },
            { src: meta.artwork, sizes: '512x512', type: 'image/png' }
          ]
        });
      }

      if ('setPositionState' in nav.mediaSession && meta.duration > 0) {
        nav.mediaSession.setPositionState({
          duration: Math.max(0, meta.duration),
          playbackRate: meta.playbackRate || 1.0,
          position: Math.max(0, Math.min(meta.position, meta.duration))
        });
      }

      nav.mediaSession.playbackState = meta.isPlaying ? 'playing' : 'paused';
    } catch (e) {
      console.warn('[NativeMedia] Browser MediaSession update error:', e);
    }
  }

  /**
   * Setup standard browser action handlers
   */
  function setupBrowserMediaActions() {
    const nav = getNavigator();
    if (!nav || !('mediaSession' in nav)) return;

    const actionMap = [
      ['play', () => { if (typeof Player !== 'undefined' && Player.play) Player.play(); }],
      ['pause', () => { if (typeof Player !== 'undefined' && Player.pause) Player.pause(); }],
      ['previoustrack', () => { if (typeof Player !== 'undefined' && Player.previous) Player.previous(); }],
      ['nexttrack', () => { if (typeof Player !== 'undefined' && Player.next) Player.next(); }],
      ['seekto', (details) => {
        if (details && details.seekTime !== undefined && typeof Player !== 'undefined' && Player.seek) {
          Player.seek(details.seekTime);
        }
      }],
      ['stop', () => { if (typeof Player !== 'undefined' && Player.pause) Player.pause(); }]
    ];

    actionMap.forEach(([action, handler]) => {
      try {
        nav.mediaSession.setActionHandler(action, handler);
      } catch (_) {}
    });

    // Clear 15s/30s skips to guarantee system UI renders Previous / Next buttons
    try { nav.mediaSession.setActionHandler('seekforward', null); } catch (_) {}
    try { nav.mediaSession.setActionHandler('seekbackward', null); } catch (_) {}
  }

  return {
    /**
     * Publish complete track metadata and playback state to Native OS Media Session
     */
    updateMetadata(song, isPlaying = true, positionSec = 0, durationSec = 0) {
      if (!song) {
        this.clear();
        return;
      }

      setupBrowserMediaActions();

      const title = String(song.name || song.title || 'Unknown Track').trim();
      const artist = getCanonicalArtist(song);
      const album = String(song.album || song.albumTitle || 'MusicFlow Lossless').trim();
      const artwork = getAbsoluteArtworkUrl(song);
      const trackId = String(song.id || song.songId || song._id || title);
      const duration = Number(durationSec || song.duration || song.durationSeconds || 0);
      const position = Number(positionSec || 0);

      lastTrackId = trackId;
      lastArtworkUrl = artwork;
      lastDuration = duration;
      lastPosition = position;
      lastState = isPlaying;

      const payload = {
        id: trackId,
        title: title,
        artist: artist,
        album: album,
        artwork: artwork,
        duration: duration,
        position: position,
        isPlaying: Boolean(isPlaying),
        playbackRate: isPlaying ? 1.0 : 0.0
      };

      // 1. Android Native Bridge (@JavascriptInterface)
      if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.updateMetadata === 'function') {
        try {
          window.AndroidMediaBridge.updateMetadata(JSON.stringify(payload));
        } catch (e) {
          console.warn('[NativeMedia] AndroidMediaBridge.updateMetadata failed:', e);
        }
      }

      // 2. iOS Capacitor / WebKit MessageHandler
      if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
        try {
          window.webkit.messageHandlers.nativeMedia.postMessage({
            action: 'updateMetadata',
            ...payload
          });
        } catch (e) {
          console.warn('[NativeMedia] iOS webkit nativeMedia postMessage failed:', e);
        }
      }

      // 3. Browser MediaSession Fallback
      updateBrowserMediaSession(payload);
    },

    /**
     * Publish playback state changes (play, pause, seek, rate)
     */
    setPlaybackState(stateObj = {}) {
      const isPlaying = (stateObj.isPlaying !== undefined) ? Boolean(stateObj.isPlaying) : (lastState ?? false);
      const position = (stateObj.positionSec !== undefined) ? Number(stateObj.positionSec) : (stateObj.position || lastPosition);
      const duration = (stateObj.durationSec !== undefined) ? Number(stateObj.durationSec) : (stateObj.duration || lastDuration);
      const playbackRate = (stateObj.playbackRate !== undefined) ? Number(stateObj.playbackRate) : (isPlaying ? 1.0 : 0.0);

      lastState = isPlaying;
      lastPosition = position;
      lastDuration = duration;

      // 1. Android Native Bridge
      if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.setPlaybackState === 'function') {
        try {
          window.AndroidMediaBridge.setPlaybackState(isPlaying, position, duration, playbackRate);
        } catch (e) {
          console.warn('[NativeMedia] AndroidMediaBridge.setPlaybackState failed:', e);
        }
      }

      // 2. iOS WebKit MessageHandler
      if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
        try {
          window.webkit.messageHandlers.nativeMedia.postMessage({
            action: 'setPlaybackState',
            isPlaying: isPlaying,
            position: position,
            duration: duration,
            playbackRate: playbackRate
          });
        } catch (e) {
          console.warn('[NativeMedia] iOS webkit setPlaybackState failed:', e);
        }
      }

      // 3. Browser Fallback
      const nav = getNavigator();
      if (nav && 'mediaSession' in nav) {
        try {
          nav.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
          if ('setPositionState' in nav.mediaSession && duration > 0) {
            nav.mediaSession.setPositionState({
              duration: Math.max(0, duration),
              playbackRate: playbackRate,
              position: Math.max(0, Math.min(position, duration))
            });
          }
        } catch (_) {}
      }
    },

    /**
     * Synchronize queue with native media session
     */
    setQueue(queueList = [], currentIndex = 0) {
      if (!Array.isArray(queueList)) return;

      const summary = queueList.slice(0, 50).map(s => ({
        id: String(s.id || ''),
        title: String(s.name || s.title || ''),
        artist: getCanonicalArtist(s),
        artwork: getAbsoluteArtworkUrl(s),
        duration: Number(s.duration || 0)
      }));

      // Android Native Bridge
      if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.setQueue === 'function') {
        try {
          window.AndroidMediaBridge.setQueue(JSON.stringify(summary), currentIndex);
        } catch (e) {
          console.warn('[NativeMedia] AndroidMediaBridge.setQueue failed:', e);
        }
      }

      // iOS Native Bridge
      if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
        try {
          window.webkit.messageHandlers.nativeMedia.postMessage({
            action: 'setQueue',
            queue: summary,
            currentIndex: currentIndex
          });
        } catch (e) {
          console.warn('[NativeMedia] iOS webkit setQueue failed:', e);
        }
      }
    },

    /**
     * Clear / release native media sessions when playback ends
     */
    clear() {
      lastTrackId = null;
      lastState = false;

      if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.releaseSession === 'function') {
        try {
          window.AndroidMediaBridge.releaseSession();
        } catch (_) {}
      }

      if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.nativeMedia) {
        try {
          window.webkit.messageHandlers.nativeMedia.postMessage({ action: 'clear' });
        } catch (_) {}
      }

      const nav = getNavigator();
      if (nav && 'mediaSession' in nav) {
        try {
          nav.mediaSession.metadata = null;
          nav.mediaSession.playbackState = 'none';
        } catch (_) {}
      }
    },

    setupBrowserMediaActions
  };
})();

if (typeof window !== 'undefined') {
  window.NativeMedia = NativeMedia;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NativeMedia;
}

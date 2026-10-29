// ============================================================================
// MUSICFLOW — CENTRALIZED MULTI-PROVIDER PLAYBACK RESOLVER
// Single Source of Truth for Cross-Provider Playback Resolution & Stream Validation
// Priority: Downloaded > Local > Cached > Origin Provider > Fallback Provider
// ============================================================================

const PlaybackResolver = (() => {
  const SourceType = {
    DOWNLOADED: 'DOWNLOADED',
    LOCAL: 'LOCAL',
    CACHED: 'CACHED',
    STREAMING: 'STREAMING',
    UNKNOWN: 'UNKNOWN'
  };

  const ErrorCode = {
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    OFFLINE_UNAVAILABLE: 'OFFLINE_UNAVAILABLE',
    ABORTED: 'ABORTED',
    NETWORK_ERROR: 'NETWORK_ERROR'
  };

  // In-Memory Stream Cache with TTL (1 hour)
  const streamCache = new Map();
  const CACHE_TTL_MS = 60 * 60 * 1000;

  function getCachedStream(songId) {
    if (!songId) return null;
    const entry = streamCache.get(String(songId));
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
      return entry.streamUrl;
    }
    return null;
  }

  function setCachedStream(songId, streamUrl) {
    if (!songId || !streamUrl) return;
    streamCache.set(String(songId), { streamUrl, timestamp: Date.now() });
    if (streamCache.size > 200) {
      const oldest = streamCache.keys().next().value;
      streamCache.delete(oldest);
    }
  }

  /**
   * Safe helper to normalize artist strings without throwing TypeError
   */
  function safeArtistString(song) {
    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getArtistString) {
      return DataNormalizer.getArtistString(song);
    }
    if (!song) return '';
    if (typeof song.artists === 'string') return song.artists;
    if (Array.isArray(song.artists)) {
      return song.artists.map(a => (typeof a === 'object' ? a.name : a)).filter(Boolean).join(', ');
    }
    if (typeof song.artists === 'object' && song.artists !== null) {
      return song.artists.name || '';
    }
    return String(song.primaryArtist || song.artist || '');
  }

  /**
   * Safe helper to normalize track title
   */
  function safeTrackTitle(song) {
    if (typeof DataNormalizer !== 'undefined' && DataNormalizer.getTrackTitle) {
      return DataNormalizer.getTrackTitle(song);
    }
    return String(song?.name || song?.title || '').trim();
  }

  /**
   * Helper to strip video tags, channel names, and timestamps for robust catalog search
   */
  function extractCleanQueries(rawTitle, rawArtist) {
    let t = String(rawTitle || '').trim();
    let a = String(rawArtist || '').trim();

    t = t.replace(/\(lyrics\b.*?\)/gi, '')
         .replace(/\[lyrics\b.*?\]/gi, '')
         .replace(/\(official\b.*?\)/gi, '')
         .replace(/\[official\b.*?\]/gi, '')
         .replace(/\(audio\b.*?\)/gi, '')
         .replace(/\[audio\b.*?\]/gi, '')
         .replace(/\(video\b.*?\)/gi, '')
         .replace(/\[video\b.*?\]/gi, '')
         .replace(/\(slowed\b.*?\)/gi, '')
         .replace(/\[slowed\b.*?\]/gi, '')
         .replace(/\(reverb\b.*?\)/gi, '')
         .replace(/\(feat\b.*?\)/gi, '')
         .replace(/\[feat\b.*?\]/gi, '')
         .replace(/\(from\b.*?\)/gi, '')
         .replace(/\|.*?\|/g, ' ')
         .replace(/\|.*$/g, '');

    if (t.includes(' - ')) {
      t = t.split(' - ')[0].trim();
    }

    t = t.replace(/[|•~#_/*]/g, ' ').replace(/\s+/g, ' ').trim();

    if (/^\d+:\d+$/.test(a) || /^(d-muze|t-series|zee music|sony music|speed records|everything matters|tips|yrf)/i.test(a)) {
      a = '';
    }

    const queries = [];
    if (t && a) queries.push(`${t} ${a}`);
    if (t) queries.push(t);
    if (rawTitle && rawTitle !== t) {
      const basic = rawTitle.replace(/\(.*?\)|\[.*?\]/g, '').trim();
      if (basic) queries.push(basic);
    }
    return queries.filter((q, idx, arr) => q && arr.indexOf(q) === idx);
  }

  /**
   * Safe helper to strip formatting noise and punctuation for strict similarity comparison
   */
  function cleanTitleForMatching(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegex(s) {
    return String(s || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  /**
   * Computes strict title similarity score (0.0 to 1.0) between target and candidate titles
   */
  function computeTitleSimilarity(target, candidate) {
    const t = cleanTitleForMatching(target);
    const c = cleanTitleForMatching(candidate);
    if (!t || !c) return 0;
    if (t === c) return 1.0;

    const tWords = t.split(' ').filter(w => w.length > 1);
    const cWords = c.split(' ').filter(w => w.length > 1);
    if (tWords.length === 0 || cWords.length === 0) return t === c ? 1.0 : 0;

    const cSet = new Set(cWords);
    const intersection = tWords.filter(w => cSet.has(w));
    const overlapRatio = (2 * intersection.length) / (tWords.length + cWords.length);

    // Inclusion check with word boundary
    const tRegex = new RegExp('\\b' + escapeRegex(t) + '\\b', 'i');
    const cRegex = new RegExp('\\b' + escapeRegex(c) + '\\b', 'i');
    if (tRegex.test(c) || cRegex.test(t)) {
      const lenRatio = Math.min(t.length, c.length) / Math.max(t.length, c.length);
      // A short title contained in a much longer one ("Test" in "... test track") is not a match.
      if (lenRatio >= 0.6) {
        return Math.max(overlapRatio, 0.5 + lenRatio * 0.5);
      }
    }

    return overlapRatio;
  }

  /**
   * Helper to inspect search results and find the best playable audio stream matching the target track
   * Strictly verifies title similarity (threshold >= 0.55) to prevent playing completely unrelated songs
   */
  function findPlayableMatch(results, targetSong, preferredQuality) {
    if (!Array.isArray(results) || results.length === 0) return null;
    const urlOf = (item) => {
      const u = item.audioUrl || item.streamUrl || ((typeof API !== 'undefined' && API.getDownloadUrl) ? API.getDownloadUrl(item, preferredQuality) : '');
      return (u && typeof u === 'string' && u.trim().startsWith('http')) ? u.trim() : '';
    };
    // Strict matcher shared with the YouTube import: title, version words and artist/duration must agree.
    const svc = (typeof YouTubeMusicService !== 'undefined') ? YouTubeMusicService
      : ((typeof window !== 'undefined' && window.YouTubeMusicService) ? window.YouTubeMusicService : null);
    if (svc && typeof svc.pickCatalogMatch === 'function') {
      const picked = svc.pickCatalogMatch(targetSong, results.filter(item => item && urlOf(item)));
      if (!picked) return null;
      return { item: picked.item, url: urlOf(picked.item), score: picked.score };
    }
    const targetTitle = safeTrackTitle(targetSong);
    const targetArtist = safeArtistString(targetSong);

    let bestCandidate = null;
    let bestScore = -1;
    let bestUrl = '';

    for (const item of results) {
      if (!item) continue;
      const u = item.audioUrl || item.streamUrl || ((typeof API !== 'undefined' && API.getDownloadUrl) ? API.getDownloadUrl(item, preferredQuality) : '');
      if (!u || typeof u !== 'string' || !u.trim().startsWith('http')) continue;

      const candidateTitle = item.name || item.title || '';
      const candidateArtist = item.primaryArtists || item.artists || '';

      const score = computeTitleSimilarity(targetTitle, candidateTitle);

      // Secondary artist validation: boost score if artists match
      let finalScore = score;
      if (targetArtist && candidateArtist) {
        const tArt = cleanTitleForMatching(targetArtist);
        const cArt = cleanTitleForMatching(candidateArtist);
        if (tArt && cArt && (tArt.includes(cArt) || cArt.includes(tArt))) {
          finalScore += 0.15;
        }
      }

      // Enforce strict title similarity threshold (0.50). Reject completely different songs!
      if (score >= 0.72 && finalScore > bestScore) {
        bestScore = finalScore;
        bestCandidate = item;
        bestUrl = u.trim();
      }
    }

    if (bestCandidate && bestUrl) {
      return { item: bestCandidate, url: bestUrl, score: bestScore };
    }
    return null;
  }

  /**
   * Centralized resolvePlayableSource
   * Implements strict origin-aware provider hierarchy with automatic cross-provider fallback
   */
  async function resolvePlayableSource(song, options = {}) {
    if (!song) {
      return { type: SourceType.UNKNOWN, uri: '', error: ErrorCode.SOURCE_UNAVAILABLE, message: "Couldn't play this song" };
    }

    const signal = options.signal;
    if (signal?.aborted) {
      const abortErr = new Error('Playback request aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const songId = String(song.id || '');
    const title = safeTrackTitle(song);
    const artists = safeArtistString(song);
    const primaryArtist = artists.split(/[,;&/]|feat\.|ft\./i)[0].trim();
    const preferredQuality = (typeof Storage !== 'undefined' && Storage.getAudioQuality) ? Storage.getAudioQuality() : '320kbps';

    function createResult(type, uri, provider, song, extra = {}) {
      let bitrate = '320kbps';
      let format = 'AAC';
      let isLossless = false;

      if (type === SourceType.DOWNLOADED) {
        bitrate = song?.bitrate || '320kbps';
        format = song?.format || 'AAC';
        isLossless = Boolean(song?.isLossless) || String(bitrate).includes('320') || ['FLAC', 'WAV', 'ALAC'].includes(String(format).toUpperCase());
      } else if (type === SourceType.LOCAL) {
        const ext = String(uri || song?.name || '').match(/\.(flac|wav|alac|aac|mp3|m4a|ogg)/i)?.[1]?.toUpperCase() || 'AUDIO';
        format = ext;
        isLossless = ['FLAC', 'WAV', 'ALAC'].includes(ext) || Boolean(song?.isLossless);
        bitrate = isLossless ? 'Lossless' : '320kbps';
      } else {
        // JioSaavn / Remote stream
        if (uri.includes('_320') || (Array.isArray(song?.downloadUrl) && song.downloadUrl.some(u => (u.url === uri || u.link === uri) && String(u.quality).includes('320')))) {
          bitrate = '320kbps';
          isLossless = true;
        } else if (uri.includes('_160')) {
          bitrate = '160kbps';
          isLossless = false;
        } else if (uri.includes('_96')) {
          bitrate = '96kbps';
          isLossless = false;
        } else if (uri.includes('_48')) {
          bitrate = '48kbps';
          isLossless = false;
        } else if (uri.includes('_12')) {
          bitrate = '12kbps';
          isLossless = false;
        } else {
          bitrate = preferredQuality || '320kbps';
          isLossless = String(bitrate).includes('320');
        }
        format = uri.includes('.mp4') ? 'AAC (MP4)' : (uri.includes('.m4a') ? 'AAC' : 'MP3');
      }

      return {
        type,
        uri,
        provider: provider || 'direct',
        song,
        bitrate,
        format,
        isLossless,
        ...extra
      };
    }

    // 1. Downloaded Offline Audio Check
    if (song.source === 'DOWNLOADED' || (typeof Storage !== 'undefined' && Storage.isDownloaded && Storage.isDownloaded(song.id))) {
      try {
        const offlineUrl = await Storage.getDownloadedAudioUrl(song.id);
        if (offlineUrl) {
          console.log(`[PlaybackResolver] Selected: DOWNLOADED (${song.name || song.title})`);
          return createResult(SourceType.DOWNLOADED, offlineUrl, 'local_offline', song);
        }
      } catch (e) {
        console.warn('[PlaybackResolver] Downloaded audio check warning:', e);
      }
    }

    // 2. Local User Audio Check (Blob URL / File / ID3)
    const isLocalTrack = song.source === 'LOCAL' || 
                         song.isLocal === true || 
                         (typeof song.id === 'string' && (song.id.startsWith('loc_') || song.id.startsWith('local_'))) ||
                         Boolean(song.localBlobUrl) || 
                         (song.streamUrl && song.streamUrl.startsWith('blob:'));

    if (isLocalTrack) {
      let resolvedUrl = null;

      // 2a. Direct fileBlob on song object
      if (song.fileBlob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        resolvedUrl = URL.createObjectURL(song.fileBlob);
      }

      // 2b. Local audio URL from Storage / IndexedDB
      if (!resolvedUrl && typeof Storage !== 'undefined' && typeof Storage.getLocalAudioUrl === 'function') {
        try {
          resolvedUrl = await Storage.getLocalAudioUrl(song.id);
        } catch (e) {
          console.warn('[PlaybackResolver] getLocalAudioUrl warning:', e);
        }
      }

      // 2c. Fallback to existing localBlobUrl or streamUrl
      if (!resolvedUrl && (song.localBlobUrl || song.streamUrl)) {
        resolvedUrl = song.localBlobUrl || song.streamUrl;
      }

      if (resolvedUrl) {
        song.localBlobUrl = resolvedUrl;
        song.streamUrl = resolvedUrl;
        console.log(`[PlaybackResolver] Selected: LOCAL (${title}) -> ${resolvedUrl}`);
        return createResult(SourceType.LOCAL, resolvedUrl, 'local_file', song);
      } else {
        console.warn(`[PlaybackResolver] Local audio source missing for "${title}" (${songId})`);
        return {
          type: SourceType.LOCAL,
          uri: '',
          error: ErrorCode.FILE_MISSING,
          message: 'Local audio file could not be found or read from device storage.'
        };
      }
    }

    // Check Online Connectivity for remote streams
    const isOnline = (typeof OfflineManager !== 'undefined')
      ? OfflineManager.isOnline()
      : (typeof navigator === 'undefined' || navigator.onLine !== false);

    if (!isOnline) {
      return {
        type: SourceType.STREAMING,
        uri: '',
        error: ErrorCode.OFFLINE_UNAVAILABLE,
        message: 'This track is available offline only if downloaded.'
      };
    }

    // 3. In-Memory Stream Cache Check
    const cachedUrl = getCachedStream(song.id);
    if (cachedUrl && cachedUrl.startsWith('http')) {
      console.log(`[PlaybackResolver] Selected: CACHED (${title})`);
      return createResult(SourceType.CACHED, cachedUrl, song.provider || 'cached', song);
    }

    // 4. Already Available Direct Audio URL Check
    let directUrl = (typeof API !== 'undefined' && API.getDownloadUrl) ? API.getDownloadUrl(song, preferredQuality) : (song.audioUrl || song.streamUrl || '');

    if (directUrl && typeof directUrl === 'string' && directUrl.trim().startsWith('http')) {
      const u = directUrl.trim();
      setCachedStream(song.id, u);
      return createResult(SourceType.STREAMING, u, song.provider || 'direct', song);
    }

    const isYtOrigin = songId.startsWith('yt_') || song.provider === 'youtube_music' || Boolean(song.videoId || song.sourceYtVideoId);

    console.log(`[PlaybackResolver] Resolving stream for "${title}" by "${artists}"`);

    // ========================================================================
    // PIPELINE A: YOUTUBE MUSIC / IMPORTED TRACKS
    // 1. JioSaavn catalog match (strict title check, full 320 kbps) -> 2. YouTube stream as fallback.
    // YouTube only serves ~1 MB per stream without an attestation token (see ytStreamResolver.js),
    // so the catalog copy is preferred and the YouTube stream is used when nothing matches.
    // ========================================================================
    if (isYtOrigin) {
      console.log(`[PlaybackResolver] Looking for a catalog copy of the YouTube track: "${title} ${primaryArtist}"`);
      if (typeof API !== 'undefined' && API.searchSongs && (title || primaryArtist)) {
        const queries = extractCleanQueries(title, primaryArtist);
        for (const q of queries) {
          try {
            console.log(`[PlaybackResolver] Matching legacy track query: "${q}"`);
            const searchResults = await API.searchSongs(q, 1, 6);
            const found = findPlayableMatch(searchResults, song, preferredQuality);
            if (found) {
              const { item: matched, url: u } = found;
              song.audioUrl = u;
              song.streamUrl = u;
              song.downloadUrl = matched.downloadUrl || [];
              song.playbackAvailable = true;
              song.isPlayable = true;
              if (matched.image && (!song.image || song.image.includes('logo.png'))) {
                const saavnImg = (typeof API !== 'undefined' && API.getImageUrl) ? API.getImageUrl(matched) : '';
                if (saavnImg && !saavnImg.includes('logo.png')) {
                  song.image = saavnImg;
                }
              }
              if (!song.name || song.name === 'Song' || song.name === 'Unknown Track') {
                song.name = matched.name;
              }
              if (!song.album && matched.album) {
                song.album = matched.album;
              }
              if (!song.primaryArtist && !song.artists && matched.primaryArtists) {
                song.primaryArtist = matched.primaryArtists;
              }
              if (!song.duration && matched.duration) {
                song.duration = matched.duration;
              }
              setCachedStream(song.id, u);
              console.log(`[PlaybackResolver] Selected: JioSaavn Match (${matched.name})`);
              return createResult(SourceType.STREAMING, u, 'jiosaavn', song);
            }
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.warn('[PlaybackResolver] Query attempt failed for ' + q, err.message);
          }
        }
      }

      if (signal?.aborted) {
        const abortErr = new Error('Playback request aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const ytVideoId = song.videoId || song.sourceYtVideoId || songId.replace(/^yt_/, '');
      console.log(`[PlaybackResolver] No catalog copy; resolving the YouTube stream itself: ${ytVideoId}`);

      const ytmSvc = (typeof YouTubeMusicService !== 'undefined') ? YouTubeMusicService : ((typeof window !== 'undefined' && window.YouTubeMusicService) ? window.YouTubeMusicService : null);
      if (ytmSvc && typeof ytmSvc.getStreamUrl === 'function' && ytVideoId) {
        try {
          const ytStream = await ytmSvc.getStreamUrl(ytVideoId, { signal });
          if (ytStream && ytStream.url) {
            song.audioUrl = ytStream.url;
            song.streamUrl = ytStream.url;
            song.playbackAvailable = true;
            song.isPlayable = true;
            if (!ytStream.preview) setCachedStream(song.id, ytStream.url);
            if (ytStream.preview && typeof window !== 'undefined' && window.UI && typeof window.UI.showToast === 'function') {
              try { window.UI.showToast('YouTube preview only (about a minute) for this track'); } catch (_) {}
            }
            console.log(`[PlaybackResolver] Selected: Direct YouTube Music Stream (${title})${ytStream.preview ? ' [preview]' : ''}`);
            return createResult(SourceType.STREAMING, ytStream.url, 'youtube_music', song, {
              mimeType: ytStream.mimeType, contentLength: ytStream.contentLength, rawUrl: ytStream.rawUrl
            });
          }
        } catch (ytErr) {
          console.warn('[PlaybackResolver] Direct YouTube extraction notice, falling back to catalog match:', ytErr.message);
        }
      }
    }

    // ========================================================================
    // PIPELINE B: DIRECT JIOSAAVN ORIGIN TRACKS
    // 1. JioSaavn Details & Streams -> 2. JioSaavn Search Match
    // ========================================================================
    else {
      // Attempt 1: JioSaavn Song Details by ID
      if (song.id && typeof API !== 'undefined' && API.getSongDetails) {
        console.log(`[PlaybackResolver] Attempt 1 (JioSaavn ID): Fetching details for ID ${song.id}`);
        try {
          const details = await API.getSongDetails(song.id);
          if (details && details.length > 0) {
            const resolved = details[0];
            Object.assign(song, resolved);
            const u = API.getDownloadUrl(resolved, preferredQuality);
            if (u && typeof u === 'string' && u.trim().startsWith('http')) {
              const cleanU = u.trim();
              song.audioUrl = cleanU;
              song.streamUrl = cleanU;
              song.playbackAvailable = true;
              song.isPlayable = true;
              if (resolved.image) {
                const saavnImg = (typeof API !== 'undefined' && API.getImageUrl) ? API.getImageUrl(resolved) : '';
                if (saavnImg && !saavnImg.includes('logo.png')) {
                  song.image = saavnImg;
                }
              }
              setCachedStream(song.id, cleanU);
              console.log(`[PlaybackResolver] Selected: JioSaavn Direct Stream (${title})`);
              return createResult(SourceType.STREAMING, cleanU, 'jiosaavn', song);
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.warn('[PlaybackResolver] JioSaavn details resolution failed:', err.message);
        }
      }

      if (signal?.aborted) throw new Error('Playback request aborted');

      // Attempt 2: JioSaavn Search Match
      if (typeof API !== 'undefined' && API.searchSongs && (title || primaryArtist)) {
        console.log(`[PlaybackResolver] Attempt 2 (JioSaavn Search): Searching for "${title} ${primaryArtist}"`);
        const queries = extractCleanQueries(title, primaryArtist);
        for (const q of queries) {
          try {
            const searchResults = await API.searchSongs(q, 1, 6);
            const found = findPlayableMatch(searchResults, song, preferredQuality);
            if (found) {
              const { item: matched, url: u } = found;
              song.audioUrl = u;
              song.streamUrl = u;
              song.downloadUrl = matched.downloadUrl || [];
              song.playbackAvailable = true;
              song.isPlayable = true;
              if (matched.image && (!song.image || song.image.includes('logo.png'))) {
                const saavnImg = (typeof API !== 'undefined' && API.getImageUrl) ? API.getImageUrl(matched) : '';
                if (saavnImg && !saavnImg.includes('logo.png')) {
                  song.image = saavnImg;
                }
              }
              if (!song.name || song.name === 'Song' || song.name === 'Unknown Track') {
                song.name = matched.name;
              }
              if (!song.album && matched.album) {
                song.album = matched.album;
              }
              if (!song.primaryArtist && !song.artists && matched.primaryArtists) {
                song.primaryArtist = matched.primaryArtists;
              }
              if (!song.duration && matched.duration) {
                song.duration = matched.duration;
              }
              setCachedStream(song.id, u);
              console.log(`[PlaybackResolver] Selected: JioSaavn Search Stream (${matched.name})`);
              return createResult(SourceType.STREAMING, u, 'jiosaavn', song);
            }
          } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.warn('[PlaybackResolver] JioSaavn search stream resolution failed:', err.message);
          }
        }
      }
    }

    // All Providers Failed
    console.warn(`[PlaybackResolver] All providers failed for "${title}" (${songId})`);
    return {
      type: SourceType.UNKNOWN,
      uri: '',
      error: ErrorCode.SOURCE_UNAVAILABLE,
      message: isYtOrigin
        ? 'No full copy of this YouTube song is available (YouTube allows only a short preview outside its own app)'
        : "Couldn't play this song"
    };
  }

  return {
    SourceType,
    ErrorCode,
    resolvePlayableSource,
    getCachedStream,
    setCachedStream
  };
})();

if (typeof window !== 'undefined') {
  window.PlaybackResolver = PlaybackResolver;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlaybackResolver;
}

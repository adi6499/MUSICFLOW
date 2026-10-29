// ==========================================================================
// MUSICFLOW — CENTRALIZED CANONICAL DATA NORMALIZER
// Guarantees predictable, type-safe data schemas across all providers, API,
// search, home feed, player, queue, storage, playlists, and downloads.
// Completely eliminates [object Object] and TypeError: .replace / .split / .toLowerCase
// ==========================================================================

var DataNormalizer = (function() {
  // HTML entity decoder
  function decodeHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  // Dedicated boundary function to separate actual performing artists from contributor credits
  function extractArtistsAndCredits(raw, defaultProvider = 'jiosaavn') {
    if (!raw) {
      return {
        primaryArtist: 'Unknown Artist',
        featuredArtists: [],
        artists: [{ id: 'unknown_artist', name: 'Unknown Artist', role: 'artist', provider: defaultProvider, providerId: '' }],
        displayArtists: ['Unknown Artist'],
        displayArtistString: 'Unknown Artist',
        credits: []
      };
    }

    const credits = [];
    const performingArtists = [];
    const seenPerformingNames = new Set();
    const seenCreditKeys = new Set();

    function addCredit(name, role = 'contributor') {
      const cleanName = decodeHtml(String(name || '')).trim();
      if (!cleanName || cleanName.toLowerCase() === 'unknown') return;
      const key = `${cleanName.toLowerCase()}_${role.toLowerCase()}`;
      if (!seenCreditKeys.has(key)) {
        seenCreditKeys.add(key);
        credits.push({ name: cleanName, role });
      }
    }

    function addPerformingArtist(art, role = 'artist') {
      if (!art) return;
      let name = '';
      let id = '';
      let image = '';
      let provider = defaultProvider;
      let providerId = '';

      if (typeof art === 'string') {
        name = decodeHtml(art).trim();
        id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        providerId = id;
      } else if (typeof art === 'object') {
        name = decodeHtml(art.name || art.title || art.artist || '').trim();
        id = String(art.id || art.browseId || art.artistId || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
        provider = art.provider || defaultProvider;
        providerId = String(art.providerId || id);
        image = getImageUrl(art);
        if (art.role && !role) role = art.role;
      }

      if (!name || name.toLowerCase() === 'unknown' || name.toLowerCase() === 'unknown artist') return;

      const normName = name.toLowerCase();
      if (!seenPerformingNames.has(normName)) {
        seenPerformingNames.add(normName);
        performingArtists.push({
          id: id || normName,
          name: name,
          role: role || 'artist',
          provider: provider,
          providerId: providerId || id || normName,
          image: image || ''
        });
      }
    }

    // 1. Extract non-performing contributor credits
    if (typeof raw === 'object') {
      if (raw.music) {
        String(raw.music).split(/[,;&/]/).forEach(c => addCredit(c, 'composer'));
      }
      if (raw.lyrics) {
        String(raw.lyrics).split(/[,;&/]/).forEach(c => addCredit(c, 'lyricist'));
      }
      if (raw.starring) {
        String(raw.starring).split(/[,;&/]/).forEach(c => addCredit(c, 'actor'));
      }
      if (raw.composer) {
        String(raw.composer).split(/[,;&/]/).forEach(c => addCredit(c, 'composer'));
      }
      if (raw.lyricist) {
        String(raw.lyricist).split(/[,;&/]/).forEach(c => addCredit(c, 'lyricist'));
      }
      if (raw.producer) {
        String(raw.producer).split(/[,;&/]/).forEach(c => addCredit(c, 'producer'));
      }

      // If raw.artists is an object with primary / featured / all (JioSaavn schema)
      if (raw.artists && typeof raw.artists === 'object' && !Array.isArray(raw.artists)) {
        if (Array.isArray(raw.artists.all)) {
          raw.artists.all.forEach(a => {
            const role = (a.role || '').toLowerCase();
            if (role.includes('composer') || role.includes('music') || role.includes('lyricist') || role.includes('producer') || role.includes('starring') || role.includes('actor') || role.includes('director')) {
              addCredit(a.name, a.role || 'contributor');
            }
          });
        }
      }

      // If raw already has separated credits array
      if (Array.isArray(raw.credits)) {
        raw.credits.forEach(c => addCredit(c.name, c.role));
      }
    }

    // 2. Extract ACTUAL PERFORMING ARTISTS ONLY
    const featuredList = [];    if (typeof raw === 'object' && !Array.isArray(raw)) {
      // Strategy 0: If already normalized object with artistsList or artistNames
      if (Array.isArray(raw.artistsList) && raw.artistsList.length > 0) {
        raw.artistsList.forEach(a => addPerformingArtist(a, a.role || 'artist'));
      } else if (Array.isArray(raw.artistNames) && raw.artistNames.length > 0) {
        raw.artistNames.forEach((n, idx) => addPerformingArtist(n, idx === 0 ? 'primary' : 'featured'));
      } else if (raw.primaryArtist && Array.isArray(raw.featuredArtists) && raw.featuredArtists.length > 0) {
        addPerformingArtist(raw.primaryArtist, 'primary');
        raw.featuredArtists.forEach(a => addPerformingArtist(a, 'featured'));
      }

      // Strategy A: Structured artist object (JioSaavn / Provider schema)
      const prim = Array.isArray(raw.artists?.primary) ? raw.artists.primary : (Array.isArray(raw.primary) ? raw.primary : []);
      const feat = Array.isArray(raw.artists?.featured) ? raw.artists.featured : (Array.isArray(raw.featured) ? raw.featured : []);

      if (prim.length > 0 || feat.length > 0) {
        prim.forEach(a => addPerformingArtist(a, 'primary'));
        feat.forEach(a => {
          addPerformingArtist(a, 'featured');
          featuredList.push(typeof a === 'object' ? a.name : a);
        });
      }

      // Single artist object: { artists: { name: 'Shreya Ghoshal' } }
      if (performingArtists.length === 0 && raw.artists && typeof raw.artists === 'object' && !Array.isArray(raw.artists)) {
        if (raw.artists.name) {
          addPerformingArtist(raw.artists, 'primary');
        }
      }

      // If raw.artist is an object: { artist: { name: 'Shreya Ghoshal' } }
      if (performingArtists.length === 0 && raw.artist && typeof raw.artist === 'object' && !Array.isArray(raw.artist)) {
        if (raw.artist.name) {
          addPerformingArtist(raw.artist, 'primary');
        }
      }

      // If raw is an artist entity directly: { name: 'Shreya Ghoshal' }
      if (performingArtists.length === 0 && raw.name && !raw.title && !raw.song && !raw.trackId && !raw.primaryArtist && !raw.artists && !raw.album) {
        addPerformingArtist(raw, 'primary');
      }

      // Strategy B: Dedicated primaryArtists or primaryArtist fields
      if (performingArtists.length === 0) {
        if (typeof raw.artists === 'string' && raw.artists.includes('•')) {
          raw.artists.split('•').forEach((n, idx) => {
            addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
          });
        } else if (raw.primaryArtist && typeof raw.primaryArtist === 'string' && raw.primaryArtist.trim()) {
          raw.primaryArtist.split(/[,;&/]|feat\.|ft\./i).forEach((n, idx) => {
            addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
          });
        } else if (raw.primaryArtists) {
          if (typeof raw.primaryArtists === 'string') {
            raw.primaryArtists.split(/[,;&/]|feat\.|ft\./i).forEach((n, idx) => {
              addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
            });
          } else if (Array.isArray(raw.primaryArtists)) {
            raw.primaryArtists.forEach(a => addPerformingArtist(a, 'primary'));
          }
        } else if (raw.singers) {
          if (typeof raw.singers === 'string') {
            raw.singers.split(/[,;&/]|feat\.|ft\./i).forEach((n, idx) => {
              addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
            });
          } else if (Array.isArray(raw.singers)) {
            raw.singers.forEach(a => addPerformingArtist(a, 'primary'));
          }
        }
      }

      // Strategy C: If raw.artists is an array, filter out non-performing credit roles
      if (performingArtists.length === 0 && Array.isArray(raw.artists)) {
        raw.artists.forEach(a => {
          if (typeof a === 'object' && a !== null) {
            const role = (a.role || '').toLowerCase();
            const isCredit = role.includes('composer') || role.includes('lyricist') || role.includes('producer') || role.includes('actor') || role.includes('starring') || role.includes('cast') || role.includes('director');
            if (!isCredit) {
              addPerformingArtist(a, a.role || 'artist');
            } else {
              addCredit(a.name, a.role);
            }
          } else if (typeof a === 'string') {
            addPerformingArtist(a, 'artist');
          }
        });
      }

      // Strategy D: String fallbacks (raw.artist, raw.artists, raw.subtitle)
      if (performingArtists.length === 0) {
        const candidateStr = (typeof raw.artist === 'string' && raw.artist) ||
                             (typeof raw.artists === 'string' && raw.artists) ||
                             (typeof raw.subtitle === 'string' && raw.subtitle) || '';

        if (candidateStr) {
          candidateStr.split(/[,;&/]|feat\.|ft\./i).forEach((n, idx) => {
            addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
          });
        }
      }
    } else if (Array.isArray(raw)) {
      raw.forEach(a => addPerformingArtist(a, 'artist'));
    } else if (typeof raw === 'string' || typeof raw === 'number') {
      String(raw).split(/[,;&/]|feat\.|ft\./i).forEach((n, idx) => {
        addPerformingArtist(n.trim(), idx === 0 ? 'primary' : 'featured');
      });
    }

    if (performingArtists.length === 0) {
      performingArtists.push({
        id: 'unknown_artist',
        name: 'Unknown Artist',
        role: 'artist',
        provider: defaultProvider,
        providerId: ''
      });
    }

    // Determine canonical primaryArtist string
    const primObj = performingArtists.find(a => a.role === 'primary') || performingArtists[0];
    const primaryArtistStr = primObj ? primObj.name : 'Unknown Artist';
    const displayArtists = performingArtists.map(a => a.name);

    // Single-line Apple-like display string (Max 2-3 artists)
    let displayArtistString = '';
    if (displayArtists.length <= 3) {
      displayArtistString = displayArtists.join(' • ');
    } else {
      displayArtistString = `${displayArtists.slice(0, 3).join(' • ')} +${displayArtists.length - 3}`;
    }

    return {
      primaryArtist: primaryArtistStr,
      featuredArtists: performingArtists.filter(a => a.role === 'featured'),
      artists: performingArtists,
      displayArtists: displayArtists,
      displayArtistString: displayArtistString || primaryArtistStr,
      credits: credits
    };
  }

  // Guaranteed string representation of performing artists (for UI display)
  function getArtistName(val) {
    if (!val) return 'Unknown Artist';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') {
      const clean = decodeHtml(val);
      return clean && clean.toLowerCase() !== 'unknown' ? clean : 'Unknown Artist';
    }
    if (Array.isArray(val)) {
      const names = val.map(item => {
        if (!item) return '';
        if (typeof item === 'string') return decodeHtml(item).trim();
        if (typeof item === 'object') return decodeHtml(item.name || item.title || item.artist || '').trim();
        return String(item).trim();
      }).filter(Boolean);
      return names.length > 0 ? names.join(', ') : 'Unknown Artist';
    }
    if (typeof val === 'object') {
      if (val.name && !val.title && !val.song && !val.trackId && !val.primaryArtist && !val.artists && !val.album) {
        return decodeHtml(val.name);
      }
      const extracted = extractArtistsAndCredits(val);
      if (extracted.displayArtists && extracted.displayArtists.length > 0 && extracted.displayArtists[0] !== 'Unknown Artist') {
        return extracted.displayArtists.join(', ');
      }
      return extracted.displayArtistString;
    }
    return 'Unknown Artist';
  }

  // Guaranteed display name
  function getArtistDisplayName(val) {
    return getArtistName(val);
  }

  // Single primary performing artist string
  function getPrimaryArtist(val) {
    if (!val) return 'Unknown Artist';
    if (typeof val === 'object') {
      const extracted = extractArtistsAndCredits(val);
      return extracted.primaryArtist || 'Unknown Artist';
    }
    const full = getArtistName(val);
    if (!full || full === 'Unknown Artist') return 'Unknown Artist';
    return full.split(/[,;&/]|•|feat\.|ft\./i)[0].trim() || 'Unknown Artist';
  }

  // Single primary artist alias
  function getPrimaryArtistName(val) {
    return getPrimaryArtist(val);
  }

  // Array of actual performing artist names (strings)
  function getDisplayArtists(val) {
    if (!val) return ['Unknown Artist'];
    const extracted = extractArtistsAndCredits(val);
    return extracted.displayArtists.length > 0 ? extracted.displayArtists : ['Unknown Artist'];
  }

  // Array of artist names alias
  function getArtistNames(val) {
    return getDisplayArtists(val);
  }

  // Array of featured performing artist objects
  function getFeaturedArtists(val) {
    if (!val) return [];
    const extracted = extractArtistsAndCredits(val);
    return extracted.featuredArtists || [];
  }

  // Formatted string representation with max limit (e.g. "Katy Perry" or "Artist 1 • Artist 2")
  function getArtistString(val, maxArtists = 3) {
    if (!val) return 'Unknown Artist';
    const extracted = extractArtistsAndCredits(val);
    const list = extracted.displayArtists;
    if (list.length <= maxArtists) {
      return list.join(' • ');
    }
    return `${list.slice(0, maxArtists).join(' • ')} +${list.length - maxArtists}`;
  }

  // Structured array of legitimate performing artist objects: [{ id, name, role, provider, providerId, image }]
  function getLegitimateMusicArtists(song, defaultProvider = 'jiosaavn') {
    if (!song) return [{ id: 'unknown_artist', name: 'Unknown Artist', role: 'artist', provider: defaultProvider, providerId: '' }];
    const extracted = extractArtistsAndCredits(song, defaultProvider);
    return extracted.artists.length > 0 ? extracted.artists : [{ id: 'unknown_artist', name: 'Unknown Artist', role: 'artist', provider: defaultProvider, providerId: '' }];
  }

  // Universal artist normalization returning structured array: [{ id, name, provider, providerId, image, role }]
  function normalizeArtists(val, defaultProvider = 'jiosaavn') {
    if (!val) return [{ id: 'unknown_artist', name: 'Unknown Artist', role: 'artist', provider: defaultProvider, providerId: '' }];
    const extracted = extractArtistsAndCredits(val, defaultProvider);
    return extracted.artists;
  }

  // Array of non-performing contributor credits: [{ name, role }]
  function getCredits(val) {
    if (!val) return [];
    if (typeof val === 'object' && Array.isArray(val.credits)) return val.credits;
    const extracted = extractArtistsAndCredits(val);
    return extracted.credits || [];
  }

  // Primary recording artist for LRCLIB lyrics lookups (prioritizes singer over lyricist/producer)
  function getPrimaryRecordingArtist(track) {
    if (!track) return 'Unknown Artist';
    if (typeof track === 'string') return getPrimaryArtist(track);
    if (typeof track === 'object') {
      if (track.primaryRecordingArtist && typeof track.primaryRecordingArtist === 'string') {
        return decodeHtml(track.primaryRecordingArtist.trim());
      }
      if (track.artists && typeof track.artists === 'object') {
        const artList = Array.isArray(track.artists.primary)
          ? track.artists.primary
          : (Array.isArray(track.artists.all)
            ? track.artists.all
            : (Array.isArray(track.artists) ? track.artists : []));
        const singer = artList.find(a => (a.role || '').toLowerCase().includes('singer') || (a.role || '').toLowerCase().includes('vocal') || (a.role || '').toLowerCase().includes('primary'));
        if (singer && singer.name) return decodeHtml(singer.name.trim());
      }
      return getPrimaryArtist(track);
    }
    return 'Unknown Artist';
  }

  // Guaranteed track title string
  function getTrackTitle(val) {
    if (!val) return 'Unknown Track';
    if (typeof val === 'object') {
      const title = val.title || val.name || val.song || '';
      return decodeHtml(String(title || 'Unknown Track'));
    }
    return decodeHtml(String(val));
  }

  // Guaranteed album title string
  function getAlbumName(val) {
    if (!val) return 'Unknown Album';
    if (typeof val === 'object') {
      const title = val.name || val.title || val.album || '';
      return decodeHtml(String(title || 'Unknown Album'));
    }
    return decodeHtml(String(val));
  }

  // High-Resolution Artwork URL extractor (HD 500x500)
  function getImageUrl(raw) {
    const placeholder = 'assets/logo.png';
    if (!raw) return placeholder;

    let artwork = placeholder;

    if (typeof raw === 'string' && raw.startsWith('http')) {
      artwork = raw;
    } else if (Array.isArray(raw) && raw.length > 0) {
      const hi = raw.find(i => i && (i.quality === '500x500' || i.link?.includes('500x500') || i.url?.includes('500x500') || i.width >= 500)) || raw[raw.length - 1];
      artwork = hi?.url || hi?.link || (typeof hi === 'string' ? hi : artwork);
    } else if (typeof raw.image === 'string' && raw.image.startsWith('http')) {
      artwork = raw.image;
    } else if (typeof raw.artwork === 'string' && raw.artwork.startsWith('http')) {
      artwork = raw.artwork;
    } else if (typeof raw.albumArt === 'string' && raw.albumArt.startsWith('http')) {
      artwork = raw.albumArt;
    } else if (typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('http')) {
      artwork = raw.thumbnail;
    } else if (typeof raw.cover === 'string' && raw.cover.startsWith('http')) {
      artwork = raw.cover;
    } else if (Array.isArray(raw.image) && raw.image.length > 0) {
      const hi = raw.image.find(i => i && (i.quality === '500x500' || i.link?.includes('500x500'))) || raw.image[raw.image.length - 1];
      artwork = hi?.url || hi?.link || raw.image[0]?.url || raw.image[0]?.link || artwork;
    } else if (Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0) {
      const hi = raw.thumbnails[raw.thumbnails.length - 1];
      artwork = hi?.url || raw.thumbnails[0]?.url || artwork;
    } else if (raw.image && typeof raw.image === 'object') {
      artwork = raw.image.url || raw.image.link || artwork;
    } else if (raw.album && typeof raw.album === 'object' && raw.album.image) {
      return getImageUrl(raw.album);
    }

    if (typeof artwork === 'string' && artwork.startsWith('http')) {
      artwork = artwork.replace(/50x50|150x150/, '500x500');
    }

    return artwork || placeholder;
  }

  // Canonical language normalization mapping codes, english names, and native script names
  function normalizeLanguage(val) {
    if (!val || typeof val !== 'string') return 'unknown';
    const clean = val.toLowerCase().trim();
    if (!clean) return 'unknown';

    if (clean === 'hi' || clean === 'hin' || clean.includes('hindi') || clean.includes('हिंदी') || clean.includes('हिन्दी') || clean.includes('hindustani')) return 'hindi';
    if (clean === 'en' || clean === 'eng' || clean.includes('english') || clean.includes('angrezi')) return 'english';
    if (clean === 'pa' || clean === 'pan' || clean.includes('punjabi') || clean.includes('ਪੰਜਾਬੀ')) return 'punjabi';
    if (clean === 'ta' || clean === 'tam' || clean.includes('tamil') || clean.includes('தமிழ்')) return 'tamil';
    if (clean === 'te' || clean === 'tel' || clean.includes('telugu') || clean.includes('తెలుగు')) return 'telugu';
    if (clean === 'bn' || clean === 'ben' || clean.includes('bengali') || clean.includes('bangla') || clean.includes('বাংলা')) return 'bengali';
    if (clean === 'mr' || clean === 'mar' || clean.includes('marathi') || clean.includes('मराठी')) return 'marathi';
    if (clean === 'gu' || clean === 'guj' || clean.includes('gujarati') || clean.includes('ગુજરાતી')) return 'gujarati';
    if (clean === 'kn' || clean === 'kan' || clean.includes('kannada') || clean.includes('ಕನ್ನಡ')) return 'kannada';
    if (clean === 'ml' || clean === 'mal' || clean.includes('malayalam') || clean.includes('മലയാളം')) return 'malayalam';
    if (clean === 'bho' || clean.includes('bhojpuri') || clean.includes('भोजपुरी')) return 'bhojpuri';
    if (clean === 'ur' || clean === 'urd' || clean.includes('urdu') || clean.includes('اردو')) return 'urdu';
    if (clean === 'har' || clean.includes('haryanvi')) return 'haryanvi';
    if (clean === 'raj' || clean.includes('rajasthani') || clean.includes('marwari')) return 'rajasthani';
    if (clean === 'or' || clean === 'ori' || clean.includes('odia') || clean.includes('oriya')) return 'odia';
    if (clean === 'as' || clean === 'asm' || clean.includes('assamese')) return 'assamese';
    if (clean === 'es' || clean === 'spa' || clean.includes('spanish') || clean.includes('espanol') || clean.includes('español')) return 'spanish';
    if (clean === 'ko' || clean === 'kor' || clean.includes('korean') || clean.includes('k-pop') || clean.includes('kpop')) return 'korean';
    if (clean === 'ja' || clean === 'jpn' || clean.includes('japanese') || clean.includes('j-pop') || clean.includes('jpop')) return 'japanese';
    if (clean === 'fr' || clean === 'fra' || clean.includes('french')) return 'french';
    if (clean === 'ar' || clean === 'ara' || clean.includes('arabic')) return 'arabic';

    return clean;
  }

  // Duration in seconds
  function getDurationSeconds(raw) {
    if (!raw) return 0;
    const d = raw.duration !== undefined ? raw.duration : (raw.durationSeconds !== undefined ? raw.durationSeconds : raw);
    if (typeof d === 'number') return Math.round(d);
    if (typeof d === 'string') {
      if (d.includes(':')) {
        const parts = d.split(':').map(Number);
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      }
      return parseInt(d, 10) || 0;
    }
    return 0;
  }

  // Audio Stream / Download URL extractor
  function getAudioUrl(raw) {
    if (!raw) return '';

    if (Array.isArray(raw.downloadUrl) && raw.downloadUrl.length > 0) {
      const best = raw.downloadUrl.find(u => u && (u.quality === '320kbps' || u.quality === '320')) ||
                   raw.downloadUrl.find(u => u && (u.quality === '160kbps' || u.quality === '160')) ||
                   raw.downloadUrl[raw.downloadUrl.length - 1];
      const url = best?.url || best?.link || (typeof best === 'string' ? best : '');
      if (url && typeof url === 'string') return url.trim();
    }

    if (typeof raw.audioUrl === 'string' && raw.audioUrl.trim()) return raw.audioUrl.trim();
    if (typeof raw.streamUrl === 'string' && raw.streamUrl.trim()) return raw.streamUrl.trim();
    if (typeof raw.url === 'string' && raw.url.trim() && (raw.url.includes('.mp4') || raw.url.includes('.mp3') || raw.url.includes('.m4a') || raw.url.includes('googlevideo') || raw.url.includes('saavncdn'))) {
      return raw.url.trim();
    }

    return '';
  }

  // ========================================================================
  // 1. CANONICAL TRACK NORMALIZER
  // ========================================================================
  function normalizeTrack(raw, defaultProvider = 'jiosaavn') {
    if (!raw || typeof raw !== 'object') return null;

    const provider = raw.provider || defaultProvider;
    const rawId = raw.id || raw.videoId || raw._id || raw.trackId || '';
    const providerId = String(raw.providerId || rawId || Math.random().toString(36).substring(2, 9));
    
    let canonicalId = String(rawId || providerId);
    if (!canonicalId.startsWith('yt_') && provider === 'youtube_music') {
      canonicalId = `yt_${providerId}`;
    }

    const { primaryArtist, featuredArtists, artists, displayArtists, displayArtistString, credits } = extractArtistsAndCredits(raw, provider);

    const title = getTrackTitle(raw);
    const primaryRecordingArtist = getPrimaryRecordingArtist(raw) || primaryArtist;
    const album = getAlbumName(raw.album || raw);
    const albumId = String(raw.albumId || (raw.album && typeof raw.album === 'object' ? raw.album.id : '') || '');
    const image = getImageUrl(raw);
    const duration = getDurationSeconds(raw);
    const audioUrl = getAudioUrl(raw);
    const isPlayable = (raw.playbackAvailable !== undefined)
      ? Boolean(raw.playbackAvailable)
      : Boolean(audioUrl || provider === 'jiosaavn' || provider === 'local');

    const lang = normalizeLanguage(raw.language || raw.lang || raw.language_name || 'unknown');

    return {
      id: canonicalId,
      name: title,
      title: title,
      artists: getArtistName(raw),
      artist: primaryArtist,
      primaryArtist: primaryArtist,
      primaryRecordingArtist: primaryRecordingArtist,
      displayArtist: displayArtistString,
      artistNames: displayArtists,
      artistsList: artists,
      featuredArtists: featuredArtists,
      credits: credits,
      album: album,
      albumId: albumId,
      albumArtist: primaryArtist,
      image: image,
      artwork: image,
      albumArt: image,
      audioUrl: audioUrl,
      streamUrl: raw.streamUrl || audioUrl,
      streamType: String(raw.streamType || (audioUrl.includes('.mp4') ? 'mp4' : 'mp3')),
      downloadUrl: Array.isArray(raw.downloadUrl) ? raw.downloadUrl : [],
      duration: duration,
      durationSeconds: duration,
      rawDuration: raw.duration || duration,
      year: String(raw.year || raw.releaseDate || ''),
      playCount: Number(raw.playCount || raw.play_count || raw.plays || 0) || 0,
      language: lang,
      languages: Array.isArray(raw.languages) ? raw.languages.map(normalizeLanguage) : [lang],
      quality: String(raw.quality || '320kbps'),
      provider: provider,
      providerId: providerId,
      source: raw.source || provider,
      sourceId: raw.sourceId || providerId,
      sourceYtVideoId: raw.sourceYtVideoId || null,
      isPlayable: isPlayable,
      playbackAvailable: isPlayable,
      metadataAvailable: true,
      playlistId: raw.playlistId || null,
      playlistIndex: raw.playlistIndex !== undefined ? raw.playlistIndex : null,
      providerData: (() => {
        const pd = raw.providerData || raw;
        if (!pd || typeof pd !== 'object') return null;
        const sanitized = { ...pd };
        delete sanitized.cookie;
        delete sanitized.token;
        delete sanitized.adminKey;
        delete sanitized.auth;
        delete sanitized.authorization;
        delete sanitized.password;
        delete sanitized.key;
        return sanitized;
      })()
    };
  }

  // ========================================================================
  // 2. CANONICAL ALBUM NORMALIZER
  // ========================================================================
  function normalizeAlbum(raw, defaultProvider = 'jiosaavn') {
    if (!raw || typeof raw !== 'object') return null;

    const provider = raw.provider || defaultProvider;
    const albumId = String(raw.id || raw.browseId || raw._id || Math.random().toString(36).substring(2, 9));
    const title = getAlbumName(raw);
    const artists = getArtistName(raw.artists || raw.artist || raw.subtitle || 'Various Artists');
    const primaryArtist = getPrimaryArtist(raw.primaryArtist || raw.artists || raw.artist || artists);
    const image = getImageUrl(raw);
    const year = String(raw.year || raw.releaseDate || '');

    const rawSongs = Array.isArray(raw.songs) ? raw.songs : (Array.isArray(raw.tracks) ? raw.tracks : []);
    const normalizedSongs = rawSongs.map(s => normalizeTrack(s, provider)).filter(Boolean);

    return {
      id: albumId,
      name: title,
      title: title,
      artists: artists,
      artist: primaryArtist,
      primaryArtist: primaryArtist,
      subtitle: `${primaryArtist} • ${year || 'Album'}`,
      image: image,
      artwork: image,
      year: year,
      type: String(raw.type || (normalizedSongs.length <= 4 ? 'EP' : 'Album')),
      songCount: normalizedSongs.length || parseInt(raw.songCount, 10) || 0,
      songs: normalizedSongs,
      provider: provider
    };
  }

  // ========================================================================
  // 3. CANONICAL ARTIST NORMALIZER
  // ========================================================================
  function normalizeArtist(raw, defaultProvider = 'jiosaavn') {
    if (!raw || typeof raw !== 'object') return null;

    const provider = raw.provider || defaultProvider;
    const artistId = String(raw.id || raw.browseId || raw._id || Math.random().toString(36).substring(2, 9));
    const name = decodeHtml(String(raw.name || raw.title || raw.artist || 'Unknown Artist'));
    const image = getImageUrl(raw);

    const rawSongs = Array.isArray(raw.topSongs) ? raw.topSongs : (Array.isArray(raw.songs) ? raw.songs : []);
    const topSongs = rawSongs.map(s => normalizeTrack(s, provider)).filter(Boolean);

    const rawAlbums = Array.isArray(raw.albums) ? raw.albums : [];
    const albums = rawAlbums.map(a => normalizeAlbum(a, provider)).filter(Boolean);

    return {
      id: artistId,
      name: name,
      title: name,
      image: image,
      artwork: image,
      bio: decodeHtml(String(raw.bio || raw.description || '')),
      followerCount: parseInt(raw.followerCount || raw.followers, 10) || 0,
      topSongs: topSongs,
      albums: albums,
      provider: provider
    };
  }

  // ========================================================================
  // 4. CANONICAL PLAYLIST NORMALIZER
  // ========================================================================
  function normalizePlaylist(raw, defaultProvider = 'jiosaavn') {
    if (!raw || typeof raw !== 'object') return null;

    const provider = raw.provider || defaultProvider;
    const playlistId = String(raw.id || raw.playlistId || raw._id || Math.random().toString(36).substring(2, 9));
    const title = decodeHtml(String(raw.name || raw.title || 'Playlist'));
    const description = decodeHtml(String(raw.description || raw.subtitle || ''));
    const artists = getArtistName(raw.artists || raw.subtitle || 'Various Artists');
    const image = getImageUrl(raw);

    const rawSongs = Array.isArray(raw.songs) ? raw.songs : (Array.isArray(raw.tracks) ? raw.tracks : []);
    const songs = rawSongs.map(s => normalizeTrack(s, provider)).filter(Boolean);

    return {
      id: playlistId,
      name: title,
      title: title,
      description: description,
      subtitle: `${songs.length || raw.songCount || 0} songs`,
      artists: artists,
      image: image,
      artwork: image,
      songCount: songs.length || parseInt(raw.songCount, 10) || 0,
      songs: songs,
      provider: provider
    };
  }

  function normalizeSongs(rawList, defaultProvider = 'jiosaavn') {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(s => normalizeTrack(s, defaultProvider)).filter(Boolean);
  }

  function getArtistString(val) {
    return getArtistName(val);
  }

  function getArtistNames(val) {
    return normalizeArtists(val).map(a => a.name).filter(Boolean);
  }

  function parseYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const str = url.trim();

    const listMatch = str.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    const vMatch = str.match(/(?:watch\?v=|youtu\.be\/|embed\/|v\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
    const rawVideoIdMatch = /^[a-zA-Z0-9_-]{11}$/.test(str) && !str.startsWith('PL') && !str.startsWith('RD') && !str.startsWith('VL') && !str.startsWith('OLAK5uy_');
    const rawPlaylistIdMatch = /^(PL|VL|RD|OLAK5uy_)[a-zA-Z0-9_-]+$/i.test(str);

    // 1. Single video with optional playlist context -> Prioritize single track when user shares watch link
    if (vMatch && vMatch[1]) {
      return {
        provider: 'youtube_music',
        type: 'track',
        id: vMatch[1],
        playlistId: listMatch ? listMatch[1] : null,
        url: str
      };
    }

    // 2. Direct 11-character Video ID
    if (rawVideoIdMatch) {
      return {
        provider: 'youtube_music',
        type: 'track',
        id: str,
        playlistId: null,
        url: `https://www.youtube.com/watch?v=${str}`
      };
    }

    // 3. Playlist URL with list parameter
    if (listMatch && listMatch[1]) {
      return {
        provider: 'youtube_music',
        type: 'playlist',
        id: listMatch[1],
        url: str
      };
    }

    // 4. Raw Playlist / Album ID
    if (rawPlaylistIdMatch) {
      return {
        provider: 'youtube_music',
        type: 'playlist',
        id: str,
        url: `https://music.youtube.com/playlist?list=${str}`
      };
    }

    // 5. YouTube Music browse / album link (MPREb_...)
    const browseMatch = str.match(/(?:browse\/|browse_id=)([a-zA-Z0-9_-]+)/i);
    if (browseMatch && browseMatch[1]) {
      return {
        provider: 'youtube_music',
        type: 'playlist',
        id: browseMatch[1],
        url: str
      };
    }

    return null;
  }

  return {
    decodeHtml,
    extractArtistsAndCredits,
    getArtistName,
    getArtistString,
    getArtistNames,
    getDisplayArtists,
    getFeaturedArtists,
    getCredits,
    getArtistDisplayName,
    getPrimaryArtist,
    getPrimaryArtistName: getPrimaryArtist,
    getPrimaryRecordingArtist,
    getLegitimateMusicArtists,
    normalizeArtists,
    formatArtists: getArtistString,
    getTrackTitle,
    getAlbumName,
    getImageUrl,
    getDurationSeconds,
    getAudioUrl,
    parseYouTubeUrl,
    normalizeLanguage,
    normalizeTrack,
    normalizeSong: normalizeTrack,
    normalizeSongs,
    normalizeAlbum,
    normalizeArtist,
    normalizePlaylist
  };
})();

if (typeof window !== 'undefined') {
  window.DataNormalizer = DataNormalizer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataNormalizer;
}

// ==========================================================================
// MUSICFLOW — TYPESENSE-STYLE SEARCH & RANKING ENGINE
// ==========================================================================

const SearchEngine = (() => {
  const getQN = () => (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer : (typeof require !== 'undefined' ? require('./queryNormalizer.js') : { normalize: s => (s||'').toLowerCase().trim(), isLikelyArtist: () => false });
  const getSS = () => (typeof StringSimilarity !== 'undefined') ? StringSimilarity : (typeof require !== 'undefined' ? require('./stringSimilarity.js') : { computeMatchScore: () => 0 });
  const getTD = () => (typeof TrackDeduplicator !== 'undefined') ? TrackDeduplicator : (typeof require !== 'undefined' ? require('./trackDeduplicator.js') : { cleanTrackTitle: s => (s||'').toLowerCase().trim(), cleanArtistName: s => (s||'').toLowerCase().trim(), scoreTrackQuality: () => 100, deduplicate: list => list });

  const Weights = {
    EXACT_TITLE_AND_ARTIST: 1000.0,
    EXACT_TITLE: 900.0,
    EXACT_ARTIST_PARTIAL_TITLE: 850.0,
    PREFIX_TITLE_MATCH: 800.0,
    SUBSTRING_TITLE_MATCH: 750.0,
    HIGH_FUZZY_TITLE_MATCH: 650.0,
    TOKEN_OVERLAP_MATCH: 600.0,
    ARTIST_ONLY_MATCH: 450.0,
    ALBUM_MATCH: 350.0,
    LOW_FUZZY_MATCH: 200.0,

    BONUS_320KBPS: 15.0,
    BONUS_HAS_LYRICS: 10.0,
    BONUS_HIGH_RES_ART: 10.0,
    BONUS_PLAYABLE_SOURCE: 20.0,
    BONUS_PRIMARY_PROVIDER: 10.0,
    PENALTY_KARAOKE: -250.0,
    PENALTY_COVER: -200.0,
    PENALTY_SLOWED_REVERB: -150.0
  };

  const FUZZY_BUDGET = 40;   // fuzzy string work is only spent on the first candidates

  function scoreSong(song, parsed, allowFuzzy = true) {
    if (!song) return { song, score: 0, matchType: 'none' };

    const QN = getQN();
    const SS = getSS();
    const TD = getTD();

    const qNorm = parsed.normalizedQuery;
    const sTitleNorm = QN.normalize(song.name);
    const sArtistNorm = QN.normalize(song.artists || song.primaryArtist);
    const sAlbumNorm = QN.normalize(song.album);

    const cleanTitle = TD.cleanTrackTitle(song.name);
    const cleanArtist = TD.cleanArtistName(song.artists || song.primaryArtist);

    let score = 0.0;
    let matchType = 'fuzzy';

    const wantsKaraoke = qNorm.includes('karaoke') || qNorm.includes('instrumental');
    const wantsCover = qNorm.includes('cover') || qNorm.includes('tribute');
    const wantsRemix = qNorm.includes('remix') || qNorm.includes('mix');
    const wantsSlowed = qNorm.includes('slowed') || qNorm.includes('reverb');

    // 1. Compound Query
    if (parsed.isCompoundQuery && parsed.candidateSongTitle && parsed.candidateArtist) {
      const targetSong = parsed.candidateSongTitle;
      const targetArtist = parsed.candidateArtist;

      const titleScore = SS.computeMatchScore(targetSong, cleanTitle);
      const artistScore = SS.computeMatchScore(targetArtist, cleanArtist);

      if (titleScore >= 0.90 && artistScore >= 0.85) {
        score = Weights.EXACT_TITLE_AND_ARTIST + (titleScore * 50.0) + (artistScore * 50.0);
        matchType = 'exact_title_and_artist';
      } else if (titleScore >= 0.85) {
        score = Weights.EXACT_TITLE + (titleScore * 40.0) + (artistScore * 30.0);
        matchType = 'compound_title_match';
      } else if (artistScore >= 0.90 && titleScore >= 0.60) {
        score = Weights.EXACT_ARTIST_PARTIAL_TITLE + (titleScore * 50.0);
        matchType = 'artist_partial_title';
      }
    }

    // 2. Direct Matching
    if (score === 0.0) {
      if (cleanTitle === qNorm || sTitleNorm === qNorm) {
        score = Weights.EXACT_TITLE;
        matchType = 'exact_title';
        const artistMatch = SS.computeMatchScore(qNorm, sArtistNorm);
        if (artistMatch > 0.5) score += 50.0;
      } else if (cleanTitle.startsWith(qNorm) || sTitleNorm.startsWith(qNorm)) {
        const ratio = qNorm.length / Math.max(1, cleanTitle.length);
        const artistBonus = QN.isLikelyArtist(cleanArtist) ? 40.0 : 0.0;   // never enough to beat an exact title
        score = Weights.PREFIX_TITLE_MATCH + (ratio * 50.0) + artistBonus;
        matchType = 'prefix_title';
      } else if (cleanTitle.includes(qNorm) || sTitleNorm.includes(qNorm)) {
        const ratio = qNorm.length / Math.max(1, cleanTitle.length);
        score = Weights.SUBSTRING_TITLE_MATCH + (ratio * 40.0);
        matchType = 'substring_title';
      } else if (!allowFuzzy) {
        score = sAlbumNorm.includes(qNorm) ? Weights.ALBUM_MATCH : 50.0;
        matchType = 'generic_match';
      } else {
        const simTitle = SS.computeMatchScore(qNorm, cleanTitle);
        const simArtist = SS.computeMatchScore(qNorm, cleanArtist);
        const simCombined = SS.computeMatchScore(qNorm, `${cleanTitle} ${cleanArtist}`);

        if (simTitle >= 0.82) {
          score = Weights.HIGH_FUZZY_TITLE_MATCH + (simTitle * 80.0);
          matchType = 'fuzzy_title_typo';
        } else if (simCombined >= 0.80) {
          score = Weights.TOKEN_OVERLAP_MATCH + (simCombined * 80.0);
          matchType = 'fuzzy_combined';
        } else if (simArtist >= 0.85) {
          score = Weights.ARTIST_ONLY_MATCH + (simArtist * 50.0);
          matchType = 'artist_match';
        } else if (simTitle >= 0.65) {
          score = Weights.LOW_FUZZY_MATCH + (simTitle * 100.0);
          matchType = 'low_fuzzy_title';
        } else if (sAlbumNorm.includes(qNorm)) {
          score = Weights.ALBUM_MATCH;
          matchType = 'album_match';
        } else {
          score = Math.max(50.0, simCombined * 150.0);
          matchType = 'generic_match';
        }
      }
    }

    // 3. User Personalization Signals (Favorites, Repeat Plays, Affinity)
    try {
      let favorites = [];
      let topArtists = {};
      let milestones = {};
      if (typeof Storage !== 'undefined') {
        favorites = Storage.getFavorites() || [];
        const signals = (typeof Storage.getUserTasteSignals === 'function') ? Storage.getUserTasteSignals() : null;
        if (signals) {
          topArtists = signals.artistScores || {};
          milestones = signals.milestones || {};
        }
      }
      const songId = String(song.id || '');
      if (favorites.some(f => String(f.id) === songId)) {
        score += 60.0;
      }
      if (milestones[songId]) {
        if (milestones[songId].completions > 0) score += 40.0;
        if (milestones[songId].plays > 2) score += 30.0;
      }
      if (topArtists[cleanArtist]) {
        score += Math.min(60.0, topArtists[cleanArtist] * 12.0);
      }
    } catch (_) {}

    // 4. Modifiers
    if (song.audioUrl || song.streamUrl || song.playbackAvailable) score += Weights.BONUS_PLAYABLE_SOURCE;
    if (song.provider === 'jiosaavn') score += Weights.BONUS_PRIMARY_PROVIDER;
    if (Array.isArray(song.downloadUrl) && song.downloadUrl.some(u => (u.quality || '').includes('320'))) {
      score += Weights.BONUS_320KBPS;
    }
    if (song.image && song.image.includes('500x500')) score += Weights.BONUS_HIGH_RES_ART;
    if (song.popularity) score += Math.min(30.0, Number(song.popularity) * 0.3);

    const nameLower = (song.name || '').toLowerCase();
    if ((nameLower.includes('karaoke') || nameLower.includes('instrumental')) && !wantsKaraoke) {
      score += Weights.PENALTY_KARAOKE;
    }
    if ((nameLower.includes('cover') || nameLower.includes('tribute')) && !wantsCover) {
      score += Weights.PENALTY_COVER;
    }
    if ((nameLower.includes('slowed') || nameLower.includes('reverb')) && !wantsSlowed) {
      score += Weights.PENALTY_SLOWED_REVERB;
    }
    if (nameLower.includes('remix') && !wantsRemix && !qNorm.includes('remix')) {
      score -= 120.0;
    }
    if (/teaser|trailer|promo|dialogue|jingle|ringtone|bgm/.test(nameLower) && !/teaser|trailer|promo|dialogue|jingle|ringtone|bgm/.test(qNorm)) {
      score -= 150.0;
    }
    const durSec = Number(song.duration) || 0;
    if (durSec > 0 && durSec < 60 && !/teaser|trailer|intro|bgm|ringtone/.test(qNorm)) score -= 200.0;

    return { song, score, matchType };
  }

  function artistIncludes(song, artistNorm) {
    if (!artistNorm) return false;
    const QN = getQN();
    const all = QN.normalize(String(song.artists || song.primaryArtist || ''));
    return all.includes(artistNorm);
  }

  /** The artist the query names, if any (exact or near-exact name among the artist results). */
  function findExactArtist(artists, parsed) {
    if (!Array.isArray(artists) || artists.length === 0) return null;
    const QN = getQN();
    const SS = getSS();
    const targets = [parsed.normalizedQuery, parsed.candidateArtist].filter(Boolean).map(x => QN.normalize(x));
    for (const art of artists.slice(0, 8)) {
      const raw = String(art.name || art.title || '');
      if (!raw || raw.includes('|')) continue;
      const n = QN.normalize(raw);
      for (const q of targets) {
        if (n === q || (q.length >= 4 && SS.jaroWinklerSimilarity(n, q) >= 0.93)) return art;
      }
    }
    return null;
  }

  /**
   * Same title, different recording: covers, karaoke tracks and obscure namesakes only stay in the list
   * when they have real popularity next to the first (best) version, or when the query names their artist.
   */
  function collapseSameTitle(list, artistNorm) {
    const TD = getTD();
    const topPlays = new Map();
    const kept = [];
    for (const s of list) {
      const key = TD.cleanTrackTitle(s.name);
      const plays = Number(s.playCount) || 0;
      if (!topPlays.has(key)) { topPlays.set(key, plays); kept.push(s); continue; }
      const top = topPlays.get(key);
      const namesArtist = artistNorm && artistIncludes(s, artistNorm);
      if (namesArtist || top === 0 || plays >= 1000000 || plays >= top * 0.02) kept.push(s);
    }
    return kept;
  }

  function rankSongs(candidates, parsed, options = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const TD = getTD();
    const QN = getQN();
    const artistNorm = options.artistName ? QN.normalize(options.artistName) : '';
    const scored = candidates.map((s, i) => scoreSong(s, parsed, i < FUZZY_BUDGET));
    scored.forEach(x => {
      const s = x.song;
      // Popularity breaks ties inside a relevance tier (log scale: 1k plays → +60, 100M → +160)
      x.score += Math.min(180, Math.log10((Number(s.playCount) || 0) + 1) * 20);
      if (s.__topRank !== undefined && s.__topRank !== null) x.score += 1500 - Number(s.__topRank) * 10;
      else if (artistNorm && artistIncludes(s, artistNorm)) x.score += 300;
    });
    scored.sort((a, b) => b.score - a.score);
    const sortedSongs = scored.map(s => s.song);
    const deduplicated = collapseSameTitle(TD.deduplicate(sortedSongs, parsed.rawQuery), artistNorm);

    const qNorm = parsed.normalizedQuery || '';
    const isExplicitArtistQuery = (typeof QN.isLikelyArtist === 'function') && QN.isLikelyArtist(qNorm);

    // If explicit artist query (e.g. "The Weeknd"), allow that artist's songs to flow naturally
    if (isExplicitArtistQuery || parsed.isCompoundQuery || artistNorm) {
      return deduplicated;
    }

    // For genre, mood, thematic or general keyword queries (e.g. "phonk", "pop", "gym", "chill"),
    // apply strict Artist Diversity & Interleaving so the results never feel like single-artist spam
    const diversified = [];
    const artistCounts = {};
    const deferred = [];

    for (const song of deduplicated) {
      const art = TD.cleanArtistName(song.artists || song.primaryArtist || '');
      const count = artistCounts[art] || 0;

      // Allow max 2 songs per artist in top results, and never 2 consecutive tracks by the same artist
      const prevArtist = diversified.length > 0 ? TD.cleanArtistName(diversified[diversified.length - 1].artists || diversified[diversified.length - 1].primaryArtist || '') : null;

      if (count < 2 && art !== prevArtist) {
        diversified.push(song);
        artistCounts[art] = count + 1;
      } else {
        deferred.push(song);
      }
    }

    // Append remaining deferred tracks respecting spacing
    for (const song of deferred) {
      const art = TD.cleanArtistName(song.artists || song.primaryArtist || '');
      const count = artistCounts[art] || 0;
      if (count < 3) {
        diversified.push(song);
        artistCounts[art] = count + 1;
      }
    }

    return diversified;
  }

  function rankArtists(artists, parsed) {
    if (!Array.isArray(artists) || artists.length === 0) return [];
    const QN = getQN();
    const SS = getSS();
    const qNorm = parsed.normalizedQuery;

    // One entry per artist: drop "A|B" junk and "A & B" composites when A or B is listed on its own.
    const seen = new Set();
    const names = new Set(artists.map(a => QN.normalize(a.name || a.title || '')));
    const unique = [];
    for (const a of artists) {
      const raw = String(a.name || a.title || '');
      const n = QN.normalize(raw);
      if (!n || seen.has(n) || raw.includes('|')) continue;
      const parts = raw.split(/\s*(?:&|and|,|\|)\s*/i).map(x => QN.normalize(x)).filter(Boolean);
      if (parts.length > 1 && (parts.length >= 3 || parts.some(pt => names.has(pt) && pt !== n))) continue;
      // Relevance gate: "Tom Hull" has no business under a "tum hi ho" search
      const rel = n === qNorm || n.includes(qNorm) || qNorm.includes(n) ? 1 : SS.computeMatchScore(qNorm, n);
      if (rel < 0.72) continue;
      seen.add(n);
      unique.push(a);
    }
    return unique.sort((a, b) => {
      const aNorm = QN.normalize(a.name || a.title);
      const bNorm = QN.normalize(b.name || b.title);

      const scoreA = aNorm === qNorm ? 1000 : (aNorm.startsWith(qNorm) ? 800 : SS.computeMatchScore(qNorm, aNorm) * 600);
      const scoreB = bNorm === qNorm ? 1000 : (bNorm.startsWith(qNorm) ? 800 : SS.computeMatchScore(qNorm, bNorm) * 600);
      return scoreB - scoreA;
    }).slice(0, 8);
  }

  function rankAlbums(albums, parsed) {
    if (!Array.isArray(albums) || albums.length === 0) return [];
    const QN = getQN();
    const SS = getSS();
    const qNorm = parsed.normalizedQuery;

    const unique = albums.filter((a, idx, self) => idx === self.findIndex(t => (t.id || t.name) === (a.id || a.name)));
    return unique.sort((a, b) => {
      const aNorm = QN.normalize(a.name || a.title);
      const bNorm = QN.normalize(b.name || b.title);
      const scoreA = aNorm === qNorm ? 900 : (aNorm.startsWith(qNorm) ? 750 : SS.computeMatchScore(qNorm, aNorm) * 500);
      const scoreB = bNorm === qNorm ? 900 : (bNorm.startsWith(qNorm) ? 750 : SS.computeMatchScore(qNorm, bNorm) * 500);
      return scoreB - scoreA;
    });
  }

  function detectDidYouMean(rawQuery) {
    const QN = getQN();
    const SS = getSS();
    const qNorm = QN.normalize(rawQuery);
    if (qNorm.length < 3) return null;

    for (const artist of QN.POPULAR_ARTISTS) {
      const canonical = artist.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      if (artist.startsWith('the ') && artist.substring(4) === qNorm) {
        return canonical;
      }

      const dist = SS.damerauLevenshteinDistance(qNorm, artist);
      const sim = SS.jaroWinklerSimilarity(qNorm, artist);
      if ((dist === 1 || dist === 2 || sim >= 0.88) && qNorm !== artist && !artist.includes(qNorm)) {
        return canonical;
      }
    }
    return null;
  }

  function getAutocompleteSuggestions(prefix, recentSearches = []) {
    const QN = getQN();
    const pNorm = QN.normalize(prefix);
    if (!pNorm) return recentSearches.slice(0, 6);

    const results = [];

    for (const r of recentSearches) {
      if (QN.normalize(r).startsWith(pNorm)) {
        results.push(r);
      }
    }

    for (const artist of QN.POPULAR_ARTISTS) {
      if (artist.startsWith(pNorm)) {
        results.push(artist.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
      }
    }

    return Array.from(new Set(results)).slice(0, 6);
  }

  function searchOffline(query, limit = 50) {
    if (!query || !query.trim()) return { songs: [], artists: [], albums: [] };
    const QN = getQN();
    const SS = getSS();
    const TD = getTD();
    const parsed = QN.parseCompoundQuery(query);
    const qNorm = parsed.normalizedQuery;

    let catalog = [];
    if (typeof OfflineManager !== 'undefined' && typeof OfflineManager.getOfflineCatalog === 'function') {
      catalog = OfflineManager.getOfflineCatalog();
    } else if (typeof Storage !== 'undefined' && typeof Storage.getOfflineCatalog === 'function') {
      catalog = Storage.getOfflineCatalog();
    }

    const scored = catalog.map(song => scoreSong(song, parsed)).filter(s => s.score > 200);
    scored.sort((a, b) => b.score - a.score);
    const rankedSongs = scored.slice(0, limit).map(s => s.song);

    // Group artists and albums from matching local/downloaded tracks
    const artistMap = new Map();
    const albumMap = new Map();

    catalog.forEach(s => {
      const art = s.artists || s.primaryArtist || '';
      const displayArt = art.split(/[,&/]|feat\./i)[0].trim();
      const artNorm = QN.normalize(displayArt);
      if (displayArt && (artNorm === qNorm || artNorm.includes(qNorm) || qNorm.includes(artNorm) || SS.computeMatchScore(qNorm, artNorm) > 0.6)) {
        const key = artNorm;
        if (!artistMap.has(key)) {
          artistMap.set(key, { id: `art_${key}`, name: displayArt, image: s.image || 'assets/logo.png', role: 'Artist' });
        }
      }
      const alb = s.album || '';
      const albNorm = QN.normalize(alb);
      if (alb && (albNorm === qNorm || albNorm.includes(qNorm) || qNorm.includes(albNorm) || SS.computeMatchScore(qNorm, albNorm) > 0.6)) {
        if (!albumMap.has(alb)) {
          albumMap.set(alb, { id: `alb_${alb}`, name: alb, artist: art, image: s.image || 'assets/logo.png', year: s.year || '' });
        }
      }
    });

    return {
      songs: rankedSongs,
      artists: Array.from(artistMap.values()),
      albums: Array.from(albumMap.values()),
      didYouMean: detectDidYouMean(query)
    };
  }

  // Detect Search Intent (ARTIST, SONG, COMPOUND, ALBUM, PLAYLIST, GENERAL)
  function detectSearchIntent(query, rawResults = {}) {
    const QN = getQN();
    const TD = getTD();
    const qNorm = QN.normalize(query);
    if (!qNorm) return { intent: 'GENERAL', query: qNorm };

    const songs = rawResults.songs || [];
    const artists = rawResults.artists || [];
    const albums = rawResults.albums || [];
    const playlists = rawResults.playlists || [];

    // 1. Exact Artist Intent
    const exactArtist = artists.find(a => QN.normalize(a.name || a.title) === qNorm);
    if (exactArtist) {
      return { intent: 'ARTIST', target: exactArtist, query: qNorm };
    }

    // 2. Compound Query Intent (e.g. "The Weeknd Blinding Lights")
    const parsed = QN.parseCompoundQuery(query);
    if (parsed.isCompoundQuery && parsed.candidateSongTitle && parsed.candidateArtist) {
      return { intent: 'COMPOUND', target: parsed, query: qNorm };
    }

    // 3. Exact Song Intent
    const exactSong = songs.find(s => TD.cleanTrackTitle(s.name) === qNorm || QN.normalize(s.name) === qNorm);
    if (exactSong) {
      return { intent: 'SONG', target: exactSong, query: qNorm };
    }

    // 4. Exact Album Intent
    const exactAlbum = albums.find(a => QN.normalize(a.title || a.name) === qNorm);
    if (exactAlbum) {
      return { intent: 'ALBUM', target: exactAlbum, query: qNorm };
    }

    // 5. Exact Playlist Intent
    const exactPlaylist = playlists.find(p => QN.normalize(p.title || p.name) === qNorm);
    if (exactPlaylist) {
      return { intent: 'PLAYLIST', target: exactPlaylist, query: qNorm };
    }

    return { intent: 'GENERAL', query: qNorm };
  }

  // Deterministic Best Match Evaluator across all entity types
  function evaluateBestMatch(results, query) {
    const QN = getQN();
    const SS = getSS();
    const TD = getTD();
    const qNorm = QN.normalize(query);
    if (!qNorm) return null;

    const songs = results?.songs?.results || results?.songs || [];
    const artists = results?.artists?.results || results?.artists || [];
    const albums = results?.albums?.results || results?.albums || [];
    const playlists = results?.playlists?.results || results?.playlists || [];

    const isArtistQuery = (typeof QN.isLikelyArtist === 'function') && QN.isLikelyArtist(qNorm);

    let bestCandidate = null;
    let highestScore = -Infinity;

    // 1. Evaluate Artists
    for (const art of artists.slice(0, 4)) {
      const rawName = art.name || art.title || '';
      const artNorm = QN.normalize(rawName);
      let score = 0;
      let reason = 'Artist match';

      if (artNorm === qNorm) {
        score = isArtistQuery ? 1800.0 : 1200.0;
        reason = 'Exact artist match';
      } else if (artNorm.startsWith(qNorm) || qNorm.startsWith(artNorm)) {
        score = (isArtistQuery ? 1200.0 : 800.0) + (Math.min(qNorm.length, artNorm.length) / Math.max(qNorm.length, artNorm.length)) * 50.0;
        reason = 'Artist prefix match';
      } else {
        const sim = SS.jaroWinklerSimilarity(qNorm, artNorm);
        if (sim >= 0.85) {
          score = (isArtistQuery ? 1000.0 : 600.0) + (sim * 100.0);
          reason = 'Similar artist name';
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = { type: 'artist', item: art, score, reason };
      }
    }

    // 2. Evaluate Songs
    const parsed = QN.parseCompoundQuery(query);

    for (let i = 0; i < Math.min(6, songs.length); i++) {
      const s = songs[i];
      const sTitleNorm = QN.normalize(s.name);
      const cleanTitle = TD.cleanTrackTitle(s.name);
      const cleanArtist = TD.cleanArtistName(s.artists || s.primaryArtist);

      let score = 0;
      let reason = 'Song match';

      const isExactTitle = (cleanTitle === qNorm || sTitleNorm === qNorm);
      const isExactArtistOnly = (cleanArtist === qNorm && !isExactTitle);

      if (isExactTitle) {
        score = 1600.0;
        reason = 'Exact song title match';
        if (cleanArtist && (qNorm.includes(cleanArtist) || isArtistQuery)) {
          score += 100.0;
        }
      } else if (isExactArtistOnly) {
        // Query is just the artist name (e.g. "The Weeknd")
        // Song is by this artist, but title wasn't searched — should NOT beat exact artist entity!
        score = 400.0 + Math.max(0, (6 - i) * 10.0);
        reason = `Top track by ${s.artists || 'artist'}`;
      } else if (parsed.isCompoundQuery && parsed.candidateSongTitle && parsed.candidateArtist) {
        const tTitleScore = SS.computeMatchScore(parsed.candidateSongTitle, cleanTitle);
        const tArtistScore = SS.computeMatchScore(parsed.candidateArtist, cleanArtist);
        if (tTitleScore >= 0.85 && tArtistScore >= 0.80) {
          score = 1700.0 + (tTitleScore * 50.0) + (tArtistScore * 50.0);
          reason = 'Exact track and artist match';
        } else if (tTitleScore >= 0.85) {
          score = 1100.0 + (tTitleScore * 50.0);
          reason = 'Song title match';
        }
      } else if (cleanTitle.startsWith(qNorm) || sTitleNorm.startsWith(qNorm)) {
        score = 850.0 + (qNorm.length / Math.max(1, cleanTitle.length)) * 50.0;
        reason = 'Song title prefix match';
      } else {
        const sim = SS.computeMatchScore(qNorm, cleanTitle);
        if (sim >= 0.82) {
          score = 650.0 + (sim * 100.0);
          reason = 'Similar song title';
        }
      }

      // Retrieval position bonus
      score += Math.max(0, (6 - i) * 5.0);

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = { type: 'song', item: s, score, reason, index: i };
      }
    }

    // 3. Evaluate Albums
    for (const alb of albums.slice(0, 3)) {
      const albNorm = QN.normalize(alb.title || alb.name);
      let score = 0;
      let reason = 'Album match';

      if (albNorm === qNorm) {
        score = 1100.0;
        reason = 'Exact album match';
      } else if (albNorm.startsWith(qNorm)) {
        score = 750.0 + (qNorm.length / albNorm.length) * 50.0;
        reason = 'Album prefix match';
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = { type: 'album', item: alb, score, reason };
      }
    }

    return highestScore >= 500.0 ? bestCandidate : null;
  }

  return {
    Weights,
    scoreSong,
    rankSongs,
    rankArtists,
    findExactArtist,
    rankAlbums,
    detectDidYouMean,
    getAutocompleteSuggestions,
    searchOffline,
    detectSearchIntent,
    evaluateBestMatch
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchEngine;
}

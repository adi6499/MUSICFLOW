// ============================================================================
// MUSICFLOW — RECOMMENDATION ENGINE 2.0 (Phase 8)
// Real Hybrid Personalization Pipeline: Multi-Dimensional User Profiling,
// Context-Aware Mood Scaling, Multi-Channel Recall, Song-First Filtering,
// Strict Artist Diversity, Controlled Discovery, and Human-Readable Reasons.
// ============================================================================

const RecommendationEngine = (() => {

  // Configurable Hybrid Ranker Weights (Language + Mood + Taste)
  const Weights = {
    languageMatch: 0.35,
    moodRelevance: 0.20,
    artistRelevance: 0.15,
    userAffinity: 0.15,
    vectorSimilarity: 0.05,
    playableSource: 0.05,
    popularity: 0.03,
    freshness: 0.02,
    skipPenaltyWeight: 0.30,
    repetitionPenaltyWeight: 0.15
  };

  let lastDiagnostics = [];
  const radioSessionSeenIds = new Set();

  // Context-Aware Mood Profiles (Modulates taste without replacing it)
  const MOOD_PROFILES = {
    'workout': { energy: 0.85, danceability: 0.80, minTempo: 120, maxTempo: 155, acousticness: 0.20, valence: 0.70, keywords: ['workout', 'gym', 'pump', 'beast', 'fast', 'high energy', 'dance', 'phonk'] },
    'relax': { energy: 0.35, danceability: 0.40, minTempo: 60, maxTempo: 100, acousticness: 0.80, valence: 0.50, keywords: ['chill', 'relax', 'acoustic', 'lo-fi', 'unplugged', 'peaceful', 'ambient', 'soft'] },
    'focus': { energy: 0.50, speechiness: 0.15, instrumentalness: 0.70, minTempo: 70, maxTempo: 115, keywords: ['study', 'focus', 'instrumental', 'piano', 'deep focus', 'ambient', 'concentration'] },
    'energize': { energy: 0.90, danceability: 0.85, valence: 0.85, minTempo: 110, maxTempo: 150, keywords: ['party', 'dance', 'energetic', 'club', 'pop', 'banger', 'hype', 'edm'] },
    'party': { energy: 0.90, danceability: 0.90, valence: 0.80, minTempo: 115, maxTempo: 140, keywords: ['party', 'club', 'remix', 'celebration', 'dance', 'dj', 'bass'] },
    'romance': { energy: 0.45, valence: 0.65, acousticness: 0.60, minTempo: 65, maxTempo: 105, keywords: ['love', 'romantic', 'dil', 'ishq', 'pyaar', 'sweet', 'ballad', 'slow'] },
    'sleep': { energy: 0.20, danceability: 0.25, acousticness: 0.90, minTempo: 50, maxTempo: 85, keywords: ['sleep', 'lullaby', 'peaceful', 'rain', 'meditation', 'drone', 'night'] },
    'all': null
  };

  // Curated Related Artists Graph for Deep Discovery
  const RELATED_ARTISTS_GRAPH = {
    // Western Pop & R&B
    'the weeknd': ['drake', 'travis scott', 'post malone', 'dua lipa', 'daft punk', 'kanye west', 'sza', 'charlie puth', 'bruno mars'],
    'katy perry': ['taylor swift', 'dua lipa', 'ariana grande', 'selena gomez', 'lady gaga', 'rihanna', 'bebe rexha', 'shakira', 'avril lavigne', 'kesha'],
    'taylor swift': ['olivia rodrigo', 'ed sheeran', 'billie eilish', 'sabrina carpenter', 'katy perry', 'ariana grande', 'selena gomez', 'gracie abrams'],
    'dua lipa': ['bebe rexha', 'ava max', 'calvin harris', 'olivia rodrigo', 'the weeknd', 'anne-marie', 'katy perry', 'sabrina carpenter'],
    'ariana grande': ['katy perry', 'taylor swift', 'dua lipa', 'selena gomez', 'billie eilish', 'olivia rodrigo', 'camila cabello'],
    'ed sheeran': ['shawn mendes', 'charlie puth', 'taylor swift', 'justin bieber', 'james arthur', 'lewis capaldi', 'sam smith'],
    'billie eilish': ['olivia rodrigo', 'finneas', 'lorde', 'lana del rey', 'taylor swift', 'conan gray', 'melanie martinez'],
    'olivia rodrigo': ['billie eilish', 'taylor swift', 'sabrina carpenter', 'gracie abrams', 'conan gray'],
    'sabrina carpenter': ['taylor swift', 'olivia rodrigo', 'dua lipa', 'ariana grande', 'camila cabello'],
    'post malone': ['the weeknd', 'juice wrld', 'khalid', 'twenty one pilots', 'travis scott', 'swae lee', 'justin bieber'],
    'justin bieber': ['shawn mendes', 'charlie puth', 'ed sheeran', 'the weeknd', 'zayn', 'one direction'],
    'selena gomez': ['taylor swift', 'ariana grande', 'dua lipa', 'katy perry', 'camila cabello', 'bebe rexha'],
    'lady gaga': ['katy perry', 'rihanna', 'dua lipa', 'beyonce', 'madonna', 'kesha', 'sia'],
    'rihanna': ['katy perry', 'beyonce', 'dua lipa', 'shakira', 'ariana grande', 'drake', 'sza'],
    'sza': ['the weeknd', 'summer walker', 'jhene aiko', 'drake', 'frank ocean', 'doja cat'],
    'bruno mars': ['maroon 5', 'the weeknd', 'ed sheeran', 'justin timberlake', 'anderson .paak', 'silk sonic'],
    'maroon 5': ['coldplay', 'one republic', 'imagine dragons', 'bruno mars', 'charlie puth'],
    'coldplay': ['imagine dragons', 'one republic', 'the chainsmokers', 'keane', 'maroon 5', 'u2', 'bastille'],
    'imagine dragons': ['coldplay', 'fall out boy', 'one republic', 'bastille', 'twenty one pilots', 'linkin park', 'the score'],
    'one republic': ['coldplay', 'imagine dragons', 'maroon 5', 'the chainsmokers', 'bastille'],
    'onerepublic': ['coldplay', 'imagine dragons', 'maroon 5', 'the chainsmokers', 'bastille'],
    
    // Hip-Hop / Rap (Western)
    'drake': ['travis scott', 'the weeknd', 'future', '21 savage', 'kendrick lamar', 'post malone', 'kanye west', 'lil baby'],
    'travis scott': ['drake', 'future', 'don toliver', 'playboi carti', 'kanye west', 'asap rocky', 'metro boomin'],
    'kendrick lamar': ['j. cole', 'drake', 'kanye west', 'asap rocky', 'travis scott', 'baby keem'],
    
    // EDM / Dance
    'alan walker': ['marshmello', 'the chainsmokers', 'martin garrix', 'kygo', 'dj snake', 'avicii', 'k-391'],
    'marshmello': ['alan walker', 'the chainsmokers', 'martin garrix', 'dj snake', 'bastille', 'juice wrld'],
    'the chainsmokers': ['alan walker', 'marshmello', 'martin garrix', 'coldplay', 'kygo', 'halsey', 'dj snake'],
    'martin garrix': ['alan walker', 'marshmello', 'the chainsmokers', 'tiesto', 'david guetta', 'avicii'],
    'avicii': ['kygo', 'martin garrix', 'alan walker', 'david guetta', 'tiesto', 'swedish house mafia'],
    'kygo': ['avicii', 'alan walker', 'marshmello', 'the chainsmokers', 'gryffin'],

    // Bollywood / Hindi
    'arijit singh': ['pritam', 'shreya ghoshal', 'atif aslam', 'mohit chauhan', 'kk', 'darshan raval', 'jubin nautiyal', 'jasleen royal', 'vishal mishra'],
    'shreya ghoshal': ['arijit singh', 'sonu nigam', 'sunidhi chauhan', 'alka yagnik', 'pritam', 'shaan', 'mohit chauhan', 'monali thakur'],
    'pritam': ['arijit singh', 'kk', 'mohit chauhan', 'atif aslam', 'shreya ghoshal', 'badshah', 'vishal-shekhar', 'sachin-jigar'],
    'atif aslam': ['arijit singh', 'rahat fateh ali khan', 'mustafa zahid', 'ali zafar', 'kk', 'mohit chauhan', 'ali sethi'],
    'kk': ['arijit singh', 'shaan', 'mohit chauhan', 'atif aslam', 'pritam', 'sonu nigam', 'lucky ali'],
    'sonu nigam': ['shreya ghoshal', 'arijit singh', 'shaan', 'udit narayan', 'kumar sanu', 'alka yagnik', 'abhijeet'],
    'kumar sanu': ['alka yagnik', 'udit narayan', 'anuradha paudwal', 'sonu nigam', 'abhijeet', 'babul supriyo'],
    'udit narayan': ['kumar sanu', 'alka yagnik', 'sonu nigam', 'kavita krishnamurthy', 'abhijeet'],
    'jubin nautiyal': ['arijit singh', 'darshan raval', 'pritam', 'rochak kohli', 'b praak', 'vishal mishra', 'meet bros'],
    'darshan raval': ['arijit singh', 'jubin nautiyal', 'armaan malik', 'atif aslam', 'neha kakkar'],
    'armaan malik': ['darshan raval', 'arijit singh', 'jubin nautiyal', 'shreya ghoshal'],
    'badshah': ['yo yo honey singh', 'diljit dosanjh', 'karan aujla', 'raftaar', 'divine', 'neha kakkar', 'guru randhawa', 'ikky'],
    'yo yo honey singh': ['badshah', 'raftaar', 'bohemia', 'imran khan', 'guru randhawa', 'diljit dosanjh', 'mika singh'],
    'mithoon': ['arijit singh', 'pritam', 'atif aslam', 'jubin nautiyal', 'mohit chauhan', 'tanishk bagchi'],
    'tanishk bagchi': ['jubin nautiyal', 'arijit singh', 'neha kakkar', 'badshah', 'mithoon'],

    // Punjabi
    'diljit dosanjh': ['karan aujla', 'sidhu moose wala', 'ap dhillon', 'badshah', 'amrinder gill', 'guru randhawa', 'shubh'],
    'karan aujla': ['diljit dosanjh', 'sidhu moose wala', 'ap dhillon', 'shubh', 'ikky', 'amrit maan'],
    'sidhu moose wala': ['karan aujla', 'amrit maan', 'premy', 'ap dhillon', 'bohemia', 'shubh', 'diljit dosanjh'],
    'shubh': ['ap dhillon', 'karan aujla', 'sidhu moose wala', 'diljit dosanjh', 'gurinder gill'],
    'ap dhillon': ['shubh', 'gurinder gill', 'karan aujla', 'diljit dosanjh', 'sidhu moose wala'],
    'b praak': ['jaani', 'jubin nautiyal', 'ammy virk', 'harrdy sandhu', 'diljit dosanjh'],

    // South Indian
    'anirudh ravichander': ['a.r. rahman', 'yuvan shankar raja', 'harris jayaraj', 'santhosh narayanan', 'sid sriram', 'g.v. prakash kumar'],
    'a.r. rahman': ['anirudh ravichander', 'harris jayaraj', 'yuvan shankar raja', 'sid sriram', 'shreya ghoshal', 'hariharan', 'k.s. chithra'],
    'sid sriram': ['anirudh ravichander', 'a.r. rahman', 'pradeep kumar', 'chinmayi', 'shreya ghoshal', 'jonita gandhi']
  };

  // Artist-to-dominant-language mapping for reliable inference when track metadata is missing
  const ARTIST_LANGUAGE_HINTS = {
    // English / Western
    'the weeknd': 'english', 'katy perry': 'english', 'taylor swift': 'english', 'ed sheeran': 'english',
    'drake': 'english', 'travis scott': 'english', 'post malone': 'english', 'dua lipa': 'english',
    'billie eilish': 'english', 'olivia rodrigo': 'english', 'ariana grande': 'english', 'justin bieber': 'english',
    'coldplay': 'english', 'imagine dragons': 'english', 'alan walker': 'english', 'marshmello': 'english',
    'the chainsmokers': 'english', 'shawn mendes': 'english', 'charlie puth': 'english', 'bebe rexha': 'english',
    'ava max': 'english', 'selena gomez': 'english', 'sabrina carpenter': 'english', 'lady gaga': 'english',
    'rihanna': 'english', 'bruno mars': 'english', 'maroon 5': 'english', 'adele': 'english', 'eminem': 'english',
    'kendrick lamar': 'english', 'kanye west': 'english', 'sza': 'english', 'camila cabello': 'english',
    'one republic': 'english', 'onerepublic': 'english', 'david guetta': 'english', 'calvin harris': 'english',
    'martin garrix': 'english', 'kygo': 'english', 'avicii': 'english', 'dj snake': 'english',

    // Hindi / Bollywood
    'arijit singh': 'hindi', 'pritam': 'hindi', 'shreya ghoshal': 'hindi', 'atif aslam': 'hindi',
    'mohit chauhan': 'hindi', 'kk': 'hindi', 'darshan raval': 'hindi', 'jubin nautiyal': 'hindi',
    'jasleen royal': 'hindi', 'vishal mishra': 'hindi', 'sonu nigam': 'hindi', 'sunidhi chauhan': 'hindi',
    'alka yagnik': 'hindi', 'kumar sanu': 'hindi', 'udit narayan': 'hindi', 'shaan': 'hindi',
    'vishal-shekhar': 'hindi', 'sachin-jigar': 'hindi', 'amit trivedi': 'hindi', 'neha kakkar': 'hindi',
    'rochak kohli': 'hindi', 'meet bros': 'hindi', 'b praak': 'hindi', 'badshah': 'hindi',
    'yo yo honey singh': 'hindi', 'raftaar': 'hindi', 'divine': 'hindi', 'armaan malik': 'hindi',
    'mithoon': 'hindi', 'tanishk bagchi': 'hindi',

    // Punjabi
    'diljit dosanjh': 'punjabi', 'karan aujla': 'punjabi', 'sidhu moose wala': 'punjabi',
    'ap dhillon': 'punjabi', 'shubh': 'punjabi', 'amrinder gill': 'punjabi', 'guru randhawa': 'punjabi',
    'amrit maan': 'punjabi', 'bohemia': 'punjabi', 'ikky': 'punjabi', 'gurinder gill': 'punjabi',
    'harrdy sandhu': 'punjabi', 'jassie gill': 'punjabi', 'mankirt aulakh': 'punjabi',

    // South Indian
    'anirudh ravichander': 'tamil', 'a.r. rahman': 'tamil', 'yuvan shankar raja': 'tamil',
    'harris jayaraj': 'tamil', 'santhosh narayanan': 'tamil', 'sid sriram': 'tamil',
    'g.v. prakash kumar': 'tamil', 'devi sri prasad': 'telugu', 'thaman s': 'telugu',
    'm.m. keeravani': 'telugu',

    // K-Pop
    'bts': 'korean', 'blackpink': 'korean', 'jungkook': 'korean', 'jimin': 'korean',
    'stray kids': 'korean', 'twice': 'korean', 'txt': 'korean', 'newjeans': 'korean',
    'aespa': 'korean', 'itzy': 'korean', 'seventeen': 'korean'
  };

  function getTrackArtistList(track) {
    if (!track) return [];
    const TD = getTrackDeduplicator();
    const names = new Set();
    if (track.primaryArtist && typeof track.primaryArtist === 'string') {
      const p = TD.cleanArtistName(track.primaryArtist);
      if (p) names.add(p);
    }
    const rawArtists = track.artists;
    if (typeof rawArtists === 'string') {
      rawArtists.split(/[,;&/•+]|feat\.|ft\./i).forEach(a => {
        const c = TD.cleanArtistName(a);
        if (c) names.add(c);
      });
    } else if (Array.isArray(rawArtists)) {
      rawArtists.forEach(a => {
        const c = TD.cleanArtistName(typeof a === 'object' ? (a.name || a.title) : a);
        if (c) names.add(c);
      });
    }
    return Array.from(names);
  }

  function inferTrackLanguage(track) {
    if (!track) return 'unknown';
    const DN = getDataNormalizer();
    // 1. Direct explicit language metadata
    const rawLang = track.language || track.lang || track.language_name || '';
    const norm = DN.normalizeLanguage(rawLang);
    if (norm && norm !== 'unknown') return norm;

    // 2. Infer from primary or contributing artists
    const artistList = getTrackArtistList(track);
    for (const art of artistList) {
      if (ARTIST_LANGUAGE_HINTS[art]) {
        return ARTIST_LANGUAGE_HINTS[art];
      }
      for (const [knownArt, lang] of Object.entries(ARTIST_LANGUAGE_HINTS)) {
        if (art.includes(knownArt) || knownArt.includes(art)) {
          return lang;
        }
      }
    }

    return 'unknown';
  }

  function getEmbedder() {
    if (typeof MusicFlowEmbedder !== 'undefined') return MusicFlowEmbedder;
    if (typeof require !== 'undefined') {
      try { return require('./musicFlowEmbedder.js'); } catch (_) {}
      try { return require('./js/musicFlowEmbedder.js'); } catch (_) {}
    }
    return null;
  }

  function getFeatureStore() {
    if (typeof FeatureStore !== 'undefined') return FeatureStore;
    if (typeof require !== 'undefined') {
      try { return require('./featureStore.js'); } catch (_) {}
      try { return require('./js/featureStore.js'); } catch (_) {}
    }
    return null;
  }

  function getDataNormalizer() {
    if (typeof DataNormalizer !== 'undefined') return DataNormalizer;
    if (typeof require !== 'undefined') {
      try { return require('./dataNormalizer.js'); } catch (_) {}
      try { return require('./js/dataNormalizer.js'); } catch (_) {}
    }
    return {
      normalizeLanguage: (l) => {
        if (!l || typeof l !== 'string') return 'unknown';
        const clean = l.toLowerCase().trim();
        if (clean === 'hi' || clean.includes('hindi') || clean.includes('हिंदी')) return 'hindi';
        if (clean === 'en' || clean.includes('english')) return 'english';
        if (clean === 'pa' || clean.includes('punjabi') || clean.includes('ਪੰਜਾਬੀ')) return 'punjabi';
        if (clean === 'ta' || clean.includes('tamil') || clean.includes('தமிழ்')) return 'tamil';
        if (clean === 'te' || clean.includes('telugu') || clean.includes('తెలుగు')) return 'telugu';
        if (clean === 'bn' || clean.includes('bengali') || clean.includes('বাংলা')) return 'bengali';
        if (clean === 'mr' || clean.includes('marathi') || clean.includes('मराठी')) return 'marathi';
        if (clean === 'gu' || clean.includes('gujarati')) return 'gujarati';
        if (clean === 'spanish') return 'spanish';
        if (clean === 'korean') return 'korean';
        return clean || 'unknown';
      },
      getArtistString: (a) => {
        if (!a) return 'Unknown Artist';
        if (typeof a === 'string') return a;
        if (Array.isArray(a)) return a.map(x => (typeof x === 'object' ? x.name : x)).filter(Boolean).join(', ') || 'Unknown Artist';
        if (typeof a === 'object') return a.name || a.title || 'Unknown Artist';
        return 'Unknown Artist';
      },
      getPrimaryArtist: (a) => {
        if (!a) return 'Unknown Artist';
        if (typeof a === 'string') return a.split(/[,;&/]|feat\.|ft\./i)[0].trim() || 'Unknown Artist';
        if (typeof a === 'object') return a.primaryArtist || a.name || 'Unknown Artist';
        return 'Unknown Artist';
      }
    };
  }

  function getTrackDeduplicator() {
    if (typeof TrackDeduplicator !== 'undefined') return TrackDeduplicator;
    if (typeof require !== 'undefined') {
      try { return require('./trackDeduplicator.js'); } catch (_) {}
      try { return require('./js/trackDeduplicator.js'); } catch (_) {}
    }
    return {
      cleanArtistName: (a) => String(a || '').split(/[,&;/]|feat\.|ft\./i)[0].trim().toLowerCase(),
      cleanTrackTitle: (t) => String(t || '').replace(/\(.*?\)|\[.*?\]/g, '').trim().toLowerCase(),
      deduplicate: (arr) => arr
    };
  }

  function TD_clean(a) {
    const artStr = (typeof DataNormalizer !== 'undefined' && a && typeof a === 'object') ? DataNormalizer.getArtistString(a) : a;
    return getTrackDeduplicator().cleanArtistName(artStr);
  }

  // Song-First Quality Filter: Strictly rejects channels, playlists, compilations, podcasts
  function isLegitimateTrack(song) {
    if (!song) return false;
    const type = (song.type || '').toLowerCase();
    if (type === 'playlist' || type === 'channel' || type === 'artist' || type === 'album' || type === 'user') {
      return false;
    }

    const title = (song.name || song.title || '').toLowerCase();
    const artStr = (typeof DataNormalizer !== 'undefined')
      ? DataNormalizer.getArtistString(song)
      : (typeof song.artists === 'string' ? song.artists : (song.artists?.name || song.primaryArtist || ''));
    const artist = String(artStr || '').toLowerCase();
    const dur = Number(song.duration || 0);

    // Reject non-track compilation titles
    const invalidKeywords = ['podcast', 'playlist', 'jukebox', 'best songs of', 'top hits of', 'full album', 'audiobook', 'continuous mix', 'megamix', 'live stream'];
    if (invalidKeywords.some(kw => title.includes(kw))) {
      return false;
    }

    // Must have recognizable duration (> 30s) or valid provider stream
    if (dur > 0 && dur < 30) return false;
    if (artist === 'unknown artist' && !song.audioUrl && !song.streamUrl) return false;

    return true;
  }

  function computeArtistSimilarity(artistA, artistB) {
    const TD = getTrackDeduplicator();
    const artStrA = (typeof DataNormalizer !== 'undefined' && typeof artistA === 'object') ? DataNormalizer.getArtistString(artistA) : artistA;
    const artStrB = (typeof DataNormalizer !== 'undefined' && typeof artistB === 'object') ? DataNormalizer.getArtistString(artistB) : artistB;
    const a = TD.cleanArtistName(artStrA);
    const b = TD.cleanArtistName(artStrB);

    if (!a || !b) return 0.0;
    if (a === b) return 1.0;
    if (a.includes(b) || b.includes(a)) return 0.85;

    const relA = RELATED_ARTISTS_GRAPH[a] || [];
    if (relA.includes(b)) return 0.75;

    const relB = RELATED_ARTISTS_GRAPH[b] || [];
    if (relB.includes(a)) return 0.75;

    return 0.0;
  }

  // Multi-Channel Candidate Recall Engine
  function generateCandidates(seedTrack, candidatePool = [], options = {}) {
    if (!seedTrack || !Array.isArray(candidatePool) || candidatePool.length === 0) return [];
    const Embedder = getEmbedder();
    const Store = getFeatureStore();
    const TD = getTrackDeduplicator();
    const TD_clean = TD.cleanArtistName;

    const seedFeatures = Store ? Store.getFeatures(seedTrack.id) : null;
    const seedVector = Embedder ? Embedder.generateEmbedding(seedTrack, seedFeatures) : null;
    const seedArtistList = getTrackArtistList(seedTrack);
    const seedLang = inferTrackLanguage(seedTrack);

    const relatedSet = new Set();
    seedArtistList.forEach(sa => {
      (RELATED_ARTISTS_GRAPH[sa] || []).forEach(r => relatedSet.add(r.toLowerCase()));
    });
    const relatedList = Array.from(relatedSet);

    const candidateMap = new Map();

    function recordCandidate(song, channel, score) {
      if (!isLegitimateTrack(song)) return;
      if (String(song.id) === String(seedTrack.id)) return;
      const id = String(song.id);
      if (!candidateMap.has(id)) {
        candidateMap.set(id, { song, channels: new Set(), channelScores: {} });
      }
      const entry = candidateMap.get(id);
      entry.channels.add(channel);
      entry.channelScores[channel] = Math.max(entry.channelScores[channel] || 0, score);
    }

    candidatePool.forEach(cand => {
      if (String(cand.id) === String(seedTrack.id)) return;
      const candArtistList = getTrackArtistList(cand);
      const candLang = inferTrackLanguage(cand);

      const isSameArtist = seedArtistList.some(sa => candArtistList.some(ca => ca === sa || ca.includes(sa) || sa.includes(ca)));
      const isRelatedArtist = candArtistList.some(ca => relatedList.some(ra => ra === ca || ca.includes(ra) || ra.includes(ca)));
      const isLanguageRelated = (seedLang !== 'unknown' && candLang === seedLang);
      const candFeatures = Store ? Store.getFeatures(cand.id) : null;
      const hasRealAudio = Boolean(seedFeatures?.source === 'REAL_AUDIO' || candFeatures?.source === 'REAL_AUDIO');

      // STRICT LANGUAGE FILTER: If both seed and candidate have known distinct languages,
      // strictly reject the candidate unless they are same or related artists.
      if (seedLang !== 'unknown' && candLang !== 'unknown' && seedLang !== candLang) {
        if (!isSameArtist && !isRelatedArtist) {
          return; // Skip musically incompatible cross-language candidate
        }
      }

      if (!isSameArtist && !isRelatedArtist && !isLanguageRelated && !hasRealAudio) {
        return; // Skip tracks with no musical, artist, language, or acoustic grounding
      }

      // Channel 1: 64-dim Embeat Vector Similarity (Acoustic ANN)
      if (Embedder && seedVector) {
        const candVector = Embedder.generateEmbedding(cand, candFeatures);
        const sim = Embedder.cosineSimilarity(seedVector, candVector);
        if (sim > 0.40) {
          recordCandidate(cand, 'vector_ann', sim);
          recordCandidate(cand, 'acoustic', sim);
        }
      }

      // Channel 2: Same Artist Catalog
      if (isSameArtist) {
        recordCandidate(cand, 'same_artist', 0.95);
      }

      // Channel 3: Related Artist Graph
      if (isRelatedArtist) {
        recordCandidate(cand, 'related_artist', 0.85);
      }

      // Channel 4: Language & Genre Cluster
      if (isLanguageRelated) {
        const pop = (cand.popularity ? Number(cand.popularity) : 60) / 100.0;
        recordCandidate(cand, 'genre_cluster', 0.70 + (pop * 0.20));
      }

      // Channel 5: Auxiliary Playable Provider bonus (ONLY for already-matched legitimate candidates)
      if (candidateMap.has(String(cand.id)) && (cand.playbackAvailable || cand.audioUrl || cand.mediaUrl)) {
        recordCandidate(cand, 'playable_source', 0.90);
      }
    });

    return Array.from(candidateMap.values()).map(entry => ({
      song: entry.song,
      sources: Array.from(entry.channels),
      channelScores: entry.channelScores
    }));
  }

  // Calculate Context/Mood Affinity for a Track
  function scoreMoodAffinity(song, moodName = 'all') {
    if (!moodName || moodName.toLowerCase() === 'all') return 0.5;
    const moodKey = moodName.toLowerCase();
    const profile = MOOD_PROFILES[moodKey];
    if (!profile) return 0.5;

    const Store = getFeatureStore();
    const features = Store ? Store.getFeatures(song.id) : null;
    let score = 0.5;

    if (features) {
      if (profile.energy !== undefined && features.energy !== undefined) {
        const energyDiff = Math.abs(features.energy - profile.energy);
        score += (1.0 - energyDiff) * 0.25;
      }
      if (profile.danceability !== undefined && features.danceability !== undefined) {
        const danceDiff = Math.abs(features.danceability - profile.danceability);
        score += (1.0 - danceDiff) * 0.25;
      }
      if (profile.minTempo !== undefined && features.tempo !== undefined) {
        if (features.tempo >= profile.minTempo && features.tempo <= profile.maxTempo) {
          score += 0.25;
        } else {
          score -= 0.15;
        }
      }
    }

    // Keyword Match in Title / Genre / Album
    const fullText = `${song.name || ''} ${song.album || ''} ${song.genre || ''}`.toLowerCase();
    if (profile.keywords && profile.keywords.some(kw => fullText.includes(kw))) {
      score += 0.20;
    }

    return Math.max(0.0, Math.min(1.0, score));
  }

  // Main Hybrid Personalized Recommender (Recommendation 2.0)
  function getPersonalizedRecommendations(
    userHistory = [],
    userFavorites = [],
    candidatePool = [],
    options = {}
  ) {
    if (!Array.isArray(candidatePool) || candidatePool.length === 0) return [];
    const limit = options.limit || 20;
    const mood = options.mood || 'all';
    const discoveryRatio = options.discoveryRatio !== undefined ? options.discoveryRatio : 0.15;

    const Embedder = getEmbedder();
    const Store = getFeatureStore();
    const TD = getTrackDeduplicator();
    const DN = getDataNormalizer();
    const TD_clean = (a) => {
      const artStr = (a && typeof a === 'object') ? DN.getArtistString(a) : (typeof a === 'string' ? a : (a?.name || ''));
      return TD.cleanArtistName(artStr);
    };

    // 1. Authoritative User Language Preference (from Settings or options)
    const configuredLangs = options.selectedLanguages || (typeof Storage !== 'undefined' && typeof Storage.getLanguages === 'function' ? Storage.getLanguages() : null);
    const userSelectedLanguages = (configuredLangs && Array.isArray(configuredLangs) ? configuredLangs : (configuredLangs ? [configuredLangs] : []))
      .map(l => DN.normalizeLanguage(l))
      .filter(l => l && l !== 'unknown');

    // Filter candidate pool to legitimate tracks only (0% playlist/channel contamination)
    const validCandidates = candidatePool.filter(isLegitimateTrack);
    if (validCandidates.length === 0) return [];

    // Retrieve User Signals from Storage
    let userSignals = {
      artistScores: {},
      languageScores: {},
      skippedSongCounts: {},
      skippedArtistCounts: {},
      milestones: {},
      totalSignals: 0
    };
    let recentDelivered = [];
    if (typeof Storage !== 'undefined' && typeof Storage.getUserTasteSignals === 'function') {
      userSignals = Storage.getUserTasteSignals();
      recentDelivered = (Storage.getRecentDeliveredRecommendations() || []).map(r => String(r.id));
    }

    const artistScores = { ...(userSignals.artistScores || {}) };
    const languageScores = { ...(userSignals.languageScores || {}) };
    const skippedSongCounts = { ...(userSignals.skippedSongCounts || {}) };
    const skippedArtistCounts = { ...(userSignals.skippedArtistCounts || {}) };
    const milestones = { ...(userSignals.milestones || {}) };

    // Supplement with directly provided history & favorites arrays
    userFavorites.forEach(s => {
      if (!s) return;
      const art = TD_clean(s.artists || s.primaryArtist || '');
      if (art) artistScores[art] = (artistScores[art] || 0) + 1.5;
      const sLang = DN.normalizeLanguage(s.language || s.lang || '');
      if (sLang && sLang !== 'unknown') languageScores[sLang] = (languageScores[sLang] || 0) + 1.5;
    });

    userHistory.forEach(s => {
      if (!s) return;
      const art = TD_clean(s.artists || s.primaryArtist || '');
      if (art) artistScores[art] = (artistScores[art] || 0) + 1.0;
      const sLang = DN.normalizeLanguage(s.language || s.lang || '');
      if (sLang && sLang !== 'unknown') languageScores[sLang] = (languageScores[sLang] || 0) + 1.0;
    });

    // Cold-Start Handling for Fresh Users
    const isColdStart = (userHistory.length === 0 && userFavorites.length === 0 && userSignals.totalSignals === 0);
    if (isColdStart) {
      const sortedByPop = [...validCandidates].sort((a, b) => {
        const langA = DN.normalizeLanguage(a.language || a.lang || '');
        const langB = DN.normalizeLanguage(b.language || b.lang || '');
        const langMatchA = userSelectedLanguages.length === 0 || userSelectedLanguages.includes(langA) ? 50 : -40;
        const langMatchB = userSelectedLanguages.length === 0 || userSelectedLanguages.includes(langB) ? 50 : -40;
        const moodA = scoreMoodAffinity(a, mood);
        const moodB = scoreMoodAffinity(b, mood);
        const popA = (a.popularity ? Number(a.popularity) : 70) + (moodA * 30) + langMatchA;
        const popB = (b.popularity ? Number(b.popularity) : 70) + (moodB * 30) + langMatchB;
        return popB - popA;
      });
      const dedup = TD.deduplicate(sortedByPop);
      const coldResults = [];
      const artCount = {};
      for (const s of dedup) {
        const art = TD_clean(s.artists || s.primaryArtist);
        if ((artCount[art] || 0) < 2) {
          coldResults.push({
            song: s,
            score: 0.85,
            reason: mood !== 'all' ? `Trending in ${mood}` : 'Trending popular tracks',
            provenance: 'METADATA_DERIVED'
          });
          artCount[art] = (artCount[art] || 0) + 1;
        }
        if (coldResults.length >= limit) break;
      }
      return coldResults;
    }

    const recentDeliveredSet = new Set(recentDelivered);
    const knownSongIds = new Set([...userFavorites, ...userHistory].map(s => String(s.id)));
    const mostRecentSong = userHistory[0] || userFavorites[0] || null;
    const seedFeatures = (mostRecentSong && Store) ? Store.getFeatures(mostRecentSong.id) : null;
    const seedVector = (mostRecentSong && Embedder) ? Embedder.generateEmbedding(mostRecentSong, seedFeatures) : null;

    lastDiagnostics = [];

    // Score all candidate tracks using Hybrid Multi-Signal Formula
    const scoredCandidates = validCandidates.map(cand => {
      const candId = String(cand.id);
      const candArtist = DN.getArtistString(cand);
      const cleanCandArtist = TD_clean(candArtist);
      const candLang = DN.normalizeLanguage(cand.language || cand.lang || cand.language_name || '');
      const candFeatures = Store ? Store.getFeatures(candId) : null;

      // 1. Language Score: Exact Match (+100 / 1.0), Detected (+80 / 0.8), Unknown (0 / 0.0), Unselected (-60 / -0.6)
      let langScore = 0.0;
      let isLanguageMatched = false;
      const userLangSignals = languageScores[candLang] || 0;

      if (userSelectedLanguages.length > 0) {
        if (userSelectedLanguages.includes(candLang)) {
          langScore = 1.0;
          isLanguageMatched = true;
        } else if (userLangSignals >= 1.0) {
          langScore = Math.min(0.90, 0.50 + (userLangSignals / 5.0));
          isLanguageMatched = true;
        } else if (candLang === 'unknown') {
          langScore = 0.0;
        } else {
          langScore = -0.60;
        }
      } else {
        if (userLangSignals > 0) {
          langScore = Math.min(1.0, 0.40 + (userLangSignals / 4.0));
          isLanguageMatched = true;
        } else {
          langScore = 0.0;
        }
      }

      // 2. Vector Similarity (64-dim embedding cosine sim)
      let vecSim = 0.5;
      if (Embedder && seedVector) {
        const candVec = Embedder.generateEmbedding(cand, candFeatures);
        vecSim = Embedder.cosineSimilarity(seedVector, candVec);
      }

      // 3. Artist Relevance (Long-term affinity + short-term history)
      let artistScore = 0.0;
      if (artistScores[cleanCandArtist]) {
        artistScore = Math.min(1.0, artistScores[cleanCandArtist] / 4.0);
      } else if (mostRecentSong) {
        artistScore = computeArtistSimilarity(mostRecentSong.artists || mostRecentSong.primaryArtist, cand.artists || cand.primaryArtist);
      }

      // 4. User Affinity (Likes: +1.5, Completions: +1.0, 50% Plays: +0.4)
      const isFav = userFavorites.some(f => String(f.id) === candId);
      const milestone = milestones[candId];
      let userAffinityScore = isFav ? 0.90 : 0.20;
      if (milestone) {
        if (milestone.completions > 0) userAffinityScore += 0.30;
        if (milestone.highestPct >= 50) userAffinityScore += 0.15;
        if (milestone.plays > 2) userAffinityScore += 0.25; // Repeat play bonus
      }

      // 5. Context-Aware Mood Scaling
      const moodScore = scoreMoodAffinity(cand, mood);

      // 6. Playability Check
      const isPlayable = cand.playbackAvailable || cand.audioUrl || cand.streamUrl || cand.provider === 'jiosaavn';
      const playabilityScore = isPlayable ? 1.0 : 0.15;

      // 7. Popularity & Freshness / Discovery
      const popScore = (cand.popularity ? Number(cand.popularity) : 65) / 100.0;
      const isDiscovery = !knownSongIds.has(candId);
      const freshnessScore = isDiscovery ? 0.90 : 0.40;

      // 8. Penalties: Skips & Repetition
      const skipsOnTrack = skippedSongCounts[candId] || 0;
      const skipsOnArtist = skippedArtistCounts[cleanCandArtist] || 0;
      const skipPenalty = (skipsOnTrack * 0.50) + Math.min(0.35, skipsOnArtist * 0.15);
      const repetitionPenalty = recentDeliveredSet.has(candId) ? 0.35 : 0.0;

      // Final Composite Score: Language + Mood + Taste
      const totalScore =
        (langScore * Weights.languageMatch) +
        (moodScore * Weights.moodRelevance) +
        (artistScore * Weights.artistRelevance) +
        (userAffinityScore * Weights.userAffinity) +
        (vecSim * Weights.vectorSimilarity) +
        (playabilityScore * Weights.playableSource) +
        (popScore * Weights.popularity) +
        (freshnessScore * Weights.freshness) -
        (skipPenalty * Weights.skipPenaltyWeight) -
        (repetitionPenalty * Weights.repetitionPenaltyWeight);

      // Explainable Human-Readable Reason
      let reason = 'Recommended for you';
      if (mood !== 'all' && moodScore >= 0.50) {
        reason = `Matches your ${mood} taste`;
      } else if (isFav) {
        reason = 'From your Liked Songs';
      } else if (artistScores[cleanCandArtist] > 2.0) {
        reason = `From your top artist ${candArtist}`;
      } else if (mostRecentSong && vecSim > 0.70) {
        reason = `Similar style to ${mostRecentSong.name}`;
      } else if (candLang !== 'unknown' && isLanguageMatched) {
        const capLang = candLang.charAt(0).toUpperCase() + candLang.slice(1);
        reason = `Popular in ${capLang}`;
      }

      // Record Developer Diagnostics (Internal only)
      lastDiagnostics.push({
        songId: candId,
        title: cand.name || cand.title || 'Track',
        artist: candArtist,
        language: candLang,
        selectedLanguages: userSelectedLanguages,
        mood,
        languageScore: Math.round(langScore * 100),
        moodScore: Math.round(moodScore * 100),
        artistScore: Math.round(artistScore * 100),
        historyScore: Math.round(userAffinityScore * 100),
        finalScore: Math.round(totalScore * 100),
        reason
      });

      return {
        song: cand,
        score: Math.max(0.01, totalScore),
        reason,
        isDiscovery,
        isLanguageMatched,
        candLang,
        provenance: candFeatures?.source || 'METADATA_DERIVED'
      };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    // Apply Soft-First Filtering & Interleaved Diversity
    // Always sequence matching language candidates first, followed by non-matching fallback candidates
    const matchedLanguageTracks = scoredCandidates.filter(c => c.isLanguageMatched || userSelectedLanguages.length === 0);
    const unmatchedTracks = scoredCandidates.filter(c => !c.isLanguageMatched && userSelectedLanguages.length > 0);
    const candidateSource = [...matchedLanguageTracks, ...unmatchedTracks];

    const deduplicated = TD.deduplicate(candidateSource.map(c => c.song));
    const scoredMap = new Map();
    scoredCandidates.forEach(c => scoredMap.set(String(c.song.id), c));

    const candidateList = deduplicated.map(s => scoredMap.get(String(s.id))).filter(Boolean);
    const finalRecs = [];
    const artistUsage = new Map();
    let lastArtist = null;

    while (finalRecs.length < limit && candidateList.length > 0) {
      // 1. Prefer the highest-scoring candidate whose artist is not lastArtist (and usage < 2)
      let pickIdx = candidateList.findIndex(item => {
        const art = TD_clean(item.song.artists || item.song.primaryArtist || 'unknown');
        const count = artistUsage.get(art) || 0;
        return count < 2 && art !== lastArtist;
      });

      // 2. If no alternating candidate is available, pick the next highest-scoring candidate with usage < 2
      if (pickIdx === -1) {
        pickIdx = candidateList.findIndex(item => {
          const art = TD_clean(item.song.artists || item.song.primaryArtist || 'unknown');
          return (artistUsage.get(art) || 0) < 2;
        });
      }

      if (pickIdx === -1) break; // No more eligible tracks

      const [selected] = candidateList.splice(pickIdx, 1);
      const art = TD_clean(selected.song.artists || selected.song.primaryArtist || 'unknown');
      finalRecs.push(selected);
      artistUsage.set(art, (artistUsage.get(art) || 0) + 1);
      lastArtist = art;
    }

    return finalRecs;
  }

  // Quick Picks Builder: 12-20 Song-First Tracks (Zero Playlists/Channels)
  function buildQuickPicks(userHistory = [], userFavorites = [], candidatePool = [], mood = 'all', limit = 16, options = {}) {
    const recs = getPersonalizedRecommendations(userHistory, userFavorites, candidatePool, {
      limit: Math.max(12, Math.min(24, limit)),
      mood,
      discoveryRatio: 0.15,
      ...options
    });
    return recs.map(r => ({
      ...r.song,
      recommendationReason: r.reason
    }));
  }

  // Similar Songs ("More Like This" & Song Radio Candidates)
  function getSimilarTracks(seedSong, candidatePool = [], limit = 20) {
    if (!seedSong || !Array.isArray(candidatePool) || candidatePool.length === 0) return [];
    const valid = candidatePool.filter(isLegitimateTrack);
    const candidates = generateCandidates(seedSong, valid, { limit: 50 });
    const TD = getTrackDeduplicator();
    const seedArtistKey = TD.cleanArtistName(seedSong.artists || seedSong.primaryArtist || '');

    const scored = candidates.map(c => {
      const vecSim = c.channelScores['vector_ann'] || 0.0;
      const sameArt = c.channelScores['same_artist'] ? 0.40 : 0.0;
      const relArt = c.channelScores['related_artist'] ? 0.30 : 0.0;
      const genre = c.channelScores['genre_cluster'] ? 0.20 : 0.0;
      const playable = (c.song.playbackAvailable || c.song.audioUrl || c.song.mediaUrl) ? 0.10 : 0.0;

      const score = (vecSim * 0.35) + sameArt + relArt + genre + playable;
      let reason = `Similar style to ${seedSong.name}`;
      if (sameArt > 0) reason = `More from ${seedSong.artists || 'this artist'}`;
      else if (relArt > 0) reason = `From related artists`;

      return { song: c.song, score, reason };
    });

    // Hard filter: discard candidates that have no legitimate acoustic, artist, or genre relationship
    const filteredScored = scored.filter(s => s.score >= 0.25);
    filteredScored.sort((a, b) => b.score - a.score);

    // Apply Interleaved Diversity to Radio / Similar Candidates
    const dedup = TD.deduplicate(filteredScored.map(s => s.song));
    const sMap = new Map();
    filteredScored.forEach(s => sMap.set(String(s.song.id), s));

    const aBuckets = new Map();
    for (const song of dedup) {
      const art = TD.cleanArtistName(song.artists || song.primaryArtist || '');
      if (!aBuckets.has(art)) aBuckets.set(art, []);
      aBuckets.get(art).push(sMap.get(String(song.id)) || { song, score: 0.5, reason: 'Similar track' });
    }

    // Prioritize seed artist first, then highest-affinity related artists
    const aKeys = Array.from(aBuckets.keys()).sort((a, b) => {
      if (a === seedArtistKey) return -1;
      if (b === seedArtistKey) return 1;
      const scoreA = aBuckets.get(a)?.[0]?.score || 0;
      const scoreB = aBuckets.get(b)?.[0]?.score || 0;
      return scoreB - scoreA;
    });

    const interleavedSimilar = [];
    const uIds = new Set();
    const artistCounts = new Map();

    let round = 0;
    while (interleavedSimilar.length < limit && round < 10) {
      let anyAddedThisRound = false;
      for (const k of aKeys) {
        const bucket = aBuckets.get(k) || [];
        const isSeed = (k === seedArtistKey);
        const maxForArtist = isSeed ? (limit <= 5 ? 3 : 6) : (limit <= 5 ? 2 : 3);
        const currentCount = artistCounts.get(k) || 0;

        if (currentCount < maxForArtist && round < bucket.length) {
          const it = bucket[round];
          if (it) {
            const sid = String(it.song.id);
            if (!uIds.has(sid)) {
              uIds.add(sid);
              interleavedSimilar.push(it);
              artistCounts.set(k, currentCount + 1);
              anyAddedThisRound = true;
            }
          }
        }
        if (interleavedSimilar.length >= limit) break;
      }
      if (!anyAddedThisRound) break;
      round++;
    }

    return interleavedSimilar;
  }

  // Continuous Song Radio Queue (Session-level Deduplication)
  function resetRadioSession() {
    radioSessionSeenIds.clear();
  }

  function getTrackRadio(seedSong, candidatePool = [], limit = 25) {
    if (!seedSong) return candidatePool.filter(isLegitimateTrack).slice(0, limit);
    const seedId = String(seedSong.id);
    radioSessionSeenIds.add(seedId);

    const filteredPool = candidatePool.filter(c => !radioSessionSeenIds.has(String(c.id)));
    const pool = filteredPool.length >= 5 ? filteredPool : candidatePool;
    const similar = getSimilarTracks(seedSong, pool, limit);
    const radioQueue = [seedSong];
    similar.forEach(item => {
      const sid = String(item.song.id);
      if (sid !== seedId && !radioSessionSeenIds.has(sid)) {
        radioSessionSeenIds.add(sid);
        radioQueue.push(item.song);
      }
    });
    return radioQueue;
  }

  const discoverySessionSeenIds = new Set();

  function resetDiscoverySession() {
    discoverySessionSeenIds.clear();
  }

  function getDiscoveryFeed(candidatePool = [], options = {}) {
    const limit = options.limit || 25;
    const mood = options.mood || 'all';
    const DN = getDataNormalizer();
    const excludeIds = new Set((options.excludeIds || []).map(String));

    let userHistory = [];
    let userFavorites = [];
    let selectedLanguages = options.selectedLanguages || [];

    if (typeof Storage !== 'undefined') {
      if (typeof Storage.getHistory === 'function') userHistory = Storage.getHistory() || [];
      if (typeof Storage.getFavorites === 'function') userFavorites = Storage.getFavorites() || [];
      if (selectedLanguages.length === 0 && typeof Storage.getLanguages === 'function') {
        selectedLanguages = Storage.getLanguages() || [];
      }
    }

    // 6-Level Fallback Chain Pipeline with Session-level Deduplication
    let pool = candidatePool.filter(c => {
      if (!c || !c.id) return false;
      const sid = String(c.id);
      return !discoverySessionSeenIds.has(sid) && !excludeIds.has(sid);
    });

    if (pool.length < limit && candidatePool.length > 0) {
      // Keep feed alive by recycling candidates while avoiding currently loaded cards
      const freshCandidates = candidatePool.filter(c => c && c.id && !excludeIds.has(String(c.id)));
      pool = [...pool, ...freshCandidates];
    }

    const recs = getPersonalizedRecommendations(userHistory, userFavorites, pool, {
      limit,
      mood,
      selectedLanguages,
      discoveryRatio: 0.35
    });

    const feedTracks = [];
    recs.forEach(r => {
      const sid = String(r.song.id);
      discoverySessionSeenIds.add(sid);
      feedTracks.push({
        ...r.song,
        discoveryReason: r.reason || 'Recommended for you',
        tag: r.isDiscovery ? 'DISCOVER' : (r.isLanguageMatched && r.candLang && r.candLang !== 'unknown' ? r.candLang.toUpperCase() : 'FOR YOU')
      });
    });

    return feedTracks;
  }

  function recordInteraction(eventType, payload = {}) {
    if (!eventType) return;
    if (typeof Storage !== 'undefined' && typeof Storage.recordTasteSignal === 'function') {
      Storage.recordTasteSignal(eventType, payload);
    }
  }

  function recordImportSignal(songs = []) {
    if (!Array.isArray(songs) || songs.length === 0) return;
    recordInteraction('imported_playlist_tracks', { count: songs.length, sample: songs.slice(0, 5) });
  }

  function getLastDiagnostics() {
    return [...lastDiagnostics];
  }

  return {
    Weights,
    MOOD_PROFILES,
    RELATED_ARTISTS_GRAPH,
    ARTIST_LANGUAGE_HINTS,
    inferTrackLanguage,
    detectLanguage: inferTrackLanguage,
    isLegitimateTrack,
    computeArtistSimilarity,
    generateCandidates,
    scoreMoodAffinity,
    getPersonalizedRecommendations,
    buildQuickPicks,
    getSimilarTracks,
    getTrackRadio,
    buildRadioQueue: getTrackRadio,
    resetRadioSession,
    getDiscoveryFeed,
    resetDiscoverySession,
    getLastDiagnostics,
    recordInteraction,
    recordImportSignal
  };
})();

if (typeof window !== 'undefined') {
  window.RecommendationEngine = RecommendationEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RecommendationEngine;
}

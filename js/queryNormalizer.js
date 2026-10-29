// ==========================================================================
// MUSICFLOW — QUERY NORMALIZER & INTENT PARSER
// ==========================================================================

const QueryNormalizer = (() => {
  const NOISE_PREFIXES = [
    'play me the song ', 'play the song ', 'stream the song ',
    'listen to the song ', 'play audio of ', 'play video of ',
    'audio of ', 'video of ', 'lyrics of '
  ];

  const NOISE_SUFFIXES = [
    ' official music video', ' official video', ' official audio',
    ' full video song', ' lyrical video', ' hd audio'
  ];

  const COMPOUND_SEPARATORS = [' - ', ' – ', ' — ', ' by ', ' feat. ', ' feat ', ' ft. ', ' ft ', ' x ', ' & '];

  const POPULAR_ARTISTS = [
    'the weeknd', 'weeknd', 'arijit singh', 'arijit', 'ed sheeran', 'taylor swift',
    'drake', 'travis scott', 'post malone', 'dua lipa', 'shreya ghoshal', 'pritam',
    'badshah', 'diljit dosanjh', 'diljit', 'atif aslam', 'karan aujla', 'sidhu moose wala',
    'ar rahman', 'justin bieber', 'billie eilish', 'eminem', 'rihanna', 'bruno mars',
    'coldplay', 'imagine dragons', 'ac/dc', 'ac dc', 'guns n roses', 'linkin park',
    'queen', 'ariana grande', 'katy perry', 'shakira', 'bts', 'blackpink', 'anuv jain',
    'prateek kuhad', 'darshan raval', 'neha kakkar', 'jubin nautiyal', 'king', 'mc stan',
    'seedhe maut', 'kr$na', 'divine', 'ap dhillon', 'yo yo honey singh', 'honey singh',
    'kishore kumar', 'rd burman', 'charlie puth', 'shawn mendes', 'olivia rodrigo',
    'kendrick lamar', 'sza', 'kanye west', 'kanye', 'alan walker', 'marshmello', 'david guetta'
  ];

  const POPULAR_SONG_CANONICALS = {
    'blinding ligt': 'blinding lights',
    'blinding ligths': 'blinding lights',
    'blinding lites': 'blinding lights',
    'shape of yu': 'shape of you',
    'shape of u': 'shape of you',
    'tum hi ho': 'tum hi ho',
    'arjit sing': 'arijit singh'
  };

  function normalize(input) {
    if (!input || typeof input !== 'string') return '';

    // 1. Unicode decomposition
    const decomposed = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 2. Transliterate smart characters & standard replacements
    let clean = decomposed
      .replace(/[’’`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—−-]/g, ' ')
      .replace(/…/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/\+/g, ' ')
      .replace(/[\/_]/g, ' ')
      .replace(/[^\w\s']/g, ' ');

    // 3. Collapse whitespace and lowercase
    return clean.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function stripNoise(query) {
    if (!query || typeof query !== 'string') return '';
    let q = query.trim();
    const lower = q.toLowerCase();

    for (const prefix of NOISE_PREFIXES) {
      if (lower.startsWith(prefix)) {
        const candidate = q.substring(prefix.length).trim();
        if (candidate) {
          q = candidate;
          break;
        }
      }
    }

    for (const suffix of NOISE_SUFFIXES) {
      if (q.toLowerCase().endsWith(suffix)) {
        const candidate = q.substring(0, q.length - suffix.length).trim();
        if (candidate) {
          q = candidate;
          break;
        }
      }
    }

    return q.trim();
  }

  const artistMatchCache = new Map();
  const POPULAR_SET = new Set(POPULAR_ARTISTS);

  function findFuzzyArtistMatch(name) {
    if (!name) return null;
    const norm = normalize(name);
    if (!norm) return null;
    if (artistMatchCache.has(norm)) return artistMatchCache.get(norm);

    let found = null;
    if (POPULAR_SET.has(norm)) {
      found = norm;
    } else {
      const contains = POPULAR_ARTISTS.find(a => a.startsWith(norm) || norm.startsWith(a));
      if (contains && Math.abs(contains.length - norm.length) <= 3) {
        found = contains;
      } else if (norm.length >= 4) {
        // Typo tolerance only against names of a similar length (cheap filter before the edit distance)
        const SS = (typeof StringSimilarity !== 'undefined') ? StringSimilarity : (typeof require !== 'undefined' ? require('./stringSimilarity.js') : null);
        if (SS) {
          for (const artist of POPULAR_ARTISTS) {
            if (Math.abs(artist.length - norm.length) > 3) continue;
            if (SS.damerauLevenshteinDistance(norm, artist) <= 2 || SS.jaroWinklerSimilarity(norm, artist) >= 0.85) { found = artist; break; }
          }
        }
      }
    }
    if (artistMatchCache.size > 4000) artistMatchCache.clear();
    artistMatchCache.set(norm, found);
    return found;
  }

  function isLikelyArtist(name) {
    return findFuzzyArtistMatch(name) !== null;
  }

  function parseCompoundQuery(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string') {
      return {
        rawQuery: '',
        normalizedQuery: '',
        candidateSongTitle: null,
        candidateArtist: null,
        isCompoundQuery: false,
        searchTerms: []
      };
    }

    const stripped = stripNoise(rawQuery);
    let normalized = normalize(stripped);

    if (POPULAR_SONG_CANONICALS[normalized]) {
      normalized = POPULAR_SONG_CANONICALS[normalized];
    }

    if (!normalized) {
      return {
        rawQuery,
        normalizedQuery: '',
        candidateSongTitle: null,
        candidateArtist: null,
        isCompoundQuery: false,
        searchTerms: []
      };
    }

    // 0. Check for voice / command introductory prefixes (e.g. "ok katy perry", "hey weeknd", "play roar")
    const voicePrefixMatch = normalized.match(/^(ok|okay|hey|play|stream|listen to|sing)\s+(.+)$/i);
    let voiceRest = null;
    if (voicePrefixMatch) {
      voiceRest = voicePrefixMatch[2].trim();
      const fuzzyArtist = findFuzzyArtistMatch(voiceRest);
      if (fuzzyArtist) {
        return {
          rawQuery,
          normalizedQuery: fuzzyArtist,
          candidateSongTitle: null,
          candidateArtist: fuzzyArtist,
          isCompoundQuery: false,
          searchTerms: [fuzzyArtist, voiceRest, normalized]
        };
      }
    }

    // 1. Direct Fuzzy Artist Match (e.g. "katy pery" -> "katy perry", "the weeknd")
    const directArtist = findFuzzyArtistMatch(normalized);
    if (directArtist && (normalized.length <= directArtist.length + 3)) {
      return {
        rawQuery,
        normalizedQuery: directArtist,
        candidateSongTitle: null,
        candidateArtist: directArtist,
        isCompoundQuery: false,
        searchTerms: [directArtist, normalized]
      };
    }

    // 2. Explicit Separators (e.g. "Song - Artist" or "Artist - Song")
    for (const sep of COMPOUND_SEPARATORS) {
      if (normalized.includes(sep)) {
        const parts = normalized.split(sep);
        if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
          const p1 = parts[0].trim();
          const p2 = parts[1].trim();
          const p1Artist = findFuzzyArtistMatch(p1);
          const p2Artist = findFuzzyArtistMatch(p2);

          const candidateArtist = p1Artist || p2Artist || (p1.length > p2.length ? p2 : p1);
          const candidateSong = (candidateArtist === p1 || candidateArtist === p1Artist) ? p2 : p1;

          return {
            rawQuery,
            normalizedQuery: normalized,
            candidateSongTitle: candidateSong,
            candidateArtist: candidateArtist,
            isCompoundQuery: true,
            searchTerms: [normalized, candidateSong, candidateArtist, `${candidateSong} ${candidateArtist}`]
          };
        }
      }
    }

    // 3. Known popular artist prefix or suffix
    for (const artist of POPULAR_ARTISTS) {
      if (normalized.startsWith(artist + ' ')) {
        const songPart = normalized.substring(artist.length).trim();
        if (songPart && songPart.length >= 2) {
          return {
            rawQuery,
            normalizedQuery: normalized,
            candidateSongTitle: songPart,
            candidateArtist: artist,
            isCompoundQuery: true,
            searchTerms: [normalized, songPart, artist, `${songPart} ${artist}`]
          };
        }
      } else if (normalized.endsWith(' ' + artist)) {
        const songPart = normalized.substring(0, normalized.length - artist.length).trim();
        if (songPart && songPart.length >= 2) {
          return {
            rawQuery,
            normalizedQuery: normalized,
            candidateSongTitle: songPart,
            candidateArtist: artist,
            isCompoundQuery: true,
            searchTerms: [normalized, songPart, artist, `${songPart} ${artist}`]
          };
        }
      }
    }

    // 4. Multi-word split
    const tokens = normalized.split(' ');
    if (tokens.length >= 3) {
      const firstTwo = `${tokens[0]} ${tokens[1]}`;
      const firstTwoArtist = findFuzzyArtistMatch(firstTwo);
      if (firstTwoArtist) {
        const songPart = tokens.slice(2).join(' ');
        return {
          rawQuery,
          normalizedQuery: normalized,
          candidateSongTitle: songPart,
          candidateArtist: firstTwoArtist,
          isCompoundQuery: true,
          searchTerms: [normalized, songPart, firstTwoArtist]
        };
      }

      const lastTwo = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
      const lastTwoArtist = findFuzzyArtistMatch(lastTwo);
      if (lastTwoArtist) {
        const songPart = tokens.slice(0, tokens.length - 2).join(' ');
        return {
          rawQuery,
          normalizedQuery: normalized,
          candidateSongTitle: songPart,
          candidateArtist: lastTwoArtist,
          isCompoundQuery: true,
          searchTerms: [normalized, songPart, lastTwoArtist]
        };
      }
    }

    return {
      rawQuery,
      normalizedQuery: normalized,
      candidateSongTitle: null,
      candidateArtist: null,
      isCompoundQuery: false,
      searchTerms: [normalized]
    };
  }

  return {
    normalize,
    stripNoise,
    isLikelyArtist,
    findFuzzyArtistMatch,
    parseCompoundQuery,
    POPULAR_ARTISTS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QueryNormalizer;
}

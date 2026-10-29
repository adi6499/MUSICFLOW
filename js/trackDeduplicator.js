// ==========================================================================
// MUSICFLOW — TRACK DEDUPLICATOR & QUALITY CLUSTER ENGINE
// ==========================================================================

const TrackDeduplicator = (() => {

  function cleanTrackTitle(name) {
    if (!name) return '';
    const clean = String(name)
      .replace(/\(.*?\)/gs, '')
      .replace(/\[.*?\]/gs, '')
      .replace(/(?:feat\..*|ft\..*|prod\..*|official.*|slowed.*|reverb.*)/gi, '');
    return (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(clean) : clean.toLowerCase().trim();
  }

  function cleanArtistName(artists) {
    if (!artists) return '';
    const first = String(artists).split(/[,&;/]|feat\.|ft\./i)[0].trim();
    const clean = first.replace(/(?:feat\..*|ft\..*)/gi, '');
    return (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(clean) : clean.toLowerCase().trim();
  }

  function scoreTrackQuality(song, wantsRemix, wantsLive, wantsAcoustic, wantsKaraoke) {
    let score = 100.0;
    const nameLower = (song.name || '').toLowerCase();
    const albumLower = (song.album || '').toLowerCase();

    // 1. Bitrate / Stream URL Quality & Playable Provider Bonus
    if (song.playbackAvailable || song.audioUrl || song.streamUrl) score += 30.0;
    if (song.provider === 'jiosaavn') score += 15.0; // Prefer JioSaavn canonical source
    if (Array.isArray(song.downloadUrl) && song.downloadUrl.some(u => (u.quality || '').includes('320'))) {
      score += 15.0;
    }

    // 2. High Resolution Artwork
    if (song.image && song.image.includes('500x500')) score += 10.0;
    if (song.image && !song.image.includes('logo.png')) score += 5.0;

    // 3. Album context
    if (song.album && !albumLower.includes('compilation') && !albumLower.includes('best of')) {
      score += 10.0;
    }

    // 4. Version modifiers
    const isKaraoke = nameLower.includes('karaoke') || nameLower.includes('instrumental');
    const isCover = nameLower.includes('cover') || nameLower.includes('tribute') || nameLower.includes('originally performed');
    const isLive = nameLower.includes('live') || nameLower.includes('concert');
    const isRemix = nameLower.includes('remix') || nameLower.includes('mix');
    const isSlowed = nameLower.includes('slowed') || nameLower.includes('reverb');

    if (isKaraoke && !wantsKaraoke) score -= 80.0;
    if (isCover) score -= 70.0;
    if (isLive && !wantsLive) score -= 30.0;
    if (isRemix && !wantsRemix) score -= 20.0;
    const dur = Number(song.duration || 0);
    if (dur >= 90 && dur <= 480) score += 5.0;

    // Metadata quality check: penalize if artist name is identical to track name
    if (cleanTrackTitle(song.name) === cleanArtistName(song.artists || song.primaryArtist)) {
      score -= 40.0;
    }

    return score;
  }

  const COMPILATION = /best of|\bhits\b|\btop\b|collection|jukebox|mashup|nonstop|non-stop|superhits|chartbusters|playlist|\bsongs\b|love|romantic|\bsad\b|party|dance|evergreen|trending|latest|\bnew\b|\bmix\b|medley|anthems|classics|forever|wedding|monsoon|birthday|\bvol\b|volume|compilation|20\d\d|19\d\d|lofi|lo-fi|remix|unplugged|reprise/i;

  /** Albums named like compilations never win over the song's own release. */
  function isCompilationAlbum(album, title) {
    const a = String(album || '').trim();
    if (!a) return true;
    if (cleanTrackTitle(a) === cleanTrackTitle(title)) return false;   // single named after the song
    return COMPILATION.test(a);
  }

  function artistTokens(artists) {
    const QN = (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer : null;
    return new Set(String(artists || '').split(/[,&;/|]|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
      .map(x => (QN ? QN.normalize(x) : x.toLowerCase().trim())).filter(x => x && x.length > 1));
  }

  function sameRecording(a, b) {
    const pa = Number(a.playCount) || 0, pb = Number(b.playCount) || 0;
    if (pa > 0 && pb > 0 && Math.abs(pa - pb) / Math.max(pa, pb) <= 0.005) return true;
    const da = Number(a.duration) || 0, db = Number(b.duration) || 0;
    if (da > 0 && db > 0 && Math.abs(da - db) <= 2) return true;
    const ta = artistTokens(a.artists || a.primaryArtist), tb = artistTokens(b.artists || b.primaryArtist);
    for (const x of ta) if (tb.has(x)) return true;
    return false;
  }

  function deduplicate(songs, query = '') {
    if (!Array.isArray(songs) || songs.length === 0) return [];

    const qNorm = (typeof QueryNormalizer !== 'undefined') ? QueryNormalizer.normalize(query) : String(query || '').toLowerCase();
    const wantsRemix = qNorm.includes('remix') || qNorm.includes('mix');
    const wantsLive = qNorm.includes('live') || qNorm.includes('concert');
    const wantsAcoustic = qNorm.includes('acoustic') || qNorm.includes('unplugged');
    const wantsKaraoke = qNorm.includes('karaoke') || qNorm.includes('instrumental');

    // 1. Same title → candidates for being the same song
    const byTitle = new Map();
    for (const song of songs) {
      if (!song) continue;
      const key = cleanTrackTitle(song.name);
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(song);
    }

    const result = [];
    byTitle.forEach(group => {
      // 2. Split a title group into recordings (the same song released on many albums is ONE recording)
      const recordings = [];
      for (const s of group) {
        const rec = recordings.find(r => r.some(m => sameRecording(m, s)));
        if (rec) rec.push(s); else recordings.push([s]);
      }
      recordings.forEach(members => {
        if (members.length === 1) { result.push(members[0]); return; }
        const years = members.map(m => parseInt(String(m.year || '').slice(0, 4), 10)).filter(y => y > 1900);
        const minYear = years.length ? Math.min(...years) : null;
        const maxPlays = Math.max(...members.map(m => Number(m.playCount) || 0));
        let best = members[0], bestScore = -Infinity;
        for (const m of members) {
          let sc = scoreTrackQuality(m, wantsRemix, wantsLive, wantsAcoustic, wantsKaraoke);
          sc += isCompilationAlbum(m.album, m.name) ? -40 : 25;                 // the song's own album wins
          sc += Math.log10((Number(m.playCount) || 0) + 1) * 4;                 // the version people play
          if (/lofi|lo-fi|flip|chill version|slowed|reverb|sped up/i.test(String(m.name) + ' ' + String(m.album)) && !wantsRemix) sc -= 35;
          const y = parseInt(String(m.year || '').slice(0, 4), 10);
          if (minYear && y === minYear) sc += 12;                               // original release year
          if (sc > bestScore) { bestScore = sc; best = m; }
        }
        // Carry the strongest signals of the whole recording onto the survivor
        if (maxPlays > (Number(best.playCount) || 0)) best.playCount = maxPlays;
        const ranks = members.map(m => m.__topRank).filter(r => r !== undefined && r !== null);
        if (ranks.length) best.__topRank = Math.min(...ranks);
        result.push(best);
        if (!wantsRemix) {
          const remix = members.find(m => m.id !== best.id && /remix/i.test(String(m.name || '')));
          if (remix && !/remix/i.test(String(best.name || ''))) result.push(remix);
        }
      });
    });

    return result;
  }

  /** Items of `more` that are not already represented in `existing` (same recording family). */
  function dedupeAgainst(existing, more, query = '') {
    const fresh = deduplicate(more, query);
    const have = new Map();
    for (const s of existing || []) {
      const key = cleanTrackTitle(s.name);
      if (!have.has(key)) have.set(key, []);
      have.get(key).push(s);
    }
    const ids = new Set((existing || []).map(s => String(s.id)));
    return fresh.filter(s => {
      if (ids.has(String(s.id))) return false;
      const twins = have.get(cleanTrackTitle(s.name)) || [];
      return !twins.some(tw => sameRecording(tw, s));
    });
  }

  return {
    cleanTrackTitle,
    cleanArtistName,
    isCompilationAlbum,
    sameRecording,
    deduplicate,
    dedupeAgainst
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackDeduplicator;
}

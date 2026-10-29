// ============================================================================
// MUSICFLOW — EMBEAT DATA ADAPTER & MULTI-CHANNEL RECALL ENGINE
// Based on gdstudio-org/Embeat architecture
// ============================================================================

const EmbeatAdapter = (() => {

  // 1. MUSICFLOW <-> EMBEAT TRACK ADAPTER
  const MusicFlowTrackAdapter = {
    toEmbeatTrack(song) {
      if (!song) return null;
      const rawArtist = song.artists || song.primaryArtist || song.artist || 'Unknown Artist';
      const cleanArtist = rawArtist.split(/[,&/]|feat\./i)[0].trim() || 'Unknown Artist';
      
      // Determine language/genre cluster
      const lang = (song.language || 'english').toLowerCase().trim();
      const genre = (song.genre || lang || 'pop').toLowerCase().trim();
      const duration = Number(song.duration || 180);
      const year = parseInt(song.year || 2020, 10);
      const popularity = Number(song.popularity || 70);

      // Estimate / extract acoustic proxy vector features for EmbeatMLP (7 continuous dims + discrete)
      // Normalized between 0.0 and 1.0
      const acousticVector = this.computeAcousticProxies(song, lang, genre, duration, year);

      return {
        id: String(song.id || ''),
        track_name: song.name || song.title || 'Unknown Title',
        artist_name: cleanArtist,
        all_artists: rawArtist,
        album_name: song.album || '',
        genre: genre,
        language: lang,
        duration: duration,
        year: year,
        popularity: popularity,
        image: song.image || 'assets/logo.png',
        stream_url: song.streamUrl || song.audioUrl || '',
        acoustic_features: acousticVector,
        source_song: song
      };
    },

    fromEmbeatTrack(embeatTrack) {
      if (!embeatTrack) return null;
      if (embeatTrack.source_song) return embeatTrack.source_song;
      return {
        id: embeatTrack.id,
        name: embeatTrack.track_name,
        artists: embeatTrack.all_artists || embeatTrack.artist_name,
        primaryArtist: embeatTrack.artist_name,
        album: embeatTrack.album_name,
        language: embeatTrack.language,
        duration: embeatTrack.duration,
        year: String(embeatTrack.year || ''),
        image: embeatTrack.image || 'assets/logo.png',
        streamUrl: embeatTrack.stream_url || ''
      };
    },

    computeAcousticProxies(song, lang, genre, duration, year) {
      // Deterministic feature hash from musical title and artist to preserve acoustic identity
      let hash = 0;
      const str = `${song.name}_${song.artists}_${genre}`.toLowerCase();
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      const pseudoNorm = (seed) => {
        const x = Math.sin(hash + seed) * 10000;
        return x - Math.floor(x);
      };

      // 7 continuous EmbeatMLP features:
      // [danceability, energy, speechiness, acousticness, instrumentalness, liveness, valence]
      let danceability = 0.55 + (pseudoNorm(1) * 0.35);
      let energy = 0.60 + (pseudoNorm(2) * 0.35);
      let speechiness = 0.05 + (pseudoNorm(3) * 0.15);
      let acousticness = 0.20 + (pseudoNorm(4) * 0.40);
      let instrumentalness = 0.02 + (pseudoNorm(5) * 0.10);
      let liveness = 0.12 + (pseudoNorm(6) * 0.25);
      let valence = 0.50 + (pseudoNorm(7) * 0.40);

      // Adjust based on known genre / language profiles
      if (genre.includes('dance') || genre.includes('edm') || genre.includes('phonk')) {
        energy = Math.min(0.98, energy + 0.25);
        danceability = Math.min(0.95, danceability + 0.25);
        acousticness = Math.max(0.02, acousticness - 0.20);
      } else if (genre.includes('lo-fi') || genre.includes('chill') || genre.includes('ambient')) {
        energy = Math.max(0.15, energy - 0.35);
        acousticness = Math.min(0.90, acousticness + 0.30);
        valence = Math.max(0.20, valence - 0.15);
      } else if (genre.includes('acoustic') || genre.includes('classical') || genre.includes('ghazal')) {
        acousticness = Math.min(0.95, acousticness + 0.40);
        energy = Math.max(0.20, energy - 0.30);
      }

      // Discrete features: key (0-12), mode (0-2), time_signature (0-5), tempo_bucket (0-4)
      const key = Math.abs(hash) % 12;
      const mode = Math.abs(hash >> 2) % 2;
      const tempo = 80 + Math.floor(pseudoNorm(8) * 90); // 80 - 170 BPM

      return {
        continuous: [danceability, energy, speechiness, acousticness, instrumentalness, liveness, valence],
        discrete: { key, mode, tempo, timeSignature: 4 }
      };
    }
  };

  // 2. EMBEAT 64-DIMENSIONAL CONTRASTIVE ENCODER (EmbeatMLP Vector Generator)
  const EmbeatEncoder = {
    // Generates a 64-dimensional L2-normalized vector according to EmbeatMLP structure
    encodeTrack(embeatTrack) {
      const { continuous, discrete } = embeatTrack.acoustic_features || { continuous: [0.5, 0.5, 0.1, 0.3, 0.05, 0.15, 0.5], discrete: { key: 0, mode: 1, tempo: 120, timeSignature: 4 } };
      
      const vector = new Float32Array(64);

      // Section 1: Continuous acoustic features (dims 0..27)
      for (let i = 0; i < 7; i++) {
        const val = continuous[i];
        for (let j = 0; j < 4; j++) {
          const idx = i * 4 + j;
          vector[idx] = val * Math.cos(j * 1.5708 + val);
        }
      }

      // Section 2: Discrete features (key, mode, tempo, time_signature) (dims 28..47)
      const keyAngle = (discrete.key / 12.0) * 2 * Math.PI;
      vector[28] = Math.cos(keyAngle);
      vector[29] = Math.sin(keyAngle);
      vector[30] = discrete.mode === 1 ? 1.0 : -1.0;
      vector[31] = (discrete.tempo - 60) / 140.0;

      // Section 3: Genre / Language semantic embeddings (dims 48..63)
      const langStr = `${embeatTrack.genre}_${embeatTrack.language}`.toLowerCase();
      let gHash = 0;
      for (let k = 0; k < langStr.length; k++) {
        gHash = ((gHash << 5) - gHash) + langStr.charCodeAt(k);
        gHash |= 0;
      }
      for (let m = 0; m < 16; m++) {
        vector[48 + m] = Math.sin(gHash * (m + 1)) * 0.8;
      }

      // L2 Normalize vector
      let normSq = 0.0;
      for (let n = 0; n < 64; n++) {
        normSq += vector[n] * vector[n];
      }
      const norm = Math.sqrt(normSq) || 1.0;
      for (let n = 0; n < 64; n++) {
        vector[n] /= norm;
      }

      return vector;
    },

    // Computes Cosine Similarity between two 64-dim vectors
    cosineSimilarity(vecA, vecB) {
      if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
      let dot = 0.0;
      for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
      }
      // Since vectors are already L2 normalized, dot product is cosine similarity
      return Math.max(0.0, Math.min(1.0, (dot + 1.0) / 2.0)); // Scale [-1, 1] to [0, 1]
    }
  };

  // 3. MULTI-CHANNEL RECALL (5 PARALLEL CHANNELS)
  const MultiChannelRecall = {
    // Channel A: Acoustic / Vector Similarity (EmbeatMLP)
    recallAcoustic(seedTrack, candidatePool, topK = 30) {
      const seedEmbeat = MusicFlowTrackAdapter.toEmbeatTrack(seedTrack);
      const seedVec = EmbeatEncoder.encodeTrack(seedEmbeat);

      const scored = candidatePool
        .filter(c => c && String(c.id) !== String(seedTrack.id))
        .map(cand => {
          const candEmbeat = MusicFlowTrackAdapter.toEmbeatTrack(cand);
          const candVec = EmbeatEncoder.encodeTrack(candEmbeat);
          const similarity = EmbeatEncoder.cosineSimilarity(seedVec, candVec);
          return { song: cand, score: similarity, channel: 'acoustic' };
        });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    },

    // Channel B: Same Genre Popular Recall
    recallSameGenre(seedTrack, candidatePool, topK = 25) {
      const seedLang = (seedTrack.language || 'english').toLowerCase();
      const matched = candidatePool
        .filter(c => c && String(c.id) !== String(seedTrack.id))
        .filter(c => (c.language || 'english').toLowerCase() === seedLang)
        .map(cand => {
          const pop = Number(cand.popularity || 50) / 100.0;
          return { song: cand, score: 0.70 + (pop * 0.30), channel: 'genre' };
        });

      matched.sort((a, b) => b.score - a.score);
      return matched.slice(0, topK);
    },

    // Channel C: Same Artist Recall
    recallSameArtist(seedTrack, candidatePool, topK = 15) {
      const seedArtist = (seedTrack.artists || seedTrack.primaryArtist || '').split(/[,&/]/)[0].trim().toLowerCase();
      if (!seedArtist) return [];

      const matched = candidatePool
        .filter(c => c && String(c.id) !== String(seedTrack.id))
        .filter(c => {
          const art = (c.artists || c.primaryArtist || '').toLowerCase();
          return art.includes(seedArtist);
        })
        .map(cand => ({ song: cand, score: 0.95, channel: 'same_artist' }));

      return matched.slice(0, topK);
    },

    // Channel D: Similar / Related Artist Recall (Artist Graph)
    recallRelatedArtists(seedTrack, candidatePool, relatedArtistGraph = {}, topK = 25) {
      const rawArtist = (seedTrack.artists || seedTrack.primaryArtist || '').split(/[,&/]/)[0].trim().toLowerCase();
      const relatedList = (relatedArtistGraph[rawArtist] || []).map(a => a.toLowerCase());
      if (relatedList.length === 0) return [];

      const matched = candidatePool
        .filter(c => c && String(c.id) !== String(seedTrack.id))
        .filter(c => {
          const art = (c.artists || c.primaryArtist || '').toLowerCase();
          return relatedList.some(r => art.includes(r));
        })
        .map(cand => ({ song: cand, score: 0.85, channel: 'related_artist' }));

      return matched.slice(0, topK);
    },

    // Channel E: Playlist Collaborative Filtering (Track2Vec co-occurrence)
    recallPlaylistCooccurrence(seedTrack, candidatePool, playlistCooccurrenceMap = {}, topK = 20) {
      const seedId = String(seedTrack.id || '');
      const cooccurred = playlistCooccurrenceMap[seedId] || [];
      if (cooccurred.length === 0) return [];

      const idToWeight = new Map(cooccurred.map(item => [String(item.id), item.weight || 0.8]));

      const matched = candidatePool
        .filter(c => idToWeight.has(String(c.id)))
        .map(cand => ({
          song: cand,
          score: idToWeight.get(String(cand.id)),
          channel: 'playlist_cf'
        }));

      matched.sort((a, b) => b.score - a.score);
      return matched.slice(0, topK);
    }
  };

  return {
    MusicFlowTrackAdapter,
    EmbeatEncoder,
    MultiChannelRecall
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmbeatAdapter;
}

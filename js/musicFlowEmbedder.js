// ============================================================================
// MUSICFLOW — CUSTOM HYBRID EMBEDDING ENGINE (Phase 5.2)
// Generates 64-dimensional L2-normalized vector embeddings for Qdrant retrieval.
// Model Type: MusicFlow Custom Embedding Model (Option B)
// ============================================================================

const MusicFlowEmbedder = (() => {

  const MODEL_NAME = 'MusicFlow-Custom-Embedding-64d';
  const EMBEDDING_DIM = 64;

  // Generates a 64-dimensional normalized vector
  function generateEmbedding(song, features = null) {
    if (!song) return new Float32Array(EMBEDDING_DIM);
    const vector = new Float32Array(EMBEDDING_DIM);

    const hasRealAudio = features && features.source === 'REAL_AUDIO';
    const lang = (song.language || 'english').toLowerCase().trim();
    const genre = (song.genre || lang || 'pop').toLowerCase().trim();
    const artStr = (typeof DataNormalizer !== 'undefined' ? DataNormalizer.getArtistString(song) : (typeof song.artists === 'string' ? song.artists : (song.artists?.name || song.primaryArtist || '')));
    const artist = String(artStr || '').toLowerCase().trim();
    const year = parseInt(song.year || 2020, 10);
    const popularity = (song.popularity ? Number(song.popularity) : 70) / 100.0;

    // SECTION 1 (Dims 0..27): Acoustic Features (Real audio if available, else semantic genre profile)
    if (hasRealAudio) {
      const energy = features.energy?.value ?? 0.5;
      const danceability = features.danceability?.value ?? 0.5;
      const acousticness = features.acousticness?.value ?? 0.3;
      const speechiness = features.speechiness?.value ?? 0.1;
      const instrumentalness = features.instrumentalness?.value ?? 0.05;
      const liveness = features.liveness?.value ?? 0.15;
      const valence = features.valence?.value ?? 0.5;

      const continuous = [danceability, energy, speechiness, acousticness, instrumentalness, liveness, valence];
      for (let i = 0; i < 7; i++) {
        const val = continuous[i];
        for (let j = 0; j < 4; j++) {
          vector[i * 4 + j] = val * Math.cos(j * 1.5708 + val);
        }
      }
    } else {
      // Semantic acoustic estimates based on genre / language
      let gHash = 0;
      const str = `${genre}_${lang}`.toLowerCase();
      for (let i = 0; i < str.length; i++) {
        gHash = ((gHash << 5) - gHash) + str.charCodeAt(i);
        gHash |= 0;
      }
      for (let m = 0; m < 28; m++) {
        vector[m] = Math.sin(gHash * (m + 1)) * 0.7;
      }
    }

    // SECTION 2 (Dims 28..39): Discrete Musical & Temporal Properties (Key, Mode, Tempo, Year)
    if (hasRealAudio && features.tempo?.value !== null) {
      const bpm = features.tempo.value;
      const keyVal = features.key?.value ?? 0;
      const modeVal = features.mode?.value ?? 1;

      const keyAngle = (keyVal / 12.0) * 2 * Math.PI;
      vector[28] = Math.cos(keyAngle);
      vector[29] = Math.sin(keyAngle);
      vector[30] = modeVal === 1 ? 1.0 : -1.0;
      vector[31] = (bpm - 60) / 140.0;
    } else {
      vector[28] = 0.5;
      vector[29] = 0.5;
      vector[30] = 1.0;
      vector[31] = (120 - 60) / 140.0;
    }
    vector[32] = Math.max(-1.0, Math.min(1.0, (year - 2000) / 30.0));
    vector[33] = popularity;

    // SECTION 3 (Dims 40..63): Artist & Catalog Metadata Semantics
    let artHash = 0;
    for (let k = 0; k < artist.length; k++) {
      artHash = ((artHash << 5) - artHash) + artist.charCodeAt(k);
      artHash |= 0;
    }
    for (let p = 0; p < 24; p++) {
      vector[40 + p] = Math.sin(artHash * (p + 1)) * 0.85;
    }

    // L2 Normalize Vector: ||v|| = 1.0
    let normSq = 0.0;
    for (let n = 0; n < EMBEDDING_DIM; n++) {
      normSq += vector[n] * vector[n];
    }
    const norm = Math.sqrt(normSq) || 1.0;
    for (let n = 0; n < EMBEDDING_DIM; n++) {
      vector[n] /= norm;
    }

    return vector;
  }

  // Cosine Similarity between two L2-normalized 64-dim vectors
  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
    let dot = 0.0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    // Scale [-1, 1] to [0, 1]
    return Math.max(0.0, Math.min(1.0, (dot + 1.0) / 2.0));
  }

  return {
    MODEL_NAME,
    EMBEDDING_DIM,
    generateEmbedding,
    cosineSimilarity
  };
})();

if (typeof window !== 'undefined') {
  window.MusicFlowEmbedder = MusicFlowEmbedder;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicFlowEmbedder;
}

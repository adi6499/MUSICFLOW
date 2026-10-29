// ============================================================================
// MUSICFLOW — PERSISTENT FEATURE STORE & VERSIONING (Phase 5.2)
// Manages cached audio features and indexing states.
// ============================================================================

const FeatureStore = (() => {

  const STORE_KEY = 'mf_feature_store';
  const INDEX_STATE_KEY = 'mf_feature_index_states';
  const CURRENT_FEATURE_VERSION = 'audio-analysis-v1';

  // Indexing State Enum
  const INDEXING_STATE = {
    NOT_INDEXED: 'NOT_INDEXED',
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    INDEXED: 'INDEXED',
    FAILED: 'FAILED',
    STALE: 'STALE'
  };

  // In-Memory Feature Cache for ultra-fast access
  let memoryCache = new Map();
  let memoryStates = new Map();

  function loadStore() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        memoryCache = new Map(Object.entries(obj));
      }
      const rawStates = localStorage.getItem(INDEX_STATE_KEY);
      if (rawStates) {
        const statesObj = JSON.parse(rawStates);
        memoryStates = new Map(Object.entries(statesObj));
      }
    } catch (_) {}
  }

  function persistStore() {
    if (typeof localStorage === 'undefined') return;
    try {
      const obj = Object.fromEntries(memoryCache);
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      const statesObj = Object.fromEntries(memoryStates);
      localStorage.setItem(INDEX_STATE_KEY, JSON.stringify(statesObj));
    } catch (_) {}
  }

  // Initialize store from persistence
  loadStore();

  return {
    CURRENT_FEATURE_VERSION,
    INDEXING_STATE,

    saveFeatures(trackId, features) {
      if (!trackId || !features) return;
      const id = String(trackId);
      const record = {
        ...features,
        trackId: id,
        featureVersion: CURRENT_FEATURE_VERSION,
        updatedAt: Date.now()
      };
      memoryCache.set(id, record);
      persistStore();
      return record;
    },

    getFeatures(trackId) {
      if (!trackId) return null;
      const record = memoryCache.get(String(trackId));
      if (!record) return null;
      // Mark as stale if feature version does not match
      if (record.featureVersion !== CURRENT_FEATURE_VERSION) {
        this.setIndexingState(trackId, INDEXING_STATE.STALE);
      }
      return record;
    },

    getByFingerprint(fingerprint) {
      if (!fingerprint) return null;
      for (const record of memoryCache.values()) {
        if (record.audioFingerprint === fingerprint) {
          return record;
        }
      }
      return null;
    },

    setIndexingState(trackId, state) {
      if (!trackId || !state) return;
      memoryStates.set(String(trackId), {
        state,
        timestamp: Date.now()
      });
      persistStore();
    },

    getIndexingState(trackId) {
      if (!trackId) return INDEXING_STATE.NOT_INDEXED;
      const entry = memoryStates.get(String(trackId));
      return entry ? entry.state : INDEXING_STATE.NOT_INDEXED;
    },

    getAllFeatures() {
      return Array.from(memoryCache.values());
    },

    clear() {
      memoryCache.clear();
      memoryStates.clear();
      persistStore();
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FeatureStore;
}

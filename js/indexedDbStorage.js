// ==========================================================================
// MUSICFLOW — PERSISTENT OFFLINE INDEXEDDB STORAGE
// Handles offline audio Blobs, local tracks library, and download state machine
// ==========================================================================

const IndexedDbStorage = (() => {
  const DB_NAME = 'mf_offline_db';
  const DB_VERSION = 1;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null); // Non-browser / mock environment fallback
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // 1. Downloaded Audio Blobs
        if (!db.objectStoreNames.contains('downloaded_audio')) {
          db.createObjectStore('downloaded_audio', { keyPath: 'id' });
        }
        // 2. Local User Tracks
        if (!db.objectStoreNames.contains('local_tracks')) {
          const localStore = db.createObjectStore('local_tracks', { keyPath: 'id' });
          localStore.createIndex('folderName', 'folderName', { unique: false });
          localStore.createIndex('album', 'album', { unique: false });
          localStore.createIndex('artists', 'artists', { unique: false });
        }
        // 3. Download Tasks
        if (!db.objectStoreNames.contains('download_tasks')) {
          const taskStore = db.createObjectStore('download_tasks', { keyPath: 'id' });
          taskStore.createIndex('status', 'status', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = (err) => {
        console.warn('[IndexedDB] Open failed:', err);
        resolve(null);
      };
    });
    return dbPromise;
  }

  // --- DOWNLOADED AUDIO BLOB STORAGE ---

  async function saveDownloadedAudio(id, audioBlob, metadata = {}) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('downloaded_audio', 'readwrite');
        const store = tx.objectStore('downloaded_audio');
        const record = {
          id: String(id),
          audioBlob: audioBlob,
          size: audioBlob.size || 0,
          type: audioBlob.type || 'audio/mpeg',
          downloadedAt: Date.now(),
          ...metadata
        };
        store.put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn('[IndexedDB] saveDownloadedAudio error:', e);
        resolve(false);
      }
    });
  }

  async function getDownloadedAudio(id) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('downloaded_audio', 'readonly');
        const store = tx.objectStore('downloaded_audio');
        const req = store.get(String(id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function getDownloadedAudioUrl(id) {
    const record = await getDownloadedAudio(id);
    if (record && record.audioBlob) {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(record.audioBlob);
      }
    }
    return null;
  }

  async function deleteDownloadedAudio(id) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('downloaded_audio', 'readwrite');
        const store = tx.objectStore('downloaded_audio');
        store.delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function clearAllDownloadedAudio() {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('downloaded_audio', 'readwrite');
        tx.objectStore('downloaded_audio').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // --- LOCAL TRACKS STORAGE ---

  async function saveLocalTrack(trackData, fileBlob = null) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('local_tracks', 'readwrite');
        const store = tx.objectStore('local_tracks');
        const record = {
          ...trackData,
          id: String(trackData.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`),
          fileBlob: fileBlob || trackData.fileBlob || null,
          source: 'LOCAL',
          addedAt: trackData.addedAt || Date.now()
        };
        store.put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => resolve(false);
      } catch (e) {
        console.warn('[IndexedDB] saveLocalTrack error:', e);
        resolve(false);
      }
    });
  }

  async function getAllLocalTracks() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('local_tracks', 'readonly');
        const store = tx.objectStore('local_tracks');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function getLocalTrack(id) {
    const db = await openDB();
    if (!db || !id) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('local_tracks', 'readonly');
        const store = tx.objectStore('local_tracks');
        const req = store.get(String(id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function getLocalTrackAudioUrl(id) {
    const record = await getLocalTrack(id);
    if (record && record.fileBlob) {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(record.fileBlob);
      }
    }
    return null;
  }

  async function removeLocalTrack(id) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('local_tracks', 'readwrite');
        tx.objectStore('local_tracks').delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function clearAllLocalTracks() {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('local_tracks', 'readwrite');
        tx.objectStore('local_tracks').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // --- DOWNLOAD TASKS (STATE MACHINE) ---

  async function saveDownloadTask(task) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('download_tasks', 'readwrite');
        tx.objectStore('download_tasks').put({
          ...task,
          id: String(task.id),
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function getAllDownloadTasks() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('download_tasks', 'readonly');
        const req = tx.objectStore('download_tasks').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function removeDownloadTask(id) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('download_tasks', 'readwrite');
        tx.objectStore('download_tasks').delete(String(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }

  // --- STORAGE STATS & USAGE BREAKDOWN ---

  async function getStorageBreakdown() {
    const db = await openDB();
    if (!db) {
      return { totalBytes: 0, totalMb: '0.0', downloadedCount: 0, localCount: 0 };
    }

    let totalBytes = 0;
    let dlCount = 0;
    let locCount = 0;

    try {
      const dlAudio = await new Promise((res) => {
        const tx = db.transaction('downloaded_audio', 'readonly');
        const req = tx.objectStore('downloaded_audio').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      dlCount = dlAudio.length;
      dlAudio.forEach(item => {
        if (item.size) totalBytes += item.size;
        else if (item.audioBlob && item.audioBlob.size) totalBytes += item.audioBlob.size;
      });

      const locTracks = await new Promise((res) => {
        const tx = db.transaction('local_tracks', 'readonly');
        const req = tx.objectStore('local_tracks').getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      locCount = locTracks.length;
      locTracks.forEach(item => {
        if (item.fileBlob && item.fileBlob.size) totalBytes += item.fileBlob.size;
      });
    } catch (e) {
      console.warn('[IndexedDB] Storage calculation error:', e);
    }

    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
    const totalGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);

    return {
      totalBytes,
      totalMb,
      totalGb,
      downloadedCount: dlCount,
      localCount: locCount
    };
  }

  return {
    openDB,
    saveDownloadedAudio,
    getDownloadedAudio,
    getDownloadedAudioUrl,
    deleteDownloadedAudio,
    clearAllDownloadedAudio,
    saveLocalTrack,
    getAllLocalTracks,
    getLocalTrack,
    getLocalTrackAudioUrl,
    removeLocalTrack,
    clearAllLocalTracks,
    saveDownloadTask,
    getAllDownloadTasks,
    removeDownloadTask,
    getStorageBreakdown
  };
})();

if (typeof window !== 'undefined') {
  window.IndexedDbStorage = IndexedDbStorage;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndexedDbStorage;
}

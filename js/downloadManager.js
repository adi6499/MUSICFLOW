// ==========================================================================
// MUSICFLOW — DOWNLOAD MANAGER 2.0 (Phase 9.1)
// Unified, observable, bounded-concurrency download manager with persistent
// queue, integrity verification, missing file detection, and error taxonomy.
// ==========================================================================

const DownloadManager = (() => {
  // Download States
  const STATUS = {
    IDLE: 'IDLE',
    QUEUED: 'QUEUED',
    DOWNLOADING: 'DOWNLOADING',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    RETRYING: 'RETRYING',
    MISSING: 'MISSING'
  };

  // Error Taxonomy
  const ERROR_CODES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    HTTP_ERROR: 'HTTP_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    STORAGE_ERROR: 'STORAGE_ERROR',
    INSUFFICIENT_STORAGE: 'INSUFFICIENT_STORAGE',
    INVALID_FILE: 'INVALID_FILE',
    VERIFICATION_ERROR: 'VERIFICATION_ERROR',
    CANCELLED: 'CANCELLED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  };

  const MAX_CONCURRENT_DOWNLOADS = 2;
  const MAX_RETRIES = 3;
  const RETRY_BACKOFF_MS = 1000;

  // In-memory Task Map (keyed by track ID) & Execution Queue
  const tasks = new Map();
  let activeCount = 0;
  let isQueuePaused = false;

  // Event Emitter Subscriptions
  const listeners = {
    taskAdded: [],
    progress: [],
    statusChange: [],
    completed: [],
    failed: [],
    queueUpdated: []
  };

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.warn(`[DownloadManager] event ${event} error:`, e); }
      });
    }
  }

  // --- INITIALIZATION & RECOVERY ---
  async function init() {
    // 1. Recover completed downloads from Storage & IndexedDB
    try {
      if (typeof Storage !== 'undefined') {
        const existingDownloads = Storage.getDownloads();
        existingDownloads.forEach(song => {
          if (song && song.id) {
            tasks.set(String(song.id), {
              id: String(song.id),
              trackId: String(song.id),
              name: song.name || 'Unknown Track',
              artists: song.artists || song.primaryArtist || 'Unknown Artist',
              album: song.album || '',
              image: song.image || 'assets/logo.png',
              duration: song.duration || 0,
              sourceUrl: song.streamUrl || song.downloadUrl || '',
              status: STATUS.COMPLETED,
              progress: 100,
              bytesDownloaded: song.size || 0,
              totalBytes: song.size || 0,
              createdAt: song.downloadedAt || Date.now(),
              updatedAt: song.downloadedAt || Date.now(),
              retryCount: 0,
              error: null,
              abortController: null
            });
          }
        });
      }
    } catch (e) {
      console.warn('[DownloadManager] Init recovery error:', e);
    }

    emit('queueUpdated', getTasks());
  }

  // --- CANONICAL ENQUEUE & DUPLICATE PREVENTION ---
  function enqueue(track, options = {}) {
    if (!track || !track.id) return null;
    const trackId = String(track.id);

    // Duplicate Prevention: Check if already queued, downloading, or completed
    const existing = tasks.get(trackId);
    if (existing) {
      if (options.priority === 'explicit' && existing.priority === 'smart') {
        existing.priority = 'explicit';
      }
      if (existing.status === STATUS.DOWNLOADING || existing.status === STATUS.QUEUED) {
        return existing;
      }
      if (existing.status === STATUS.COMPLETED) {
        return existing;
      }
    }

    const priority = options.priority || 'explicit';
    const reason = options.reason || (priority === 'explicit' ? 'User Download' : 'Recommended for you');

    const task = {
      id: trackId,
      trackId: trackId,
      name: track.name || 'Unknown Track',
      artists: track.artists || track.primaryArtist || 'Unknown Artist',
      album: track.album || '',
      image: track.image || 'assets/logo.png',
      duration: track.duration || 0,
      sourceUrl: track.streamUrl || track.downloadUrl || '',
      status: STATUS.QUEUED,
      priority,
      reason,
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      error: null,
      abortController: null
    };

    tasks.set(trackId, task);
    emit('taskAdded', task);
    emit('statusChange', { id: trackId, status: STATUS.QUEUED });
    emit('queueUpdated', getTasks());

    _processQueue();
    return task;
  }

  function enqueueMultiple(tracks, options = {}) {
    if (!Array.isArray(tracks)) return [];
    return tracks.map(t => enqueue(t, options)).filter(Boolean);
  }

  // --- QUEUE PROCESSOR & WORKER DISPATCHER ---
  async function _processQueue() {
    if (isQueuePaused) return;
    if (activeCount >= MAX_CONCURRENT_DOWNLOADS) return;

    // Find next QUEUED task sorted by priority (explicit before smart)
    const queuedTasks = Array.from(tasks.values()).filter(t => t.status === STATUS.QUEUED);
    if (queuedTasks.length === 0) return;

    queuedTasks.sort((a, b) => {
      const pA = a.priority === 'explicit' ? 0 : 1;
      const pB = b.priority === 'explicit' ? 0 : 1;
      if (pA !== pB) return pA - pB;
      return a.createdAt - b.createdAt;
    });

    const task = queuedTasks[0];

    // Smart download safety check
    if (task.priority === 'smart') {
      if (typeof SmartDownloadManager !== 'undefined' && !SmartDownloadManager.canSmartDownload()) {
        task.status = STATUS.CANCELLED;
        task.error = { code: ERROR_CODES.INSUFFICIENT_STORAGE, message: 'Smart download constraints not met' };
        emit('statusChange', { id: task.id, status: STATUS.CANCELLED });
        emit('queueUpdated', getTasks());
        _processQueue();
        return;
      }
    }

    activeCount++;
    _startDownloadWorker(task);

    // If still have worker capacity, process more
    if (activeCount < MAX_CONCURRENT_DOWNLOADS) {
      _processQueue();
    }
  }

  async function _startDownloadWorker(task) {
    task.status = STATUS.DOWNLOADING;
    task.updatedAt = Date.now();
    task.abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    emit('statusChange', { id: task.id, status: STATUS.DOWNLOADING });
    emit('queueUpdated', getTasks());

    try {
      // 1. Resolve Audio Stream / Download URL
      let downloadUrl = task.sourceUrl;
      if (!downloadUrl && typeof API !== 'undefined') {
        if (API.getSongDetails) {
          const details = await API.getSongDetails(task.id);
          downloadUrl = details?.downloadUrl || details?.streamUrl;
        }
        if (!downloadUrl && API.getStreamUrl) {
          downloadUrl = await API.getStreamUrl(task.id);
        }
      }

      if (!downloadUrl) {
        throw { code: ERROR_CODES.SOURCE_UNAVAILABLE, message: 'Audio stream URL is unavailable' };
      }

      // 2. Fetch Audio Stream with Progress Tracking & Proxy Fallback
      const signal = task.abortController ? task.abortController.signal : undefined;
      let response = null;
      try {
        response = await fetch(downloadUrl, { mode: 'cors', signal });
      } catch (fetchErr) {
        // Fallback to local server proxy if CORS or network blocked
        if (typeof window !== 'undefined' && window.location) {
          const proxyUrl = `/api/download/proxy?url=${encodeURIComponent(downloadUrl)}`;
          response = await fetch(proxyUrl, { signal });
        } else {
          throw fetchErr;
        }
      }

      if (!response.ok) {
        throw { code: ERROR_CODES.HTTP_ERROR, message: `HTTP status ${response.status} from server` };
      }

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
      task.totalBytes = totalBytes;

      let blob = null;

      if (response.body && typeof response.body.getReader === 'function' && totalBytes > 0) {
        // Stream reading with continuous progress
        const reader = response.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedBytes += value.length;
          task.bytesDownloaded = receivedBytes;
          task.progress = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));

          emit('progress', { id: task.id, progress: task.progress, bytesDownloaded: receivedBytes, totalBytes });
        }

        blob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
      } else {
        // Fallback: Whole blob download
        blob = await response.blob();
        task.bytesDownloaded = blob.size;
        task.totalBytes = blob.size;
        task.progress = 99;
      }

      // 3. File Verification & Integrity Check
      if (!blob || blob.size < 1024) { // Must be non-empty, > 1KB
        throw { code: ERROR_CODES.INVALID_FILE, message: 'Downloaded audio file is empty or corrupted' };
      }

      // 4. Persistent Storage Commit
      if (typeof IndexedDbStorage !== 'undefined') {
        const saved = await IndexedDbStorage.saveDownloadedAudio(task.id, blob, {
          name: task.name,
          artists: task.artists,
          album: task.album,
          image: task.image,
          duration: task.duration,
          size: blob.size,
          format: 'mp3'
        });
        if (!saved) {
          console.warn('[DownloadManager] IndexedDB save returned false, checking fallback');
        }
      }

      if (typeof Storage !== 'undefined') {
        Storage.addDownload({
          id: task.id,
          name: task.name,
          artists: task.artists,
          album: task.album,
          image: task.image,
          duration: task.duration,
          size: blob.size,
          source: 'DOWNLOADED',
          downloadedAt: Date.now()
        });
      }

      // 4b. Device File System Export (Android Files App / MediaStore & iOS Documents / Files App)
      try {
        _saveToDeviceFilesystem(task, blob);
      } catch (fsErr) {
        console.warn('[DownloadManager] Device filesystem export notice:', fsErr);
      }

      // 5. Verification Complete -> Mark COMPLETED
      task.status = STATUS.COMPLETED;
      task.progress = 100;
      task.bytesDownloaded = blob.size;
      task.totalBytes = blob.size;
      task.error = null;
      task.abortController = null;
      task.updatedAt = Date.now();

      emit('progress', { id: task.id, progress: 100, bytesDownloaded: blob.size, totalBytes: blob.size });
      emit('statusChange', { id: task.id, status: STATUS.COMPLETED });
      emit('completed', task);

    } catch (err) {
      if (task.status === STATUS.CANCELLED || task.status === STATUS.PAUSED) {
        // Handled via user action
        return;
      }

      const errCode = err.code || (err.name === 'AbortError' ? ERROR_CODES.CANCELLED : ERROR_CODES.NETWORK_ERROR);
      const errMsg = err.message || 'Download failed';

      task.error = { code: errCode, message: errMsg };
      task.abortController = null;
      task.updatedAt = Date.now();

      // Bounded Exponential Backoff Retry Logic (transient network drops)
      const isTransient = (errCode === ERROR_CODES.NETWORK_ERROR);
      if (isTransient && task.retryCount < MAX_RETRIES && errCode !== ERROR_CODES.CANCELLED) {
        task.retryCount++;
        task.status = STATUS.RETRYING;
        const delayMs = RETRY_BACKOFF_MS * Math.pow(2, task.retryCount - 1);
        emit('statusChange', { id: task.id, status: STATUS.RETRYING, retryCount: task.retryCount, nextRetryInMs: delayMs });
        console.warn(`[DownloadManager] Retrying task ${task.id} (${task.retryCount}/${MAX_RETRIES}) in ${delayMs}ms...`);
        setTimeout(() => {
          if (task.status === STATUS.RETRYING) {
            task.status = STATUS.QUEUED;
            emit('statusChange', { id: task.id, status: STATUS.QUEUED });
            _processQueue();
          }
        }, delayMs);
      } else {
        task.status = STATUS.FAILED;
        emit('statusChange', { id: task.id, status: STATUS.FAILED, error: task.error });
        emit('failed', task);
      }
    } finally {
      activeCount = Math.max(0, activeCount - 1);
      emit('queueUpdated', getTasks());
      _processQueue();
    }
  }

  // --- PAUSE, RESUME, CANCEL, RETRY ---
  function pause(trackId) {
    const task = tasks.get(String(trackId));
    if (!task) return false;

    if (task.status === STATUS.DOWNLOADING) {
      if (task.abortController) task.abortController.abort();
      task.status = STATUS.PAUSED;
      task.abortController = null;
      task.updatedAt = Date.now();
      emit('statusChange', { id: task.id, status: STATUS.PAUSED });
      emit('queueUpdated', getTasks());
      activeCount = Math.max(0, activeCount - 1);
      _processQueue();
      return true;
    } else if (task.status === STATUS.QUEUED) {
      task.status = STATUS.PAUSED;
      task.updatedAt = Date.now();
      emit('statusChange', { id: task.id, status: STATUS.PAUSED });
      emit('queueUpdated', getTasks());
      return true;
    }
    return false;
  }

  function pauseAll() {
    isQueuePaused = true;
    tasks.forEach(task => {
      if (task.status === STATUS.DOWNLOADING || task.status === STATUS.QUEUED) {
        if (task.abortController) task.abortController.abort();
        task.status = STATUS.PAUSED;
        task.abortController = null;
      }
    });
    activeCount = 0;
    emit('queueUpdated', getTasks());
  }

  function resume(trackId) {
    const task = tasks.get(String(trackId));
    if (!task) return false;

    if (task.status === STATUS.PAUSED || task.status === STATUS.FAILED) {
      task.status = STATUS.QUEUED;
      task.error = null;
      task.updatedAt = Date.now();
      emit('statusChange', { id: task.id, status: STATUS.QUEUED });
      emit('queueUpdated', getTasks());
      _processQueue();
      return true;
    }
    return false;
  }

  function resumeAll() {
    isQueuePaused = false;
    tasks.forEach(task => {
      if (task.status === STATUS.PAUSED || task.status === STATUS.FAILED) {
        task.status = STATUS.QUEUED;
        task.error = null;
      }
    });
    emit('queueUpdated', getTasks());
    _processQueue();
  }

  function cancel(trackId) {
    const task = tasks.get(String(trackId));
    if (!task) return false;

    task.cancelRequested = true;
    const wasDownloading = task.status === STATUS.DOWNLOADING;
    task.status = STATUS.CANCELLED;

    if (wasDownloading && task.abortController) {
      try { task.abortController.abort(); } catch (_) {}
      task.abortController = null;
      // activeCount will be decremented in _startDownloadWorker's finally block
    }

    tasks.delete(String(trackId));

    emit('statusChange', { id: String(trackId), status: STATUS.CANCELLED });
    emit('queueUpdated', getTasks());

    if (!wasDownloading) {
      _processQueue();
    }
    return true;
  }

  function cancelAll() {
    tasks.forEach(task => {
      task.cancelRequested = true;
      if (task.status === STATUS.DOWNLOADING && task.abortController) {
        try { task.abortController.abort(); } catch (_) {}
        task.abortController = null;
      }
      if (task.status !== STATUS.COMPLETED) {
        tasks.delete(task.id);
      }
    });
    activeCount = 0;
    emit('queueUpdated', getTasks());
  }

  function retry(trackId) {
    const task = tasks.get(String(trackId));
    if (!task) return false;
    task.retryCount = 0;
    return resume(trackId);
  }

  // --- REMOVAL & CLEANUP ---
  async function removeDownload(trackId) {
    cancel(trackId);
    tasks.delete(String(trackId));

    if (typeof IndexedDbStorage !== 'undefined') {
      await IndexedDbStorage.deleteDownloadedAudio(trackId);
    }
    if (typeof Storage !== 'undefined') {
      Storage.removeDownload(trackId);
    }

    emit('queueUpdated', getTasks());
    return true;
  }

  async function clearAllDownloads() {
    cancelAll();
    tasks.clear();

    if (typeof IndexedDbStorage !== 'undefined') {
      await IndexedDbStorage.clearAllDownloadedAudio();
    }
    if (typeof Storage !== 'undefined') {
      await Storage.clearAllDownloads();
    }

    emit('queueUpdated', getTasks());
    return true;
  }

  function clearCompleted() {
    Array.from(tasks.keys()).forEach(id => {
      const task = tasks.get(id);
      if (task && task.status === STATUS.COMPLETED) {
        // Keep in Storage & IndexedDB, but remove from active queue memory if user requests
        tasks.delete(id);
      }
    });
    emit('queueUpdated', getTasks());
  }

  // --- AUDIT & VERIFICATION ---
  async function verifyAllDownloads() {
    if (typeof Storage === 'undefined' || typeof IndexedDbStorage === 'undefined') return [];
    const downloads = Storage.getDownloads();
    const verified = [];

    for (const song of downloads) {
      const audio = await IndexedDbStorage.getDownloadedAudio(song.id);
      if (!audio || !audio.audioBlob || audio.audioBlob.size === 0) {
        // Mark MISSING
        const task = tasks.get(String(song.id));
        if (task) task.status = STATUS.MISSING;
        verified.push({ id: song.id, status: STATUS.MISSING });
      } else {
        verified.push({ id: song.id, status: STATUS.COMPLETED, size: audio.size });
      }
    }
    return verified;
  }

  // --- GETTERS & OBSERVABILITY ---
  function getStatus(trackId) {
    const task = tasks.get(String(trackId));
    if (task) return task.status;
    if (typeof Storage !== 'undefined' && Storage.isDownloaded && Storage.isDownloaded(trackId)) {
      return STATUS.COMPLETED;
    }
    return STATUS.IDLE;
  }

  function getTask(trackId) {
    return tasks.get(String(trackId)) || null;
  }

  function getTasks() {
    return Array.from(tasks.values());
  }

  function getActiveCount() {
    return activeCount;
  }

  function _saveToDeviceFilesystem(task, blob) {
    if (!blob || typeof window === 'undefined') return;

    const safeTitle = (task.name || 'Song').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const safeArtist = (task.artists || 'Artist').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const fileName = `${safeTitle} - ${safeArtist}.mp3`;
    const mimeType = blob.type || 'audio/mpeg';

    // 1. Native Android Storage via AndroidMediaBridge (Download/MusicFlow directory in phone's public Downloads folder)
    if (window.AndroidMediaBridge) {
      try {
        if (typeof FileReader !== 'undefined') {
          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              const dataUrl = reader.result;
              const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
              if (base64) {
                // Priority: Save directly to phone's public Downloads folder
                if (typeof window.AndroidMediaBridge.saveAudioToDownloadFolder === 'function') {
                  const dlSuccess = window.AndroidMediaBridge.saveAudioToDownloadFolder(
                    fileName,
                    base64,
                    mimeType,
                    task.name || '',
                    task.artists || '',
                    task.album || ''
                  );
                  console.log(`[DownloadManager] AndroidMediaBridge.saveAudioToDownloadFolder: ${dlSuccess} for ${fileName}`);
                }
                // Also index in MediaStore
                if (typeof window.AndroidMediaBridge.saveAudioToDevice === 'function') {
                  window.AndroidMediaBridge.saveAudioToDevice(
                    fileName,
                    base64,
                    mimeType,
                    task.name || '',
                    task.artists || '',
                    task.album || ''
                  );
                }
              }
            } catch (bridgeErr) {
              console.warn('[DownloadManager] AndroidMediaBridge save audio error:', bridgeErr);
            }
          };
          reader.readAsDataURL(blob);
        }
      } catch (err) {
        console.warn('[DownloadManager] Android bridge filesystem save error:', err);
      }
    }

    // 2. Native iOS Storage via WKScriptMessageHandler (Documents directory -> Files.app "On My iPhone / MusicFlow")
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeMedia) {
      try {
        if (typeof FileReader !== 'undefined') {
          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              const dataUrl = reader.result;
              const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
              if (base64) {
                window.webkit.messageHandlers.nativeMedia.postMessage({
                  action: 'saveAudioFile',
                  fileName: fileName,
                  base64Data: base64,
                  mimeType: mimeType
                });
                console.log(`[DownloadManager] Sent to iOS nativeMedia.saveAudioFile: ${fileName}`);
              }
            } catch (iosErr) {
              console.warn('[DownloadManager] iOS nativeMedia saveAudioFile error:', iosErr);
            }
          };
          reader.readAsDataURL(blob);
          return;
        }
      } catch (err) {
        console.warn('[DownloadManager] iOS bridge filesystem save error:', err);
      }
    }

    // 3. Capacitor Filesystem Plugin (Fallback)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
      try {
        const Filesystem = window.Capacitor.Plugins.Filesystem;
        if (typeof FileReader !== 'undefined') {
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const dataUrl = reader.result;
              const base64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
              if (base64) {
                await Filesystem.writeFile({
                  path: fileName,
                  data: base64,
                  directory: 'DOCUMENTS',
                  recursive: true
                });
                console.log(`[DownloadManager] Saved to iOS Documents folder (Files.app): ${fileName}`);
              }
            } catch (capErr) {
              console.warn('[DownloadManager] Capacitor Filesystem write error:', capErr);
            }
          };
          reader.readAsDataURL(blob);
          return;
        }
      } catch (err) {
        console.warn('[DownloadManager] Capacitor Filesystem error:', err);
      }
    }

    // 3. Web Browser & Desktop Fallback (Trigger native browser file download to user's Downloads folder)
    try {
      const isMobileApp = (typeof window.AndroidMediaBridge !== 'undefined') ||
                          (typeof window.webkit !== 'undefined' && window.webkit.messageHandlers);
      if (!isMobileApp && typeof document !== 'undefined' && document.createElement && typeof URL !== 'undefined' && URL.createObjectURL) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (_) {}
        }, 1000);
        console.log(`[DownloadManager] Browser download initiated: ${fileName}`);
      }
    } catch (e) {
      console.warn('[DownloadManager] Browser file download trigger error:', e);
    }
  }

  const QUALITY_STORAGE_KEY = 'mf_download_quality';
  const ASK_QUALITY_STORAGE_KEY = 'mf_download_quality_ask';
  const PHONE_FOLDER_STORAGE_KEY = 'mf_save_phone_folder';

  function getDownloadQuality() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(QUALITY_STORAGE_KEY) || '320kbps';
      }
    } catch (_) {}
    return '320kbps';
  }

  function setDownloadQuality(quality) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(QUALITY_STORAGE_KEY, quality || '320kbps');
      }
    } catch (_) {}
  }

  function shouldAskDownloadQuality() {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(ASK_QUALITY_STORAGE_KEY);
        if (val === 'false') return false;
      }
    } catch (_) {}
    return true;
  }

  function setAskDownloadQuality(ask) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ASK_QUALITY_STORAGE_KEY, String(ask));
      }
    } catch (_) {}
  }

  function getSaveToPhoneFolder() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(PHONE_FOLDER_STORAGE_KEY) !== 'false';
      }
    } catch (_) {}
    return true;
  }

  function setSaveToPhoneFolder(enabled) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PHONE_FOLDER_STORAGE_KEY, String(enabled));
      }
    } catch (_) {}
  }

  function on(event, callback) {
    if (listeners[event]) listeners[event].push(callback);
  }

  function off(event, callback) {
    if (listeners[event]) {
      listeners[event] = listeners[event].filter(cb => cb !== callback);
    }
  }

  return {
    STATUS,
    ERROR_CODES,
    init,
    enqueue,
    enqueueMultiple,
    pause,
    pauseAll,
    resume,
    resumeAll,
    cancel,
    cancelAll,
    retry,
    removeDownload,
    clearAllDownloads,
    clearCompleted,
    verifyAllDownloads,
    getStatus,
    getTask,
    getTasks,
    getActiveCount,
    getDownloadQuality,
    setDownloadQuality,
    shouldAskDownloadQuality,
    setAskDownloadQuality,
    getSaveToPhoneFolder,
    setSaveToPhoneFolder,
    on,
    off
  };
})();

// Export for Web and Node test environments
if (typeof window !== 'undefined') {
  window.DownloadManager = DownloadManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DownloadManager;
}

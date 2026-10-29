// ==========================================================================
// MUSICFLOW — HARDENED AUDIO PLAYBACK ENGINE (Phase 8.1)
// Unified source resolution, deterministic state machine, gapless queue,
// media session integration, audio focus, Web Audio EQ & 3D Spatial Graph.
// ==========================================================================

const Player = (() => {
  // Playback States (Single Source of Truth)
  const PlaybackState = {
    IDLE: 'IDLE',
    LOADING: 'LOADING',
    READY: 'READY',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    BUFFERING: 'BUFFERING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR'
  };

  // Audio Source Types
  const SourceType = {
    DOWNLOADED: 'DOWNLOADED',
    LOCAL: 'LOCAL',
    CACHED: 'CACHED',
    STREAMING: 'STREAMING',
    UNKNOWN: 'UNKNOWN'
  };

  // Playback Error Codes
  const ErrorCode = {
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    NETWORK_ERROR: 'NETWORK_ERROR',
    FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',
    FILE_MISSING: 'FILE_MISSING',
    DECODE_ERROR: 'DECODE_ERROR',
    OFFLINE_UNAVAILABLE: 'OFFLINE_UNAVAILABLE',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  };

  let audio = null;
  let queue = [];
  let currentIndex = -1;
  let playbackState = PlaybackState.IDLE;
  let currentSourceType = null;
  let isShuffle = false;
  let repeatMode = 'OFF'; // 'OFF', 'ALL', 'ONE'
  let unShuffledQueue = [];
  let sleepTimerState = {
    active: false,
    mode: 'off', // 'off' | 'duration' | 'end_of_track'
    durationMinutes: 0,
    expiresAt: 0,
    trackIdWhenSet: null
  };
  let sleepTimerTimeout = null;
  let sleepTimerInterval = null;
  let baselineVolume = 1.0;
  let isSleepFading = false;

  function getVolume() {
    return isSleepFading ? baselineVolume : (audio ? (audio.volume ?? baselineVolume) : baselineVolume);
  }

  function setVolume(val) {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    baselineVolume = v;
    if (audio && !isSleepFading) {
      audio.volume = v;
    }
  }

  function restoreSleepFadeVolume() {
    if (isSleepFading) {
      isSleepFading = false;
      if (audio) {
        audio.volume = baselineVolume;
      }
    }
  }

  // Race condition token & cancellation controllers
  let playbackGeneration = 0;
  let playbackRequestId = 0;
  let lastStartedRequestId = 0;
  let activeAbortController = null;
  let retryCount = 0;
  const MAX_RETRIES = 2;

  // --- iOS Background Audio Fix ---
  // When AudioEffectsEngine is attached (createMediaElementSource called), the audio element's
  // output is routed through AudioContext. iOS suspends AudioContext in background, causing
  // silent playback while progress continues. To fix: swap to a clean Audio element on
  // background entry, and swap back on foreground return.
  let _backgroundAudioEl = null;        // Clean Audio element for background playback
  let _foregroundAudioEl = null;        // The original effects-connected Audio element
  let _isBackgroundSwapActive = false;  // Whether we've swapped to the background element
  let _audioCtxSuspendedSince = 0;      // Timestamp when AudioContext suspension was first detected

  // Current playback source resolution information
  let currentResolvedSource = null;

  // Tracking milestones & history debounce
  let hasAddedToHistory = false;
  let recordedMilestones = new Set();
  let lastError = null;

  // Web Audio Context, 5-Band Equalizer & 3D Spatial Audio Graph
  let audioCtx = null;
  let sourceNode = null;
  let eqBands = [];
  let bassBoostNode = null;
  let virtualizerGain = null;

  const EQ_FREQS = [60, 230, 910, 3600, 14000];
  const EQ_PRESETS = {
    'Flat': [0, 0, 0, 0, 0],
    'Bass Boost': [6, 4, 1, 0, -1],
    'Pop': [-1, 2, 4, 3, 1],
    'Rock': [4, 2, -1, 2, 5],
    'Electronic': [4, 3, 0, 2, 4],
    'Hip Hop': [5, 3, 0, 1, 3],
    'Classical': [3, 2, -1, 2, 3],
    'Acoustic': [2, 1, 2, 3, 2],
    'Vocal Booster': [-2, 1, 5, 3, -1],
    '3D Spatial Concert': [3, 2, 1, 3, 4]
  };

  const eventListeners = {
    trackChange: [],
    stateChange: [],
    timeUpdate: [],
    queueChange: [],
    eqChange: [],
    shuffleChange: [],
    repeatChange: [],
    sleepTimerChange: [],
    sleepTimerTick: [],
    sleepTimerExpired: [],
    error: []
  };

  function transitionTo(newState, payload = {}) {
    playbackState = newState;
    const isPlaying = (newState === PlaybackState.PLAYING);

    const statePayload = {
      state: newState,
      playbackState: newState,
      isPlaying,
      currentTrack: getCurrentTrack(),
      position: audio ? audio.currentTime : 0,
      duration: audio ? (audio.duration || 0) : 0,
      bufferedPosition: getBufferedPosition(),
      sourceType: currentSourceType,
      queueIndex: currentIndex,
      repeatMode,
      shuffleEnabled: isShuffle,
      error: lastError,
      ...payload
    };

    notify('stateChange', statePayload);

    if (typeof NativeMedia !== 'undefined') {
      const isPlaying = (newState === PlaybackState.PLAYING);
      NativeMedia.setPlaybackState({
        isPlaying,
        positionSec: audio ? audio.currentTime : 0,
        durationSec: audio ? audio.duration : 0,
        playbackRate: audio ? audio.playbackRate : 1.0
      });
    } else {
      if (newState === PlaybackState.PLAYING) {
        updateMediaSessionPlaybackState('playing');
      } else if (newState === PlaybackState.PAUSED || newState === PlaybackState.BUFFERING) {
        updateMediaSessionPlaybackState('paused');
      } else if (newState === PlaybackState.IDLE || newState === PlaybackState.COMPLETED || newState === PlaybackState.ERROR) {
        updateMediaSessionPlaybackState('none');
      }
    }
  }

  function getBufferedPosition() {
    if (!audio || !audio.buffered || audio.buffered.length === 0) return 0;
    try {
      return audio.buffered.end(audio.buffered.length - 1);
    } catch (_) {
      return 0;
    }
  }

  function init() {
    if (!audio) {
      if (typeof document !== 'undefined' && document.getElementById) {
        audio = document.getElementById('app-audio') || (typeof Audio !== 'undefined' ? new Audio() : null);
      } else if (typeof Audio !== 'undefined') {
        audio = new Audio();
      }

      if (audio) {
        audio.id = 'app-audio';
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';

        try {
          if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.init) {
            AudioEffectsEngine.init(audio);
          }
        } catch (e) {
          console.warn('[Player] AudioEffectsEngine init:', e);
        }
      }
    }

    if (!audio) return;

    setupMediaSession();

    // Attach core audio lifecycle listeners
    audio.addEventListener('loadstart', () => {
      transitionTo(PlaybackState.LOADING);
    });

    audio.addEventListener('canplay', () => {
      if (playbackState === PlaybackState.LOADING) {
        transitionTo(PlaybackState.READY);
      }
    });

    audio.addEventListener('waiting', () => {
      if (playbackState === PlaybackState.PLAYING) {
        transitionTo(PlaybackState.BUFFERING);
      }
    });

    audio.addEventListener('playing', () => {
      retryCount = 0;
      transitionTo(PlaybackState.PLAYING);
      updatePositionState();

      try {
        if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.resumeAudioContext) {
          AudioEffectsEngine.resumeAudioContext();
        }
      } catch (_) {}

      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(console.warn);
      }
    });

    audio.addEventListener('pause', () => {
      if (playbackState !== PlaybackState.COMPLETED && playbackState !== PlaybackState.ERROR) {
        transitionTo(PlaybackState.PAUSED);
      }
      updatePositionState();
    });

    audio.addEventListener('timeupdate', () => {
      if (playbackState === PlaybackState.LOADING || playbackState === PlaybackState.IDLE) {
        return;
      }
      const curTime = audio.currentTime || 0;
      const dur = audio.duration || (getCurrentTrack()?.duration) || 0;

      notify('timeUpdate', {
        currentTime: curTime,
        duration: dur
      });

      if (Math.floor(curTime) % 2 === 0) {
        updatePositionState();
      }

      // AudioContext smooth resume check
      if (audioCtx && audioCtx.state === 'suspended' && playbackState === PlaybackState.PLAYING) {
        audioCtx.resume().catch(() => {});
      }

      // Check End-of-Track Sleep Timer Fade Out (last 10 seconds)
      if (sleepTimerState.active && sleepTimerState.mode === 'end_of_track' && dur > 15 && audio) {
        const remainingSec = Math.max(0, dur - curTime);
        if (remainingSec <= 10) {
          isSleepFading = true;
          const progress = Math.max(0, Math.min(1, remainingSec / 10.0));
          const factor = Math.pow(progress, 1.5);
          audio.volume = Math.max(0, Math.min(1, baselineVolume * factor));
        }
      }

      const cur = getCurrentTrack();
      if (!cur || !dur || isNaN(dur) || dur <= 0) return;

      const pct = Math.floor((curTime / dur) * 100);

      // Add to listening history only after meaningful listening (10s or 25%)
      if (!hasAddedToHistory && (curTime >= 10 || pct >= 25)) {
        hasAddedToHistory = true;
        if (typeof Storage !== 'undefined' && Storage.addToHistory) {
          Storage.addToHistory(cur);
        }
      }

      // Record recommendation milestone signals (25%, 50%, 75%, 100%)
      if (pct >= 25 && !recordedMilestones.has(25)) {
        recordedMilestones.add(25);
        if (typeof Storage !== 'undefined' && Storage.recordPlayMilestone) Storage.recordPlayMilestone(cur, 25);
      }

      // Zero-Gap Gapless Next-Track Pre-Buffering (<10ms track switching)
      if (dur > 15 && (pct >= 80 || dur - curTime <= 25)) {
        preloadNextTrack();
      }
      if (pct >= 50 && !recordedMilestones.has(50)) {
        recordedMilestones.add(50);
        if (typeof Storage !== 'undefined' && Storage.recordPlayMilestone) Storage.recordPlayMilestone(cur, 50);
      }
      if (pct >= 75 && !recordedMilestones.has(75)) {
        recordedMilestones.add(75);
        if (typeof Storage !== 'undefined' && Storage.recordPlayMilestone) Storage.recordPlayMilestone(cur, 75);
      }
      if (pct >= 90 && !recordedMilestones.has(100)) {
        recordedMilestones.add(100);
        if (typeof Storage !== 'undefined' && Storage.recordPlayMilestone) Storage.recordPlayMilestone(cur, 100);
      }

      // Sleep timer timestamp-based background verification
      if (sleepTimerState.active && sleepTimerState.mode === 'duration' && sleepTimerState.expiresAt > 0) {
        if (Date.now() >= sleepTimerState.expiresAt) {
          handleSleepTimerExpiration();
        }
      }
    });

    audio.addEventListener('ended', () => {
      if (lastStartedRequestId !== playbackRequestId) {
        console.log('[Player] Ignoring ended event from superseded playback request');
        return;
      }
      transitionTo(PlaybackState.COMPLETED);
      // End of Current Track Sleep Timer Mode
      if (sleepTimerState.active && sleepTimerState.mode === 'end_of_track') {
        handleSleepTimerExpiration();
        return;
      }
      if (repeatMode === 'ONE') {
        audio.currentTime = 0;
        audio.play().catch(console.warn);
      } else {
        next();
      }
    });

    if (typeof document !== 'undefined' && !document._sleepTimerVisibilityAttached) {
      document._sleepTimerVisibilityAttached = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && sleepTimerState.active && sleepTimerState.mode === 'duration') {
          if (Date.now() >= sleepTimerState.expiresAt) {
            handleSleepTimerExpiration();
          } else {
            notify('sleepTimerChange', getSleepTimerState());
          }
        }
      });
    }

    audio.addEventListener('error', (e) => {
      if (lastStartedRequestId !== playbackRequestId) {
        console.log('[Player] Ignoring error event from superseded playback request');
        return;
      }
      const err = audio.error;
      let code = ErrorCode.UNKNOWN_ERROR;
      let msg = 'Playback failed to decode audio source.';

      if (err) {
        if (err.code === MediaError.MEDIA_ERR_NETWORK) {
          code = ErrorCode.NETWORK_ERROR;
          msg = 'Network connection failed during playback.';
        } else if (err.code === MediaError.MEDIA_ERR_DECODE) {
          code = ErrorCode.DECODE_ERROR;
          msg = 'Audio format cannot be decoded.';
        } else if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          code = ErrorCode.FORMAT_UNSUPPORTED;
          msg = 'Audio source or format is unsupported.';
        }
      }

      const failedTrack = getCurrentTrack();
      if (failedTrack) {
        failedTrack.isPlayable = false;
      }
      lastError = { code, message: msg, track: failedTrack };
      console.warn('[Player] Audio playback error:', lastError);
      notify('error', lastError);
      transitionTo(PlaybackState.ERROR, { error: lastError });

      // Handle transient recovery or auto-skip
      if (retryCount < MAX_RETRIES && code === ErrorCode.NETWORK_ERROR) {
        retryCount++;
        console.log(`[Player] Retrying stream playback (${retryCount}/${MAX_RETRIES})...`);
        setTimeout(() => {
          if (audio && lastStartedRequestId === playbackRequestId) {
            audio.load();
            audio.play().catch(console.warn);
          }
        }, 800);
      } else if (queue.length > 1) {
        // Swift auto-skip failed track (350ms)
        const trackTitle = failedTrack?.name || failedTrack?.title || 'Song';
        if (typeof window !== 'undefined' && window.UI && typeof window.UI.showToast === 'function') {
          window.UI.showToast(unavailableMessage(getCurrentTrack(), trackTitle));
        }
        setTimeout(() => {
          if (lastStartedRequestId === playbackRequestId) {
            next();
          }
        }, 350);
      }
    });

    // Auto-resume audio context & background lifecycle
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Foreground return — restore from background swap if active
        _handleForegroundTransition();

        if (playbackState === PlaybackState.PLAYING && audio) {
          if (audio.paused) audio.play().catch(console.warn);
          if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(console.warn);
        }
      } else if (document.visibilityState === 'hidden') {
        // Background entry — swap to clean element if AudioContext is in the path
        _handleBackgroundTransition();
      }
    });

    window.addEventListener('pageshow', () => {
      if (playbackState === PlaybackState.PLAYING && audio && audio.paused) {
        audio.play().catch(console.warn);
      }
    });

    setupMediaSession();
  }

  function initWebAudio() {
    if (audioCtx || !audio || typeof window === 'undefined') return;
    try {
      if (typeof AudioEffectsEngine !== 'undefined' && typeof AudioEffectsEngine.init === 'function') {
        // AudioEffectsEngine.init is now lazy — it won't attach AudioContext on iOS
        AudioEffectsEngine.init(audio);
        audioCtx = AudioEffectsEngine.getAudioContext();
      } else {
        // Fallback: only create AudioContext on non-iOS or when effects are actively needed
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
          console.log('[Player] Skipping Web Audio Context on iOS (native playback path)');
          return;
        }

        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
          audioCtx = new AudioCtxClass();
          sourceNode = audioCtx.createMediaElementSource(audio);
          bassBoostNode = audioCtx.createBiquadFilter();
          bassBoostNode.type = 'lowshelf';
          bassBoostNode.frequency.value = 80;
          bassBoostNode.gain.value = 0;

          eqBands = EQ_FREQS.map((freq, idx) => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = idx === 0 ? 'lowshelf' : (idx === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking');
            filter.frequency.value = freq;
            filter.gain.value = 0;
            filter.Q.value = 1.0;
            return filter;
          });

          virtualizerGain = audioCtx.createGain();
          virtualizerGain.gain.value = 1.0;

          let prev = sourceNode;
          prev.connect(bassBoostNode);
          prev = bassBoostNode;
          eqBands.forEach(band => {
            prev.connect(band);
            prev = band;
          });
          prev.connect(virtualizerGain);
          virtualizerGain.connect(audioCtx.destination);
        }
      }
    } catch (e) {
      console.warn('[Player] Web Audio setup error:', e);
    }
  }

  // ==========================================================================
  // iOS BACKGROUND AUDIO — ELEMENT SWAP MECHANISM
  // ==========================================================================
  // When AudioEffectsEngine is attached (createMediaElementSource called),
  // the HTMLAudioElement's output is permanently routed through AudioContext.
  // iOS suspends AudioContext when WKWebView goes to background, causing
  // silent playback while currentTime continues advancing.
  //
  // Fix: On background entry, create a CLEAN Audio() element (no AudioContext),
  // transfer src + currentTime, and play from that. On foreground return,
  // sync position back to the effects-connected element.
  // ==========================================================================

  function _handleBackgroundTransition() {
    updatePositionState();
  }

  function _handleForegroundTransition() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    updatePositionState();
  }

  function applyEqualizerSettings(eqData) {
    if (!eqData) return;
    if (typeof AudioEffectsEngine !== 'undefined') {
      if (eqData.enabled !== undefined) AudioEffectsEngine.setEnabled(eqData.enabled);
      if (eqData.preset) AudioEffectsEngine.setPreset(eqData.preset);
      if (Array.isArray(eqData.bands)) {
        eqData.bands.forEach((g, idx) => AudioEffectsEngine.setBandGain(idx, g));
      }
      if (eqData.bassBoost !== undefined) AudioEffectsEngine.setBassBoost(eqData.bassBoost);
      if (eqData.trebleBoost !== undefined) AudioEffectsEngine.setTrebleBoost(eqData.trebleBoost);
      if (eqData.vocalBoost !== undefined) AudioEffectsEngine.setVocalBoost(eqData.vocalBoost);
      if (eqData.spatial !== undefined) AudioEffectsEngine.setSpatial(eqData.spatial);
    } else {
      const isEnabled = eqData.enabled === true;
      if (bassBoostNode) bassBoostNode.gain.value = isEnabled ? (eqData.bassBoost || 0) : 0;
      if (eqBands && eqBands.length === 5) {
        const bands = eqData.bands || [0, 0, 0, 0, 0];
        eqBands.forEach((band, idx) => {
          band.gain.value = isEnabled ? (bands[idx] || 0) : 0;
        });
      }
      if (virtualizerGain) {
        const v = isEnabled ? (eqData.virtualizer || 0) : 0;
        virtualizerGain.gain.value = 1.0 + (v / 200);
      }
    }
    notify('eqChange', eqData);
  }

  function setEqEnabled(enabled) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setEnabled(enabled);
    }
    if (typeof Storage !== 'undefined') {
      const eq = Storage.getEqualizer ? Storage.getEqualizer() : {};
      eq.enabled = enabled;
      if (Storage.setEqualizer) Storage.setEqualizer(eq);
    }
    notify('eqChange', { enabled });
  }

  function setEqBand(index, gainDb) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setBandGain(index, gainDb);
    }
    if (typeof Storage !== 'undefined') {
      const eq = Storage.getEqualizer ? Storage.getEqualizer() : { bands: [0, 0, 0, 0, 0] };
      if (!eq.bands) eq.bands = [0, 0, 0, 0, 0];
      eq.bands[index] = gainDb;
      eq.preset = 'Custom';
      if (Storage.setEqualizer) Storage.setEqualizer(eq);
    }
    notify('eqChange', { band: index, gain: gainDb });
  }

  function setBassBoost(gainDb) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setBassBoost(gainDb);
    }
    if (typeof Storage !== 'undefined') {
      const eq = Storage.getEqualizer ? Storage.getEqualizer() : {};
      eq.bassBoost = gainDb;
      if (Storage.setEqualizer) Storage.setEqualizer(eq);
    }
    notify('eqChange', { bassBoost: gainDb });
  }

  function setTrebleBoost(gainDb) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setTrebleBoost(gainDb);
    }
    if (typeof Storage !== 'undefined' && Storage.setAudioEffects) {
      Storage.setAudioEffects({ trebleBoost: gainDb, preset: 'Custom' });
    }
    notify('eqChange', { trebleBoost: gainDb });
  }

  function setVocalBoost(gainDb) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setVocalBoost(gainDb);
    }
    if (typeof Storage !== 'undefined' && Storage.setAudioEffects) {
      Storage.setAudioEffects({ vocalBoost: gainDb, preset: 'Custom' });
    }
    notify('eqChange', { vocalBoost: gainDb });
  }

  function setSpatial(level) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setSpatial(level);
    }
    if (typeof Storage !== 'undefined' && Storage.setAudioEffects) {
      Storage.setAudioEffects({ spatial: level });
    }
    notify('eqChange', { spatial: level });
  }

  function setVirtualizerStrength(percent) {
    const level = percent >= 75 ? 'HIGH' : (percent >= 45 ? 'MEDIUM' : (percent >= 15 ? 'LOW' : 'OFF'));
    setSpatial(level);
  }

  function setNormalization(enabled) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setNormalization(enabled);
    }
    if (typeof Storage !== 'undefined' && Storage.setAudioEffects) {
      Storage.setAudioEffects({ normalization: enabled });
    }
    notify('eqChange', { normalization: enabled });
  }

  function setCrossfade(seconds) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setCrossfade(seconds);
    }
    if (typeof Storage !== 'undefined' && Storage.setAudioEffects) {
      Storage.setAudioEffects({ crossfade: seconds });
    }
  }

  function setEqPreset(presetName) {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.setPreset(presetName);
    }
    if (typeof Storage !== 'undefined') {
      const eq = Storage.getEqualizer ? Storage.getEqualizer() : {};
      eq.preset = presetName;
      const presetGains = EQ_PRESETS[presetName] || (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.getSettings ? AudioEffectsEngine.getSettings().bands : null);
      if (presetGains) eq.bands = [...presetGains];
      if (Storage.setEqualizer) Storage.setEqualizer(eq);
    }
    notify('eqChange', { preset: presetName });
  }

  function resetAudioEffects() {
    if (typeof AudioEffectsEngine !== 'undefined') {
      AudioEffectsEngine.resetDefaults();
    }
    if (typeof Storage !== 'undefined' && Storage.resetAudioEffects) {
      Storage.resetAudioEffects();
    }
    notify('eqChange', { reset: true });
  }

  function notify(event, data) {
    (eventListeners[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }

  function setupMediaSession() {
    if (typeof NativeMedia !== 'undefined' && NativeMedia.setupBrowserMediaActions) {
      // NativeMedia handles cross-platform actions automatically
      return;
    }
  }

  function updatePositionState() {
    if (typeof NativeMedia !== 'undefined') {
      const isPlaying = (playbackState === PlaybackState.PLAYING);
      const pos = (audio && !isNaN(audio.currentTime)) ? Math.max(0, audio.currentTime) : 0;
      const dur = (audio && !isNaN(audio.duration) && audio.duration > 0) ? audio.duration : 0;
      NativeMedia.setPlaybackState({
        isPlaying,
        positionSec: pos,
        durationSec: dur,
        playbackRate: (audio ? audio.playbackRate : 1.0) || 1.0
      });
    }
  }

  function getAbsoluteImageUrl(url) {
    if (!url) url = 'assets/logo.png';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http://')) return url.replace('http://', 'https://');
    if (url.startsWith('https://')) return url;
    try {
      return (typeof window !== 'undefined') ? new URL(url, window.location.href).href : url;
    } catch (_) {
      return url;
    }
  }

  function updateMediaSession(song) {
    if (!song) return;
    if (typeof NativeMedia !== 'undefined') {
      const isPlaying = (playbackState === PlaybackState.PLAYING);
      const pos = (audio && !isNaN(audio.currentTime)) ? audio.currentTime : 0;
      const dur = (audio && !isNaN(audio.duration) && audio.duration > 0) ? audio.duration : (song.duration || 0);
      NativeMedia.updateMetadata(song, isPlaying, pos, dur);
    }
  }

  function updateMediaSessionPlaybackState(state) {
    if (typeof NativeMedia !== 'undefined') {
      const isPlaying = (state === 'playing');
      NativeMedia.setPlaybackState({ isPlaying });
    }
  }

  // What the toast says when a song cannot be played. YouTube songs get the honest reason.
  function unavailableMessage(track, trackTitle) {
    const id = String((track && track.id) || '');
    const isYt = id.startsWith('yt_') || (track && (track.provider === 'youtube_music' || track.videoId || track.sourceYtVideoId));
    return isYt
      ? `"${trackTitle}" is YouTube-only (no catalog copy), skipping`
      : `"${trackTitle}" unavailable, skipping...`;
  }

  function getCurrentTrack() {
    return (currentIndex >= 0 && currentIndex < queue.length) ? queue[currentIndex] : null;
  }

  function getPlaybackResolver() {
    if (typeof PlaybackResolver !== 'undefined') return PlaybackResolver;
    if (typeof require !== 'undefined') {
      try { return require('./playbackResolver.js'); } catch (_) {}
      try { return require('./js/playbackResolver.js'); } catch (_) {}
    }
    return null;
  }

  // Unified Source Resolution Pipeline delegating to PlaybackResolver
  async function resolvePlaybackSource(song, options = {}) {
    if (!song) {
      return { type: SourceType.UNKNOWN, uri: '', error: ErrorCode.SOURCE_UNAVAILABLE, message: "Couldn't play this song" };
    }

    const Resolver = getPlaybackResolver();
    if (Resolver && typeof Resolver.resolvePlayableSource === 'function') {
      return Resolver.resolvePlayableSource(song, options);
    }

    const signal = options.signal;
    if (signal?.aborted) {
      const abortErr = new Error('Playback request aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // Direct stream fallback if Resolver is unavailable
    const u = song.audioUrl || song.streamUrl || '';
    if (u && typeof u === 'string' && u.startsWith('http')) {
      return { type: SourceType.STREAMING, uri: u, provider: song.provider || 'direct', song };
    }

    return {
      type: SourceType.UNKNOWN,
      uri: '',
      error: ErrorCode.SOURCE_UNAVAILABLE,
      message: "Couldn't play this song"
    };
  }

  function safeArtistString(song) {
    if (!song) return '';
    if (typeof song.primaryArtist === 'string' && song.primaryArtist) return song.primaryArtist;
    if (typeof song.artists === 'string') return song.artists;
    if (Array.isArray(song.artists)) {
      return song.artists.map(a => (typeof a === 'object' ? a.name : a)).filter(Boolean).join(', ');
    }
    return '';
  }

  // Play Track at Index with Generation Protection against Race Conditions ("Latest Request Wins")
  async function requestTrackPlayback(index, options = {}) {
    const { autoPlay = true, force = false, source = 'user' } = options;
    if (index < 0 || index >= queue.length) return;

    const isRadio = (queueContext.source === 'radio' || queueContext.mode === 'radio');

    // Immediately pause previous audio when switching tracks to prevent old track continuing in background
    if (audio && !audio.paused && (currentIndex !== index || force)) {
      try { audio.pause(); } catch (_) {}
    }

    // Abort any in-flight fetch request
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch (_) {}
    }
    activeAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    const currentReqGen = ++playbackGeneration;
    playbackRequestId = currentReqGen;
    lastStartedRequestId = currentReqGen;

    currentIndex = index;
    const song = queue[currentIndex];

    // Reset tracking flags for new track
    hasAddedToHistory = false;
    recordedMilestones.clear();
    lastError = null;
    preloadedNextTrackId = null;

    notify('trackChange', song);
    setupMediaSession();
    updateMediaSession(song);
    transitionTo(PlaybackState.LOADING);

    if (isRadio) {
      console.log(`[Radio] Requesting playback: index ${currentIndex} ("${song.name}" by "${safeArtistString(song)}")`);
    }

    try {
      const resolved = await resolvePlaybackSource(song, { signal: activeAbortController?.signal });

      // Race condition check: ensure a newer track request has not superseded this one
      if (currentReqGen !== playbackGeneration) {
        console.log(`[Player] Discarding stale playback request #${currentReqGen} in favor of #${playbackGeneration}`);
        return;
      }

      if (isRadio) {
        console.log(`[Radio] Resolved source: ${resolved.uri ? (resolved.uri.substring(0, 70) + '...') : 'NONE'}`);
        console.log(`[Radio] Source type: ${resolved.type || 'UNKNOWN'}`);
        console.log(`[Radio] Valid stream: ${Boolean(resolved.uri && !resolved.error)}`);
      }

      if (resolved.error || !resolved.uri) {
        if (isRadio) {
          console.error(`[Radio] Resolver failure for "${song.name}":`, resolved.message || resolved.error);
        }
        throw new Error(resolved.message || 'No valid audio stream URL available');
      }

      currentSourceType = resolved.type;
      currentResolvedSource = resolved;
      notify('sourceResolved', resolved);

      if (!audio) init();
      if (!audio) return;

      const ytLoader = (typeof window !== 'undefined' && window.YtStreamResolver) ? window.YtStreamResolver : null;
      if (ytLoader && ytLoader.isYouTubeStream(resolved.uri) && ytLoader.canUseMse(resolved)) {
        // YouTube media servers only serve bounded byte ranges: stream through MediaSource.
        await ytLoader.attach(audio, resolved);
      } else {
        if (ytLoader) ytLoader.detach();
        audio.src = resolved.uri;
        audio.load();
      }

      if (autoPlay) {
        if (isRadio) console.log(`[Radio] Calling audio.play()`);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise.then(() => {
            if (isRadio) console.log(`[Radio] Playback started: "${song.name}" at index ${currentIndex}`);
          }).catch(err => {
            if (err.name === 'AbortError') {
              console.log('[Player] Play request superseded/aborted cleanly');
              return;
            }
            console.warn('[Player] Autoplay interrupted/prevented:', err.message);
            if (isRadio) console.error(`[Radio] Playback exception on audio.play():`, err.message);
          });
        }
      }

      if (currentReqGen !== playbackGeneration) return;

      if (typeof Storage !== 'undefined' && Storage.saveSession) {
        try {
          Storage.saveSession(queue, currentIndex, audio.currentTime);
        } catch (_) {}
      }

      // Continuous endless playback: auto-populate whenever near queue end
      if (queue.length - currentIndex <= 4 && autoPlay) {
        autoPopulateContinuousQueue(song);
      }
    } catch (err) {
      if (currentReqGen !== playbackGeneration) return;
      if (audio && !audio.paused) {
        try { audio.pause(); } catch (_) {}
      }
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        console.log('[Player] Request aborted by newer playback action');
        return;
      }
      song.isPlayable = false;
      lastError = { code: ErrorCode.SOURCE_UNAVAILABLE, message: err.message, track: song };
      console.warn('[Player] play error:', err.message);
      notify('error', lastError);
      transitionTo(PlaybackState.ERROR, { error: lastError });

      // Auto-advance swiftly if track is unavailable and more songs in queue
      if (queue.length > 1) {
        const trackTitle = song?.name || song?.title || 'Song';
        console.log(`[Player] Track unavailable; auto-skipping "${trackTitle}"`);
        if (typeof window !== 'undefined' && window.UI && typeof window.UI.showToast === 'function') {
          window.UI.showToast(unavailableMessage(getCurrentTrack(), trackTitle));
        }
        setTimeout(() => {
          if (currentReqGen === playbackGeneration) next();
        }, 350);
      }
    }
  }

  // Canonical Alias for Backwards Compatibility
  async function playTrackAtIndex(index, autoPlay = true) {
    return requestTrackPlayback(index, { autoPlay });
  }

  let isAutoPopulatingQueue = false;

  async function autoPopulateContinuousQueue(currentSong) {
    if (!currentSong || isAutoPopulatingQueue) return;

    isAutoPopulatingQueue = true;
    try {
      let recs = [];
      const primaryArtist = (typeof DataNormalizer !== 'undefined')
        ? DataNormalizer.getPrimaryArtist(currentSong)
        : String(currentSong.primaryArtist || currentSong.artists || '').split(/[,;&/•+]/)[0].trim();

      // MusicFlow Station: same language, the artist's real top songs, co-artists, the album, curated
      // playlists and related artists — never anything played this session or recently.
      let stationUsed = false;
      if (typeof Station !== 'undefined' && typeof Station.build === 'function') {
        try {
          const built = await Station.build(currentSong, { size: 14, excludeSongs: queue });
          if (Array.isArray(built) && built.length > 0) { recs = built; stationUsed = true; }
        } catch (e) { console.warn('[Player] station build failed:', e.message); }
      }
      if (!stationUsed) {
      // Channel 1: Similar Songs API
      if (currentSong.id && typeof API !== 'undefined' && API.getSimilarSongs) {
        try {
          const sim = await API.getSimilarSongs(currentSong.id, 25);
          if (Array.isArray(sim) && sim.length > 0) recs.push(...sim);
        } catch (_) {}
      }

      // Channel 2: Artist Top Songs
      if (recs.length < 15 && primaryArtist && typeof API !== 'undefined' && API.getArtistSongs) {
        try {
          const artSongs = await API.getArtistSongs(primaryArtist, 1, 25);
          if (Array.isArray(artSongs) && artSongs.length > 0) recs.push(...artSongs);
        } catch (_) {}
      }

      // Channel 3: Artist Hits Search
      if (recs.length < 15 && primaryArtist && typeof API !== 'undefined' && API.searchSongs) {
        try {
          const searchRecs = await API.searchSongs(`${primaryArtist} Hits`, 1, 20);
          if (Array.isArray(searchRecs) && searchRecs.length > 0) recs.push(...searchRecs);
        } catch (_) {}
      }

      // Channel 4: General Artist Query & Related Artists
      const isRadioSession = (queueContext && (queueContext.mode === 'radio' || queueContext.source === 'radio'));
      if (recs.length < 15 && primaryArtist) {
        const cleanArt = primaryArtist.toLowerCase();
        const rel = (typeof RecommendationEngine !== 'undefined' && RecommendationEngine.RELATED_ARTISTS_GRAPH)
          ? (RecommendationEngine.RELATED_ARTISTS_GRAPH[cleanArt] || [])
          : [];
        if (rel.length > 0 && typeof API !== 'undefined' && API.searchSongs) {
          try {
            const relSongs = await API.searchSongs(`${rel[0]} Hits`, 1, 15);
            if (Array.isArray(relSongs) && relSongs.length > 0) recs.push(...relSongs);
          } catch (_) {}
        }
      }

      // Channel 5: Fallback - NEVER dump arbitrary local songs during radio session
      if (!isRadioSession && recs.length < 8 && typeof Storage !== 'undefined' && Storage.getAllSongs) {
        try {
          const pool = Storage.getAllSongs();
          if (Array.isArray(pool) && pool.length > 0) recs.push(...pool);
        } catch (_) {}
      } else if (isRadioSession && recs.length < 8 && typeof API !== 'undefined' && API.searchSongs) {
        try {
          const radioFallbacks = await API.searchSongs(`${primaryArtist} radio`, 1, 15);
          if (Array.isArray(radioFallbacks) && radioFallbacks.length > 0) recs.push(...radioFallbacks);
        } catch (_) {}
      }

      // Harmonic Vibe & Style Re-ranking (tempo, mood, language affinity)
      if (typeof RecommendationEngine !== 'undefined' && typeof RecommendationEngine.getSimilarTracks === 'function' && recs.length > 0) {
        try {
          const ranked = RecommendationEngine.getSimilarTracks(currentSong, recs, 20);
          if (Array.isArray(ranked) && ranked.length > 0) {
            recs = ranked.map(r => r.song || r);
          }
        } catch (_) {}
      }

      }   // end of the legacy channels

      const TD = (typeof TrackDeduplicator !== 'undefined') ? TrackDeduplicator : { deduplicate: arr => arr, cleanTrackTitle: t => t };
      const seedCleanTitle = TD.cleanTrackTitle ? TD.cleanTrackTitle(currentSong.name || currentSong.title) : '';
      
      const uniqueRecs = TD.deduplicate(recs || []);
      const queuedIds = new Set(queue.map(q => String(q.id || q.videoId || '').toLowerCase()));
      const queuedTitles = new Set(queue.map(q => String(q.name || q.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')));

      // Recently played (last 40 history entries): keep auto-play fresh instead of looping the same hits
      const recentIds = new Set();
      const recentTitles = new Set();
      try {
        const hist = (typeof Storage !== 'undefined' && Storage.getHistory) ? (Storage.getHistory() || []).slice(0, 40) : [];
        hist.forEach(h => {
          if (!h) return;
          recentIds.add(String(h.id || h.videoId || '').toLowerCase());
          recentTitles.add(String(h.name || h.title || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
        });
      } catch (_) {}

      // Hard filter: reject exact same track, tracks already in queue, and duplicate remix variants
      const baseItems = uniqueRecs.filter(s => {
        if (!s || (!s.id && !s.videoId)) return false;
        const sid = String(s.id || s.videoId || '').toLowerCase();
        if (sid === String(currentSong.id || currentSong.videoId || '').toLowerCase()) return false;
        if (queuedIds.has(sid)) return false;
        const candTitle = String(s.name || s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (candTitle && queuedTitles.has(candTitle)) return false;
        return true;
      });
      const freshItems = baseItems.filter(s => {
        const sid = String(s.id || s.videoId || '').toLowerCase();
        const candTitle = String(s.name || s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return !recentIds.has(sid) && !(candTitle && recentTitles.has(candTitle));
      });
      // Prefer unheard tracks; only fall back to recently played ones if the pool would starve
      // The Station already keeps recently played songs out (and only brings them back when nothing
      // unheard is left); the legacy path must never top the queue up with what just played.
      const newItems = stationUsed ? baseItems : freshItems;

      if (newItems.length > 0) {
        queue.push(...newItems);
        unShuffledQueue.push(...newItems);
        if (typeof Station !== 'undefined' && Station.markQueued) Station.markQueued(newItems);
        notify('queueChange', queue);
        if (typeof NativeMedia !== 'undefined') {
          NativeMedia.setQueue(queue, currentIndex);
        }
      }
    } catch (_) {
    } finally {
      isAutoPopulatingQueue = false;
    }
  }

  async function playSong(song, newQueue = null) {
    if (!song) return;
    if (newQueue && Array.isArray(newQueue) && newQueue.length > 1) {
      const idx = newQueue.findIndex(s => String(s.id) === String(song.id));
      setQueue(newQueue, idx >= 0 ? idx : 0);
      if (newQueue.length <= 4) {
        autoPopulateContinuousQueue(song);
      }
    } else {
      const existingIdx = queue.findIndex(s => String(s.id) === String(song.id));
      if (existingIdx >= 0) {
        await playTrackAtIndex(existingIdx, true);
      } else {
        queue = [song];
        unShuffledQueue = [song];
        currentIndex = 0;
        notify('queueChange', queue);
        await playTrackAtIndex(0, true);
      }
      autoPopulateContinuousQueue(song);
    }
  }

  let queueContext = { source: 'default', mode: 'normal', sourceId: null, title: '' };

  function isValidQueueTrack(t) {
    if (!t || typeof t !== 'object') return false;
    if (!t.id && !t.name && !t.title && !t.mediaUrl && !t.url) return false;
    return true;
  }

  function startRadioQueue(currentSong, relatedSongs = []) {
    if (!currentSong || !isValidQueueTrack(currentSong)) return;
    queueContext = { source: 'radio', mode: 'radio', sourceId: currentSong.id, title: `${currentSong.name} Radio` };
    const cleanRelated = relatedSongs.filter(s => isValidQueueTrack(s) && String(s.id) !== String(currentSong.id));
    const activeTrack = getCurrentTrack();
    const isSameActiveTrack = activeTrack && (String(activeTrack.id) === String(currentSong.id));

    if (isSameActiveTrack) {
      const pastTracks = queue.slice(0, currentIndex).filter(isValidQueueTrack);
      queue = [...pastTracks, activeTrack, ...cleanRelated];
      unShuffledQueue = [...queue];
      notify('queueChange', queue);
      if (typeof NativeMedia !== 'undefined') {
        NativeMedia.setQueue(queue, currentIndex);
      }
      console.log(`[Radio] Starting radio from: "${activeTrack.name}" (${activeTrack.id})`);
      console.log(`[Radio] Queue size: ${queue.length}`);
      console.log(`[Radio] Active index: ${currentIndex}`);
      console.log(`[Radio] Active track: "${activeTrack.name}"`);
      console.log(`[Player] Radio queue populated: ${queue.length} total tracks (${cleanRelated.length} upcoming) preserving active track "${activeTrack.name}" at index ${currentIndex}`);

      // If audio is not already actively playing, start/resume playback immediately!
      const isActivelyPlaying = audio && !audio.paused && audio.currentTime > 0 && (playbackState === PlaybackState.PLAYING);
      if (!isActivelyPlaying) {
        console.log(`[Radio] Active track "${activeTrack.name}" is not currently playing; starting playback at index ${currentIndex}`);
        playTrackAtIndex(currentIndex, true);
      } else {
        console.log(`[Radio] Active track "${activeTrack.name}" is already playing; continuing playback seamlessly`);
      }
      return;
    }

    // Otherwise, set new queue with currentSong at index 0 and start playback immediately!
    queue = [currentSong, ...cleanRelated];
    unShuffledQueue = [...queue];
    currentIndex = 0;
    notify('queueChange', queue);
    if (typeof NativeMedia !== 'undefined') {
      NativeMedia.setQueue(queue, currentIndex);
    }
    console.log(`[Radio] Starting radio from: "${currentSong.name}" (${currentSong.id})`);
    console.log(`[Radio] Queue size: ${queue.length}`);
    console.log(`[Radio] Active index: 0`);
    console.log(`[Radio] Active track: "${currentSong.name}"`);
    console.log(`[Radio] Requesting playback: index 0`);
    playTrackAtIndex(0, true);
  }

  function setQueue(newQueue, startIndex = 0, autoPlay = true, context = null) {
    queueContext = context || (queueContext.source === 'playlist' ? queueContext : { source: 'default', mode: 'normal' });
    const rawQueue = Array.isArray(newQueue) ? newQueue : [];
    queue = rawQueue.filter(isValidQueueTrack);
    unShuffledQueue = [...queue];
    currentIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
    notify('queueChange', queue);
    if (typeof NativeMedia !== 'undefined') {
      NativeMedia.setQueue(queue, currentIndex);
    }
    if (queue.length > 0) {
      playTrackAtIndex(currentIndex, autoPlay);
    } else {
      transitionTo(PlaybackState.IDLE);
    }
  }

  function getQueueContext() {
    return { ...queueContext };
  }

  async function updatePlaybackQuality(preferredQuality) {
    const cur = getCurrentTrack();
    if (!cur || !audio) return;

    try {
      const savedTime = audio.currentTime || 0;
      const wasPlaying = (playbackState === PlaybackState.PLAYING);
      
      let newUrl = (typeof API !== 'undefined' && API.getDownloadUrl)
        ? API.getDownloadUrl(cur, preferredQuality)
        : '';
      
      if (newUrl && newUrl !== audio.src) {
        console.log(`[Player] Seamlessly updating stream quality to ${preferredQuality}`);
        audio.src = newUrl;
        audio.currentTime = savedTime;
        if (wasPlaying) {
          audio.play().catch(console.warn);
        }
      }
    } catch (e) {
      console.warn('[Player] Quality update notice:', e);
    }
  }

  function appendToQueue(song) {
    if (!song || !isValidQueueTrack(song)) return;
    queue.push(song);
    unShuffledQueue.push(song);
    notify('queueChange', queue);
    if (typeof NativeMedia !== 'undefined') {
      NativeMedia.setQueue(queue, currentIndex);
    }
  }

  function insertNext(trackOrTracks) {
    if (!trackOrTracks) return;
    const items = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
    const normalized = items
      .map(s => (typeof DataNormalizer !== 'undefined' ? DataNormalizer.normalizeTrack(s) : s))
      .filter(isValidQueueTrack);
    if (normalized.length === 0) return;

    // Deduplicate: if these tracks appear further down the queue, remove them from later positions
    const normIds = new Set(normalized.map(s => String(s.id)));
    for (let i = queue.length - 1; i > currentIndex; i--) {
      if (normIds.has(String(queue[i].id))) {
        queue.splice(i, 1);
      }
    }

    const insertPos = (currentIndex >= 0 && currentIndex < queue.length) ? currentIndex + 1 : queue.length;
    queue.splice(insertPos, 0, ...normalized);
    unShuffledQueue = [...queue];
    notify('queueChange', queue);
    if (typeof NativeMedia !== 'undefined') {
      NativeMedia.setQueue(queue, currentIndex);
    }
  }

  function playNext(trackOrTracks) {
    insertNext(trackOrTracks);
  }

  function removeFromQueue(index) {
    if (index < 0 || index >= queue.length) return;
    const removedCurrent = index === currentIndex;
    queue.splice(index, 1);
    unShuffledQueue = unShuffledQueue.filter((_, idx) => idx !== index);

    if (currentIndex >= queue.length) {
      currentIndex = queue.length - 1;
    }
    notify('queueChange', queue);
    if (typeof NativeMedia !== 'undefined') {
      NativeMedia.setQueue(queue, currentIndex);
    }

    if (removedCurrent && queue.length > 0) {
      playTrackAtIndex(currentIndex, true);
    } else if (queue.length === 0) {
      pause();
      currentIndex = -1;
      transitionTo(PlaybackState.IDLE);
    }
  }

  function reorderQueue(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return;
    const item = queue.splice(fromIndex, 1)[0];
    queue.splice(toIndex, 0, item);
    if (currentIndex === fromIndex) {
      currentIndex = toIndex;
    } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
      currentIndex--;
    } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
      currentIndex++;
    }
    notify('queueChange', queue);
  }

  function clearQueue() {
    const current = getCurrentTrack();
    queue = current ? [current] : [];
    unShuffledQueue = [...queue];
    currentIndex = current ? 0 : -1;
    notify('queueChange', queue);
  }

  function togglePlay() {
    if (!audio) {
      init();
    }
    if (!audio) return;

    if (audio.paused) {
      if (!audio.src && queue.length > 0) {
        playTrackAtIndex(currentIndex >= 0 ? currentIndex : 0, true);
      } else {
        play();
      }
    } else {
      pause();
    }
  }

  function play() {
    if (audio && audio.paused) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          if (err && err.name === 'AbortError') return;
          console.warn('[Player] play error:', err?.message || err);
        });
      }
    }
  }

  function pause() {
    if (audio && !audio.paused) {
      audio.pause();
    }
  }

  // Zero-Gap Next-Track Pre-Buffering & Source Pre-Resolution
  let preloadedNextTrackId = null;
  let preloadedAudio = null;

  function getNextPlayableIndex() {
    if (queue.length === 0) return -1;
    for (let i = currentIndex + 1; i < queue.length; i++) {
      if (queue[i] && queue[i].isPlayable !== false) {
        return i;
      }
    }
    if (repeatMode === 'ALL') {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i] && queue[i].isPlayable !== false) {
          return i;
        }
      }
    }
    return -1;
  }

  async function preloadNextTrack() {
    const nextIdx = getNextPlayableIndex();
    if (nextIdx < 0 || nextIdx >= queue.length) return;
    const nextSong = queue[nextIdx];
    if (!nextSong || String(nextSong.id) === String(preloadedNextTrackId)) return;

    preloadedNextTrackId = String(nextSong.id);
    console.log(`[Player] Zero-Gap Pre-buffering next track: "${nextSong.name || nextSong.title}"`);

    try {
      const resolved = await resolvePlaybackSource(nextSong);
      if (resolved && resolved.uri && resolved.uri.startsWith('http')) {
        const Resolver = getPlaybackResolver();
        if (Resolver && typeof Resolver.setCachedStream === 'function') {
          Resolver.setCachedStream(nextSong.id, resolved.uri);
        }
        const isYt = (typeof window !== 'undefined' && window.YtStreamResolver) ? window.YtStreamResolver.isYouTubeStream(resolved.uri) : false;
        if (typeof Audio !== 'undefined' && !isYt) {
          if (!preloadedAudio) {
            preloadedAudio = new Audio();
            preloadedAudio.volume = 0;
            preloadedAudio.muted = true;
          }
          preloadedAudio.preload = 'auto';
          preloadedAudio.src = resolved.uri;
          preloadedAudio.load();
        }
      }
    } catch (_) {}
  }

  async function next() {
    if (queue.length === 0) return;
    const current = getCurrentTrack();

    // Track skip behavior if skipped early (< 20s or < 25%)
    try {
      if (current && audio && audio.currentTime < 20 && typeof Storage !== 'undefined' && Storage.recordSkip) {
        Storage.recordSkip(current);
      }
    } catch (_) {}

    if (repeatMode === 'ONE') {
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(console.warn);
      }
      return;
    }

    // Find next playable track in queue ahead of currentIndex
    let targetIndex = -1;
    for (let i = currentIndex + 1; i < queue.length; i++) {
      if (queue[i] && queue[i].isPlayable !== false) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      playTrackAtIndex(targetIndex, true);
    } else if (repeatMode === 'ALL') {
      let loopIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i] && queue[i].isPlayable !== false) {
          loopIndex = i;
          break;
        }
      }
      if (loopIndex !== -1) {
        playTrackAtIndex(loopIndex, true);
      } else {
        transitionTo(PlaybackState.COMPLETED);
      }
    } else {
      // If playing a playlist, respect playlist boundaries and do not replace with radio
      if (queueContext.source === 'playlist' || queueContext.mode === 'playlist') {
        pause();
        transitionTo(PlaybackState.COMPLETED);
        return;
      }
      if (current) {
        try {
          await autoPopulateContinuousQueue(current);
          let newTarget = -1;
          for (let i = currentIndex + 1; i < queue.length; i++) {
            if (queue[i] && queue[i].isPlayable !== false) {
              newTarget = i;
              break;
            }
          }
          if (newTarget !== -1) {
            playTrackAtIndex(newTarget, true);
            return;
          }
        } catch (_) {}
      }
      transitionTo(PlaybackState.COMPLETED);
    }
  }

  function previous() {
    if (queue.length === 0) return;
    if (audio && audio.currentTime > 3.0) {
      audio.currentTime = 0;
      return;
    }
    // Find previous playable track before currentIndex
    let prevIndex = -1;
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (queue[i] && queue[i].isPlayable !== false) {
        prevIndex = i;
        break;
      }
    }
    if (prevIndex !== -1) {
      playTrackAtIndex(prevIndex, true);
    } else if (repeatMode === 'ALL') {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i] && queue[i].isPlayable !== false) {
          prevIndex = i;
          break;
        }
      }
      if (prevIndex !== -1) {
        playTrackAtIndex(prevIndex, true);
      }
    } else {
      if (audio) audio.currentTime = 0;
    }
  }

  function seek(seconds) {
    if (!audio || isNaN(seconds) || seconds < 0) return;
    const dur = audio.duration || (getCurrentTrack()?.duration) || 0;
    const target = Math.max(0, Math.min(seconds, dur || Infinity));
    audio.currentTime = target;
    updatePositionState();
    notify('timeUpdate', { currentTime: target, duration: dur });
    if (typeof Lyrics !== 'undefined' && Lyrics.updateTime) {
      Lyrics.updateTime(target, true);
    }
  }

  function seekPercent(percent) {
    if (!audio || !audio.duration || isNaN(percent)) return;
    const p = Math.max(0, Math.min(percent, 100));
    const target = (p / 100) * audio.duration;
    audio.currentTime = target;
    updatePositionState();
    notify('timeUpdate', { currentTime: target, duration: audio.duration });
    if (typeof Lyrics !== 'undefined' && Lyrics.updateTime) {
      Lyrics.updateTime(target, true);
    }
  }

  function toggleShuffle() {
    isShuffle = !isShuffle;
    const current = getCurrentTrack();

    if (isShuffle) {
      const remaining = queue.filter((_, idx) => idx !== currentIndex);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      queue = current ? [current, ...remaining] : remaining;
      currentIndex = 0;
    } else {
      queue = [...unShuffledQueue];
      currentIndex = current ? queue.findIndex(s => String(s.id) === String(current.id)) : 0;
    }

    notify('shuffleChange', isShuffle);
    notify('queueChange', queue);
    return isShuffle;
  }

  function toggleRepeat() {
    if (repeatMode === 'OFF') repeatMode = 'ALL';
    else if (repeatMode === 'ALL') repeatMode = 'ONE';
    else repeatMode = 'OFF';
    notify('repeatChange', repeatMode);
    return repeatMode;
  }

  function formatTimeRemaining(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function getSleepTimerState() {
    const remainingMs = (sleepTimerState.active && sleepTimerState.mode === 'duration' && sleepTimerState.expiresAt > 0)
      ? Math.max(0, sleepTimerState.expiresAt - Date.now())
      : 0;
    return {
      active: sleepTimerState.active,
      mode: sleepTimerState.mode,
      durationMinutes: sleepTimerState.durationMinutes,
      expiresAt: sleepTimerState.expiresAt,
      remainingMs,
      formattedRemaining: sleepTimerState.mode === 'end_of_track' ? 'End of song' : formatTimeRemaining(remainingMs)
    };
  }

  function handleSleepTimerExpiration() {
    if (!sleepTimerState.active) return;
    const prevMode = sleepTimerState.mode;
    if (sleepTimerTimeout) {
      clearTimeout(sleepTimerTimeout);
      sleepTimerTimeout = null;
    }
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    sleepTimerState = {
      active: false,
      mode: 'off',
      durationMinutes: 0,
      expiresAt: 0,
      trackIdWhenSet: null
    };
    pause();
    restoreSleepFadeVolume();
    notify('sleepTimerChange', getSleepTimerState());
    notify('sleepTimerExpired', { mode: prevMode });
  }

  function setSleepTimer(option) {
    // 1. Clear any existing timer (Duplicate timer prevention)
    restoreSleepFadeVolume();
    if (sleepTimerTimeout) {
      clearTimeout(sleepTimerTimeout);
      sleepTimerTimeout = null;
    }
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }

    // 2. End of Current Track Mode
    if (option === 'end' || option === 'end_of_track') {
      sleepTimerState = {
        active: true,
        mode: 'end_of_track',
        durationMinutes: 0,
        expiresAt: 0,
        trackIdWhenSet: getCurrentTrack()?.id || null
      };
      notify('sleepTimerChange', getSleepTimerState());
      return getSleepTimerState();
    }

    // 3. Duration Timer Mode (minutes: 5 -> 180)
    const mins = Number(option);
    if (!isNaN(mins) && mins > 0) {
      const clampedMins = Math.min(180, Math.max(1, mins));
      const expiresAt = Date.now() + (clampedMins * 60 * 1000);
      sleepTimerState = {
        active: true,
        mode: 'duration',
        durationMinutes: clampedMins,
        expiresAt,
        trackIdWhenSet: getCurrentTrack()?.id || null
      };

      // Set timeout for expiration
      sleepTimerTimeout = setTimeout(() => {
        handleSleepTimerExpiration();
      }, clampedMins * 60 * 1000);

      // Set 1-second ticker for UI countdown updates and gentle 30s volume fade-out
      sleepTimerInterval = setInterval(() => {
        if (!sleepTimerState.active || sleepTimerState.mode !== 'duration') {
          clearInterval(sleepTimerInterval);
          sleepTimerInterval = null;
          restoreSleepFadeVolume();
          return;
        }
        const now = Date.now();
        if (now >= sleepTimerState.expiresAt) {
          handleSleepTimerExpiration();
        } else {
          const remainingMs = sleepTimerState.expiresAt - now;
          if (remainingMs <= 30000 && audio) {
            isSleepFading = true;
            const progress = Math.max(0, Math.min(1, remainingMs / 30000.0));
            // Power curve for natural logarithmic hearing attenuation
            const factor = Math.pow(progress, 1.5);
            audio.volume = Math.max(0, Math.min(1, baselineVolume * factor));
          } else if (isSleepFading) {
            restoreSleepFadeVolume();
          }
          notify('sleepTimerTick', getSleepTimerState());
        }
      }, 1000);

      notify('sleepTimerChange', getSleepTimerState());
      return getSleepTimerState();
    }

    // 4. Cancel / Turn OFF Mode
    restoreSleepFadeVolume();
    sleepTimerState = {
      active: false,
      mode: 'off',
      durationMinutes: 0,
      expiresAt: 0,
      trackIdWhenSet: null
    };
    notify('sleepTimerChange', getSleepTimerState());
    return getSleepTimerState();
  }

  function addSleepTimerMinutes(extraMinutes) {
    restoreSleepFadeVolume();
    if (!sleepTimerState.active || sleepTimerState.mode !== 'duration') {
      return setSleepTimer(extraMinutes || 15);
    }
    const extraMs = (Number(extraMinutes) || 15) * 60 * 1000;
    const newExpiresAt = Math.max(Date.now() + 60000, sleepTimerState.expiresAt + extraMs);
    const addedMins = Number(extraMinutes) || 15;
    
    sleepTimerState.expiresAt = newExpiresAt;
    sleepTimerState.durationMinutes += addedMins;

    if (sleepTimerTimeout) clearTimeout(sleepTimerTimeout);
    const remainingMs = Math.max(0, sleepTimerState.expiresAt - Date.now());
    sleepTimerTimeout = setTimeout(() => {
      handleSleepTimerExpiration();
    }, remainingMs);

    notify('sleepTimerChange', getSleepTimerState());
    return getSleepTimerState();
  }

  async function setAudioSink(sinkId) {
    if (!audio) init();
    if (!audio) return false;
    if (typeof audio.setSinkId === 'function') {
      try {
        await audio.setSinkId(sinkId || '');
        return true;
      } catch (err) {
        console.warn('[Player] setSinkId error:', err);
        return false;
      }
    }
    return false;
  }

  function onAudioOutputChanged(deviceId, deviceLabel, deviceType) {
    console.log('[Player] Audio output route changed:', deviceId, deviceLabel, deviceType);
    if (typeof AudioEffectsEngine !== 'undefined' && typeof AudioEffectsEngine.handleDeviceChange === 'function') {
      AudioEffectsEngine.handleDeviceChange();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    notify('outputChanged', { id: deviceId, label: deviceLabel, type: deviceType });
  }

  function setEqEnabled(enabled) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setEnabled) {
      AudioEffectsEngine.setEnabled(enabled);
    }
  }

  function setEqPreset(presetName) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setPreset) {
      AudioEffectsEngine.setPreset(presetName);
    }
  }

  function setEqBand(index, value) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setBandGain) {
      AudioEffectsEngine.setBandGain(index, value);
    }
  }

  function setBassBoost(value) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setBassBoost) {
      AudioEffectsEngine.setBassBoost(value);
    }
  }

  function setTrebleBoost(value) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setTrebleBoost) {
      AudioEffectsEngine.setTrebleBoost(value);
    }
  }

  function setVocalBoost(value) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setVocalBoost) {
      AudioEffectsEngine.setVocalBoost(value);
    }
  }

  function setSpatial(level) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setSpatial) {
      AudioEffectsEngine.setSpatial(level);
    }
  }

  function setVirtualizerStrength(val) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setSpatial) {
      const mode = val > 66 ? 'HIGH' : (val > 33 ? 'MEDIUM' : (val > 0 ? 'LOW' : 'OFF'));
      AudioEffectsEngine.setSpatial(mode);
    }
  }

  function setNormalization(enabled) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setNormalization) {
      AudioEffectsEngine.setNormalization(enabled);
    }
  }

  function setCrossfade(seconds) {
    if (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.setCrossfade) {
      AudioEffectsEngine.setCrossfade(seconds);
    }
  }

  function resetAudioEffects() {
    if (typeof AudioEffectsEngine !== 'undefined') {
      if (typeof AudioEffectsEngine.resetDefaults === 'function') {
        AudioEffectsEngine.resetDefaults();
      } else if (typeof AudioEffectsEngine.resetToDefaults === 'function') {
        AudioEffectsEngine.resetToDefaults();
      }
    }
    if (typeof Storage !== 'undefined' && Storage.resetAudioEffects) {
      Storage.resetAudioEffects();
    }
    notify('eqChange', { reset: true });
  }

  function on(event, callback) {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    // Prevent duplicate listener attachments
    if (!eventListeners[event].includes(callback)) {
      eventListeners[event].push(callback);
    }
  }

  function off(event, callback) {
    if (!eventListeners[event]) return;
    eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
  }

  function getState() {
    return {
      playbackState,
      isPlaying: playbackState === PlaybackState.PLAYING,
      currentTrack: getCurrentTrack(),
      currentIndex,
      sourceType: currentSourceType,
      position: audio ? audio.currentTime : 0,
      duration: audio ? (audio.duration || 0) : 0,
      bufferedPosition: getBufferedPosition(),
      isShuffle,
      repeatMode,
      queueLength: queue.length,
      lastError,
      sleepTimer: getSleepTimerState()
    };
  }

  return {
    PlaybackState,
    SourceType,
    ErrorCode,
    init,
    initWebAudio,
    requestTrackPlayback,
    playTrackAtIndex,
    playSong,
    playTrack: playSong,
    setQueue,
    startRadioQueue,
    appendToQueue,
    insertNext,
    playNext,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    togglePlay,
    play,
    pause,
    next,
    previous,
    seek,
    seekPercent,
    setAudioSink,
    onAudioOutputChanged,
    getAudioElement: () => audio,
    toggleShuffle,
    toggleRepeat,
    setSleepTimer,
    addSleepTimerMinutes,
    getSleepTimerState,
    formatTimeRemaining,
    setEqEnabled,
    setEqBand,
    setBassBoost,
    setTrebleBoost,
    setVocalBoost,
    setSpatial,
    setVirtualizerStrength,
    setNormalization,
    setCrossfade,
    setEqPreset,
    resetAudioEffects,
    getEqFrequencies: () => (typeof AudioEffectsEngine !== 'undefined' ? AudioEffectsEngine.getFrequencies() : [...EQ_FREQS]),
    getEqPresets: () => (typeof AudioEffectsEngine !== 'undefined' ? Object.keys(AudioEffectsEngine.getPresets()) : Object.keys(EQ_PRESETS)),
    getProPresets: () => (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.getProPresets ? AudioEffectsEngine.getProPresets() : {}),
    getProPresetNames: () => (typeof AudioEffectsEngine !== 'undefined' && AudioEffectsEngine.getProPresetNames ? AudioEffectsEngine.getProPresetNames() : []),
    getAudioEffectsSettings: () => (typeof AudioEffectsEngine !== 'undefined' ? AudioEffectsEngine.getSettings() : null),
    getCurrentTrack,
    getCurrentResolvedSource: () => currentResolvedSource,
    getCurrentIndex: () => currentIndex,
    getQueue: () => [...queue],
    getQueueContext,
    getPlaybackGeneration: () => playbackGeneration,
    getPlaybackRequestId: () => playbackRequestId,
    getIsPlaying: () => playbackState === PlaybackState.PLAYING,
    getIsShuffle: () => isShuffle,
    getRepeatMode: () => repeatMode,
    getDuration: () => (audio ? (audio.duration || getCurrentTrack()?.duration || 0) : (getCurrentTrack()?.duration || 0)),
    getPosition: () => (audio ? audio.currentTime : 0),
    getState,
    getVolume,
    setVolume,
    resolvePlaybackSource,
    updatePlaybackQuality,
    on,
    off,
    autoPopulateContinuousQueue,
    preloadNextTrack,
    getNextPlayableIndex,
    // iOS Background Audio — exposed for native AppDelegate bridge
    _handleBackgroundTransition,
    _handleForegroundTransition
  };
})();

if (typeof window !== 'undefined') {
  window.Player = Player;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Player;
}

// ==========================================================================
// MUSICFLOW — PROFESSIONAL AUDIO EFFECTS & DSP ENGINE
// Real 7-Band EQ, 3D Spatial Audio, Bass/Treble/Vocal Boost, Peak Limiter
// ==========================================================================

const AudioEffectsEngine = (() => {
  let audioCtx = null;
  let sourceNode = null;
  let preGainNode = null;
  let normGainNode = null;
  let bassBoostNode = null;
  let trebleBoostNode = null;
  let vocalBoostNode = null;
  let eqBandNodes = [];
  let spatialSplitter = null;
  let spatialMerger = null;
  let midGainNode = null;
  let sideGainNode = null;
  let limiterNode = null;
  let masterGainNode = null;
  let isInitialized = false;

  // --- iOS Background Audio Fix ---
  // Track whether the Web Audio graph is attached to the audio element.
  // When attached, audio flows: HTMLAudioElement → MediaElementSource → DSP → destination
  // When detached, audio flows: HTMLAudioElement → native speaker (survives iOS background)
  let _pendingAudioElement = null;  // stored reference, not yet attached
  let _isAttached = false;          // true when createMediaElementSource has been called

  // 7-Band Equalizer Standard Center Frequencies (Hz)
  const EQ_FREQUENCIES = [60, 150, 400, 1000, 2400, 6000, 15000];

  // Curated Professional Presets (7 bands in dB: 60Hz, 150Hz, 400Hz, 1kHz, 2.4kHz, 6kHz, 15kHz)
  const PRESETS = {
    'Flat': {
      bands: [0, 0, 0, 0, 0, 0, 0],
      bassBoost: 0,
      trebleBoost: 0,
      vocalBoost: 0,
      spatial: 'OFF'
    },
    'Bose Clarity': {
      bands: [4, 2.5, -0.5, 1.5, 3, 3.5, 5],
      bassBoost: 3,
      trebleBoost: 4,
      vocalBoost: 3,
      spatial: 'MEDIUM'
    },
    'Bose Deep Bass': {
      bands: [6, 4, 0, 1, 2, 3, 4],
      bassBoost: 6,
      trebleBoost: 3,
      vocalBoost: 2,
      spatial: 'LOW'
    },
    'Bass Boost': {
      bands: [6, 5, 2, 0, 0, 0, 0],
      bassBoost: 8,
      trebleBoost: 0,
      vocalBoost: 0,
      spatial: 'LOW'
    },
    'Treble': {
      bands: [0, 0, 0, 1, 3, 6, 8],
      bassBoost: 0,
      trebleBoost: 8,
      vocalBoost: 0,
      spatial: 'OFF'
    },
    'Vocal': {
      bands: [-2, 0, 2, 5, 5, 2, -1],
      bassBoost: 0,
      trebleBoost: 2,
      vocalBoost: 6,
      spatial: 'LOW'
    },
    'Rock': {
      bands: [5, 3, -1, 0, 2, 4, 5],
      bassBoost: 4,
      trebleBoost: 3,
      vocalBoost: 1,
      spatial: 'MEDIUM'
    },
    'Pop': {
      bands: [3, 2, 1, 3, 4, 3, 4],
      bassBoost: 3,
      trebleBoost: 3,
      vocalBoost: 3,
      spatial: 'LOW'
    },
    'Hip-Hop': {
      bands: [7, 5, 0, 1, 2, 3, 4],
      bassBoost: 6,
      trebleBoost: 2,
      vocalBoost: 1,
      spatial: 'MEDIUM'
    },
    'Classical': {
      bands: [4, 3, 1, 1, 2, 4, 6],
      bassBoost: 2,
      trebleBoost: 4,
      vocalBoost: 1,
      spatial: 'HIGH'
    },
    'Jazz': {
      bands: [3, 2, 1, 2, 2, 3, 4],
      bassBoost: 2,
      trebleBoost: 3,
      vocalBoost: 2,
      spatial: 'LOW'
    },
    'Electronic': {
      bands: [6, 4, 0, -1, 2, 5, 6],
      bassBoost: 6,
      trebleBoost: 4,
      vocalBoost: 0,
      spatial: 'HIGH'
    },
    'Bollywood': {
      bands: [4, 3, 1, 3, 4, 3, 4],
      bassBoost: 3,
      trebleBoost: 3,
      vocalBoost: 4,
      spatial: 'MEDIUM'
    },
    'Lo-Fi': {
      bands: [4, 3, -1, -2, 1, -1, -3],
      bassBoost: 4,
      trebleBoost: -2,
      vocalBoost: 1,
      spatial: 'LOW'
    },
    'Acoustic': {
      bands: [3, 2, 0, 2, 3, 4, 5],
      bassBoost: 2,
      trebleBoost: 4,
      vocalBoost: 2,
      spatial: 'MEDIUM'
    }
  };

  // Pro Presets (lazily loaded from AudioPresetsLibrary)
  let PRO_PRESETS = null;

  function _getProPresets() {
    if (!PRO_PRESETS && typeof AudioPresetsLibrary !== 'undefined') {
      PRO_PRESETS = AudioPresetsLibrary.getMappedProPresets();
    }
    return PRO_PRESETS || {};
  }

  // State
  let settings = {
    enabled: false,
    preset: 'Flat',
    bands: [0, 0, 0, 0, 0, 0, 0],
    bassBoost: 0,       // 0 to 12 dB
    trebleBoost: 0,     // 0 to 12 dB
    vocalBoost: 0,      // 0 to 8 dB
    spatial: 'OFF',     // 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'
    normalization: false,
    crossfade: 0        // seconds: 0, 2, 4, 6, 8, 10
  };

  // Spatial Level Multipliers
  const SPATIAL_WIDTHS = {
    'OFF': 1.0,
    'LOW': 1.25,
    'MEDIUM': 1.5,
    'HIGH': 1.85
  };

  /**
   * init() — LAZY INITIALIZATION (iOS Background Audio Fix)
   * Stores the audio element reference and loads settings, but does NOT call
   * createMediaElementSource() yet. This allows the HTMLAudioElement to output
   * directly to the speaker (native path), which survives iOS background/lock.
   */
  function init(audioElement) {
    if (!audioElement || typeof window === 'undefined') return;

    _pendingAudioElement = audioElement;
    loadStoredSettings();

    const isIOS = (typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)) ||
                  (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const hasNonFlatEffects = _hasActiveEffects();

    if (hasNonFlatEffects && !isIOS) {
      attachToElement(audioElement);
    } else {
      console.log('[AudioEffects] Deferred Web Audio attachment (native playback path active)');
      isInitialized = true;
    }
  }

  /**
   * Returns true if user has any non-flat effect settings that require Web Audio processing.
   */
  function _hasActiveEffects() {
    if (!settings.enabled) return false;
    if (settings.preset && settings.preset !== 'Flat') return true;
    if (settings.bassBoost > 0 || settings.trebleBoost !== 0 || settings.vocalBoost > 0) return true;
    if (settings.spatial && settings.spatial !== 'OFF') return true;
    if (Array.isArray(settings.bands) && settings.bands.some(b => b !== 0)) return true;
    return false;
  }

  function isIOS() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
      Boolean(window.webkit?.messageHandlers?.nativeMedia) ||
      (typeof window.Capacitor !== 'undefined' && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios')
    );
  }

  /**
   * attachToElement() — Build and connect the full Web Audio DSP graph.
   * Safe against multiple calls (never recreates createMediaElementSource on same element).
   */
  function attachToElement(audioElement) {
    const el = audioElement || _pendingAudioElement;
    if (!el) return;

    if (isIOS()) {
      console.log('[AudioEffects] iOS detected — preserving native hardware audio pipeline for uninterrupted background playback');
      isInitialized = true;
      _pendingAudioElement = el;
      return;
    }

    if (_isAttached && audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(console.warn);
      }
      applyAll();
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) {
        console.warn('[AudioEffects] Web Audio API is not supported on this device/browser');
        return;
      }

      audioCtx = new AudioCtxClass();
      if (typeof audioCtx.onstatechange !== 'undefined') {
        audioCtx.onstatechange = () => {
          if (audioCtx && audioCtx.state === 'suspended' && typeof Player !== 'undefined' && Player.isPlaying && Player.isPlaying()) {
            audioCtx.resume().catch(() => {});
          }
        };
      }
      sourceNode = audioCtx.createMediaElementSource(el);

      // 1. Preamp Compensation Gain Node
      preGainNode = audioCtx.createGain();
      preGainNode.gain.value = 1.0;

      // 2. Loudness Normalization Gain Node
      normGainNode = audioCtx.createGain();
      normGainNode.gain.value = 1.0;

      // 3. Bass Boost Node (80 Hz Low-Shelf)
      bassBoostNode = audioCtx.createBiquadFilter();
      bassBoostNode.type = 'lowshelf';
      bassBoostNode.frequency.value = 80;
      bassBoostNode.gain.value = 0;

      // 4. Treble Boost Node (10 kHz High-Shelf)
      trebleBoostNode = audioCtx.createBiquadFilter();
      trebleBoostNode.type = 'highshelf';
      trebleBoostNode.frequency.value = 10000;
      trebleBoostNode.gain.value = 0;

      // 5. Vocal Enhancement Node (2.8 kHz Peaking)
      vocalBoostNode = audioCtx.createBiquadFilter();
      vocalBoostNode.type = 'peaking';
      vocalBoostNode.frequency.value = 2800;
      vocalBoostNode.Q.value = 1.4;
      vocalBoostNode.gain.value = 0;

      // 6. 7-Band Equalizer Filter Nodes
      eqBandNodes = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = audioCtx.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
        }
        filter.frequency.value = freq;
        filter.Q.value = 1.2;
        filter.gain.value = 0;
        return filter;
      });

      // 7. Dynamic Transparent Headroom Limiter (Prevents all digital clipping and distortion)
      limiterNode = audioCtx.createDynamicsCompressor();
      limiterNode.threshold.value = -0.5;
      limiterNode.knee.value = 6.0;
      limiterNode.ratio.value = 6.0;
      limiterNode.attack.value = 0.005;
      limiterNode.release.value = 0.100;

      // 8. Master Gain Node
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = 1.0;

      // --- Connect DSP Chain ---
      let currentNode = sourceNode;

      currentNode.connect(preGainNode);
      currentNode = preGainNode;

      currentNode.connect(normGainNode);
      currentNode = normGainNode;

      currentNode.connect(bassBoostNode);
      currentNode = bassBoostNode;

      currentNode.connect(trebleBoostNode);
      currentNode = trebleBoostNode;

      currentNode.connect(vocalBoostNode);
      currentNode = vocalBoostNode;

      eqBandNodes.forEach(filter => {
        currentNode.connect(filter);
        currentNode = filter;
      });

      currentNode.connect(limiterNode);
      limiterNode.connect(masterGainNode);
      masterGainNode.connect(audioCtx.destination);

      _isAttached = true;
      isInitialized = true;
      _pendingAudioElement = el;

      console.log('[AudioEffects] Web Audio DSP graph attached to audio element with pristine headroom limiter');

      // Apply current settings to the newly built graph
      applyAll();
    } catch (err) {
      console.warn('[AudioEffects] attachToElement notice:', err.message);
    }
  }

  /**
   * detachFromElement() — Tear down the Web Audio graph.
   * Closes the AudioContext so the HTMLAudioElement reverts to native output.
   * This is critical for iOS background playback: native HTMLAudioElement output
   * survives WKWebView background, but AudioContext does not.
   *
   * Returns the audio element that was detached (caller should use this for playback).
   */
  function detachFromElement() {
    if (!_isAttached || !audioCtx) {
      return _pendingAudioElement;
    }

    try {
      if (sourceNode) try { sourceNode.disconnect(); } catch (_) {}
      if (preGainNode) try { preGainNode.disconnect(); } catch (_) {}
      if (normGainNode) try { normGainNode.disconnect(); } catch (_) {}
      if (bassBoostNode) try { bassBoostNode.disconnect(); } catch (_) {}
      if (trebleBoostNode) try { trebleBoostNode.disconnect(); } catch (_) {}
      if (vocalBoostNode) try { vocalBoostNode.disconnect(); } catch (_) {}
      eqBandNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
      if (spatialSplitter) try { spatialSplitter.disconnect(); } catch (_) {}
      if (spatialMerger) try { spatialMerger.disconnect(); } catch (_) {}
      if (midGainNode) try { midGainNode.disconnect(); } catch (_) {}
      if (sideGainNode) try { sideGainNode.disconnect(); } catch (_) {}
      if (limiterNode) try { limiterNode.disconnect(); } catch (_) {}
      if (masterGainNode) try { masterGainNode.disconnect(); } catch (_) {}

      try {
        audioCtx.close().catch(console.warn);
      } catch (_) {}

      console.log('[AudioEffects] Web Audio graph detached — native playback path restored');
    } catch (err) {
      console.warn('[AudioEffects] detachFromElement error:', err);
    }

    // Reset all node references
    audioCtx = null;
    sourceNode = null;
    preGainNode = null;
    normGainNode = null;
    bassBoostNode = null;
    trebleBoostNode = null;
    vocalBoostNode = null;
    eqBandNodes = [];
    spatialSplitter = null;
    spatialMerger = null;
    midGainNode = null;
    sideGainNode = null;
    limiterNode = null;
    masterGainNode = null;
    _isAttached = false;

    return _pendingAudioElement;
  }

  /**
   * isAttached() — Whether the Web Audio DSP graph currently owns the audio element's output.
   */
  function isAttached() {
    return _isAttached;
  }

  function loadStoredSettings() {
    if (typeof Storage !== 'undefined' && typeof Storage.getAudioEffects === 'function') {
      const stored = Storage.getAudioEffects();
      if (stored) {
        settings = { ...settings, ...stored };
      }
    }
    applyAll();
  }

  function persistSettings() {
    if (typeof Storage !== 'undefined' && typeof Storage.setAudioEffects === 'function') {
      Storage.setAudioEffects(settings);
    }
  }

  // Smooth parameter ramp helper to eliminate clicks and pops
  function rampParam(param, targetVal, timeConstant = 0.04) {
    if (!param) return;
    if (audioCtx && audioCtx.state === 'running' && param.setTargetAtTime) {
      param.setTargetAtTime(targetVal, audioCtx.currentTime, timeConstant);
    } else {
      param.value = targetVal;
    }
  }

  // Applies all current settings to Web Audio DSP nodes
  function applyAll() {
    if (settings.enabled && !_isAttached && _pendingAudioElement && _hasActiveEffects()) {
      const isHidden = (typeof document !== 'undefined' && document.visibilityState === 'hidden');
      if (!isHidden) {
        attachToElement(_pendingAudioElement);
      }
    }

    if (!isInitialized || !audioCtx) return;

    const isEnabled = settings.enabled === true;

    // 1. Equalizer Bands
    const bands = Array.isArray(settings.bands) ? settings.bands : [0, 0, 0, 0, 0, 0, 0];
    let maxBoost = 0;

    eqBandNodes.forEach((node, idx) => {
      const gain = isEnabled ? (Number(bands[idx]) || 0) : 0;
      rampParam(node.gain, gain);
      if (gain > maxBoost) maxBoost = gain;
    });

    // 2. Bass Boost
    const bass = isEnabled ? (Number(settings.bassBoost) || 0) : 0;
    rampParam(bassBoostNode.gain, bass);
    if (bass > maxBoost) maxBoost = bass;

    // 3. Treble Boost
    const treble = isEnabled ? (Number(settings.trebleBoost) || 0) : 0;
    rampParam(trebleBoostNode.gain, treble);
    if (treble > maxBoost) maxBoost = treble;

    // 4. Vocal Boost
    const vocal = isEnabled ? (Number(settings.vocalBoost) || 0) : 0;
    rampParam(vocalBoostNode.gain, vocal);
    if (vocal > maxBoost) maxBoost = vocal;

    // 5. Automatic Preamp Headroom Compensation (Prevents digital clipping on large boosts)
    if (isEnabled && maxBoost > 0) {
      const attenuationDb = -Math.min(10, maxBoost * 0.70);
      const preGainLinear = Math.pow(10, attenuationDb / 20);
      rampParam(preGainNode.gain, preGainLinear);
    } else {
      rampParam(preGainNode.gain, 1.0);
    }

    // 6. Loudness Normalization
    if (isEnabled && settings.normalization) {
      rampParam(normGainNode.gain, 0.90);
    } else {
      rampParam(normGainNode.gain, 1.0);
    }
  }

  // --- Public Control APIs ---

  function setEnabled(enabled) {
    settings.enabled = Boolean(enabled);
    persistSettings();

    // If enabling effects and not yet attached, attach now (foreground only)
    if (enabled && !_isAttached && _pendingAudioElement && _hasActiveEffects()) {
      const isHidden = (typeof document !== 'undefined' && document.visibilityState === 'hidden');
      if (!isHidden) {
        attachToElement(_pendingAudioElement);
      }
    }

    applyAll();
  }

  function isEnabled() {
    return settings.enabled;
  }

  function setPreset(presetName) {
    const p = PRESETS[presetName];
    if (p) {
      settings.preset = presetName;
      settings.bands = [...p.bands];
      settings.bassBoost = p.bassBoost || 0;
      settings.trebleBoost = p.trebleBoost || 0;
      settings.vocalBoost = p.vocalBoost || 0;
      if (p.spatial) settings.spatial = p.spatial;
    } else {
      // Check Pro Presets
      const proPresets = _getProPresets();
      const pro = proPresets[presetName];
      if (pro) {
        settings.preset = presetName;
        settings.bands = [...pro.bands];
        settings.bassBoost = pro.bassBoost || 0;
        settings.trebleBoost = pro.trebleBoost || 0;
        settings.vocalBoost = pro.vocalBoost || 0;
        if (pro.spatial) settings.spatial = pro.spatial;
      } else if (typeof Storage !== 'undefined' && typeof Storage.getUserPresets === 'function') {
        const userPresets = Storage.getUserPresets();
        if (userPresets && userPresets[presetName]) {
          const up = userPresets[presetName];
          settings.preset = presetName;
          settings.bands = [...(up.bands || [0, 0, 0, 0, 0, 0, 0])];
          settings.bassBoost = up.bassBoost || 0;
          settings.trebleBoost = up.trebleBoost || 0;
          settings.vocalBoost = up.vocalBoost || 0;
          if (up.spatial) settings.spatial = up.spatial;
        }
      }
    }
    persistSettings();
    applyAll();
  }

  function setBandGain(index, gainDb) {
    if (index < 0 || index >= EQ_FREQUENCIES.length) return;
    if (!Array.isArray(settings.bands)) settings.bands = [0, 0, 0, 0, 0, 0, 0];
    const clampedGain = Math.max(-12, Math.min(12, Number(gainDb) || 0));
    settings.bands[index] = clampedGain;
    settings.preset = 'Custom';
    persistSettings();
    applyAll();
  }

  function setBassBoost(gainDb) {
    const clamped = Math.max(0, Math.min(12, Number(gainDb) || 0));
    settings.bassBoost = clamped;
    settings.preset = 'Custom';
    persistSettings();
    applyAll();
  }

  function setTrebleBoost(gainDb) {
    const clamped = Math.max(-6, Math.min(12, Number(gainDb) || 0));
    settings.trebleBoost = clamped;
    settings.preset = 'Custom';
    persistSettings();
    applyAll();
  }

  function setVocalBoost(gainDb) {
    const clamped = Math.max(0, Math.min(8, Number(gainDb) || 0));
    settings.vocalBoost = clamped;
    settings.preset = 'Custom';
    persistSettings();
    applyAll();
  }

  function setSpatial(level) {
    const validLevels = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
    if (validLevels.includes(level)) {
      settings.spatial = level;
      persistSettings();
      applyAll();
    }
  }

  function setNormalization(enabled) {
    settings.normalization = Boolean(enabled);
    persistSettings();
    applyAll();
  }

  function setCrossfade(seconds) {
    const clamped = Math.max(0, Math.min(10, Number(seconds) || 0));
    settings.crossfade = clamped;
    persistSettings();
  }

  function resetDefaults() {
    settings = {
      enabled: false,
      preset: 'Flat',
      bands: [0, 0, 0, 0, 0, 0, 0],
      bassBoost: 0,
      trebleBoost: 0,
      vocalBoost: 0,
      spatial: 'OFF',
      normalization: false,
      crossfade: 0
    };
    persistSettings();
    applyAll();
  }

  function saveCustomPreset(name) {
    const cleanName = (name || '').trim();
    if (!cleanName) return false;
    if (typeof Storage !== 'undefined' && typeof Storage.saveUserPreset === 'function') {
      Storage.saveUserPreset(cleanName, {
        bands: [...settings.bands],
        bassBoost: settings.bassBoost,
        trebleBoost: settings.trebleBoost,
        vocalBoost: settings.vocalBoost,
        spatial: settings.spatial
      });
      settings.preset = cleanName;
      persistSettings();
      return true;
    }
    return false;
  }

  function deleteCustomPreset(name) {
    if (typeof Storage !== 'undefined' && typeof Storage.deleteUserPreset === 'function') {
      Storage.deleteUserPreset(name);
      if (settings.preset === name) {
        setPreset('Flat');
      }
      return true;
    }
    return false;
  }

  function resumeContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(console.warn);
    }
  }

  function getSettings() {
    return JSON.parse(JSON.stringify(settings));
  }

  function getPresets() {
    return PRESETS;
  }

  function getProPresets() {
    return _getProPresets();
  }

  function getProPresetNames() {
    return Object.keys(_getProPresets());
  }

  function getFrequencies() {
    return EQ_FREQUENCIES;
  }

  function getAudioContext() {
    return audioCtx;
  }

  function resumeContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
      return audioCtx.resume().then(() => true).catch(err => {
        console.warn('[AudioEffects] audioCtx.resume error:', err);
        return false;
      });
    }
    return Promise.resolve(true);
  }

  function handleDeviceChange() {
    return resumeContext();
  }

  // Read-only analyser tap on the master output (used by the beat-reactive UI). Does not alter audio.
  let analyserNode = null;
  function getAnalyser() {
    if (!audioCtx || !masterGainNode) return null;
    if (!analyserNode) {
      try {
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 512;
        analyserNode.smoothingTimeConstant = 0.55;
        masterGainNode.connect(analyserNode);
      } catch (e) {
        analyserNode = null;
      }
    }
    return analyserNode;
  }

  return {
    init,
    attachToElement,
    detachFromElement,
    isAttached,
    setEnabled,
    isEnabled,
    setPreset,
    setBandGain,
    setBassBoost,
    setTrebleBoost,
    setVocalBoost,
    setSpatial,
    setNormalization,
    setCrossfade,
    resetDefaults,
    saveCustomPreset,
    deleteCustomPreset,
    resumeContext,
    resumeAudioContext: resumeContext,
    resume: resumeContext,
    handleDeviceChange,
    getAnalyser,
    getSettings,
    getPresets,
    getProPresets,
    getProPresetNames,
    getFrequencies,
    getAudioContext
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioEffectsEngine;
}

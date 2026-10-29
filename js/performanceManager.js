// ============================================================================
// MUSICFLOW — PERFORMANCE & DISPLAY REFRESH RATE MANAGER
// Manages 120 FPS Ultra Smooth, 60 FPS Smooth, 30 FPS Battery Saver, and Auto
// Probes hardware display capabilities to avoid false 120Hz claims on 60Hz screens.
// ============================================================================

const PerformanceManager = (() => {
  const MODES = {
    AUTO: 'auto',
    FPS_120: '120fps',
    FPS_60: '60fps',
    FPS_30: '30fps'
  };

  const MODE_ORDER = ['auto', '120fps', '60fps', '30fps'];

  let detectedHardwareHz = 60; // default baseline until probed
  let isProbed = false;

  /**
   * Probe display refresh rate using requestAnimationFrame timestamp sampling
   */
  function probeHardwareRefreshRate() {
    if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') {
      return;
    }

    // Check if platform screen exposes refresh rate directly
    if (window.screen && typeof window.screen.refreshRate === 'number' && window.screen.refreshRate > 0) {
      detectedHardwareHz = Math.round(window.screen.refreshRate);
      isProbed = true;
      return;
    }

    let frames = 0;
    let startTime = 0;

    function sample(timestamp) {
      if (!startTime) {
        startTime = timestamp;
        requestAnimationFrame(sample);
        return;
      }

      frames++;
      const elapsed = timestamp - startTime;

      if (frames < 20 && elapsed < 250) {
        requestAnimationFrame(sample);
      } else {
        const measuredFps = Math.round((frames * 1000) / elapsed);
        if (measuredFps >= 105) {
          detectedHardwareHz = 120;
        } else if (measuredFps >= 80) {
          detectedHardwareHz = 90;
        } else {
          detectedHardwareHz = 60;
        }
        isProbed = true;
        apply();
      }
    }

    requestAnimationFrame(sample);
  }

  /**
   * Normalizes saved mode value to supported options
   */
  function normalizeMode(rawMode) {
    if (!rawMode) return MODES.AUTO;
    if (rawMode === '120fps' || rawMode === '120' || rawMode === 'high') return MODES.FPS_120;
    if (rawMode === '60fps' || rawMode === '60' || rawMode === 'standard') return MODES.FPS_60;
    if (rawMode === '30fps' || rawMode === '30' || rawMode === 'lite') return MODES.FPS_30;
    return MODES.AUTO;
  }

  function getMode() {
    if (typeof Storage !== 'undefined' && typeof Storage.getPerformanceMode === 'function') {
      return normalizeMode(Storage.getPerformanceMode());
    }
    return MODES.AUTO;
  }

  function setMode(mode) {
    const validMode = normalizeMode(mode);
    if (typeof Storage !== 'undefined' && typeof Storage.setPerformanceMode === 'function') {
      Storage.setPerformanceMode(validMode);
    }
    apply();
    return validMode;
  }

  function cycleMode() {
    const current = getMode();
    const idx = MODE_ORDER.indexOf(current);
    const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    setMode(nextMode);
    return nextMode;
  }

  function getHardwareRefreshRate() {
    return detectedHardwareHz;
  }

  function is120HzSupported() {
    return detectedHardwareHz >= 110;
  }

  /**
   * Returns user-facing label for current or given mode, ensuring 60Hz displays are accurately labelled
   */
  function getDisplayLabel(mode) {
    const currentMode = normalizeMode(mode || getMode());
    const hwHz = getHardwareRefreshRate();

    switch (currentMode) {
      case MODES.FPS_120:
        if (hwHz < 100) {
          return `120 FPS (Display ${hwHz}Hz Cap)`;
        }
        return '120 FPS (Ultra Smooth)';
      case MODES.FPS_60:
        return '60 FPS (Smooth)';
      case MODES.FPS_30:
        return '30 FPS (Battery Saver)';
      case MODES.AUTO:
      default:
        if (hwHz >= 110) {
          return 'Auto (120Hz ProMotion)';
        }
        return `Auto (${hwHz} FPS)`;
    }
  }

  /**
   * Returns numeric target framerate for animation loops / canvas
   */
  function getFramerateTarget() {
    const mode = getMode();
    const hwHz = getHardwareRefreshRate();

    if (mode === MODES.FPS_120) {
      return Math.min(120, hwHz >= 100 ? 120 : hwHz);
    }
    if (mode === MODES.FPS_60) {
      return 60;
    }
    if (mode === MODES.FPS_30) {
      return 30;
    }
    // Auto
    return hwHz >= 110 ? 120 : 60;
  }

  /**
   * Applies performance mode classes and CSS properties to DOM
   */
  function isLowEndDevice() {
    try {
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
      const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
      return cores <= 4 || mem <= 3;
    } catch (_) { return false; }
  }

  function apply() {
    if (typeof document === 'undefined') return;

    const mode = getMode();
    const body = document.body;
    if (!body) return;

    // Reset mode classes
    ['perf-auto', 'perf-120fps', 'perf-60fps', 'perf-30fps', 'perf-lite'].forEach(c => {
      body.classList.remove(c);
    });

    // Apply specific class
    body.classList.add(`perf-${mode}`);
    if (mode === MODES.FPS_30) {
      body.classList.add('perf-lite'); // backwards-compatible token
    }
    // Auto: phones with few cores or little memory skip blur and decorative motion
    if (String(mode) === 'auto' && isLowEndDevice()) {
      body.classList.add('perf-lite');
    }

    const targetFps = getFramerateTarget();
    body.style.setProperty('--ui-target-fps', `${targetFps}`);

    // Update settings badge if present in DOM
    const perfValEl = document.getElementById('settings-perf-val');
    if (perfValEl) {
      perfValEl.textContent = getDisplayLabel(mode);
    }
  }

  // Initialize display refresh rate sampling
  if (typeof window !== 'undefined') {
    probeHardwareRefreshRate();
  }

  return {
    MODES,
    MODE_ORDER,
    getMode,
    setMode,
    cycleMode,
    getHardwareRefreshRate,
    is120HzSupported,
    getDisplayLabel,
    getFramerateTarget,
    apply,
    probeHardwareRefreshRate
  };
})();

if (typeof window !== 'undefined') {
  window.PerformanceManager = PerformanceManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceManager;
}

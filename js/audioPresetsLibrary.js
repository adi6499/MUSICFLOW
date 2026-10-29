// ==========================================================================
// MUSICFLOW — PROFESSIONAL AUDIO PRESETS LIBRARY
// 19 Curated Pro-Grade Presets with Multi-Band EQ, Bass Enhancement,
// Exciter, Compressor, Limiter, Stereo Tools & Reverb
// ==========================================================================

const AudioPresetsLibrary = (() => {

  // Engine's 7-Band EQ Center Frequencies (Hz) — must match audioEffectsEngine.js
  const ENGINE_FREQUENCIES = [60, 150, 400, 1000, 2400, 6000, 15000];

  // ─── RAW PRESET DATA (19 Presets) ───────────────────────────────────
  const PRO_PRESETS_RAW = {
    'Audiophile 3D Premium': {
      eqBands: [
        { frequency: 32, gain: 3.0, q: 1.4 },
        { frequency: 64, gain: 2.0, q: 1.4 },
        { frequency: 125, gain: 1.5, q: 1.4 },
        { frequency: 250, gain: -1.0, q: 1.4 },
        { frequency: 500, gain: -1.5, q: 1.4 },
        { frequency: 1000, gain: 0.0, q: 1.4 },
        { frequency: 2000, gain: 1.5, q: 1.4 },
        { frequency: 4000, gain: 3.0, q: 1.4 },
        { frequency: 8000, gain: 5.0, q: 1.4 },
        { frequency: 16000, gain: 6.5, q: 1.4 }
      ],
      bassEnhancer: { amount: 7.5, floor: 100, scope: 150, harmonics: 8.5 },
      exciter: { amount: 7.0, scope: 5500, harmonics: 8.0 },
      compressor: null,
      limiter: { threshold: -0.5, attack: 5, release: 5, inputGain: 2.5 },
      stereoTools: { sideLevel: 3.0, stereoBase: 0.4, delay: 0 },
      reverb: null
    },

    'Bass Boosted': {
      eqBands: [
        { frequency: 32, gain: 4.0, q: 1.5 },
        { frequency: 64, gain: 2.0, q: 1.5 },
        { frequency: 125, gain: 1.0, q: 1.5 },
        { frequency: 250, gain: 0.0, q: 1.5 },
        { frequency: 500, gain: -1.0, q: 1.5 },
        { frequency: 1000, gain: -2.0, q: 1.5 },
        { frequency: 2000, gain: 0.0, q: 1.5 },
        { frequency: 4000, gain: 2.0, q: 1.5 },
        { frequency: 8000, gain: 3.0, q: 1.5 },
        { frequency: 16000, gain: 3.0, q: 1.5 }
      ],
      bassEnhancer: { amount: 5.0, floor: 20, scope: 80, harmonics: 8.5 },
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Bass Enhancing + Perfect EQ': {
      eqBands: [
        { frequency: 32, gain: 4.0, q: 1.5 },
        { frequency: 64, gain: 2.0, q: 1.5 },
        { frequency: 125, gain: 1.0, q: 1.5 },
        { frequency: 250, gain: 0.0, q: 1.5 },
        { frequency: 500, gain: -1.0, q: 1.5 },
        { frequency: 1000, gain: -2.0, q: 1.5 },
        { frequency: 2000, gain: 0.0, q: 1.5 },
        { frequency: 4000, gain: 2.0, q: 1.5 },
        { frequency: 8000, gain: 3.0, q: 1.5 },
        { frequency: 16000, gain: 3.0, q: 1.5 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Bass Rich Universal': {
      eqBands: [
        { frequency: 30, gain: 5.0, q: 0.7 },
        { frequency: 60, gain: 6.0, q: 0.8 },
        { frequency: 120, gain: 4.0, q: 1.0 },
        { frequency: 250, gain: 1.0, q: 1.2 },
        { frequency: 500, gain: -1.5, q: 1.4 },
        { frequency: 1000, gain: -0.5, q: 1.4 },
        { frequency: 2000, gain: 2.0, q: 1.2 },
        { frequency: 4000, gain: 3.0, q: 1.0 },
        { frequency: 8000, gain: 2.5, q: 1.2 },
        { frequency: 16000, gain: 3.0, q: 0.8 }
      ],
      bassEnhancer: { amount: 5.0, floor: 60, scope: 100, harmonics: 10.0 },
      exciter: null,
      compressor: { threshold: -20, ratio: 2.5, attack: 25, release: 250, makeup: 2.5, knee: -6 },
      limiter: { threshold: -0.3, attack: 5, release: 5, inputGain: 0 },
      stereoTools: { sideLevel: 1.5, stereoBase: 0.25, delay: 0 },
      reverb: null
    },

    'Boosted': {
      eqBands: [
        { frequency: 32, gain: 5.0, q: 1.5 },
        { frequency: 64, gain: 5.0, q: 1.5 },
        { frequency: 125, gain: 0.0, q: 1.5 },
        { frequency: 250, gain: 0.0, q: 1.5 },
        { frequency: 500, gain: 1.0, q: 1.5 },
        { frequency: 1000, gain: 1.0, q: 1.5 },
        { frequency: 2000, gain: 2.0, q: 1.5 },
        { frequency: 4000, gain: 4.0, q: 1.5 },
        { frequency: 8000, gain: 3.0, q: 1.5 },
        { frequency: 16000, gain: 2.0, q: 1.5 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Dolby Atmos': {
      eqBands: [
        { frequency: 25, gain: 4.5, q: 0.7 },
        { frequency: 60, gain: 3.8, q: 0.9 },
        { frequency: 125, gain: 2.2, q: 1.0 },
        { frequency: 250, gain: -1.5, q: 1.2 },
        { frequency: 500, gain: -0.8, q: 1.2 },
        { frequency: 1000, gain: 1.0, q: 1.5 },
        { frequency: 2000, gain: 2.0, q: 1.5 },
        { frequency: 4000, gain: 2.8, q: 1.2 },
        { frequency: 8000, gain: 3.5, q: 1.0 },
        { frequency: 16000, gain: 4.0, q: 0.8 }
      ],
      bassEnhancer: { amount: 5.0, floor: 100, scope: 150, harmonics: 8.5 },
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: { sideLevel: 0, stereoBase: 0, delay: 2.05 },
      reverb: { amount: -12, decayTime: 1.5, predelay: 14, roomSize: 'Large' }
    },

    'Headphone Cinema': {
      eqBands: [
        { frequency: 25, gain: 5.5, q: 0.6 },
        { frequency: 50, gain: 5.0, q: 0.7 },
        { frequency: 100, gain: 3.0, q: 0.9 },
        { frequency: 200, gain: 0.5, q: 1.2 },
        { frequency: 400, gain: -1.5, q: 1.4 },
        { frequency: 800, gain: -1.0, q: 1.4 },
        { frequency: 1500, gain: 2.5, q: 1.2 },
        { frequency: 3000, gain: 3.0, q: 1.0 },
        { frequency: 6000, gain: 1.5, q: 1.2 },
        { frequency: 12000, gain: 2.0, q: 0.8 }
      ],
      bassEnhancer: { amount: 6.0, floor: 80, scope: 120, harmonics: 9.0 },
      exciter: null,
      compressor: { threshold: -24, ratio: 3, attack: 20, release: 200, makeup: 3, knee: -6 },
      limiter: { threshold: -0.3, attack: 5, release: 5, inputGain: 0 },
      stereoTools: { sideLevel: 2.5, stereoBase: 0.35, delay: 0 },
      reverb: { amount: -14, decayTime: 1.8, predelay: 18, roomSize: 'Large' }
    },

    'Headphone Music HD': {
      eqBands: [
        { frequency: 30, gain: 3.5, q: 0.7 },
        { frequency: 60, gain: 3.0, q: 0.8 },
        { frequency: 120, gain: 1.5, q: 1.0 },
        { frequency: 250, gain: -1.5, q: 1.4 },
        { frequency: 500, gain: -0.5, q: 1.4 },
        { frequency: 1000, gain: 0.5, q: 1.5 },
        { frequency: 2000, gain: 1.5, q: 1.5 },
        { frequency: 4000, gain: 2.5, q: 1.2 },
        { frequency: 8000, gain: 3.5, q: 1.0 },
        { frequency: 16000, gain: 4.0, q: 0.7 }
      ],
      bassEnhancer: { amount: 5.0, floor: 100, scope: 140, harmonics: 8.5 },
      exciter: { amount: 5.0, scope: 6000, harmonics: 7.5 },
      compressor: null,
      limiter: { threshold: -0.3, attack: 5, release: 5, inputGain: 0 },
      stereoTools: { sideLevel: 2.0, stereoBase: 0.3, delay: 0 },
      reverb: null
    },

    'JBL Perfect Universal': {
      eqBands: [
        { frequency: 32, gain: 4.5, q: 1.0 },
        { frequency: 64, gain: 4.0, q: 1.1 },
        { frequency: 125, gain: 0.0, q: 1.2 },
        { frequency: 250, gain: -1.5, q: 1.4 },
        { frequency: 500, gain: -0.5, q: 1.4 },
        { frequency: 1000, gain: 1.5, q: 1.2 },
        { frequency: 2000, gain: 2.5, q: 1.2 },
        { frequency: 4000, gain: 2.0, q: 1.2 },
        { frequency: 8000, gain: 0.5, q: 1.4 },
        { frequency: 16000, gain: 3.0, q: 0.9 }
      ],
      bassEnhancer: { amount: 7.0, floor: 65, scope: 130, harmonics: 9.0 },
      exciter: { amount: 5.0, scope: 4500, harmonics: 7.5 },
      compressor: { threshold: -18, ratio: 2, attack: 20, release: 200, makeup: 2, knee: -6 },
      limiter: { threshold: -0.2, attack: 5, release: 5, inputGain: 2 },
      stereoTools: null,
      reverb: null
    },

    'JBL Pure Bass & Clarity': {
      eqBands: [
        { frequency: 32, gain: 8.0, q: 0.8 },
        { frequency: 64, gain: 6.0, q: 1.0 },
        { frequency: 125, gain: 1.0, q: 1.2 },
        { frequency: 250, gain: -2.0, q: 1.4 },
        { frequency: 500, gain: -1.0, q: 1.4 },
        { frequency: 1000, gain: 2.5, q: 1.2 },
        { frequency: 2000, gain: 3.5, q: 1.1 },
        { frequency: 4000, gain: 1.5, q: 1.3 },
        { frequency: 8000, gain: -1.5, q: 1.6 },
        { frequency: 16000, gain: 4.0, q: 0.8 }
      ],
      bassEnhancer: { amount: 8.0, floor: 40, scope: 110, harmonics: 10 },
      exciter: { amount: 6.0, scope: 5000, harmonics: 8.0 },
      compressor: null,
      limiter: { threshold: -0.2, attack: 5, release: 5, inputGain: 2 },
      stereoTools: { sideLevel: 2.0, stereoBase: 0.3, delay: 0 },
      reverb: null
    },

    'Laptop Speakers Loud & Deep': {
      eqBands: [
        { frequency: 32, gain: -12.0, q: 1.4 },
        { frequency: 64, gain: -4.0, q: 1.4 },
        { frequency: 125, gain: 4.0, q: 1.2 },
        { frequency: 250, gain: 2.5, q: 1.4 },
        { frequency: 500, gain: -1.0, q: 1.4 },
        { frequency: 1000, gain: 1.5, q: 1.2 },
        { frequency: 2000, gain: 2.5, q: 1.2 },
        { frequency: 4000, gain: 3.5, q: 1.2 },
        { frequency: 8000, gain: 4.0, q: 1.4 },
        { frequency: 16000, gain: 4.5, q: 0.9 }
      ],
      bassEnhancer: { amount: 8.0, floor: 80, scope: 150, harmonics: 10 },
      exciter: { amount: 7.0, scope: 5500, harmonics: 8.0 },
      compressor: null,
      limiter: { threshold: -0.2, attack: 5, release: 5, inputGain: 3.5 },
      stereoTools: null,
      reverb: null
    },

    'Laptop Speakers Optimized': {
      eqBands: [
        { frequency: 32, gain: -15.0, q: 1.4 },
        { frequency: 64, gain: -5.0, q: 1.4 },
        { frequency: 125, gain: 4.0, q: 1.4 },
        { frequency: 250, gain: 2.0, q: 1.4 },
        { frequency: 500, gain: -1.0, q: 1.4 },
        { frequency: 1000, gain: 0.0, q: 1.4 },
        { frequency: 2000, gain: 1.5, q: 1.4 },
        { frequency: 4000, gain: 3.0, q: 1.4 },
        { frequency: 8000, gain: 4.0, q: 1.4 },
        { frequency: 16000, gain: 5.0, q: 1.4 }
      ],
      bassEnhancer: null,
      exciter: { amount: 5.0, scope: 5500, harmonics: 8.0 },
      compressor: null,
      limiter: { threshold: -0.2, attack: 5, release: 5, inputGain: 4 },
      stereoTools: null,
      reverb: null
    },

    'Perfect EQ': {
      eqBands: [
        { frequency: 32, gain: 4.0, q: 1.5 },
        { frequency: 64, gain: 2.0, q: 1.5 },
        { frequency: 125, gain: 1.0, q: 1.5 },
        { frequency: 250, gain: 0.0, q: 1.5 },
        { frequency: 500, gain: -1.0, q: 1.5 },
        { frequency: 1000, gain: -2.0, q: 1.5 },
        { frequency: 2000, gain: 0.0, q: 1.5 },
        { frequency: 4000, gain: 2.0, q: 1.5 },
        { frequency: 8000, gain: 3.0, q: 1.5 },
        { frequency: 16000, gain: 3.0, q: 1.5 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Premium Loud & Clear': {
      eqBands: [
        { frequency: 32, gain: 6.0, q: 1.5 },
        { frequency: 64, gain: 4.5, q: 1.5 },
        { frequency: 125, gain: 2.0, q: 1.5 },
        { frequency: 250, gain: -1.0, q: 1.5 },
        { frequency: 500, gain: -2.0, q: 1.5 },
        { frequency: 1000, gain: -1.0, q: 1.5 },
        { frequency: 2000, gain: 1.0, q: 1.5 },
        { frequency: 4000, gain: 3.0, q: 1.5 },
        { frequency: 8000, gain: 4.5, q: 1.5 },
        { frequency: 16000, gain: 5.0, q: 1.5 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Speaker Sync': {
      eqBands: [
        { frequency: 30, gain: 0.0, q: 0.7 },
        { frequency: 120, gain: 0.5, q: 1.0 },
        { frequency: 300, gain: -0.5, q: 1.2 },
        { frequency: 1000, gain: 0.5, q: 1.5 },
        { frequency: 5000, gain: 0.5, q: 1.2 },
        { frequency: 18000, gain: 0.0, q: 0.7 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: null,
      stereoTools: { sideLevel: 0, stereoBase: 0, delay: 0 },
      reverb: null
    },

    'Ultimate Perfect Audio': {
      eqBands: [
        { frequency: 32, gain: 4.5, q: 1.0 },
        { frequency: 64, gain: 4.0, q: 1.1 },
        { frequency: 125, gain: 0.0, q: 1.2 },
        { frequency: 250, gain: -1.5, q: 1.4 },
        { frequency: 500, gain: -0.5, q: 1.4 },
        { frequency: 1000, gain: 1.5, q: 1.2 },
        { frequency: 2000, gain: 2.5, q: 1.2 },
        { frequency: 4000, gain: 2.0, q: 1.2 },
        { frequency: 8000, gain: 0.5, q: 1.4 },
        { frequency: 16000, gain: 3.0, q: 0.9 }
      ],
      bassEnhancer: { amount: 7.0, floor: 65, scope: 130, harmonics: 9.0 },
      exciter: { amount: 5.0, scope: 4500, harmonics: 7.5 },
      compressor: { threshold: -18, ratio: 2, attack: 20, release: 200, makeup: 2, knee: -6 },
      limiter: { threshold: -0.2, attack: 5, release: 5, inputGain: 2 },
      stereoTools: null,
      reverb: null
    },

    'Advanced Auto Gain': {
      eqBands: [
        { frequency: 22.6, gain: 0, q: 4.36 },
        { frequency: 28.4, gain: 0, q: 4.36 },
        { frequency: 35.8, gain: 0, q: 4.36 },
        { frequency: 45.1, gain: 0, q: 4.36 },
        { frequency: 56.7, gain: 0, q: 4.36 },
        { frequency: 71.4, gain: 0, q: 4.36 },
        { frequency: 89.9, gain: 0, q: 4.36 },
        { frequency: 113.2, gain: 4, q: 4.36 },
        { frequency: 142.5, gain: 4, q: 4.36 },
        { frequency: 179.4, gain: 4, q: 4.36 },
        { frequency: 225.9, gain: 4, q: 4.36 },
        { frequency: 284.4, gain: 4, q: 4.36 },
        { frequency: 358.0, gain: 4, q: 4.36 },
        { frequency: 450.7, gain: 0, q: 4.36 },
        { frequency: 567.4, gain: 0, q: 4.36 },
        { frequency: 714.3, gain: -1, q: 4.36 },
        { frequency: 899.3, gain: -2, q: 4.36 },
        { frequency: 1132.2, gain: -3.6, q: 4.36 },
        { frequency: 1425.3, gain: -2.5, q: 4.36 },
        { frequency: 1794.3, gain: -1.5, q: 4.36 },
        { frequency: 2258.9, gain: 0, q: 4.36 },
        { frequency: 2843.8, gain: 0, q: 4.36 },
        { frequency: 3580.2, gain: 0, q: 4.36 },
        { frequency: 4507.1, gain: 0, q: 4.36 },
        { frequency: 5674.2, gain: 0, q: 4.36 },
        { frequency: 7143.4, gain: 0, q: 4.36 },
        { frequency: 8992.9, gain: 0, q: 4.36 },
        { frequency: 11321.5, gain: 0, q: 4.36 },
        { frequency: 14252.9, gain: 0, q: 4.36 },
        { frequency: 17943.3, gain: 0, q: 4.36 }
      ],
      bassEnhancer: null,
      exciter: { amount: 6.0, scope: 5500, harmonics: 8.0 },
      compressor: null,
      limiter: { threshold: 0, attack: 5, release: 5, inputGain: 0 },
      stereoTools: null,
      reverb: null
    },

    'Loudness+Autogain': {
      eqBands: [
        { frequency: 22.6, gain: 0, q: 4.36 },
        { frequency: 28.4, gain: 0, q: 4.36 },
        { frequency: 35.8, gain: 0, q: 4.36 },
        { frequency: 45.1, gain: 0, q: 4.36 },
        { frequency: 56.7, gain: 0, q: 4.36 },
        { frequency: 71.4, gain: 0, q: 4.36 },
        { frequency: 89.9, gain: 0, q: 4.36 },
        { frequency: 113.2, gain: 4, q: 4.36 },
        { frequency: 142.5, gain: 4, q: 4.36 },
        { frequency: 179.4, gain: 4, q: 4.36 },
        { frequency: 225.9, gain: 4, q: 4.36 },
        { frequency: 284.4, gain: 4, q: 4.36 },
        { frequency: 358.0, gain: 4, q: 4.36 },
        { frequency: 450.7, gain: 0, q: 4.36 },
        { frequency: 567.4, gain: 0, q: 4.36 },
        { frequency: 714.3, gain: -1, q: 4.36 },
        { frequency: 899.3, gain: -2, q: 4.36 },
        { frequency: 1132.2, gain: -3.6, q: 4.36 },
        { frequency: 1425.3, gain: -2.5, q: 4.36 },
        { frequency: 1794.3, gain: -1.5, q: 4.36 },
        { frequency: 2258.9, gain: 0, q: 4.36 },
        { frequency: 2843.8, gain: 0, q: 4.36 },
        { frequency: 3580.2, gain: 0, q: 4.36 },
        { frequency: 4507.1, gain: 0, q: 4.36 },
        { frequency: 5674.2, gain: 0, q: 4.36 },
        { frequency: 7143.4, gain: 0, q: 4.36 },
        { frequency: 8992.9, gain: 0, q: 4.36 },
        { frequency: 11321.5, gain: 0, q: 4.36 },
        { frequency: 14252.9, gain: 0, q: 4.36 },
        { frequency: 17943.3, gain: 0, q: 4.36 }
      ],
      bassEnhancer: { amount: 0, floor: 20, scope: 100, harmonics: 7.9 },
      exciter: null,
      compressor: { threshold: -10, ratio: 5, attack: 130, release: 600, makeup: 0, knee: -23.9 },
      limiter: null,
      stereoTools: null,
      reverb: null
    },

    'Bass Enhancing + Perfect EQ LL': {
      eqBands: [
        { frequency: 32, gain: 4.0, q: 1.5 },
        { frequency: 64, gain: 2.0, q: 1.5 },
        { frequency: 125, gain: 1.0, q: 1.5 },
        { frequency: 250, gain: 0.0, q: 1.5 },
        { frequency: 500, gain: -1.0, q: 1.5 },
        { frequency: 1000, gain: -2.0, q: 1.5 },
        { frequency: 2000, gain: 0.0, q: 1.5 },
        { frequency: 4000, gain: 2.0, q: 1.5 },
        { frequency: 8000, gain: 3.0, q: 1.5 },
        { frequency: 16000, gain: 3.0, q: 1.5 }
      ],
      bassEnhancer: null,
      exciter: null,
      compressor: null,
      limiter: { threshold: 0, attack: 5, release: 5, inputGain: 0 },
      stereoTools: null,
      reverb: null
    }
  };

  /**
   * Map N-band raw preset EQ to the engine's 7 fixed frequency bands using
   * weighted nearest-neighbor interpolation (log-frequency domain).
   * Also extracts bass/treble/vocal boost and spatial settings.
   */
  function mapPresetToEngine(rawPreset) {
    if (!rawPreset || !rawPreset.eqBands || rawPreset.eqBands.length === 0) {
      return null;
    }

    const bands = rawPreset.eqBands;
    const mappedBands = ENGINE_FREQUENCIES.map(targetFreq => {
      const logTarget = Math.log10(targetFreq);

      // Find the two nearest bands in log-frequency space
      let bestDist = Infinity;
      let totalWeight = 0;
      let weightedGain = 0;

      for (const band of bands) {
        const logBand = Math.log10(band.frequency);
        const dist = Math.abs(logBand - logTarget);
        // Gaussian-ish weighting: closer bands contribute more
        // Narrower window (0.3 decades) keeps it from smearing too much
        const weight = Math.exp(-(dist * dist) / (2 * 0.3 * 0.3));
        if (weight > 0.01) { // Skip negligible contributions
          totalWeight += weight;
          weightedGain += band.gain * weight;
        }
      }

      return totalWeight > 0 ? Math.round(weightedGain / totalWeight * 10) / 10 : 0;
    });

    // Map bassEnhancer → bassBoost (0-12 dB)
    let bassBoost = 0;
    if (rawPreset.bassEnhancer && rawPreset.bassEnhancer.amount > 0) {
      bassBoost = Math.min(12, Math.round(rawPreset.bassEnhancer.amount * 1.2));
    }

    // Map exciter → trebleBoost (0-12 dB)
    let trebleBoost = 0;
    if (rawPreset.exciter && rawPreset.exciter.amount > 0) {
      trebleBoost = Math.min(12, Math.round(rawPreset.exciter.amount * 0.8));
    }

    // Map compressor presence → slight vocal boost
    let vocalBoost = 0;
    if (rawPreset.compressor && rawPreset.compressor.ratio > 1.5) {
      vocalBoost = Math.min(8, Math.round(rawPreset.compressor.ratio));
    }

    // Map stereoTools → spatial level
    let spatial = 'OFF';
    if (rawPreset.stereoTools) {
      const wideness = (rawPreset.stereoTools.sideLevel || 0) + (rawPreset.stereoTools.stereoBase || 0) * 5;
      if (wideness >= 3) spatial = 'HIGH';
      else if (wideness >= 1.5) spatial = 'MEDIUM';
      else if (wideness > 0 || rawPreset.stereoTools.delay > 0) spatial = 'LOW';
    }
    if (rawPreset.reverb) {
      if (spatial === 'OFF') spatial = 'MEDIUM';
      else if (spatial === 'LOW') spatial = 'HIGH';
    }

    return {
      bands: mappedBands,
      bassBoost,
      trebleBoost,
      vocalBoost,
      spatial,
      // Preserve raw data for display/debug
      _raw: {
        bassEnhancer: rawPreset.bassEnhancer,
        exciter: rawPreset.exciter,
        compressor: rawPreset.compressor,
        limiter: rawPreset.limiter,
        stereoTools: rawPreset.stereoTools,
        reverb: rawPreset.reverb
      }
    };
  }

  /**
   * Returns all 19 pro presets mapped to the engine's 7-band format,
   * keyed by preset name. Ready to be consumed by AudioEffectsEngine.
   */
  function getMappedProPresets() {
    const mapped = {};
    for (const [name, raw] of Object.entries(PRO_PRESETS_RAW)) {
      const result = mapPresetToEngine(raw);
      if (result) {
        mapped[name] = result;
      }
    }
    return mapped;
  }

  /**
   * Returns all pro preset names as an array.
   */
  function getProPresetNames() {
    return Object.keys(PRO_PRESETS_RAW);
  }

  /**
   * Returns the raw preset data for a given name.
   */
  function getRawPreset(name) {
    return PRO_PRESETS_RAW[name] || null;
  }

  return {
    getMappedProPresets,
    getProPresetNames,
    getRawPreset,
    mapPresetToEngine,
    PRO_PRESETS_RAW
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioPresetsLibrary;
}

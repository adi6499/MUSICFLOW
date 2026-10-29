// ==========================================================================
// MUSICFLOW — THEME MANAGER (one design, light + dark appearance, one accent)
// MusicFlow has one design: the Fluent look (css/fluent.css, both appearances
// in one sheet). The user chooses the appearance (System / Light / Dark) and
// the accent colour (the Windows set) in Settings. This module keeps the old
// API surface (presets, styles, neumorphism) so nothing else needs to change;
// every style call resolves to the one design. It also owns the
// artwork-derived "dynamic colour" used by the player.
// ==========================================================================

const ThemeManager = (() => {
  const DESIGN_STYLE = 'fluent';
  const DESIGN_CLASS = 'theme-fluent';
  const APPEARANCE_KEY = 'mf_appearance';          // 'system' | 'light' | 'dark'
  const ACCENT_KEY = 'mf_accent';                  // '#RRGGBB'
  const APPEARANCES = ['system', 'light', 'dark'];
  const META_COLOR = { light: '#FFFFFF', dark: '#0E0E0E' };

  const PRESETS = [
    { id: 'green', name: 'Xbox green', color: '#107C10', isDefault: true },
    { id: 'blue', name: 'Blue', color: '#0078D4' },
    { id: 'purple', name: 'Purple', color: '#881798' },
    { id: 'red', name: 'Red', color: '#E81123' },
    { id: 'orange', name: 'Orange', color: '#F7630C' },
    { id: 'teal', name: 'Teal', color: '#038387' },
    { id: 'leaf', name: 'Leaf', color: '#86C33E' }
  ];
  const DEFAULT_THEME = PRESETS[0];
  let currentTheme = { ...DEFAULT_THEME };
  let mediaQuery = null;

  // ---- colour helpers (kept for callers such as the waveform and dynamic glow) ----
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 16, g: 124, b: 16 };
    let clean = hex.replace('#', '').trim();
    if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
    if (clean.length !== 6 || /[^0-9a-f]/i.test(clean)) return { r: 16, g: 124, b: 16 };
    const num = parseInt(clean, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function calculateContrastColor(hexColor) {
    const rgb = hexToRgb(hexColor);
    return getLuminance(rgb.r, rgb.g, rgb.b) > 0.45 ? '#000000' : '#FFFFFF';
  }

  function isHex(v) { return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()); }

  // Accepts a preset id, a preset object, or a hex string; anything else keeps the current accent.
  function resolveTheme(themeOrHex) {
    if (themeOrHex && typeof themeOrHex === 'object' && isHex(themeOrHex.color)) {
      const preset = PRESETS.find(p => p.color.toLowerCase() === themeOrHex.color.toLowerCase());
      return preset || { id: themeOrHex.id || 'custom', name: themeOrHex.name || 'Custom', color: themeOrHex.color.toUpperCase() };
    }
    if (isHex(themeOrHex)) {
      const hex = themeOrHex.trim().toUpperCase();
      return PRESETS.find(p => p.color.toUpperCase() === hex) || { id: 'custom', name: 'Custom', color: hex };
    }
    if (typeof themeOrHex === 'string') {
      const preset = PRESETS.find(p => p.id === themeOrHex);
      if (preset) return preset;
    }
    return currentTheme;
  }

  function getCSSVariables(themeOrHex) {
    const color = resolveTheme(themeOrHex).color;
    const rgb = hexToRgb(color);
    const strongHex = rgbToHex(rgb.r * 0.85, rgb.g * 0.85, rgb.b * 0.85);
    return {
      '--accent': color,
      '--accent-rgb': `${rgb.r}, ${rgb.g}, ${rgb.b}`,
      '--accent-soft': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
      '--accent-strong': strongHex,
      '--accent-glow': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.40)`,
      '--accent-text': calculateContrastColor(color),
      '--accent-border': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.30)`,
      '--accent-surface': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`,
      '--color-primary': color,
      '--color-primary-glow': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.40)`,
      '--color-primary-dark': strongHex,
      '--dynamic-color': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.32)`
    };
  }

  function applyVariablesToDOM(vars) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    Object.entries(vars).forEach(([prop, val]) => root.style.setProperty(prop, val));
  }

  function dispatch(name, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function setMetaColor(color) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && typeof meta.setAttribute === 'function') meta.setAttribute('content', color);
  }

  // ---- public API (compatible with the previous multi-theme manager) ----
  function getPresets() { return PRESETS.map(p => ({ ...p })); }
  function getTheme() { return { ...currentTheme }; }

  function setTheme(themeOrHex) {
    currentTheme = { ...resolveTheme(themeOrHex) };
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(ACCENT_KEY, currentTheme.color); } catch (_) {}
    applyVariablesToDOM(getCSSVariables(currentTheme));
    if (typeof UI !== 'undefined' && typeof UI.onThemeChange === 'function') UI.onThemeChange(currentTheme);
    if (typeof App !== 'undefined' && typeof App.redrawSeekBarWave === 'function') { try { App.redrawSeekBarWave(); } catch (_) {} }
    dispatch('mf_theme_change', currentTheme);
    return getTheme();
  }

  function setAccentColor(hex) { return setTheme(hex); }

  function setDynamicColor(colorOrUrl) {
    if (!colorOrUrl) { resetDynamicColor(); return; }
    if (typeof colorOrUrl === 'string' && (colorOrUrl.startsWith('#') || colorOrUrl.startsWith('rgb'))) {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.style.setProperty('--dynamic-color', colorOrUrl);
      }
      return;
    }
    resetDynamicColor();
  }

  function resetDynamicColor() {
    const rgb = hexToRgb(currentTheme.color);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--dynamic-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.32)`);
    }
  }

  function getThemeStyle() { return DESIGN_STYLE; }
  function isNeumorphic() { return false; }

  // ---- appearance: system / light / dark ----
  function getAppearance() {
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(APPEARANCE_KEY);
        if (APPEARANCES.includes(v)) return v;
      }
    } catch (_) {}
    return 'system';
  }

  function systemPrefersLight() {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return !!window.matchMedia('(prefers-color-scheme: light)').matches;
      }
    } catch (_) {}
    return false;   // no information: stay dark
  }

  function getResolvedAppearance() {
    const mode = getAppearance();
    if (mode === 'light' || mode === 'dark') return mode;
    return systemPrefersLight() ? 'light' : 'dark';
  }

  function applyAppearanceToDOM() {
    if (typeof document === 'undefined') return 'dark';
    const resolved = getResolvedAppearance();
    [document.documentElement, document.body].forEach(el => {
      if (!el || !el.classList) return;
      try {
        el.classList.remove('appearance-light', 'appearance-dark');
        el.classList.add(resolved === 'light' ? 'appearance-light' : 'appearance-dark');
      } catch (_) {}
    });
    setMetaColor(META_COLOR[resolved]);
    try {
      if (typeof window !== 'undefined' && window.AndroidMediaBridge && typeof window.AndroidMediaBridge.setLightSystemBars === 'function') {
        window.AndroidMediaBridge.setLightSystemBars(resolved === 'light');
      }
    } catch (_) {}
    return resolved;
  }

  function setAppearance(mode) {
    const valid = APPEARANCES.includes(mode) ? mode : 'system';
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(APPEARANCE_KEY, valid); } catch (_) {}
    const resolved = applyAppearanceToDOM();
    if (typeof App !== 'undefined' && typeof App.redrawSeekBarWave === 'function') {
      try { App.redrawSeekBarWave(); } catch (_) {}
    }
    dispatch('mf_appearance_change', { mode: valid, resolved });
    return valid;
  }

  function watchSystemAppearance() {
    try {
      if (mediaQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => { if (getAppearance() === 'system') applyAppearanceToDOM(); };
      if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', onChange);
      else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(onChange);
    } catch (_) {}
  }

  function applyThemeStyleToDOM() {
    if (typeof document === 'undefined') return;
    const stale = ['theme-pulse', 'theme-neumorphic', 'theme-neumorphic-dark', 'theme-neumorphic-light', 'theme-apple', 'theme-glass'];
    [document.documentElement, document.body].forEach(el => {
      if (!el || !el.classList) return;
      try { el.classList.remove(...stale); el.classList.add(DESIGN_CLASS); } catch (_) {}
    });
    applyAppearanceToDOM();
  }

  function setThemeStyle() {
    applyThemeStyleToDOM();
    dispatch('mf_theme_style_change', { style: DESIGN_STYLE });
    return DESIGN_STYLE;
  }

  function toggleNeumorphism() { return setThemeStyle(); }
  function reset() { setThemeStyle(); return setTheme(DEFAULT_THEME); }

  function apply() {
    // Forget style choices saved by older versions; keep the appearance and the accent.
    let saved = null;
    try {
      if (typeof localStorage !== 'undefined') {
        ['mf_theme_style', 'mf_style_migrated_pulse', 'mf_user_theme'].forEach(k => localStorage.removeItem(k));
        saved = localStorage.getItem(ACCENT_KEY);
      }
    } catch (_) {}
    currentTheme = { ...(isHex(saved) ? resolveTheme(saved) : DEFAULT_THEME) };
    applyVariablesToDOM(getCSSVariables(currentTheme));
    applyThemeStyleToDOM();
    watchSystemAppearance();
    return getTheme();
  }

  if (typeof window !== 'undefined') {
    try { apply(); } catch (_) {}
  }

  return {
    getPresets,
    getTheme,
    setTheme,
    setAccentColor,
    setDynamicColor,
    resetDynamicColor,
    reset,
    apply,
    getCSSVariables,
    calculateContrastColor,
    getThemeStyle,
    isNeumorphic,
    setThemeStyle,
    toggleNeumorphism,
    applyThemeStyleToDOM,
    getAppearance,
    getResolvedAppearance,
    setAppearance,
    applyAppearanceToDOM
  };
})();

if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}

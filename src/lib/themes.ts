// The colour themes. Each one is a complete, hand-picked palette; the rest of
// the app only ever uses the names (--bg, --ink, --accent…), so adding a theme
// is adding one entry here.
//
// All themes are flat: solid surfaces, hairline borders, one accent. No
// gradients or glows.

export interface Palette {
  id: string;
  name: string;
  kind: 'light' | 'dark';
  /** Page background, bars and cards, raised sheets, wells. */
  bg: string;
  surface: string;
  raised: string;
  sunken: string;
  /** Text: main, secondary, faint. */
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  /** Text drawn on top of the accent colour. */
  accentInk: string;
}

export const PALETTES: Palette[] = [
  // ---- light
  { id: 'paper', name: 'Paper', kind: 'light', bg: '#f4f1ea', surface: '#faf8f3', raised: '#ffffff', sunken: '#ebe7de', ink: '#1e1c19', ink2: '#5b5750', ink3: '#8c877d', accent: '#4b57b8', accentInk: '#ffffff' },
  { id: 'snow', name: 'Snow', kind: 'light', bg: '#ffffff', surface: '#f5f5f7', raised: '#ffffff', sunken: '#ebebee', ink: '#111113', ink2: '#55565c', ink3: '#8a8b92', accent: '#2563eb', accentInk: '#ffffff' },
  { id: 'mist', name: 'Mist', kind: 'light', bg: '#eef2f5', surface: '#f6f8fa', raised: '#ffffff', sunken: '#e1e7ec', ink: '#17202a', ink2: '#4d5b69', ink3: '#808d9a', accent: '#19708f', accentInk: '#ffffff' },
  { id: 'sage', name: 'Sage', kind: 'light', bg: '#eef1ea', surface: '#f6f8f2', raised: '#ffffff', sunken: '#e1e6da', ink: '#1b211a', ink2: '#525c50', ink3: '#848d80', accent: '#3d7a4f', accentInk: '#ffffff' },
  { id: 'blush', name: 'Blush', kind: 'light', bg: '#f7efec', surface: '#fcf6f4', raised: '#ffffff', sunken: '#eee2de', ink: '#2a1c19', ink2: '#6a5550', ink3: '#9b8580', accent: '#b4533c', accentInk: '#ffffff' },
  // ---- dark
  { id: 'ink', name: 'Ink', kind: 'dark', bg: '#141312', surface: '#1b1a18', raised: '#24221f', sunken: '#0f0e0d', ink: '#ede9e2', ink2: '#b0aaa0', ink3: '#7c776f', accent: '#aab2ff', accentInk: '#15173a' },
  { id: 'black', name: 'Black', kind: 'dark', bg: '#000000', surface: '#0d0d0e', raised: '#18181a', sunken: '#000000', ink: '#f2f2f3', ink2: '#a9a9ad', ink3: '#74747a', accent: '#a8c7fa', accentInk: '#0a1d3a' },
  { id: 'midnight', name: 'Midnight', kind: 'dark', bg: '#0e1420', surface: '#141b2a', raised: '#1c2536', sunken: '#0a0f18', ink: '#e6ebf5', ink2: '#a3adc0', ink3: '#6f7a8f', accent: '#7fb2ff', accentInk: '#0a1a33' },
  { id: 'forest', name: 'Forest', kind: 'dark', bg: '#0f1512', surface: '#151d18', raised: '#1d2721', sunken: '#0a0f0c', ink: '#e4ede6', ink2: '#a2b3a7', ink3: '#6d7d72', accent: '#7fd6a3', accentInk: '#082015' },
  { id: 'plum', name: 'Plum', kind: 'dark', bg: '#17111a', surface: '#1e1722', raised: '#281f2d', sunken: '#100b13', ink: '#efe6f1', ink2: '#b5a6ba', ink3: '#807286', accent: '#e2a0c8', accentInk: '#2c0f22' },
  { id: 'mocha', name: 'Mocha', kind: 'dark', bg: '#17120f', surface: '#1f1814', raised: '#2a211b', sunken: '#100c0a', ink: '#f0e7df', ink2: '#b8a99c', ink3: '#84766a', accent: '#e0a66b', accentInk: '#2b1808' },
];

export const DEFAULT_LIGHT = 'paper';
export const DEFAULT_DARK = 'ink';

/** The palette with this id, or the default for that kind when the id is unknown or of the wrong kind. */
export function paletteFor(id: string, kind: 'light' | 'dark'): Palette {
  return (
    PALETTES.find((p) => p.id === id && p.kind === kind) ||
    PALETTES.find((p) => p.id === (kind === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT))!
  );
}

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Every colour variable the stylesheets use, worked out from the palette's nine colours. */
export function cssVars(p: Palette): Record<string, string> {
  const dark = p.kind === 'dark';
  const ink = rgb(p.ink);
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--raised': p.raised,
    '--sunken': p.sunken,
    '--ink': p.ink,
    '--ink-2': p.ink2,
    '--ink-3': p.ink3,
    '--line': `rgba(${ink}, ${dark ? 0.09 : 0.08})`,
    '--line-2': `rgba(${ink}, ${dark ? 0.17 : 0.15})`,
    '--accent': p.accent,
    '--accent-ink': p.accentInk,
    '--accent-soft': `rgba(${rgb(p.accent)}, ${dark ? 0.14 : 0.11})`,
    // Liquid glass: a see-through wash of the theme's own surface colour, and a thin bright rim.
    '--glass': `rgba(${rgb(p.surface)}, ${dark ? 0.3 : 0.32})`,
    '--glass-strong': `rgba(${rgb(p.raised)}, ${dark ? 0.7 : 0.74})`,
    '--glass-edge': dark ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.7)',
    '--danger': dark ? '#f0907c' : '#b0432e',
    '--scrim': dark ? 'rgba(0, 0, 0, 0.6)' : `rgba(${ink}, 0.32)`,
    '--shadow': dark
      ? '0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.36)'
      : `0 1px 2px rgba(${ink}, 0.05), 0 10px 28px rgba(${ink}, 0.08)`,
    '--shadow-art': dark
      ? '0 2px 6px rgba(0, 0, 0, 0.3), 0 20px 48px rgba(0, 0, 0, 0.5)'
      : `0 2px 6px rgba(${ink}, 0.08), 0 18px 44px rgba(${ink}, 0.16)`,
  };
}

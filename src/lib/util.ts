// Small helpers used everywhere. No side effects, safe to import anywhere.

const ENTITY: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", '#39': "'",
};

/** The catalog sends names like `Tu Hai (From &quot;KING&quot;)`. */
export function decode(text: unknown): string {
  if (text == null) return '';
  let s = String(text);
  if (s === 'null' || s === 'undefined') return '';
  if (s.indexOf('&') === -1) return s.trim();
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/&(#x?[0-9a-f]+|[a-z]+|#0?39);/gi, (whole, code: string) => {
      const key = code.toLowerCase();
      if (ENTITY[key]) return ENTITY[key];
      if (key[0] === '#') {
        const n = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole;
      }
      return whole;
    });
  }
  return s.trim();
}

/**
 * Catalog artwork comes in 50, 150 and 500 pixel versions, picked by a size
 * token in the file name. Ask for the smallest one that still looks sharp.
 */
export function img(url: string | undefined, size: 50 | 150 | 500 = 150): string {
  if (!url) return '';
  let out = url.replace(/^http:\/\//, 'https://');
  if (out.indexOf('saavncdn.com') !== -1) {
    out = out.replace(/([-_])(\d{2,3})x\2(?=\.(?:jpe?g|png|webp))/i, `$1${size}x${size}`);
  } else if (out.indexOf('mzstatic.com') !== -1) {
    // Apple podcast artwork: .../600x600bb.jpg
    const px = size === 500 ? 600 : size === 150 ? 200 : 100;
    out = out.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpe?g|png|webp)$/i, `/${px}x${px}bb.$3`);
  }
  return out;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** 215 → "3:35"; 3723 → "1:02:03". */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => (n < 10 ? '0' + n : '' + n);
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** 3723 → "1 hr 2 min" — for totals such as an album's length. */
export function longTime(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function compact(n: number): string {
  if (n >= 1e7) return (n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' crore';
  if (n >= 1e5) return (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' lakh';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function shuffled<T>(list: readonly T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; fn(...args); }, ms);
  };
  run.cancel = () => { if (timer) clearTimeout(timer); timer = undefined; };
  return run;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lower-case, no accents, no punctuation, no "(From …)" tails: for comparing titles. */
export function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((from|feat|ft|with|original|official)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim();
}

/** Title without the soundtrack/feature tail, kept readable (for lyrics lookups). */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](from|feat\.?|ft\.?|with|original|official|lyric|video)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(from|feat|remaster|single|version).*$/i, '')
    .trim();
}

export function firstArtist(artist: string): string {
  return artist.split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0].trim();
}

/** 0…1 — how alike two already-plain()ed strings are (shared words). */
export function alike(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wa = a.split(' ').filter(Boolean);
  const wb = new Set(b.split(' ').filter(Boolean));
  if (!wa.length || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return (2 * hit) / (wa.length + wb.size);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Winding down';
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/** Opened from the phone's home screen (full screen, no browser bars). */
export const isStandalone =
  typeof window !== 'undefined' &&
  ((navigator as { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches);

export const isTouch =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) if (p) out += (out ? ' ' : '') + p;
  return out;
}

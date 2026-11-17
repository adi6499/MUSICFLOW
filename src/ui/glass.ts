// Glass: the floating bars as a magnifying glass.
//
// What passes under the bottom pills (and the wide bars) is shown SHARP and
// BIGGER, and stretches towards the rounded rim, like looking through a thick
// lens. This is the glass from the Expenses app, brought over as it is there.
//
// One number rules it (Settings → Glass, 0…100):
//   Solid    (0)    no glass at all: plain bars
//   Frosted  (30)   milky glass: the page shows through as a soft blur
//   Clear    (100)  the magnifier: no blur, the page reads through, enlarged
//
// The magnifier needs a browser that can bend what is behind an element:
// every Chromium browser (Chrome, Edge, Samsung Internet, the Android app).
// Safari, every iPhone browser and Firefox cannot; they get plain clear glass
// with a light blur instead. Cosmetic only: any failure leaves plain glass.
//
// How: one picture per bar size (a "displacement map": each pixel says where
// to look instead), used through an SVG filter in backdrop-filter. The element
// is handed the filter as --lens and marked data-lens; glass.css does the rest.

import type { RefObject } from 'preact';
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { settings } from '../lib/library';
import { perfLevel } from '../lib/perf';

export type GlassName = 'solid' | 'frosted' | 'clear';
export type LensKind = 'pill' | 'flat';

/** The three named points on the slider. */
export const glassName = (n: number): GlassName => (n < 5 ? 'solid' : n < 55 ? 'frosted' : 'clear');

const hasCss = typeof CSS !== 'undefined' && typeof CSS.supports === 'function';

/** Can this browser draw glass at all? */
export const canGlass =
  hasCss && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));

/**
 * Found by its engine, not its name, so it still works when the browser
 * pretends to be an iPhone (developer tools) or hides its version.
 */
function isChromium(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    if ((window as unknown as { chrome?: unknown }).chrome) return true;
    const brands = (navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands;
    if (brands && brands.some((b) => /Chromium|Chrome|Edge|Opera|Brave/i.test(b.brand))) return true;
  } catch { /* fall through to the name */ }
  const ua = navigator.userAgent || '';
  return /Chrome\/\d+|Chromium\/\d+|EdgA?\/\d+|SamsungBrowser\/\d+/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Can it also magnify what is behind the glass? (Not when the phone is saving data.) */
export const canBend =
  canGlass && isChromium() && !(typeof navigator !== 'undefined' && (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData);

// The same numbers as the Expenses app.
const LOOK: Record<LensKind, { m: number; mx: number; rim: number }> = {
  pill: { m: 1.5, mx: 1.42, rim: 0.31 }, // bottom pills: strongly magnified both ways, big stretch at the rim
  flat: { m: 1.3, mx: 1, rim: 0.3 },     // wide bars: magnified top-to-bottom, stretched at the edges
};

/** Where a pixel at distance u (0 = middle, 1 = rim) shows from: magnified in the middle, stretched near the rim. */
const sampleAt = (u: number, look: { m: number; rim: number }): number => (u - look.rim * u * u * u) / look.m;

function makeMap(w: number, h: number, kind: LensKind): { url: string; scale: number } | null {
  const look = LOOK[kind];
  // A wide bar bends only up and down, the same all the way along: a thin strip is enough.
  const cw = kind === 'flat' ? 4 : w;
  const ox = new Float32Array(cw * h);
  const oy = new Float32Array(cw * h);
  let max = 0.01;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < cw; px++) {
      const x = px + 0.5;
      const y = py + 0.5;
      let dx = 0;
      let dy = 0;
      if (kind === 'flat') {
        const half = h / 2;
        const d = y - half;
        const u = Math.min(1, Math.abs(d) / half);
        dy = Math.sign(d) * sampleAt(u, look) * half - d;
      } else {
        // A pill: distance from its middle line, round at both ends…
        const rad = h / 2;
        const sx = Math.max(rad, Math.min(w - rad, x));
        const vx = x - sx;
        const vy = y - rad;
        const dist = Math.hypot(vx, vy);
        if (dist > 0) {
          const u = Math.min(1, dist / rad);
          const k = (sampleAt(u, look) * rad - dist) / dist;
          dx = vx * k;
          dy = vy * k;
        }
        // …and widened along its length, like one long magnifying glass.
        dx += -(x - w / 2) * (1 - 1 / look.mx);
      }
      const i = py * cw + px;
      ox[i] = dx;
      oy[i] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(cw, h);
  for (let i = 0; i < cw * h; i++) {
    img.data[i * 4] = Math.round(128 + (ox[i] / max) * 127);
    img.data[i * 4 + 1] = Math.round(128 + (oy[i] / max) * 127);
    img.data[i * 4 + 2] = 128;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), scale: Math.round(max * 2 * 100) / 100 };
}

// One filter per size and shape, shared by every bar of that size, and removed
// once no bar uses it (resizing a window would otherwise leave hundreds behind).
const SVG = 'http://www.w3.org/2000/svg';
const made = new Map<string, { id: string; node: Element; users: number }>();
let host: SVGSVGElement | null = null;
let count = 0;

function hostSvg(): SVGSVGElement {
  if (host && host.isConnected) return host;
  host = document.createElementNS(SVG, 'svg');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  host.appendChild(document.createElementNS(SVG, 'defs'));
  document.body.appendChild(host);
  return host;
}

function acquire(key: string, w: number, h: number, kind: LensKind): string {
  const had = made.get(key);
  if (had) { had.users++; return had.id; }
  const map = makeMap(w, h, kind);
  if (!map) return '';
  const id = `mag${++count}`;
  const filter = document.createElementNS(SVG, 'filter');
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  // Without this the map's neutral grey would be read as a small constant shift.
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const picture = document.createElementNS(SVG, 'feImage');
  picture.setAttribute('href', map.url);
  picture.setAttribute('preserveAspectRatio', 'none');
  picture.setAttribute('result', 'm');
  for (const node of [filter, picture]) {
    node.setAttribute('x', '0');
    node.setAttribute('y', '0');
    node.setAttribute('width', String(w));
    node.setAttribute('height', String(h));
  }
  const bend = document.createElementNS(SVG, 'feDisplacementMap');
  bend.setAttribute('in', 'SourceGraphic');
  bend.setAttribute('in2', 'm');
  bend.setAttribute('scale', String(map.scale));
  bend.setAttribute('xChannelSelector', 'R');
  bend.setAttribute('yChannelSelector', 'G');
  filter.appendChild(picture);
  filter.appendChild(bend);
  hostSvg().firstChild!.appendChild(filter);
  made.set(key, { id, node: filter, users: 1 });
  return id;
}

function release(key: string): void {
  const had = made.get(key);
  if (!had || --had.users > 0) return;
  had.node.remove();
  made.delete(key);
}

/**
 * Turn an element into magnifying glass while the glass level is Clear.
 * "pill" is for the round floating bars (their corners must be fully round);
 * "flat" is for bars that run the width of the screen.
 * The element must already be styled as glass in glass.css.
 */
export function useLens(ref: RefObject<HTMLElement | null>, kind: LensKind): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !canBend) return;
    let key = '';
    const drop = () => {
      if (key) { release(key); key = ''; }
      el.style.removeProperty('--lens');
      delete el.dataset.lens;
    };
    const update = () => {
      try {
        // The magnifier is the costly part; it is dropped first on a device that struggles.
        if (glassName(settings.peek().glassLevel) !== 'clear' || perfLevel.peek() > 0) { drop(); return; }
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (!w || !h) return;
        const next = `${w}x${h}x${kind}`;
        if (next === key) return;
        const id = acquire(next, w, h, kind);
        if (!id) { drop(); return; }
        if (key) release(key);
        key = next;
        el.style.setProperty('--lens', `url(#${id})`);
        el.dataset.lens = kind;
      } catch {
        drop(); // plain glass stays
      }
    };
    update();
    const watcher = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    watcher?.observe(el);
    const stop = effect(() => { settings.value.glassLevel; perfLevel.value; update(); });
    return () => {
      watcher?.disconnect();
      stop();
      drop();
    };
  }, []);
}

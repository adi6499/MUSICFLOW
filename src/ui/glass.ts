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
// There are two ways to draw the magnifier, because browsers differ:
//
//   Bending   Chromium browsers (Chrome, Edge, Samsung Internet, the Android
//             app) can bend what is BEHIND an element. One displacement map
//             per bar, used in backdrop-filter. This is the Expenses app's way.
//
//   A copy    Safari, every iPhone browser and Firefox cannot do that (WebKit
//             bug 245510). For them the round pills show a live, enlarged
//             COPY of the page instead: the page is duplicated into a small
//             clipped layer under the pill, scaled by the same amounts and
//             moved in step with scrolling. See "the copy lens" below.
//
// Cosmetic only: any failure leaves plain glass.
//
// How: one picture per bar size (a "displacement map": each pixel says where
// to look instead), used through an SVG filter in backdrop-filter. The element
// is handed the filter as --lens and marked data-lens; glass.css does the rest.

import type { RefObject } from 'preact';
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { settings } from '../lib/library';
import { perfLevel } from '../lib/perf';
import { overlays } from '../lib/router';

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

/** While developing: ?lens=copy in the address draws the iPhone version in any browser, so it can be looked at here. */
const forceCopy = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('lens') === 'copy';

/** Can it also magnify what is behind the glass? (Not when the phone is saving data.) */
export const canBend =
  canGlass && !forceCopy && isChromium() && !(typeof navigator !== 'undefined' && (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData);

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
    if (!el) return;
    // Browsers that cannot bend what is behind the pill get a magnified copy of the page instead.
    if (!canBend) return canGlass && kind === 'pill' ? copyLens(el) : undefined;
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

// ---------------------------------------------------------------- the copy lens (Safari, iPhone, Firefox)
//
// A fixed layer sits exactly under the pill and holds a duplicate of the page,
// enlarged by the same amounts as the bending lens (the pill's own background
// is then left clear). Three things keep it honest:
//   - position: on every scroll the copy is moved so that the point of the
//     page under the pill's centre is also at the centre of the copy;
//   - content: when the page changes, the copy is made again (not more than a
//     few times a second, and not while it is covered by the player);
//   - sideways rows: a shelf scrolled sideways is scrolled the same in the copy.
// Making the copy is the one costly step (tens of milliseconds for a long
// page), so it is kept rare: changes that do not alter what is seen are
// ignored, it never happens while a finger is scrolling, the two pills take
// turns, and a page too long to copy cheaply simply keeps plain glass.
// A phone that still struggles drops back to plain glass by itself
// (lib/perf.ts), exactly as it drops the bending.

const SIDEWAYS = '.shelf, .chips.scroll';
/** Above this many elements a page is not copied (a playlist of several hundred songs, say). */
const TOO_LONG = 3600;

function copyLens(el: HTMLElement): () => void {
  const sx = LOOK.pill.mx;
  const sy = LOOK.pill.m;
  let under: HTMLDivElement | null = null; // the layer beneath the pill
  let page: HTMLDivElement | null = null;  // the copy of the page inside it
  let source: HTMLElement | null = null;   // the real page
  let watcher: MutationObserver | null = null;
  let sizes: ResizeObserver | null = null;
  let timer = 0;
  let lastBuilt = 0;
  let lastScrolled = 0;
  let stale = false;
  // The mini player's copy is made a moment after the tab bar's, so the two never land in the same frame.
  const turn = el.classList.contains('mini') ? 130 : 0;
  // Where things are: the pill (bx, by, bw, bh), and the page's own top-left corner in the document.
  const at = { bx: 0, by: 0, bw: 0, bh: 0, px: 0, pDocTop: 0 };

  const covered = () => document.hidden || overlays.peek().indexOf('player') !== -1;

  const place = () => {
    if (!page) return;
    const pTop = at.pDocTop - window.scrollY;
    const tx = at.bw / 2 + sx * (at.px - (at.bx + at.bw / 2));
    const ty = at.bh / 2 + sy * (pTop - (at.by + at.bh / 2));
    page.style.transform = `matrix(${sx}, 0, 0, ${sy}, ${tx.toFixed(2)}, ${ty.toFixed(2)})`;
  };

  const measure = () => {
    if (!under || !page || !source) return;
    // offsetLeft/Top ignore the pill's own entrance animation, which getBoundingClientRect would not.
    at.bx = el.offsetLeft;
    at.by = el.offsetTop;
    at.bw = el.offsetWidth;
    at.bh = el.offsetHeight;
    const box = source.getBoundingClientRect();
    const cs = getComputedStyle(source);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    at.px = box.left + padL;
    at.pDocTop = box.top + window.scrollY + (parseFloat(cs.paddingTop) || 0);
    page.style.width = Math.max(0, source.clientWidth - padL - padR) + 'px';
    place();
  };

  const syncSideways = (only?: EventTarget | null) => {
    if (!page || !source) return;
    const real = source.querySelectorAll<HTMLElement>(SIDEWAYS);
    const copy = page.querySelectorAll<HTMLElement>(SIDEWAYS);
    for (let i = 0; i < real.length && i < copy.length; i++) {
      if (only && real[i] !== only) continue;
      if (copy[i].scrollLeft !== real[i].scrollLeft) copy[i].scrollLeft = real[i].scrollLeft;
    }
  };

  const build = () => {
    if (!page || !source || !under) return;
    lastBuilt = performance.now();
    stale = false;
    if (source.getElementsByTagName('*').length > TOO_LONG) {
      // Too long to copy cheaply: this page keeps plain clear glass.
      page.replaceChildren();
      under.style.display = 'none';
      delete el.dataset.copy;
      return;
    }
    under.style.display = '';
    el.dataset.copy = '1';
    const holder = document.createElement('div');
    for (const child of Array.from(source.children)) {
      if (child.classList.contains('offline-bar')) continue; // fixed to the screen, not part of the page
      holder.appendChild(child.cloneNode(true));
    }
    holder.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    holder.querySelectorAll('[autofocus]').forEach((n) => n.removeAttribute('autofocus'));
    // Pictures the real page has already loaded are drawn at once, with no fade and no blank frame.
    const real = source.querySelectorAll('img');
    const copy = holder.querySelectorAll('img');
    for (let i = 0; i < copy.length; i++) {
      copy[i].decoding = 'sync';
      if (real[i] && real[i].complete) copy[i].loading = 'eager';
    }
    page.replaceChildren(...Array.from(holder.childNodes));
    syncSideways();
    measure();
  };

  /** The page changed: make the copy again soon, but never more than a few times a second, and never mid-scroll. */
  const refresh = () => {
    stale = true;
    if (timer || !under) return;
    const wait = Math.max(90, 360 - (performance.now() - lastBuilt)) + turn;
    const run = () => {
      timer = 0;
      if (!under || covered()) return; // made again when it is uncovered (see below)
      if (performance.now() - lastScrolled < 150) { timer = window.setTimeout(run, 170); return; }
      try { build(); } catch { stop(); }
    };
    timer = window.setTimeout(run, wait);
  };

  /** Does this change alter what is seen? A picture finishing loading does not: the copy loads its own. */
  const matters = (list: MutationRecord[]): boolean => {
    for (const m of list) {
      if (m.type !== 'attributes') return true;
      const node = m.target as Element;
      if (node.tagName === 'IMG' && m.attributeName === 'class') continue;
      return true;
    }
    return false;
  };

  const onScroll = () => { lastScrolled = performance.now(); place(); };
  const onSideways = (e: Event) => { if (e.target !== document && e.target !== source) syncSideways(e.target); };
  const onShown = () => { if (stale && !covered()) refresh(); };

  function start(): void {
    if (under) return;
    source = document.querySelector<HTMLElement>('main.main');
    const home = el.closest('.app');
    if (!source || !home) return;
    under = document.createElement('div');
    // Placed by the stylesheet exactly as the pill it sits under is placed (see glass.css).
    under.className = 'lens-under ' + (el.classList.contains('mini') ? 'for-mini' : 'for-tabs');
    under.setAttribute('aria-hidden', 'true');
    under.setAttribute('inert', '');
    page = document.createElement('div');
    page.className = 'lens-page';
    under.appendChild(page);
    // Just below the pill it belongs to: the mini player sits one step above the tab bar.
    under.style.zIndex = String((parseInt(getComputedStyle(el).zIndex, 10) || 40) - 1);
    home.appendChild(under);
    try { build(); } catch { stop(); return; }
    watcher = new MutationObserver((list) => { if (matters(list)) refresh(); });
    watcher.observe(source, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'hidden'] });
    if (typeof ResizeObserver !== 'undefined') {
      sizes = new ResizeObserver(measure);
      sizes.observe(el);
      sizes.observe(source);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    window.visualViewport?.addEventListener('resize', measure, { passive: true });
    source.addEventListener('scroll', onSideways, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onShown);
  }

  function stop(): void {
    if (timer) { clearTimeout(timer); timer = 0; }
    watcher?.disconnect();
    watcher = null;
    sizes?.disconnect();
    sizes = null;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', measure);
    window.visualViewport?.removeEventListener('resize', measure);
    source?.removeEventListener('scroll', onSideways, { capture: true });
    document.removeEventListener('visibilitychange', onShown);
    under?.remove();
    under = null;
    page = null;
    source = null;
    delete el.dataset.copy;
  }

  const update = () => {
    try {
      if (glassName(settings.peek().glassLevel) === 'clear' && perfLevel.peek() === 0) start();
      else stop();
    } catch {
      stop(); // plain glass stays
    }
  };
  const stopLevel = effect(() => { settings.value.glassLevel; perfLevel.value; update(); });
  // Closing the full-screen player uncovers the pill: catch up on anything that changed meanwhile.
  const stopCover = effect(() => { overlays.value; onShown(); });
  return () => {
    stopLevel();
    stopCover();
    stop();
  };
}

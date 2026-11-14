// Liquid glass: clear panels that bend whatever scrolls behind them.
//
// The clear, softly blurred look works in every modern browser. The bending
// (text visibly stretching as it passes under the rim, like looking through
// the edge of a thick lens) needs an SVG filter used as the backdrop, which
// only Chromium-based browsers do — Chrome, Edge and the Android app.
// Safari and Firefox get the same clear glass without the bending.
//
// How the bending works: for each glass panel we paint a small "map" picture
// the same size as the panel. Its red channel says how far to shift each pixel
// sideways and its green channel how far to shift it up or down. The middle of
// the map is neutral (no shift); near the rim the shift grows and always points
// inward, so the rim shows a squeezed copy of what lies just inside it.
//
// Kept deliberately plain: no moving highlights and no gloss bands.

import type { RefObject } from 'preact';
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { settings } from '../lib/library';

const hasCss = typeof CSS !== 'undefined' && typeof CSS.supports === 'function';

/** Can this browser draw clear glass at all? */
export const canGlass =
  hasCss && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));

/** Can it also bend what is behind the glass? */
export const canBend = canGlass && typeof navigator !== 'undefined' && /Chrome\/\d+/.test(navigator.userAgent);

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
/** How wide the bending rim is, and how far (in pixels) it shifts things at the very edge. */
const RIM = 18;
const SHIFT = 46;

let host: SVGSVGElement | null = null;
let count = 0;

function hostSvg(): SVGSVGElement {
  if (host && host.isConnected) return host;
  host = document.createElementNS(SVG, 'svg');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.appendChild(host);
  return host;
}

/** Paint the shift map for a rounded rectangle of this size. */
function paintMap(w: number, h: number, radius: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const image = g.createImageData(w, h);
  const d = image.data;
  const hx = w / 2;
  const hy = h / 2;
  const r = Math.min(radius, hx, hy);
  const rim = Math.min(RIM, hy * 0.6, hx * 0.6);
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - hy;
    const qy = Math.abs(py) - (hy - r);
    const sy = py < 0 ? -1 : 1;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx;
      const qx = Math.abs(px) - (hx - r);
      const sx = px < 0 ? -1 : 1;
      // `inside` = how far this pixel is from the nearest edge; (nx, ny) points outward.
      let inside: number;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        inside = r - len;
        nx = (qx / len) * sx;
        ny = (qy / len) * sy;
      } else if (qx > qy) {
        inside = r - qx;
        nx = sx;
      } else {
        inside = r - qy;
        ny = sy;
      }
      let pull = 0;
      if (inside < rim) {
        const t = 1 - Math.max(0, inside) / rim;
        pull = t * t; // gentle at the inner side of the rim, strong at the edge
      }
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * pull * 127;
      d[i + 1] = 128 - ny * pull * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function setLens(el: HTMLElement, id: string, w: number, h: number, radius: number): void {
  const map = paintMap(w, h, radius);
  if (!map) return;
  let filter: Element | null = document.getElementById(id);
  let picture: Element;
  if (!filter) {
    filter = document.createElementNS(SVG, 'filter');
    filter.id = id;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    // Without this the map's neutral grey would be read as a small constant shift.
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    picture = document.createElementNS(SVG, 'feImage');
    picture.setAttribute('result', 'map');
    picture.setAttribute('preserveAspectRatio', 'none');
    const bend = document.createElementNS(SVG, 'feDisplacementMap');
    bend.setAttribute('in', 'SourceGraphic');
    bend.setAttribute('in2', 'map');
    bend.setAttribute('xChannelSelector', 'R');
    bend.setAttribute('yChannelSelector', 'G');
    bend.setAttribute('scale', String(SHIFT));
    filter.appendChild(picture);
    filter.appendChild(bend);
    hostSvg().appendChild(filter);
  } else {
    picture = filter.firstElementChild!;
  }
  const made: Element = filter;
  for (const node of [made, picture]) {
    node.setAttribute('x', '0');
    node.setAttribute('y', '0');
    node.setAttribute('width', String(w));
    node.setAttribute('height', String(h));
  }
  picture.setAttribute('href', map);
  picture.setAttributeNS(XLINK, 'xlink:href', map);
  el.style.setProperty('--lens', `url(#${id})`);
}

/**
 * Give an element a bending rim. The element must already be styled as glass
 * in glass.css (which reads the `--lens` this sets). `radius` must match the
 * element's corner radius in the stylesheet.
 */
export function useLens(ref: RefObject<HTMLElement | null>, radius: number): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !canBend) return;
    const id = 'lens-' + ++count;
    let w = 0;
    let h = 0;
    let on = false;
    const update = () => {
      if (!settings.peek().glass) {
        if (on) { el.style.removeProperty('--lens'); on = false; }
        return;
      }
      const nw = Math.round(el.offsetWidth);
      const nh = Math.round(el.offsetHeight);
      if (!nw || !nh || (on && nw === w && nh === h)) return;
      w = nw;
      h = nh;
      on = true;
      setLens(el, id, w, h, radius);
    };
    update();
    const watcher = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    watcher?.observe(el);
    const stop = effect(() => { settings.value.glass; update(); });
    return () => {
      watcher?.disconnect();
      stop();
      el.style.removeProperty('--lens');
      document.getElementById(id)?.remove();
    };
  }, []);
}

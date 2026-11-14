// Finds the main colour of an album cover so the player can take on a soft,
// flat tint of it. Runs on a 16×16 copy of the picture, so it costs almost
// nothing. Returns hue and saturation only; lightness is chosen by the theme.

import { img } from './util';

export interface Tint { h: number; s: number }

const known = new Map<string, Tint | null>();

export function tintOf(imageUrl: string): Promise<Tint | null> {
  const url = img(imageUrl, 50);
  if (!url) return Promise.resolve(null);
  const had = known.get(url);
  if (had !== undefined) return Promise.resolve(had);
  return new Promise((resolve) => {
    const done = (t: Tint | null) => {
      if (known.size > 300) known.clear();
      known.set(url, t);
      resolve(t);
    };
    try {
      const pic = new Image();
      pic.crossOrigin = 'anonymous';
      pic.decoding = 'async';
      pic.onload = () => {
        try {
          const size = 16;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const g = canvas.getContext('2d', { willReadFrequently: true });
          if (!g) return done(null);
          g.drawImage(pic, 0, 0, size, size);
          const px = g.getImageData(0, 0, size, size).data;
          // Average the colourful pixels, weighting vivid ones more. Hue is an
          // angle, so average it as a direction rather than as a number.
          let x = 0, y = 0, sat = 0, weight = 0;
          for (let i = 0; i < px.length; i += 4) {
            const r = px[i] / 255, gr = px[i + 1] / 255, b = px[i + 2] / 255;
            const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
            const l = (max + min) / 2;
            const d = max - min;
            if (d < 0.08 || l < 0.08 || l > 0.95) continue;
            const s = d / (1 - Math.abs(2 * l - 1));
            let h = max === r ? ((gr - b) / d) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
            h *= 60;
            const w = s * s + 0.05;
            x += Math.cos((h * Math.PI) / 180) * w;
            y += Math.sin((h * Math.PI) / 180) * w;
            sat += s * w;
            weight += w;
          }
          if (weight < 0.5) return done(null); // a grey cover: no tint
          let h = (Math.atan2(y, x) * 180) / Math.PI;
          if (h < 0) h += 360;
          done({ h: Math.round(h), s: Math.round(Math.min(1, sat / weight) * 100) });
        } catch {
          done(null);
        }
      };
      pic.onerror = () => done(null);
      pic.src = url;
    } catch {
      done(null);
    }
  });
}

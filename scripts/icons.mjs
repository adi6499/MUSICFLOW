// Draws the Sukoon icon (a crescent with a single note-dot, on dusk indigo)
// and writes every size the website and the Android app need.
// Run with:  npm run icons

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDIGO = '#4B57B8';
const PAPER = '#F4F1EA';

/** `scale` shrinks the mark towards the centre; `radius` rounds the background (0 = square). */
function svg({ scale = 1, radius = 0, background = INDIGO } = {}) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <mask id="cut">
      <rect width="512" height="512" fill="#fff"/>
      <circle cx="304" cy="212" r="118" fill="#000"/>
    </mask>
  </defs>
  ${background ? `<rect width="512" height="512" rx="${radius}" fill="${background}"/>` : ''}
  <g transform="${t}">
    <circle cx="240" cy="262" r="138" fill="${PAPER}" mask="url(#cut)"/>
    <circle cx="352" cy="338" r="25" fill="${PAPER}"/>
  </g>
</svg>`;
}

async function png(file, markup, size) {
  const out = join(root, file);
  await mkdir(dirname(out), { recursive: true });
  await sharp(Buffer.from(markup), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', file);
}

// Website
await writeFile(join(root, 'public/icon.svg'), svg({ radius: 116 }));
console.log('wrote public/icon.svg');
await png('public/icon-192.png', svg({ radius: 116 }), 192);
await png('public/icon-512.png', svg({ radius: 116 }), 512);
// "Maskable" = the phone crops it to its own shape, so keep the mark inside the safe middle.
await png('public/icon-maskable-512.png', svg({ scale: 0.8 }), 512);
// iPhone home screen (iOS rounds the corners itself).
await png('public/apple-touch-icon.png', svg({ scale: 0.92 }), 180);

// Android app launcher icons (legacy square/round + adaptive foreground).
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [name, size] of Object.entries(dens)) {
  const dir = `android/app/src/main/res/mipmap-${name}`;
  await png(`${dir}/ic_launcher.png`, svg({ radius: 116 }), size);
  await png(`${dir}/ic_launcher_round.png`, svg({ radius: 256 }), size);
  // Adaptive foreground: transparent background, mark within the inner 2/3.
  await png(`${dir}/ic_launcher_foreground.png`, svg({ scale: 0.6, background: '' }), Math.round(size * 2.25));
}

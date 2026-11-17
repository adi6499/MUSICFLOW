// Copies the finished website (dist/) into the Android project, where it is
// packed inside the APK. Run automatically by android/build.cmd.
//   node scripts/android-sync.mjs

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'dist');
const to = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');

try {
  await stat(join(from, 'index.html'));
} catch {
  console.error('There is no finished website yet. Run "npm run build" first.');
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

// The app does not need the website's offline helper or install details,
// and it must not carry a copy of itself (the website's download folder).
for (const extra of ['sw.js', 'manifest.webmanifest']) await rm(join(to, extra), { force: true });
await rm(join(to, 'download'), { recursive: true, force: true });

let files = 0;
let bytes = 0;
async function measure(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await measure(path);
    else { files++; bytes += (await stat(path)).size; }
  }
}
await measure(to);
console.log(`Copied the web app into the Android project: ${files} files, ${Math.round(bytes / 1024)} KB.`);

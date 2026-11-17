// Changes the name people see, everywhere it is shown, in one go.
//   node scripts/rename-app.mjs "New Name"
//
// What it changes
//   - the name in every screen, message and page title        ("Music Flow")
//   - the name on the phone's home screen and in the app list  (Android strings.xml, web manifest)
//   - the file names people download                           ("MusicFlow-v1.3.0.apk", "music-flow-backup-….json")
//   - the README files
//
// What it deliberately leaves alone, so nothing already installed breaks
//   - the Android package id (com.adi6499.sukoon): changing it would make a
//     second, separate app and leave everyone's library behind in the old one
//   - where the library is stored on the device (keys that begin "sukoon")
//   - the marker inside backup files, so old backups still restore
//   - the project folder, the website address and the signing key
//
// The current name is read from src/lib/version.ts (NAME), and written back there.

import { readFile, writeFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').trim().replace(/\s+/g, ' ');
if (!next || !/^[\p{L}\p{N}][\p{L}\p{N} .&'-]{0,28}$/u.test(next)) {
  console.error('Give the new name in quotes, for example:  node scripts/rename-app.mjs "Music Flow"');
  process.exit(1);
}

const versionFile = join(root, 'src', 'lib', 'version.ts');
const versionText = await readFile(versionFile, 'utf8');
const found = /export const NAME = '([^']+)';/.exec(versionText);
if (!found) { console.error('Could not find NAME in src/lib/version.ts.'); process.exit(1); }
const old = found[1];
if (old === next) { console.log(`The app is already called "${next}".`); process.exit(0); }

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const base = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '');                      // "Music Flow" -> "MusicFlow"   (file names)
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''); // -> "music-flow"

// The name as a word of its own: not part of a longer identifier (SukoonNative,
// Theme.Sukoon) and not a file name (those are handled as "file base" below).
const shown = new RegExp(`(?<![\\p{L}.])${esc(old)}(?![\\p{L}]|-v|\\.apk|-\\$)`, 'gu');
const fileBase = new RegExp(`${esc(base(old))}(?=-v|\\.apk|-\\$)`, 'g');

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const displayFiles = [
  ...(await walk(join(root, 'src'))),
  ...['index.html', 'README.md', 'package.json', 'public/manifest.webmanifest', 'public/sw.js', 'android/README.md',
    'android/app/src/main/res/values/strings.xml', 'android/build.cmd', 'scripts/smoke.mjs', 'scripts/icons.mjs',
    'scripts/publish-apk.mjs', 'api/_ytcore.js'].map((f) => join(root, f)),
];
const fileNameFiles = ['android/build.cmd', 'scripts/publish-apk.mjs', 'src/lib/appfile.ts', 'src/pages/getapp.tsx', 'vercel.json',
  '.vercelignore', 'README.md', 'android/README.md'].map((f) => join(root, f));

let total = 0;
const changed = new Map();
async function edit(file, fn) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return; }
  const out = fn(text);
  if (out !== text) { await writeFile(file, out); changed.set(file, (changed.get(file) || 0) + 1); }
}
const count = (text, re) => (text.match(re) || []).length;

for (const file of displayFiles) {
  await edit(file, (text) => {
    total += count(text, shown);
    return text.replace(shown, next);
  });
}
for (const file of fileNameFiles) {
  await edit(file, (text) => {
    total += count(text, fileBase);
    return text.replace(fileBase, base(next));
  });
}
// The two places where the name appears in capitals or as part of a saved file's name.
await edit(join(root, 'src', 'pages', 'stats.tsx'), (text) => text
  .split(`MY WEEK ON ${old.toUpperCase()}`).join(`MY WEEK ON ${next.toUpperCase()}`)
  .split(`my-week-on-${slug(old)}.png`).join(`my-week-on-${slug(next)}.png`));
await edit(join(root, 'src', 'pages', 'settings.tsx'), (text) => text.split(`\`${slug(old)}-backup-`).join(`\`${slug(next)}-backup-`));

// The app file the website offers.
const was = join(root, 'public', 'download', `${base(old)}.apk`);
const now = join(root, 'public', 'download', `${base(next)}.apk`);
try { await stat(was); await rename(was, now); changed.set(now, 1); } catch { /* nothing published yet */ }

await writeFile(versionFile, (await readFile(versionFile, 'utf8')).replace(found[0], `export const NAME = '${next.replace(/'/g, "\\'")}';`));

console.log(`"${old}" is now "${next}" (${total} places in ${changed.size} files).`);
for (const file of [...changed.keys()].sort()) console.log('  ' + relative(root, file).replace(/\\/g, '/'));
console.log('\nNot changed on purpose: the Android package id, where the library is stored, and the backup marker.');

// Puts the freshly built Android app on the website's "Get the app" page.
// Run automatically at the end of android/build.cmd.
//   node scripts/publish-apk.mjs
//
// It copies  android/Sukoon-v<version>.apk  to  public/download/Sukoon.apk
// (one fixed name, so the page's link never changes) and writes
// public/download/app.json, the small note the page and the app read to know
// which version is on offer. Nothing is uploaded here: the file reaches the
// website with the next "git push".

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normally the version being built (from package.json). A version can also be
// named, to put an earlier build back:  node scripts/publish-apk.mjs 1.2.0
const named = process.argv[2];
const version = named && /^\d+\.\d+\.\d+$/.test(named) ? named : JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const from = join(root, 'android', `Sukoon-v${version}.apk`);
const folder = join(root, 'public', 'download');

let info;
try {
  info = await stat(from);
} catch {
  console.error(`There is no app file for version ${version} yet (looked for android/Sukoon-v${version}.apk). Run android\\build.cmd first.`);
  process.exit(1);
}
if (info.size < 100 * 1024) {
  console.error('That app file looks too small to be real. Nothing was copied.');
  process.exit(1);
}

await mkdir(folder, { recursive: true });
await copyFile(from, join(folder, 'Sukoon.apk'));

const two = (n) => (n < 10 ? '0' + n : '' + n);
const d = info.mtime;
const note = { version, bytes: info.size, date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` };
await writeFile(join(folder, 'app.json'), JSON.stringify(note, null, 2) + '\n');

console.log(`The website's download page now offers version ${version} (${Math.round(info.size / 1024)} KB). It goes live with the next upload to GitHub.`);

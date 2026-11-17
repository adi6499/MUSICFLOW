// The Android app file offered on the website's "Get the app" page.
//
// android/build.cmd puts each new build at  download/MusicFlow.apk  on the
// website, next to a small note (download/app.json) saying which version it
// is. The page reads that note; the Android app reads it too, to notice when
// a newer version has been published.

import { cached } from './api';
import { isApp } from './native';
import { SITE } from './version';

export interface AppFile {
  version: string;
  /** Size of the file in bytes. */
  bytes: number;
  /** The day it was built, as "2026-11-17". */
  date: string;
}

/** Inside the app the website is somewhere else; on the website it is right here. */
const base = isApp ? SITE : './';

export const appFileUrl = base + 'download/MusicFlow.apk';
export const appFileKey = 'appfile';

/** What is on offer right now, or null when nothing has been published. */
export function getAppFile(signal?: AbortSignal): Promise<AppFile | null> {
  return cached(appFileKey, 30 * 60 * 1000, async () => {
    const res = await fetch(base + 'download/app.json', { cache: 'no-store', signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Couldn't check for the app just now.");
    const got = await res.json().catch(() => null);
    if (!got || typeof got.version !== 'string' || !(got.bytes > 0)) return null;
    return { version: got.version, bytes: Number(got.bytes), date: typeof got.date === 'string' ? got.date : '' };
  });
}

/** Is version `a` newer than version `b`? ("1.10.0" is newer than "1.9.3".) */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

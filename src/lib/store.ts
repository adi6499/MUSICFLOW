// A tiny key → value shelf on the device (IndexedDB). Everything the person owns
// (liked songs, playlists, history, settings) is kept here, so it survives closing
// the app. If the browser refuses storage (some private windows), it quietly falls
// back to memory so the app still works for that visit.

const DB_NAME = 'sukoon';
const STORE = 'kv';

let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(memory.get(key) as T | undefined);
    } catch {
      resolve(memory.get(key) as T | undefined);
    }
  });
}

export async function kvGetMany(keys: string[]): Promise<Record<string, unknown>> {
  const db = await open();
  const out: Record<string, unknown> = {};
  if (!db) {
    for (const k of keys) out[k] = memory.get(k);
    return out;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      for (const k of keys) {
        const req = store.get(k);
        req.onsuccess = () => { out[k] = req.result; };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
      tx.onabort = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function kvDel(key: string): Promise<void> {
  memory.delete(key);
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Ask the browser not to clear our data when the device runs low on space. */
export function keepStorage(): void {
  try { void navigator.storage?.persist?.(); } catch { /* optional */ }
}

import { DEVICE_KEY_PATTERN } from "@caysonverse/shared/memorial/constants";

/**
 * This browser's device key (memorial stage B; no login): 32 random bytes, base64url. It makes this device the "owner key" of
 * the cubby it claims (the server stores only its SHA-256). Kept in TWO places so clearing one does not lose the cubby:
 * localStorage (fast, read first) and IndexedDB (backup). Either may be blocked (private mode): then the key lives in memory for
 * this visit and the game still works — the claim screen says the family should keep the recovery code.
 */

const LS_KEY = "cv.deviceKey";
const IDB_NAME = "cv-device";
const IDB_STORE = "kv";

let current: string | null = null;
let ready: Promise<string> | null = null;

export function makeDeviceKey(rand: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  const bytes = rand(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readLocal(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && DEVICE_KEY_PATTERN.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeLocal(v: string): void {
  try {
    localStorage.setItem(LS_KEY, v);
  } catch {
    /* blocked: memory only */
  }
}

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        try {
          const db = open.result;
          const t = db.transaction(IDB_STORE, mode);
          const req = fn(t.objectStore(IDB_STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
          t.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/** Resolve the device key once: localStorage → IndexedDB → a new one; then write it back to both. Never rejects. */
export function readyDeviceKey(): Promise<string> {
  if (ready) return ready;
  ready = (async () => {
    let key = readLocal();
    if (!key) {
      const backup = await Promise.race([idb<string>("readonly", (s) => s.get(LS_KEY) as IDBRequest<string>), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      key = typeof backup === "string" && DEVICE_KEY_PATTERN.test(backup) ? backup : makeDeviceKey();
    }
    current = key;
    writeLocal(key);
    void idb("readwrite", (s) => s.put(key, LS_KEY));
    return key;
  })();
  return ready;
}

/** The key if already resolved (null before `readyDeviceKey` settles). */
export function deviceKeyNow(): string | null {
  return current;
}

/** Tests only. */
export function resetDeviceKeyForTest(): void {
  current = null;
  ready = null;
}

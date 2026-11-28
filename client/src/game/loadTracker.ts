import { FileLoader, ImageBitmapLoader, ImageLoader } from "three";

/**
 * Every file three is fetching now, whichever loading manager it belongs to (fix/entry-full-load, 2026-11-28).
 *
 * The entry's loading screen waits until everything the plaza shows is in (VillageScene EntryReveal): the village model, its
 * vegetation, and then the houses, the lot buildings, the bus, the mountains, the lake, the park's skyline, their textures. Those come
 * through several loading managers (the default one, the houses', the lots', the bus's: each of them its own so that the old
 * "불러오는 중…" chip never waited for them), so no single manager knows when the plaza is complete. Every one of them ends in one of
 * three loaders that really fetch — `FileLoader` (models, KTX2 textures, the Draco decoder, binary grids), `ImageLoader` (drei's
 * `useTexture`, `TextureLoader`) and `ImageBitmapLoader` (a glTF's own images) — so their `load` is wrapped once, here: a request
 * counts from the call until its onLoad or onError.
 *
 * Pure counting, nothing changes for the loaders' callers. `trackLoaderPrototype` is the testable core.
 */

type LoadFn = (url: string, onLoad?: (v: unknown) => void, onProgress?: (e: unknown) => void, onError?: (e: unknown) => void) => unknown;

export interface LoadTracker {
  /** Requests in flight now. */
  pending(): number;
  /** Requests started since the page began (a stage's own share: the difference of two readings). */
  started(): number;
  /** Requests ended (loaded or failed) since the page began. */
  ended(): number;
  /** performance.now() of the last start or end. */
  lastChange(): number;
  /** The urls in flight (for a log line when a stage gives up waiting). */
  urls(): string[];
  subscribe(listener: () => void): () => void;
}

export function createLoadTracker(now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now())) {
  const inFlight = new Map<string, number>();
  let started = 0;
  let ended = 0;
  let pending = 0;
  let last = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  const begin = (url: string) => {
    started++;
    pending++;
    last = now();
    inFlight.set(url, (inFlight.get(url) ?? 0) + 1);
    emit();
  };
  const end = (url: string) => {
    ended++;
    pending = Math.max(0, pending - 1);
    last = now();
    const n = (inFlight.get(url) ?? 1) - 1;
    if (n > 0) inFlight.set(url, n);
    else inFlight.delete(url);
    emit();
  };

  /** Wrap one loader class's `load` (once per prototype). */
  const trackLoaderPrototype = (proto: { load: LoadFn }): void => {
    const marked = proto as { load: LoadFn; __cvTracked?: boolean };
    if (marked.__cvTracked) return;
    marked.__cvTracked = true;
    const load = proto.load;
    proto.load = function (this: unknown, url, onLoad, onProgress, onError) {
      const key = typeof url === "string" ? url : String(url);
      begin(key);
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        end(key);
      };
      try {
        return load.call(
          this,
          url,
          (v) => {
            close();
            onLoad?.(v);
          },
          onProgress,
          (e) => {
            close();
            onError?.(e);
          },
        );
      } catch (e) {
        close();
        throw e;
      }
    };
  };

  const tracker: LoadTracker = {
    pending: () => pending,
    started: () => started,
    ended: () => ended,
    lastChange: () => last,
    urls: () => [...inFlight.keys()],
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { tracker, trackLoaderPrototype };
}

const made = createLoadTracker();
made.trackLoaderPrototype(FileLoader.prototype as unknown as { load: LoadFn });
made.trackLoaderPrototype(ImageLoader.prototype as unknown as { load: LoadFn });
made.trackLoaderPrototype(ImageBitmapLoader.prototype as unknown as { load: LoadFn });

/** The page's one tracker (installed when this module is first imported: before the village's first request). */
export const loadTracker: LoadTracker = made.tracker;

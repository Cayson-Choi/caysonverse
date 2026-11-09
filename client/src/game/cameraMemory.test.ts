import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAMERA } from "./constants";
import { ZOOM_BAND } from "./cameraControls";
import {
  CAMERA_STORAGE_KEY,
  DEFAULT_CAMERA_MEMORY,
  forgetLiveCameraMemory,
  liveCameraMemory,
  loadCameraMemory,
  normalizeCameraMemory,
  parseCameraMemory,
  rememberOrbit,
  restoreOrbit,
  saveCameraMemory,
} from "./cameraMemory";
import { applyZoom, resetViewMode } from "./viewState";
import type { StorageLike } from "./settings";
import type { Orbit } from "./types";

/** An in-memory localStorage that counts its writes. */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string>; writes: number } {
  const s = {
    data: { ...initial },
    writes: 0,
    getItem: (k: string) => (k in s.data ? s.data[k] : null),
    setItem: (k: string, v: string) => {
      s.writes++;
      s.data[k] = v;
    },
  };
  return s;
}

/** A storage the browser blocks (private mode, blocked site data): every access throws. */
const blockedStorage: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError: storage is blocked");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

/** A scene's fresh orbit, as PlayShell / WorldScene make it. */
function freshOrbit(): Orbit {
  return { yaw: CAMERA.yaw, pitch: CAMERA.pitch, distance: CAMERA.distance };
}

// Each test starts like a fresh page load: no live memory, a third-person view.
beforeEach(() => {
  forgetLiveCameraMemory();
  resetViewMode();
});
afterEach(() => forgetLiveCameraMemory());

describe("cameraMemory — what is stored and how it is read back", () => {
  it("a first visit (nothing stored, no storage at all) is the world's default framing", () => {
    expect(DEFAULT_CAMERA_MEMORY).toEqual({ distance: CAMERA.distance, pitch: CAMERA.pitch });
    expect(loadCameraMemory(memoryStorage())).toEqual(DEFAULT_CAMERA_MEMORY);
    expect(loadCameraMemory(null)).toEqual(DEFAULT_CAMERA_MEMORY);
  });

  it("a saved choice comes back exactly (no rounding, no snapping)", () => {
    const s = memoryStorage();
    saveCameraMemory({ distance: 9.4321, pitch: 0.6789 }, s);
    expect(JSON.parse(s.data[CAMERA_STORAGE_KEY])).toEqual({ distance: 9.4321, pitch: 0.6789 });
    expect(loadCameraMemory(s)).toEqual({ distance: 9.4321, pitch: 0.6789 });
  });

  it("broken JSON, a non-object and an array are the defaults", () => {
    for (const raw of ["{not json", "42", '"x"', "null", "[1,2]", ""]) {
      expect(parseCameraMemory(raw), raw).toEqual(DEFAULT_CAMERA_MEMORY);
    }
    expect(parseCameraMemory(null)).toEqual(DEFAULT_CAMERA_MEMORY);
  });

  it("each field is validated on its own: out of range is clamped into its band, a wrong type is its default", () => {
    expect(normalizeCameraMemory({ distance: 999, pitch: -5 })).toEqual({ distance: CAMERA.maxDistance, pitch: CAMERA.minPitch });
    expect(normalizeCameraMemory({ distance: 0, pitch: 9 })).toEqual({ distance: CAMERA.minDistance, pitch: CAMERA.maxPitch });
    expect(normalizeCameraMemory({ distance: "9", pitch: 0.5 })).toEqual({ distance: CAMERA.distance, pitch: 0.5 });
    expect(normalizeCameraMemory({ distance: 9, pitch: Number.NaN })).toEqual({ distance: 9, pitch: CAMERA.pitch });
    expect(normalizeCameraMemory({ distance: Infinity })).toEqual({ distance: CAMERA.distance, pitch: CAMERA.pitch });
    expect(normalizeCameraMemory({ distance: 7, extra: true })).toEqual({ distance: 7, pitch: CAMERA.pitch });
  });

  it("blocked storage: reading is the default and writing does not throw", () => {
    expect(loadCameraMemory(blockedStorage)).toEqual(DEFAULT_CAMERA_MEMORY);
    expect(() => saveCameraMemory({ distance: 8, pitch: 0.4 }, blockedStorage)).not.toThrow();
  });

  it("a page where even touching `localStorage` throws still works (the default storage is wrapped too)", () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: The operation is insecure.");
      },
    });
    try {
      expect(loadCameraMemory()).toEqual(DEFAULT_CAMERA_MEMORY);
      expect(() => saveCameraMemory({ distance: 8, pitch: 0.4 })).not.toThrow();
      const o = freshOrbit();
      expect(() => restoreOrbit(o)).not.toThrow();
      o.distance = 11;
      expect(() => rememberOrbit(o)).not.toThrow();
    } finally {
      if (desc) Object.defineProperty(globalThis, "localStorage", desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe("cameraMemory — the zoom the player sets is the zoom every scene starts with", () => {
  it("the stored zoom and tilt load on start: a fresh orbit takes them, its yaw is left as the scene set it", () => {
    const s = memoryStorage({ [CAMERA_STORAGE_KEY]: JSON.stringify({ distance: 12.5, pitch: 0.8 }) });
    const o = { yaw: 1.3, pitch: CAMERA.pitch, distance: CAMERA.distance };
    restoreOrbit(o, s);
    expect(o).toEqual({ yaw: 1.3, pitch: 0.8, distance: 12.5 });
  });

  it("a wheel zoom survives a reload: remembered after the notch, restored on the next page load", () => {
    const s = memoryStorage();
    const before = freshOrbit();
    restoreOrbit(before, s); // first visit: the defaults
    expect(before.distance).toBe(CAMERA.distance);
    applyZoom(before, 3.5, ZOOM_BAND); // a wheel gesture out: 6 → 9.5 m
    rememberOrbit(before, s);

    forgetLiveCameraMemory(); // the reload
    const after = freshOrbit();
    restoreOrbit(after, s);
    expect(after.distance).toBe(before.distance);
    expect(after.distance).toBeCloseTo(9.5, 9);
    expect(after.pitch).toBe(before.pitch);
  });

  it("between scenes of one visit (a door, another experience, a reconnect) the live memory carries the zoom", () => {
    const s = memoryStorage();
    const village = freshOrbit();
    restoreOrbit(village, s);
    village.distance = 14.2;
    village.pitch = 0.9;
    rememberOrbit(village, s);
    const classroom = freshOrbit(); // a new PlayShell: the orbit starts at the defaults again
    restoreOrbit(classroom, s);
    expect(classroom).toEqual({ yaw: CAMERA.yaw, pitch: 0.9, distance: 14.2 });
  });

  it("blocked storage: the zoom still holds for the whole visit, and a reload simply starts at the default", () => {
    const first = freshOrbit();
    restoreOrbit(first, blockedStorage);
    expect(first.distance).toBe(CAMERA.distance);
    first.distance = 15;
    expect(() => rememberOrbit(first, blockedStorage)).not.toThrow();
    const next = freshOrbit();
    restoreOrbit(next, blockedStorage);
    expect(next.distance).toBe(15); // the next scene of this visit
    forgetLiveCameraMemory(); // a reload: nothing could be stored
    const reloaded = freshOrbit();
    restoreOrbit(reloaded, blockedStorage);
    expect(reloaded.distance).toBe(CAMERA.distance);
  });

  it("a broken stored value starts at the default and is replaced by the next real choice", () => {
    const s = memoryStorage({ [CAMERA_STORAGE_KEY]: "{garbage" });
    const o = freshOrbit();
    restoreOrbit(o, s);
    expect(o).toEqual(freshOrbit());
    o.distance = 4;
    rememberOrbit(o, s);
    expect(JSON.parse(s.data[CAMERA_STORAGE_KEY])).toEqual({ distance: 4, pitch: CAMERA.pitch });
  });

  it("rememberOrbit writes only when the choice changed (a pointer-up without a zoom costs nothing)", () => {
    const s = memoryStorage();
    const o = freshOrbit();
    restoreOrbit(o, s);
    rememberOrbit(o, s);
    rememberOrbit(o, s);
    expect(s.writes).toBe(0); // nothing changed since the restore
    o.distance = 8;
    rememberOrbit(o, s);
    expect(s.writes).toBe(1);
    rememberOrbit(o, s);
    expect(s.writes).toBe(1);
    expect(liveCameraMemory()).toEqual({ distance: 8, pitch: CAMERA.pitch });
    o.yaw = 2; // the yaw is not part of the memory
    rememberOrbit(o, s);
    expect(s.writes).toBe(1);
  });

  it("restoring is read-only: it never writes the storage, and only reads it once per visit", () => {
    let reads = 0;
    const s: StorageLike = {
      getItem: () => {
        reads++;
        return JSON.stringify({ distance: 10, pitch: 0.4 });
      },
      setItem: () => {
        throw new Error("restore must not write");
      },
    };
    for (let i = 0; i < 3; i++) {
      const o = freshOrbit();
      restoreOrbit(o, s);
      expect(o.distance).toBe(10);
    }
    expect(reads).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../game/settings";

/** A fresh copy of the store module, built against whatever `localStorage` is stubbed right now. */
async function freshStore() {
  vi.resetModules();
  return (await import("./settingsStore")).useSettingsStore;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: vi.fn((k: string) => (k in data ? data[k] : null)),
    setItem: vi.fn((k: string, v: string) => {
      data[k] = v;
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settingsStore — cv-settings-v1", () => {
  it("starts from the defaults when nothing is saved", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const store = await freshStore();
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("restores saved settings (they survive a reload)", async () => {
    const saved = { ...DEFAULT_SETTINGS, leftHanded: true, buttonSize: "large", lookSensitivity: 1.5, nametagMode: "all" };
    vi.stubGlobal("localStorage", memoryStorage({ "cv-settings-v1": JSON.stringify(saved) }));
    const store = await freshStore();
    expect(store.getState().settings).toEqual(saved);
  });

  it("update merges the patch and saves the whole object under the key", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const store = await freshStore();

    store.getState().update({ leftHanded: true });
    store.getState().update({ showOwnNametag: true, nametagMode: "off" });

    const expected = { ...DEFAULT_SETTINGS, leftHanded: true, showOwnNametag: true, nametagMode: "off" };
    expect(store.getState().settings).toEqual(expected);
    expect(JSON.parse(storage.data["cv-settings-v1"])).toEqual(expected);

    // "Reload": a new module instance reads it back.
    const reloaded = await freshStore();
    expect(reloaded.getState().settings).toEqual(expected);
  });

  it("update validates the patch the same way a stored value is validated", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const store = await freshStore();

    store.getState().update({ lookSensitivity: 9 });
    expect(store.getState().settings.lookSensitivity).toBe(2);
    store.getState().update({ lookSensitivity: 1.1 });
    expect(store.getState().settings.lookSensitivity).toBe(1);
    store.getState().update({ lookSensitivity: Number.NaN });
    expect(store.getState().settings.lookSensitivity).toBe(1);
    store.getState().update({ buttonSize: "huge" as never });
    expect(store.getState().settings.buttonSize).toBe("medium");
    expect(JSON.parse(storage.data["cv-settings-v1"]).lookSensitivity).toBe(1);
  });

  it("repairs a damaged saved blob", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "cv-settings-v1": "{oops" }));
    const store = await freshStore();
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("still works with defaults when storage throws (private mode / blocked site data)", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const store = await freshStore();
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(() => store.getState().update({ leftHanded: true })).not.toThrow();
    expect(store.getState().settings.leftHanded).toBe(true); // lasts for this visit
  });

  it("still works when localStorage itself cannot be touched", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const store = await freshStore();
      expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
      expect(() => store.getState().update({ buttonSize: "small" })).not.toThrow();
      expect(store.getState().settings.buttonSize).toBe("small");
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

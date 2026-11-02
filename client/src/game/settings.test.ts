import { describe, it, expect } from "vitest";
import {
  BUTTON_SCALE,
  DEFAULT_SETTINGS,
  MIN_GAP_PX,
  MIN_TOUCH_PX,
  SENSITIVITY,
  SETTINGS_STORAGE_KEY,
  buttonPx,
  loadSettings,
  normalizeSettings,
  parseSettings,
  saveSettings,
  type Settings,
  type StorageLike,
} from "./settings";

describe("DEFAULT_SETTINGS and constants", () => {
  it("are the spec values", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      buttonSize: "medium",
      leftHanded: false,
      lookSensitivity: 1,
      nametagMode: "nearby",
      showOwnNametag: false,
      coachDone: false,
      graphics: "auto",
      brightness: 1,
    });
    expect(SENSITIVITY).toEqual({ min: 0.5, max: 2, step: 0.25 });
    expect(BUTTON_SCALE).toEqual({ small: 0.85, medium: 1, large: 1.25 });
    expect(MIN_TOUCH_PX).toBe(48);
    expect(MIN_GAP_PX).toBe(8);
    expect(SETTINGS_STORAGE_KEY).toBe("cv-settings-v1");
  });
});

describe("parseSettings", () => {
  it("defaults for null, bad JSON and non-objects", () => {
    for (const raw of [null, "{", "42", "[]", "null", '"text"', "true", ""]) {
      expect(parseSettings(raw), String(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("returns a fresh object, so a caller cannot corrupt the defaults", () => {
    const a = parseSettings(null);
    a.leftHanded = true;
    expect(parseSettings(null).leftHanded).toBe(false);
    expect(DEFAULT_SETTINGS.leftHanded).toBe(false);
  });

  it("keeps valid fields and fixes invalid ones per field", () => {
    expect(
      parseSettings(
        JSON.stringify({
          leftHanded: true,
          lookSensitivity: 9,
          nametagMode: "loud",
          buttonSize: "large",
        }),
      ),
    ).toEqual({ ...DEFAULT_SETTINGS, leftHanded: true, lookSensitivity: 2, buttonSize: "large" });
    expect(parseSettings(JSON.stringify({ lookSensitivity: 1.1 })).lookSensitivity).toBe(1);
  });

  it("round-trips every valid value", () => {
    const all: Settings = {
      buttonSize: "small",
      leftHanded: true,
      lookSensitivity: 1.75,
      nametagMode: "all",
      showOwnNametag: true,
      coachDone: true,
      graphics: "low",
      brightness: 1.3,
    };
    expect(parseSettings(JSON.stringify(all))).toEqual(all);
    for (const g of ["auto", "high", "low"] as const) {
      expect(parseSettings(JSON.stringify({ graphics: g })).graphics).toBe(g);
    }
    for (const mode of ["all", "nearby", "off"] as const) {
      expect(parseSettings(JSON.stringify({ nametagMode: mode })).nametagMode).toBe(mode);
    }
    for (const size of ["small", "medium", "large"] as const) {
      expect(parseSettings(JSON.stringify({ buttonSize: size })).buttonSize).toBe(size);
    }
  });

  it("clamps the sensitivity to 0.5..2 and snaps it to quarter steps", () => {
    const sens = (v: unknown) => parseSettings(JSON.stringify({ lookSensitivity: v })).lookSensitivity;
    expect(sens(0)).toBe(0.5);
    expect(sens(-3)).toBe(0.5);
    expect(sens(0.5)).toBe(0.5);
    expect(sens(2)).toBe(2);
    expect(sens(100)).toBe(2);
    expect(sens(1.2)).toBe(1.25);
    expect(sens(1.6)).toBe(1.5);
    expect(sens(1.75)).toBe(1.75);
    expect(sens(0.6)).toBe(0.5);
    // Every slider stop survives unchanged.
    for (let v = SENSITIVITY.min; v <= SENSITIVITY.max; v += SENSITIVITY.step) expect(sens(v)).toBe(v);
  });

  it("replaces wrong types with the field's default", () => {
    const parsed = parseSettings(
      JSON.stringify({
        buttonSize: 3,
        leftHanded: "true",
        lookSensitivity: "2",
        nametagMode: null,
        showOwnNametag: 1,
        coachDone: "yes",
        graphics: 2,
        brightness: "1.2",
      }),
    );
    expect(parsed).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ lookSensitivity: null })).lookSensitivity).toBe(1);
  });

  it("drops keys it does not know", () => {
    const parsed = parseSettings(JSON.stringify({ leftHanded: true, theme: "neon" }));
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, leftHanded: true });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

describe("graphics and brightness (Task 21)", () => {
  it("parseSettings keeps old saves valid and fixes graphics/brightness", () => {
    // A save from before Task 21 has neither field: both come back as their defaults, the rest is kept.
    const old = parseSettings(JSON.stringify({ leftHanded: true }));
    expect(old.graphics).toBe("auto");
    expect(old.brightness).toBe(1);
    expect(old.leftHanded).toBe(true);
    expect(parseSettings(JSON.stringify({ brightness: 3 })).brightness).toBe(1.4);
    expect(parseSettings(JSON.stringify({ graphics: "ultra" })).graphics).toBe("auto");
  });

  it("clamps the brightness to 0.8..1.4 and snaps it to tenths, without float dust", () => {
    const bright = (v: unknown) => parseSettings(JSON.stringify({ brightness: v })).brightness;
    expect(bright(0)).toBe(0.8);
    expect(bright(-2)).toBe(0.8);
    expect(bright(0.8)).toBe(0.8);
    expect(bright(1.4)).toBe(1.4);
    expect(bright(9)).toBe(1.4);
    expect(bright(1.04)).toBe(1);
    expect(bright(1.06)).toBe(1.1);
    expect(bright(null)).toBe(1);
    expect(bright("1.2")).toBe(1);
    // Every slider stop survives unchanged (0.9 must not come back as 0.9000000000000001).
    for (let i = 0; i <= 6; i++) {
      const v = Math.round((0.8 + i * 0.1) * 10) / 10;
      expect(bright(v)).toBe(v);
    }
  });

  it("a patch merged over the settings is validated the same way", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, brightness: Number.NaN }).brightness).toBe(1);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, graphics: "ultra" }).graphics).toBe("auto");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, graphics: "high", brightness: 1.2 })).toEqual({
      ...DEFAULT_SETTINGS,
      graphics: "high",
      brightness: 1.2,
    });
  });
});

describe("normalizeSettings", () => {
  it("validates a patch merged over the current settings the same way", () => {
    const merged = { ...DEFAULT_SETTINGS, lookSensitivity: Number.NaN, nametagMode: "loud" };
    expect(normalizeSettings(merged)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lookSensitivity: Infinity }).lookSensitivity).toBe(1);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("buttonPx", () => {
  it("never drops below 48 px", () => {
    expect(buttonPx(56, "small")).toBe(48);
    expect(buttonPx(72, "small")).toBe(61);
    expect(buttonPx(72, "large")).toBe(90);
  });

  it("is the base size at medium and respects the floor at every size", () => {
    expect(buttonPx(72, "medium")).toBe(72);
    expect(buttonPx(60, "medium")).toBe(60);
    expect(buttonPx(60, "small")).toBe(51);
    expect(buttonPx(60, "large")).toBe(75);
    for (const size of ["small", "medium", "large"] as const) {
      expect(buttonPx(10, size)).toBe(MIN_TOUCH_PX);
      expect(buttonPx(0, size)).toBe(MIN_TOUCH_PX);
    }
  });
});

/** An in-memory Storage. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/** A storage that throws on every use (private mode / blocked site data). */
const blockedStorage: StorageLike = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("loadSettings / saveSettings", () => {
  it("round-trip through the cv-settings-v1 key", () => {
    const storage = fakeStorage();
    const next: Settings = { ...DEFAULT_SETTINGS, leftHanded: true, buttonSize: "large", lookSensitivity: 1.5 };
    saveSettings(next, storage);
    expect(Object.keys(storage.data)).toEqual(["cv-settings-v1"]);
    expect(JSON.parse(storage.data["cv-settings-v1"])).toEqual(next);
    expect(loadSettings(storage)).toEqual(next);
  });

  it("repairs a damaged stored blob instead of failing", () => {
    expect(loadSettings(fakeStorage({ "cv-settings-v1": "{not json" }))).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings(fakeStorage({ "cv-settings-v1": JSON.stringify({ leftHanded: true, buttonSize: "huge" }) })),
    ).toEqual({ ...DEFAULT_SETTINGS, leftHanded: true });
  });

  it("works with defaults when storage is blocked or missing", () => {
    expect(loadSettings(blockedStorage)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings({ ...DEFAULT_SETTINGS, leftHanded: true }, blockedStorage)).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, null)).not.toThrow();
  });
});

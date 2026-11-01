import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh module graph (store + registry + bridge) built against a stubbed, empty localStorage. */
async function fresh() {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
  const { useSettingsStore } = await import("../stores/settingsStore");
  const { getNametagMode, setNametagMode } = await import("./labelRegistry");
  const { bindNametagMode } = await import("./settingsBridge");
  return { useSettingsStore, getNametagMode, setNametagMode, bindNametagMode };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bindNametagMode — settings reach the name tag system without a React subscription", () => {
  it("applies the current mode at once, then follows every change", async () => {
    const { useSettingsStore, getNametagMode, setNametagMode, bindNametagMode } = await fresh();
    useSettingsStore.getState().update({ nametagMode: "all" });
    setNametagMode("off"); // stale registry value from an earlier world

    const off = bindNametagMode();
    expect(getNametagMode()).toBe("all");

    useSettingsStore.getState().update({ nametagMode: "off" });
    expect(getNametagMode()).toBe("off");
    useSettingsStore.getState().update({ nametagMode: "nearby" });
    expect(getNametagMode()).toBe("nearby");
    off();
  });

  it("ignores changes to other settings (a slider drag must not touch the registry)", async () => {
    const { useSettingsStore, bindNametagMode } = await fresh();
    const labelRegistry = await import("./labelRegistry");
    const spy = vi.spyOn(labelRegistry, "setNametagMode");
    const off = bindNametagMode();
    spy.mockClear();

    for (const lookSensitivity of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      useSettingsStore.getState().update({ lookSensitivity });
    }
    useSettingsStore.getState().update({ buttonSize: "large", leftHanded: true, showOwnNametag: true });
    expect(spy).not.toHaveBeenCalled();
    off();
  });

  it("stops following once disposed", async () => {
    const { useSettingsStore, getNametagMode, bindNametagMode } = await fresh();
    const off = bindNametagMode();
    off();
    useSettingsStore.getState().update({ nametagMode: "off" });
    expect(getNametagMode()).toBe("nearby");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeContext } from "../land/sfx/fakeAudio.testkit";

// A fake window gives the village's shared AudioContext a constructor, so the live code path runs in node.
vi.setConfig({ testTimeout: 30_000 }); // the first build bakes the droplet loops: slow on a loaded machine
const fake = makeFakeContext("running");
vi.stubGlobal("window", {
  AudioContext: function () {
    return fake.ctx;
  },
  setTimeout: (fn: () => void) => {
    fn();
    return 1;
  },
});
vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });

const { FOUNTAIN_PEAK, FOUNTAIN_RANGE_M, FOUNTAIN_IDLE_STOP_S, PARK_FOUNTAIN, VILLAGE_FOUNTAIN, bubbleData, createFountainAudio, fountainGain, fountainLevel, fountainNear, patterData } = await import("./fountainAudio");
const { useSoundStore } = await import("../stores/soundStore");

describe("the fountain's level curve", () => {
  const rim = VILLAGE_FOUNTAIN.rim;
  it("is full at and inside the rim", () => {
    expect(fountainLevel(0, rim)).toBe(1);
    expect(fountainLevel(rim, rim)).toBe(1);
  });
  it("falls smoothly to nothing at 25 m and never rises with distance", () => {
    expect(fountainLevel(FOUNTAIN_RANGE_M, rim)).toBe(0);
    expect(fountainLevel(60, rim)).toBe(0);
    let prev = 2;
    for (let d = 0; d <= 30; d += 0.25) {
      const l = fountainLevel(d, rim);
      expect(l).toBeLessThanOrEqual(prev + 1e-12);
      prev = l;
    }
    expect(fountainLevel(rim + 1, rim)).toBeLessThan(1);
    expect(fountainLevel(rim + 1, rim)).toBeGreaterThan(0.8); // a step off the rim is still loud
    expect(fountainLevel(15, rim)).toBeGreaterThan(0.1); // and the plaza still hears it
    expect(fountainLevel(15, rim)).toBeLessThan(0.5);
  });
  it("is audible within about 25 m, in both the village and the park", () => {
    expect(fountainNear(24.9)).toBe(true);
    expect(fountainNear(25.1)).toBe(false);
    expect(fountainLevel(20, PARK_FOUNTAIN.rim)).toBeGreaterThan(0);
  });
  it("is silent when the menu's sound is off", () => {
    expect(fountainGain(3, rim, true)).toBeCloseTo(FOUNTAIN_PEAK, 9);
    expect(fountainGain(3, rim, false)).toBe(0);
  });
});

describe("the baked loops", () => {
  it("are finite and busy (events wrap round the loop's end)", () => {
    for (const d of [patterData(44100, 5), bubbleData(44100, 7)]) {
      expect(d.length).toBeGreaterThan(44100 * 4);
      let max = 0;
      let finite = true;
      for (const v of d) {
        if (!Number.isFinite(v)) finite = false;
        max = Math.max(max, Math.abs(v));
      }
      expect(finite).toBe(true);
      expect(max).toBeGreaterThan(0.2);
      expect(max).toBeLessThan(40);
    }
  });
});

describe("the live fountain (a fake AudioContext)", () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    useSoundStore.setState({ muted: false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useSoundStore.setState({ muted: false });
  });
  it("builds its nodes when you are near, and not when you are far or the sound is off", () => {
    const a = createFountainAudio(VILLAGE_FOUNTAIN);
    a.update(40, 0);
    expect(a.running).toBe(false);
    expect(a.target).toBe(0);
    useSoundStore.setState({ muted: true });
    a.update(3, 0);
    expect(a.running).toBe(false);
    expect(a.target).toBe(0);
    useSoundStore.setState({ muted: false });
    a.update(3, 0);
    expect(a.running).toBe(true);
    expect(a.target).toBeCloseTo(FOUNTAIN_PEAK, 9);
    a.update(12, 0.3);
    expect(a.target).toBeLessThan(FOUNTAIN_PEAK);
    expect(a.target).toBeGreaterThan(0);
    a.dispose();
  });
  it("goes quiet at once when the sound is switched off, and frees its nodes after a few silent seconds", () => {
    const a = createFountainAudio(VILLAGE_FOUNTAIN);
    a.update(3, 0);
    expect(a.running).toBe(true);
    useSoundStore.setState({ muted: true });
    a.update(3, 0);
    expect(a.target).toBe(0);
    expect(a.running).toBe(true); // still there for a moment (an un-mute is not a rebuild)
    for (let s = 0; s < FOUNTAIN_IDLE_STOP_S + 1; s++) {
      now += 1000;
      a.update(3, 0);
    }
    expect(a.running).toBe(false);
    a.dispose();
  });
  it("frees its nodes after the player has been out of range for a few seconds", () => {
    const a = createFountainAudio(VILLAGE_FOUNTAIN);
    a.update(5, 0);
    expect(a.running).toBe(true);
    for (let s = 0; s < FOUNTAIN_IDLE_STOP_S + 1; s++) {
      now += 1000;
      a.update(80, 0);
    }
    expect(a.running).toBe(false);
    a.dispose();
  });
  it("disposing frees the nodes (leaving the area)", () => {
    const a = createFountainAudio(VILLAGE_FOUNTAIN);
    a.update(5, 0);
    expect(a.running).toBe(true);
    a.dispose();
    expect(a.running).toBe(false);
  });
});

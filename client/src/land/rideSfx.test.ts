import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeContext } from "./sfx/fakeAudio.testkit";

const fake = makeFakeContext("running");
let tickFn: (() => void) | null = null;
vi.stubGlobal("window", {
  AudioContext: function () {
    return fake.ctx;
  },
  setInterval: (fn: () => void) => {
    tickFn = fn;
    return 7;
  },
  clearInterval: () => {
    tickFn = null;
  },
  setTimeout: (fn: () => void) => {
    fn();
    return 1;
  },
});
vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });

const sfx = await import("./rideSfx");
const { selfRide } = await import("./coasterRide");
const { sfxListener } = await import("./sfx/sfxKit");
const { useSoundStore } = await import("../stores/soundStore");
const { useMusicStore } = await import("../stores/musicStore");
const { setRideMuted } = await import("./coasterAudio");
const carousel = await import("./carouselAudio");
const wheel = await import("./wheelAudio");
const drop = await import("./dropTowerAudio");
const moon = await import("./moonBoatAudio");
const { CAROUSEL_CENTER } = await import("@caysonverse/shared/land/carousel");

describe("the level of a ride's sound", () => {
  const site = sfx.RIDE_SFX_SITES.find((s) => s.key === "carousel")!;
  it("is full for the rider, a quieter curve for a spectator, silent far away", () => {
    expect(sfx.rideLevel(true, 0, site.near, site.far, true)).toBe(sfx.RIDER_LEVEL);
    expect(sfx.rideLevel(true, 999, site.near, site.far, true)).toBe(sfx.RIDER_LEVEL);
    expect(sfx.rideLevel(false, site.near, site.near, site.far, true)).toBeCloseTo(sfx.SPECTATOR_PEAK, 9);
    expect(sfx.SPECTATOR_PEAK).toBeLessThan(sfx.RIDER_LEVEL);
    expect(sfx.rideLevel(false, site.far, site.near, site.far, true)).toBe(0);
    expect(sfx.rideLevel(false, site.far + 40, site.near, site.far, true)).toBe(0);
    let prev = 2;
    for (let d = 0; d < site.far + 5; d += 0.5) {
      const l = sfx.rideLevel(false, d, site.near, site.far, true);
      expect(l).toBeLessThanOrEqual(prev + 1e-12);
      prev = l;
    }
  });
  it("is silent whenever sound is not allowed, rider or not", () => {
    expect(sfx.rideLevel(true, 0, site.near, site.far, false)).toBe(0);
    expect(sfx.rideLevel(false, 5, site.near, site.far, false)).toBe(0);
  });
  it("gives the music its own level from the menu: off -> 0, else the volume", () => {
    expect(sfx.menuMusicLevel(false, 1)).toBe(0);
    expect(sfx.menuMusicLevel(true, 0.6)).toBeCloseTo(0.6, 9);
    expect(sfx.menuMusicLevel(true, 7)).toBe(1);
    expect(sfx.menuMusicLevel(true, -1)).toBe(0);
  });
  it("covers every ride but the coaster, each with a sensible reach", () => {
    expect(sfx.RIDE_SFX_SITES.map((s) => s.key).sort()).toEqual(["carousel", "droptower", "moonboat", "wheel"]);
    for (const s of sfx.RIDE_SFX_SITES) expect(s.far).toBeGreaterThan(s.near);
  });
});

describe("the driver, with a fake AudioContext", () => {
  beforeEach(() => {
    useSoundStore.setState({ muted: false });
    useMusicStore.setState({ on: true, volume: 1 });
    setRideMuted(false);
    selfRide.slot = -1;
    selfRide.ride = 0;
    sfxListener.valid = true;
    sfxListener.x = CAROUSEL_CENTER.x + 20;
    sfxListener.z = CAROUSEL_CENTER.z;
    sfxListener.rx = 1;
    sfxListener.rz = 0;
    sfx.setRideSfxActive(true);
  });
  afterEach(() => {
    sfx.setRideSfxActive(false);
    sfxListener.valid = false;
    selfRide.slot = -1;
    selfRide.ride = 0;
  });
  it("builds only the ride you are near, and nothing for the ones far across the park", () => {
    tickFn!();
    expect(sfx.rideSfxBuilt()).toBe(1);
  });
  it("builds nothing while the menu's sound is off, nor while the ride panel's mute is on", () => {
    useSoundStore.setState({ muted: true });
    tickFn!();
    expect(sfx.rideSfxBuilt()).toBe(0);
    useSoundStore.setState({ muted: false });
    setRideMuted(true);
    tickFn!();
    expect(sfx.rideSfxBuilt()).toBe(0);
  });
  it("builds the ride you sit on wherever you are, and frees everything on leaving the park", () => {
    sfxListener.x = 0;
    sfxListener.z = 0;
    selfRide.slot = 3;
    selfRide.ride = 4; // the moon boat
    tickFn!();
    expect(sfx.rideSfxBuilt()).toBe(1);
    sfx.setRideSfxActive(false);
    expect(sfx.rideSfxBuilt()).toBe(0);
  });
});

describe("every ride mix builds and ticks on a fake context without throwing", () => {
  type AnyMix = { update(t: number, i: unknown): void; dispose(): void };
  const cases: [string, (c: unknown, o: unknown) => AnyMix, (t: number, rider: boolean) => unknown][] = [
    ["wheel", wheel.buildWheelMix as never, (t, r) => wheel.wheelInput(t, r ? 0 : -1)],
    ["carousel", carousel.buildCarouselMix as never, (t, r) => carousel.carouselInput(t, r, 1)],
    ["droptower", drop.buildDropMix as never, (t, r) => drop.dropInput(t, r)],
    ["moonboat", moon.buildMoonBoatMix as never, (t, r) => moon.moonBoatInput(t, r)],
  ];
  for (const [name, build, input] of cases) {
    it(name, () => {
      const { ctx, stats } = makeFakeContext();
      const mix = build(ctx, ctx.destination);
      const nodesAfterBuild = stats.nodes;
      for (const rider of [true, false]) for (let ms = 0; ms < 200_000; ms += 100) mix.update(ms / 1000, input(40_000_000 + ms, rider));
      mix.dispose();
      expect(nodesAfterBuild).toBeGreaterThan(5);
      // events make a few one-shot nodes over 400 s of ride, but never one per tick
      expect(stats.nodes - nodesAfterBuild).toBeLessThan(2500);
    });
  }
});

describe("the carousel's tune", () => {
  it("is 16 bars of exactly 3 beats, and every note is a sensible pitch", () => {
    expect(carousel.WALTZ_MELODY.length).toBe(16);
    for (const bar of carousel.WALTZ_MELODY) {
      expect(bar.reduce((a, [, b]) => a + b, 0)).toBeCloseTo(3, 9);
      for (const [m] of bar) expect(m === 0 || (m >= 60 && m <= 96)).toBe(true);
    }
    expect(carousel.WALTZ_BARS.length).toBe(16);
    expect(carousel.WALTZ_BEATS).toBe(48);
  });
  it("hands every melody note to exactly one beat", () => {
    const sounding = carousel.WALTZ_MELODY.flat().filter(([m]) => m > 0).length;
    let heard = 0;
    for (let b = 0; b < carousel.WALTZ_BEATS; b++) heard += carousel.waltzNotesInBeat(b).length;
    expect(heard).toBe(sounding);
  });
  it("winds the pitch up with the platform's speed: flat at speed, far down when it stirs", () => {
    expect(carousel.windBendCents(1)).toBeCloseTo(0, 6);
    expect(carousel.windBendCents(0.55)).toBeCloseTo(0, 6);
    expect(carousel.windBendCents(0)).toBeLessThan(-1000);
    let prev = -9999;
    for (let s = 0; s <= 1; s += 0.05) {
      const c = carousel.windBendCents(s);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
  });
});

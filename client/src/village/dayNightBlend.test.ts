import { describe, expect, it } from "vitest";
import { phaseAt, sunAt } from "@caysonverse/shared/village/sunClock";
import { LIGHTING } from "../game/sceneLighting";
import { inverseNeutralToneMap, neutralToneMap } from "../game/quality";
import {
  DAY_LIFT,
  DAY_LOOK,
  DAY_SUN_DIRECTION,
  EASE_SECONDS,
  KEY_DISTANCE,
  LIGHTS_FULL_AT,
  LIGHTS_ON_ABOVE,
  NIGHT_LOOK,
  NIGHT_MOON,
  SUN_MIN_ELEVATION,
  TARGET_SECONDS,
  cloneState,
  copyState,
  dayNightAt,
  directionFrom,
  easeFactor,
  easeState,
  indoorState,
  keyOffset,
  lightsAt,
  linearHex,
  linearLuma,
  stateFor,
  type DayNightState,
} from "./dayNightBlend";

/** The scene's look from the sun's place on the real clock (Task 7A), at the instants a village visitor meets. */

const kst = (s: string) => Date.parse(`${s}+09:00`);
const at = (s: string) => dayNightAt(kst(s));
const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const RAD = 180 / Math.PI;

describe("the day look is Task 7's preset, unchanged", () => {
  it("DAY_LOOK is exactly what LIGHTING.village always was (the hall and the noon keep their look)", () => {
    const v = LIGHTING.village;
    expect(DAY_LOOK.sky).toBe(v.sky);
    expect(DAY_LOOK.hemiSky).toBe(v.hemi[0]);
    expect(DAY_LOOK.hemiGround).toBe(v.hemi[1]);
    expect(DAY_LOOK.hemiIntensity).toBe(v.hemi[2]);
    expect(DAY_LOOK.keyColor).toBe(v.key.color);
    expect(DAY_LOOK.keyIntensity).toBe(v.key.intensity);
    expect(DAY_LOOK.exposure).toBe(v.exposure);
  });

  it("the baked sun's direction (azimuth 70, 28 up) is the preset's key light position", () => {
    const [x, y, z] = LIGHTING.village.key.position;
    const d = directionFrom(70, 28);
    expect(x / len([x, y, z])).toBeCloseTo(d[0], 2);
    expect(y / len([x, y, z])).toBeCloseTo(d[1], 2);
    expect(z / len([x, y, z])).toBeCloseTo(d[2], 2);
    expect(DAY_SUN_DIRECTION).toEqual(d);
    expect(len([x, y, z])).toBeCloseTo(KEY_DISTANCE, 0);
  });

  it("directionFrom: north is -z, east +x, up +y", () => {
    expect(directionFrom(0, 0)[2]).toBeCloseTo(-1, 9);
    expect(directionFrom(90, 0)[0]).toBeCloseTo(1, 9);
    expect(directionFrom(180, 0)[2]).toBeCloseTo(1, 9);
    expect(directionFrom(123, 90)[1]).toBeCloseTo(1, 9);
  });
});

describe("a summer noon, a winter noon, a midnight", () => {
  it("noon (2026-06-21 12:30): full day, nothing lit, the day look, the sun behind the spawn camera (south, high)", () => {
    const s = at("2026-06-21T12:30:00");
    expect(s.day).toBe(1);
    expect(s.night).toBe(0);
    expect(s.lights).toBe(0);
    expect(s.stars).toBe(0);
    expect(s.exposure).toBe(DAY_LOOK.exposure);
    expect(s.lift).toBe(DAY_LIFT);
    expect(s.dayTint).toEqual([1, 1, 1]);
    expect(s.foliageTint).toEqual([1, 1, 1]);
    expect(s.cherryTint).toEqual([1, 1, 1]);
    expect(s.keyIntensity).toBeCloseTo(DAY_LOOK.keyIntensity, 6);
    expect(s.keyDir[1]).toBeGreaterThan(0.9); // 77 degrees up
    expect(s.keyDir[2]).toBeGreaterThan(0); // south is +z
    expect(s.sunElevationDeg).toBeCloseTo(sunAt(kst("2026-06-21T12:30:00")).elevationDeg, 9);
  });

  it("winter noon: the sun is lower (about 30 degrees) but still full day", () => {
    const s = at("2026-12-21T12:30:00");
    expect(s.day).toBe(1);
    expect(s.sunElevationDeg).toBeGreaterThan(28);
    expect(s.sunElevationDeg).toBeLessThan(32);
    expect(Math.asin(s.keyDir[1]) * RAD).toBeCloseTo(s.sunElevationDeg, 0);
  });

  it("midnight: all night, every light on, the moon the bake's, exposure raised, the sky and fog dark blue", () => {
    const s = at("2026-06-21T23:59:00");
    const noon = at("2026-06-21T12:30:00");
    expect(s.night).toBe(1);
    expect(s.lights).toBe(1);
    expect(s.stars).toBe(1);
    expect(s.exposure).toBe(NIGHT_LOOK.exposure);
    expect(s.exposure).toBeGreaterThan(noon.exposure);
    expect(s.lift).toBeCloseTo(NIGHT_LOOK.lift, 9);
    // The cherry blossoms are darker than the green leaves at night (Task 7A review m-g).
    expect(s.cherryTint).toEqual([0.07, 0.08, 0.115].map((v) => expect.closeTo(v, 9)));
    expect(linearLuma(s.cherryTint)).toBeLessThan(linearLuma(s.foliageTint));
    const moon = directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg);
    for (let i = 0; i < 3; i++) expect(s.keyDir[i]).toBeCloseTo(moon[i]!, 9);
    expect(s.keyColor[2]).toBeGreaterThan(s.keyColor[0]); // the moon is blue-white
    expect(s.sky[2]).toBeGreaterThan(s.sky[0]);
    expect(linearLuma(s.sky)).toBeLessThan(linearLuma(noon.sky) / 10);
    expect(linearLuma(s.domeTint)).toBeLessThan(0.1);
    expect(s.hemiIntensity).toBeLessThan(noon.hemiIntensity);
    expect(NIGHT_MOON).toEqual({ azimuthDeg: 150, elevationDeg: 42 }); // art/village/tools/bake_village.py NIGHT
  });

  it("night comes from the date: 19:45 on the summer solstice is still dusk, but 19:45 in December is deep night", () => {
    expect(at("2026-06-21T19:45:00").night).toBeLessThan(0.6);
    expect(at("2026-12-21T19:45:00").night).toBe(1);
    expect(at("2026-12-21T06:30:00").night).toBe(1); // before the winter dawn
    expect(at("2026-06-21T07:00:00").night).toBe(0);
  });
});

describe("the lamps, windows and fountain lights: on once the night weight passes 0.3", () => {
  it("lightsAt: 0 up to 0.3 (the brief's threshold), a quick ease, 1 from 0.5", () => {
    expect(LIGHTS_ON_ABOVE).toBe(0.3);
    expect(lightsAt(0)).toBe(0);
    expect(lightsAt(0.3)).toBe(0);
    expect(lightsAt(0.3001)).toBeGreaterThan(0);
    expect(lightsAt(0.4)).toBeGreaterThan(0.4);
    expect(lightsAt(0.4)).toBeLessThan(0.6);
    expect(lightsAt(LIGHTS_FULL_AT)).toBe(1);
    expect(lightsAt(1)).toBe(1);
  });

  it("across the sun's whole range (-30 to +60 degrees): never lit while night <= 0.3, lit above it, fully lit from 0.5, and monotonic as the sun sets", () => {
    for (let el = 60; el >= -30; el -= 0.1) {
      const s = stateFor(el, 250);
      if (s.night <= 0.3) expect(s.lights, `el ${el}`).toBe(0);
      else expect(s.lights, `el ${el}`).toBeGreaterThan(0);
      if (s.night >= 0.5) expect(s.lights, `el ${el}`).toBe(1);
    }
    let last = -1;
    for (let el = 30; el >= -30; el -= 0.25) {
      const l = stateFor(el, 250).lights;
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
  });

  it("they come on just after sunset: lit by the time the sun is on the horizon, off while it is still well above it", () => {
    expect(stateFor(6, 270).lights).toBe(0);
    expect(stateFor(3, 270).lights).toBe(0);
    expect(stateFor(0, 270).lights).toBe(1);
    expect(stateFor(-2, 270).lights).toBe(1);
  });
});

describe("dawn and dusk: the blend, the golden hour and the key light", () => {
  it("the night weight is phaseAt's: half and half on the horizon; the golden hour peaks a little above it", () => {
    for (const el of [-12, -8, -4, 0, 3, 6, 12, 40]) {
      const s = stateFor(el, 250);
      expect(s.night).toBeCloseTo(phaseAt(el).night, 12);
      expect(s.day).toBeCloseTo(phaseAt(el).day, 12);
      expect(s.golden).toBeCloseTo(phaseAt(el).golden, 12);
    }
    expect(stateFor(0, 250).night).toBeCloseTo(0.5, 12);
    expect(stateFor(3, 250).golden).toBe(1);
  });

  it("the golden hour warms the light: the haze, the sun and the day side's tint lean red; nothing leans red at noon or midnight", () => {
    const gold = stateFor(3, 280);
    const noon = stateFor(60, 180);
    const ratio = (c: readonly number[]) => c[0]! / c[2]!;
    expect(ratio(gold.sky)).toBeGreaterThan(ratio(noon.sky) * 1.4);
    expect(ratio(gold.keyColor)).toBeGreaterThan(ratio(noon.keyColor));
    expect(gold.dayTint[0]).toBeGreaterThan(1);
    expect(gold.dayTint[2]).toBeLessThan(1);
    expect(ratio(gold.domeTint)).toBeGreaterThan(ratio(noon.domeTint));
    expect(stateFor(-30, 280).golden).toBe(0);
  });

  it("the live key light is the sun and the moon in one: a unit direction, finite numbers, a sun held at 14 degrees at least", () => {
    for (let el = -30; el <= 80; el += 0.5) {
      const s = stateFor(el, 90 + el * 3);
      expect(len(s.keyDir), `el ${el}`).toBeCloseTo(1, 9);
      expect(s.keyIntensity).toBeGreaterThan(0);
      for (const c of [...s.keyColor, ...s.sky, ...s.hemiSky, ...s.hemiGround, s.exposure, s.hemiIntensity, s.lift]) expect(Number.isFinite(c)).toBe(true);
    }
    // While the sun is above the horizon its direction is never lower than the clamp (its shadows stay in the box).
    for (let el = 0; el <= 15; el += 1) {
      const d = stateFor(el, 285).keyDir;
      expect(Math.asin(d[1]) * RAD, `el ${el}`).toBeGreaterThanOrEqual(SUN_MIN_ELEVATION - 1e-6);
    }
    // At night it is the moon's direction, 42 degrees up.
    expect(Math.asin(stateFor(-30, 285).keyDir[1]) * RAD).toBeCloseTo(NIGHT_MOON.elevationDeg, 6);
  });

  it("every look value moves smoothly with the clock: no step larger than 0.02 in 10 s, all through two whole days", () => {
    const fields: Array<(s: DayNightState) => number> = [
      (s) => s.night,
      (s) => s.lights,
      (s) => s.exposure,
      (s) => s.keyIntensity,
      (s) => s.hemiIntensity,
      (s) => linearLuma(s.sky),
      (s) => s.keyDir[1],
      (s) => s.dayTint[0],
      (s) => s.stars,
    ];
    for (const date of ["2026-06-21", "2026-12-21"]) {
      const start = kst(`${date}T00:00:00`);
      let prev = dayNightAt(start);
      for (let t = start + TARGET_SECONDS * 1000; t < start + 86_400_000; t += TARGET_SECONDS * 1000) {
        const s = dayNightAt(t);
        fields.forEach((f, i) => expect(Math.abs(f(s) - f(prev)), `${date} field ${i} at ${new Date(t).toISOString()}`).toBeLessThan(0.02));
        prev = s;
      }
    }
  });
});

describe("the memorial hall: always the warm indoor light", () => {
  it("indoorState never carries the night: the day look, nothing lit, the baked afternoon's light and direction", () => {
    const s = indoorState();
    expect(s.night).toBe(0);
    expect(s.lights).toBe(0);
    expect(s.stars).toBe(0);
    expect(s.exposure).toBe(DAY_LOOK.exposure);
    expect(s.keyIntensity).toBe(DAY_LOOK.keyIntensity);
    expect(s.keyDir).toEqual(DAY_SUN_DIRECTION);
    expect(s.dayTint).toEqual([1, 1, 1]);
    expect(s.sky).toEqual(linearHex(DAY_LOOK.sky));
    expect(s.lift).toBe(DAY_LIFT);
    expect(indoorState()).toEqual(s); // a constant: the same at every hour
  });
});

describe("the sky's clear colour on the rich tier (the tone curve is undone for the haze)", () => {
  it("at night the compensation round-trips: tone-mapping the clear colour gives the haze back", () => {
    const night = at("2026-06-21T23:59:00");
    const clear = inverseNeutralToneMap(night.sky, night.exposure);
    const back = neutralToneMap(clear, night.exposure);
    for (let i = 0; i < 3; i++) expect(back[i]!).toBeCloseTo(night.sky[i]!, 4);
  });
});

describe("easing: the look glides to its target and never steps", () => {
  it("easeFactor: 0 for no time, 63% after one time constant, never past 1", () => {
    expect(easeFactor(0)).toBe(0);
    expect(easeFactor(-1)).toBe(0);
    expect(easeFactor(EASE_SECONDS)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(easeFactor(1e6)).toBeLessThanOrEqual(1);
    expect(easeFactor(0.016)).toBeLessThan(0.01);
  });

  it("easeState moves every number toward the target in place, keeps the key direction a unit vector, and reaches it", () => {
    const from = stateFor(60, 180);
    const to = stateFor(-20, 180);
    const cur = cloneState(from);
    const refSky = cur.sky; // the same arrays throughout: no allocation per frame
    easeState(cur, to, 0.5);
    expect(cur.sky).toBe(refSky);
    expect(cur.night).toBeGreaterThan(from.night);
    expect(cur.night).toBeLessThan(to.night);
    expect(len(cur.keyDir)).toBeCloseTo(1, 12);
    for (let i = 0; i < 4000; i++) easeState(cur, to, 0.1);
    expect(cur.night).toBeCloseTo(to.night, 9);
    expect(cur.exposure).toBeCloseTo(to.exposure, 9);
    for (let i = 0; i < 3; i++) expect(cur.sky[i]!).toBeCloseTo(to.sky[i]!, 9);
    expect(cur.keyDir[1]).toBeCloseTo(to.keyDir[1], 9);
  });

  it("copyState overwrites in place; cloneState shares nothing", () => {
    const a = stateFor(10, 100);
    const b = stateFor(-30, 100);
    const c = cloneState(a);
    c.sky[0] = 99;
    expect(a.sky[0]).not.toBe(99);
    const sky = c.sky;
    copyState(c, b);
    expect(c.sky).toBe(sky);
    expect(c).toEqual(b);
  });

  it("keyOffset: the key light's position relative to its target, KEY_DISTANCE out, written in place", () => {
    const into: [number, number, number] = [0, 0, 0];
    const out = keyOffset([0, 1, 0], into);
    expect(out).toBe(into);
    expect(into).toEqual([0, KEY_DISTANCE, 0]);
    keyOffset(directionFrom(70, 28), into);
    expect(len(into)).toBeCloseTo(KEY_DISTANCE, 9);
  });
});

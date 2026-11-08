import { afterEach, describe, expect, it } from "vitest";
import { parseKstTime, phaseAt, sunAt } from "@caysonverse/shared/village/sunClock";
import { NIGHT_MAP_LEAD_MS, nightMapWanted, nightMapWantedAt, setNightMapOverride } from "./nightLightmap";

const kst = (t: string) => parseKstTime(t)!;
const night = (ms: number) => phaseAt(sunAt(ms).elevationDeg).night;

/** The first minute (scanning from `from`, KST) at which `pred` flips. */
function firstFlip(from: string, minutes: number, pred: (ms: number) => boolean): number {
  const t0 = kst(from);
  const start = pred(t0);
  for (let m = 1; m <= minutes; m++) if (pred(t0 + m * 60000) !== start) return t0 + m * 60000;
  throw new Error("no flip");
}

afterEach(() => setNightMapOverride(null));

describe("nightLightmap — the night light map loads only when night is near (final fix I2b)", () => {
  it("noon: not wanted; midnight: wanted (summer and winter)", () => {
    for (const day of ["2026-06-21", "2026-11-03", "2026-12-21"]) {
      expect(nightMapWantedAt(kst(`${day}T12:30`)), day).toBe(false);
      expect(nightMapWantedAt(kst(`${day}T23:30`)), day).toBe(true);
      expect(nightMapWantedAt(kst(`${day}T03:00`)), day).toBe(true);
    }
  });

  it("it is wanted at least 30 minutes before sunset and NIGHT_MAP_LEAD_MS before the night blend starts", () => {
    for (const day of ["2026-06-21", "2026-11-03", "2026-12-21"]) {
      const sunset = firstFlip(`${day}T14:00`, 8 * 60, (ms) => sunAt(ms).elevationDeg < -0.833);
      const blendStarts = firstFlip(`${day}T14:00`, 8 * 60, (ms) => night(ms) > 0);
      const wantedFrom = firstFlip(`${day}T14:00`, 8 * 60, nightMapWantedAt);
      expect(sunset - wantedFrom, day).toBeGreaterThanOrEqual(30 * 60000);
      expect(blendStarts - wantedFrom, day).toBeGreaterThanOrEqual(NIGHT_MAP_LEAD_MS - 60000);
      expect(blendStarts - wantedFrom, day).toBeLessThanOrEqual(NIGHT_MAP_LEAD_MS + 60000);
    }
  });

  it("it stays wanted through sunrise until the night blend is 0 again", () => {
    for (const day of ["2026-06-21", "2026-11-03", "2026-12-21"]) {
      const sunrise = firstFlip(`${day}T03:00`, 8 * 60, (ms) => sunAt(ms).elevationDeg > -0.833);
      const blendEnds = firstFlip(`${day}T03:00`, 8 * 60, (ms) => night(ms) === 0);
      const unwanted = firstFlip(`${day}T03:00`, 8 * 60, (ms) => !nightMapWantedAt(ms));
      expect(unwanted, day).toBeGreaterThan(sunrise);
      expect(Math.abs(unwanted - blendEnds), day).toBeLessThanOrEqual(60000);
    }
  });

  it("the override wins over the clock, and null gives the decision back", () => {
    const noon = kst("2026-11-03T12:30");
    expect(nightMapWanted(noon)).toBe(false);
    setNightMapOverride(true);
    expect(nightMapWanted(noon)).toBe(true);
    setNightMapOverride(false);
    expect(nightMapWanted(kst("2026-11-03T23:30"))).toBe(false);
    setNightMapOverride(null);
    expect(nightMapWanted(noon)).toBe(false);
  });
});

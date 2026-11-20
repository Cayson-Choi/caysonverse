import { describe, expect, it } from "vitest";
import { coasterTrack, CREST_Y, STATION_Y } from "@caysonverse/shared/land/coaster";
import { ALTITUDE_FULL_M, ALTITUDE_FROM_M, altitudeFactor, altitudeFogFar, altitudeFogNear, altitudeFogTint, altitudeWindGain, hazeLineDip } from "./parkAltitude";

describe("the park's altitude look", () => {
  it("is 0 on the ground and the low rides' height, 1 at the lift's crest, and rises smoothly in between", () => {
    expect(altitudeFactor(1.7)).toBe(0);
    expect(altitudeFactor(ALTITUDE_FROM_M)).toBe(0);
    expect(altitudeFactor(CREST_Y + 1)).toBe(1);
    expect(altitudeFactor(ALTITUDE_FULL_M)).toBe(1);
    let prev = -1;
    for (let y = 0; y <= 70; y += 0.5) {
      const a = altitudeFactor(y);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    // the lift: station height 0, a third up already visible, the middle strongly
    const track = coasterTrack();
    const mid = (track.liftFrom + track.liftTo) / 2;
    const yMid = track.pos[3 * Math.round(mid) + 1]! + 1.4;
    expect(yMid).toBeGreaterThan(30);
    expect(altitudeFactor(yMid)).toBeGreaterThan(0.25);
    expect(altitudeFactor(STATION_Y + 1.4)).toBe(0);
  });
  it("brings the fog band in and drops the haze line below the horizon as the eye rises", () => {
    expect(altitudeFogFar(900, 0)).toBe(900);
    expect(altitudeFogFar(900, 1)).toBeLessThan(600);
    expect(altitudeFogNear(120, 1)).toBeLessThan(70);
    // the haze line is farther below the eye at the top than on the ground, by several degrees
    const ground = hazeLineDip(1.7, 900);
    const top = hazeLineDip(68, altitudeFogFar(900, 1));
    expect(top).toBeGreaterThan(ground + 0.1); // > 6 degrees lower
  });
  it("tints the distance bluer (red and green down, blue held) and raises the wind", () => {
    const c = altitudeFogTint([0.8, 0.9, 1], 1);
    expect(c[0]).toBeLessThan(0.8);
    expect(c[2]).toBeGreaterThanOrEqual(0.99);
    expect(altitudeFogTint([0.8, 0.9, 1], 0)).toEqual([0.8, 0.9, 1]);
    expect(altitudeWindGain(1)).toBeGreaterThan(altitudeWindGain(0.3));
  });
});

import { describe, expect, it } from "vitest";
import {
  CARDINALS,
  directionName,
  headingChanged,
  headingFromDirection,
  headingFromYaw,
  nearestCardinal,
  ringRotation,
  wrapDeg,
} from "./compass";

describe("compass", () => {
  it("wraps angles into [0, 360)", () => {
    expect(wrapDeg(-90)).toBe(270);
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(725)).toBe(5);
    expect(wrapDeg(NaN)).toBe(0);
  });

  it("reads the world's axes: north is -Z, east is +X", () => {
    expect(headingFromDirection(0, -1)).toBeCloseTo(0);
    expect(headingFromDirection(1, 0)).toBeCloseTo(90);
    expect(headingFromDirection(0, 1)).toBeCloseTo(180);
    expect(headingFromDirection(-1, 0)).toBeCloseTo(270);
    expect(headingFromDirection(1, -1)).toBeCloseTo(45);
    expect(headingFromDirection(0, 0)).toBe(0);
  });

  it("maps the camera orbit yaw to the heading it looks along", () => {
    // yaw 0: the camera is south of the player and looks north; the look direction is -(sin yaw, cos yaw).
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.2]) {
      const dir = headingFromDirection(-Math.sin(yaw), -Math.cos(yaw));
      expect(headingFromYaw(yaw)).toBeCloseTo(dir, 6);
    }
    expect(headingFromYaw(0)).toBeCloseTo(0);
    expect(headingFromYaw(-Math.PI / 2)).toBeCloseTo(90); // east
    expect(headingFromYaw(Math.PI)).toBeCloseTo(180); // south
    expect(headingFromYaw(Math.PI / 2)).toBeCloseTo(270); // west
  });

  it("names the eight directions and the nearest of the four", () => {
    expect(directionName(0)).toBe("북");
    expect(directionName(44)).toBe("북동");
    expect(directionName(90)).toBe("동");
    expect(directionName(180)).toBe("남");
    expect(directionName(270)).toBe("서");
    expect(directionName(359)).toBe("북");
    expect(nearestCardinal(350).label).toBe("북");
    expect(nearestCardinal(100).label).toBe("동");
    expect(nearestCardinal(200).label).toBe("남");
    expect(nearestCardinal(250).label).toBe("서");
    expect(CARDINALS.map((c) => c.label).join("")).toBe("북동남서");
  });

  it("turns the ring against the heading, so the facing letter is at the top", () => {
    expect(ringRotation(0)).toBe(-0);
    expect(ringRotation(90)).toBe(-90); // facing east: north swings to the left, east comes to the top
    // The letter at ring angle a (deg clockwise from the top) ends up at a + rotation: east (90) lands on 0.
    expect(wrapDeg(90 + ringRotation(90))).toBe(0);
    expect(wrapDeg(270 + ringRotation(270))).toBe(0);
  });

  it("redraws only for real changes, also across the 0/360 seam", () => {
    expect(headingChanged(10, 10.1)).toBe(false);
    expect(headingChanged(10, 11)).toBe(true);
    expect(headingChanged(359.9, 0.1)).toBe(false);
    expect(headingChanged(359, 1)).toBe(true);
  });
});

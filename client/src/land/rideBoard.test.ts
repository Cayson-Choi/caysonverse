import { describe, expect, it } from "vitest";
import { armRide, armedRide, rideForTap, rideTapSpot, rideTapZone, takeArmedRide } from "./rideBoard";

describe("tapping a ride", () => {
  it("knows the rides' footprints", () => {
    expect(rideTapZone(110, -135)).toBe("carousel");
    expect(rideTapZone(205, -140)).toBe("wheel");
    expect(rideTapZone(2, -14)).toBe("coaster"); // the station apron
    expect(rideTapZone(40, -112)).toBeNull(); // the plaza
  });
  it("a tap that lands on the lawn behind a ride still means the ride when its ray passed through the ride", () => {
    // from the avenue (64, 1.7, -114) looking at the carousel and through it to the lawn at (149, -138)
    const o = { x: 64, y: 1.7, z: -114 };
    const to = { x: 149, y: 0, z: -138 };
    const len = Math.hypot(to.x - o.x, to.y - o.y, to.z - o.z);
    const ray = { o, d: { x: (to.x - o.x) / len, y: (to.y - o.y) / len, z: (to.z - o.z) / len } };
    expect(rideForTap(to.x, to.z, ray, len)).toBe("carousel");
    expect(rideForTap(to.x, to.z, null, 0)).toBeNull();
  });
  it("is armed for a walk and fires once at the pad", () => {
    const pad = rideTapSpot("carousel");
    armRide("carousel", 0);
    expect(armedRide()).toBe("carousel");
    expect(takeArmedRide(pad.x - 30, pad.z, 1000)).toBeNull();
    expect(takeArmedRide(pad.x - 1, pad.z, 2000)).toBe("carousel");
    expect(armedRide()).toBeNull();
    armRide("wheel", 0);
    expect(takeArmedRide(rideTapSpot("wheel").x, rideTapSpot("wheel").z, 300_000)).toBeNull(); // too long
  });
});

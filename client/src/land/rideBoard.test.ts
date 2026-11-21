import { describe, expect, it } from "vitest";
import { armRide, armedRide, rideForTap, rideTapSpot, rideTapZone, takeArmedRide } from "./rideBoard";

describe("tapping a ride", () => {
  it("knows the rides' footprints", () => {
    expect(rideTapZone(110, -135)).toBe("carousel");
    expect(rideTapZone(205, -140)).toBe("wheel");
    expect(rideTapZone(-95, -140)).toBe("moonboat");
    expect(rideTapZone(-86, -140)).toBe("moonboat"); // its platform
    expect(rideTapZone(-75, -88)).toBe("droptower");
    expect(rideTapZone(-65, -88)).toBe("droptower"); // its platform
    expect(rideTapZone(2, -4)).toBe("coaster"); // the station platform
    expect(rideTapZone(2, -14)).toBe(null); // the apron in front of the steps is ground: a tap walks there, never boards
    expect(rideTapZone(40, -112)).toBeNull(); // the plaza
  });
  it("a tap on the ground is never a ride, whatever its ray crossed (owner 2026-11-21: only the 타기 button boards)", () => {
    // from the avenue (64, 1.7, -114) looking at the carousel and through it to the lawn at (149, -138)
    const o = { x: 64, y: 1.7, z: -114 };
    const to = { x: 149, y: 0, z: -138 };
    const len = Math.hypot(to.x - o.x, to.y - o.y, to.z - o.z);
    const ray = { o, d: { x: (to.x - o.x) / len, y: (to.y - o.y) / len, z: (to.z - o.z) / len } };
    expect(rideForTap(to.x, to.z, ray, len, 0, 1)).toBeNull(); // the lawn seen between the horses: a walk there
    expect(rideForTap(to.x, to.z, ray, len, 0)).toBeNull(); // (no normal known: the height alone)
    // the ground inside every ride's footprint: the carousel's deck edge, the wheel's base, the moon boat's and the tower's platforms, the station
    for (const [x, z] of [[110, -135], [205, -140], [-95, -140], [-86, -140], [-75, -88], [-65, -88], [2, -4]] as const) {
      expect(rideTapZone(x, z), `${x},${z}`).not.toBeNull();
      for (const y of [0, 0.05, 0.12, 0.2]) expect(rideForTap(x, z, null, 0, y, 1), `${x},${z} y ${y}`).toBeNull();
    }
  });
  it("a tap on a ride's own body (raised, or an upright face) is that ride: the walk to its pad, never a board", () => {
    expect(rideForTap(110, -135, null, 0, 2.2, 0)).toBe("carousel"); // a horse
    expect(rideForTap(110, -135, null, 0, 0.3, 0.1)).toBe("carousel"); // the deck's rim (an upright face, low)
    expect(rideForTap(-86, -140, null, 0, 1.4, 1)).toBe("moonboat"); // its raised platform's top
    expect(rideForTap(110, -127, null, 0, 0.55, 1)).toBe("carousel"); // its deck (0.55 m up: not walked onto by a tap)
    // through the wheel's spokes onto its far frame (not ground): the wheel
    const o = { x: 205, y: 1.7, z: -100 };
    const to = { x: 205, y: 20, z: -160 };
    const len = Math.hypot(to.x - o.x, to.y - o.y, to.z - o.z);
    const ray = { o, d: { x: 0, y: (to.y - o.y) / len, z: (to.z - o.z) / len } };
    expect(rideForTap(to.x, to.z, ray, len, 20, 0)).toBe("wheel");
    expect(rideForTap(40, -112, null, 0, 3, 0)).toBeNull(); // a lamp on the plaza
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

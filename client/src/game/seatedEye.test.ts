import { describe, expect, it } from "vitest";
import { SIT_ROOT_AHEAD } from "@caysonverse/shared/sitPose";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { VILLAGE_SEAT_MARKERS } from "@caysonverse/shared/village/generated/villageSeatMarkers";
import { SEATED_HEAD_BEHIND_ROOT, seatedEyeOffset, stepSeatedWeight } from "./seatedEye";

describe("the seated first-person eye (review 2026-11-15)", () => {
  it("sits over the chair, not over the table: the eye is at the seated head, behind the seat's front edge", () => {
    for (const s of VILLAGE_SEATS.filter((v) => v.bench.startsWith("cafe_terrace_"))) {
      const m = VILLAGE_SEAT_MARKERS.find((k) => k.id === s.bench)!;
      const o = seatedEyeOffset(s.yaw, s.seatY, 1);
      const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
      const eyeAhead = (s.x + o.dx - m.x) * f.x + (s.z + o.dz - m.z) * f.z; // from the chair's centre along its facing
      expect(eyeAhead).toBeCloseTo(m.frontEdge + SIT_ROOT_AHEAD - SEATED_HEAD_BEHIND_ROOT, 6);
      expect(eyeAhead).toBeLessThan(m.frontEdge); // over the seat
      expect(o.dy).toBeGreaterThan(0.1);
    }
  });
  it("eases in and out", () => {
    let w = 0;
    for (let i = 0; i < 60; i++) w = stepSeatedWeight(w, true, 1 / 60);
    expect(w).toBeGreaterThan(0.99);
    expect(seatedEyeOffset(0, 0.46, 0)).toEqual({ dx: -0, dy: 0, dz: -0 });
  });
});

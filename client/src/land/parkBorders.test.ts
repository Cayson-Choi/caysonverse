import { PARK_LAMPS, PARK_PLAZA } from "@caysonverse/shared/village/parkArea";
import { describe, expect, it } from "vitest";
import { parkBorders } from "./parkBorders";

describe("the planted borders beside the station and plaza", () => {
  it("keeps both paths and the lamp bases clear along the entire stone edge", () => {
    const edge = parkBorders().edging.getAttribute("position");
    let clear = true;
    for (let i = 0; i < edge.count; i++) {
      const x = edge.getX(i), z = edge.getZ(i);
      const onApproach = x >= -4 && x <= 8 && z >= -106 && z <= -19;
      const onAvenue = x >= -23 && x <= 345 && z >= -118 && z <= -106;
      const onPlaza = Math.hypot(x - PARK_PLAZA.x, z - PARK_PLAZA.z) <= PARK_PLAZA.radius;
      const onLamp = PARK_LAMPS.some(lamp => Math.hypot(x - lamp.x, z - lamp.z) < 0.4);
      if (onApproach || onAvenue || onPlaza || onLamp) clear = false;
    }
    expect(clear).toBe(true);
  });
});

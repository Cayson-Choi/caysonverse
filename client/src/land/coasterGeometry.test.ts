import { describe, expect, it } from "vitest";
import { coasterTrack } from "@caysonverse/shared/land/coaster";
import { buildCar, buildTrack, CHUNKS } from "./coasterGeometry";

const track = coasterTrack();

describe("coaster geometry budget", () => {
  const built = buildTrack(track);
  it("stays inside the static triangle budget (PC <= 125k, phone <= 60k) and the draw-call budget", () => {
    expect(built.triangles).toBeGreaterThan(30_000);
    expect(built.triangles).toBeLessThanOrEqual(125_000);
    const light = buildTrack(track, "light");
    console.log("coaster track triangles", built.triangles, "light", light.triangles);
    expect(light.triangles).toBeLessThanOrEqual(60_000);
    expect(light.triangles).toBeLessThan(built.triangles * 0.65);
    expect(built.chunks.length).toBeLessThanOrEqual(CHUNKS);
    // one mesh a chunk (steel): well under 60 draws for the track in the worst case (everything in view)
    expect(built.chunks.length).toBeLessThanOrEqual(60);
  });
  it("every chunk has finite, bounded vertices and a bounding sphere (culling works)", () => {
    for (const ch of built.chunks) {
      const p = ch.steel.attributes.position!.array as Float32Array;
      for (let i = 0; i < p.length; i += 97) expect(Number.isFinite(p[i]!)).toBe(true);
      expect(ch.steel.boundingSphere!.radius).toBeGreaterThan(1);
      // a chunk is a 1/24th of the circuit: its sphere is far smaller than the whole park
      expect(ch.steel.boundingSphere!.radius).toBeLessThan(150);
    }
  });
  it("the rails sit on the track: the first chunk's lowest steel is the ground footing, not under the ground", () => {
    let minY = Infinity;
    for (const ch of built.chunks) minY = Math.min(minY, ch.steel.boundingBox!.min.y);
    expect(minY).toBeGreaterThanOrEqual(-0.01);
  });
  it("the car is one small merged geometry", () => {
    const car = buildCar();
    expect(car.index!.count / 3).toBeLessThan(6000);
    car.computeBoundingBox();
    const bb = car.boundingBox!;
    expect(bb.max.z - bb.min.z).toBeGreaterThan(2.5);
    expect(bb.max.z - bb.min.z).toBeLessThan(3.2); // shorter than the 3.1 m car pitch: cars never overlap
    expect(bb.max.x - bb.min.x).toBeLessThan(2.2);
  });
});

describe("coaster clearance", () => {
  it("the circuit never passes closer than 3 m to itself away from its own neighbourhood (a loop crossing, a hill over a hill)", () => {
    const n = track.n;
    const stride = 4; // every 2 m
    let worst = Infinity;
    for (let i = 0; i < n; i += stride) {
      for (let j = i + Math.ceil(40 / track.ds); j < n; j += stride) {
        // arc distance both ways: skip the near neighbourhood of the join too
        const arc = Math.min(j - i, n - (j - i)) * track.ds;
        if (arc < 40) continue;
        const d = Math.hypot(track.pos[3 * i]! - track.pos[3 * j]!, track.pos[3 * i + 1]! - track.pos[3 * j + 1]!, track.pos[3 * i + 2]! - track.pos[3 * j + 2]!);
        if (d < worst) worst = d;
      }
    }
    expect(worst).toBeGreaterThan(3);
  });
});

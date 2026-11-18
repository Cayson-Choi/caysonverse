// A held-up fish is shown back up, never belly-up (owner 2026-11-18: "물고기가 뒤집혀 있어"): rollFlankToward(q, nose, toward, flank).
import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { rollFlankToward } from "./catchRig";

const Z = new Vector3(0, 0, 1);
/** nose along `dir`, back as near up as it can be (lakeAlong's start), then the flank roll. */
function pose(dir: Vector3, toward: Vector3, flank: 1 | -1): { back: Vector3; side: Vector3; q: Quaternion } {
  const n = dir.clone().normalize();
  const q = new Quaternion().setFromUnitVectors(Z, n);
  rollFlankToward(q, n, toward, flank);
  return { q, back: new Vector3(0, 1, 0).applyQuaternion(q), side: new Vector3(flank, 0, 0).applyQuaternion(q) };
}

describe("rollFlankToward", () => {
  it("nose to the viewer's right, the -X flank to the viewer: back up", () => {
    const { back, side } = pose(new Vector3(1, 0.1, -0.15), new Vector3(0, 0, 1), -1);
    expect(back.y).toBeGreaterThan(0.9);
    expect(side.z).toBeGreaterThan(0.9);
  });
  it("the +X flank to the viewer with the nose to the right is belly-up (the bug)", () => {
    const { back } = pose(new Vector3(1, 0, 0), new Vector3(0, 0, 1), 1);
    expect(back.y).toBeLessThan(-0.9);
  });
  it("nose toward the avatar's right hand, the +X flank to its front: back up", () => {
    const { back, side } = pose(new Vector3(-1, 0.3, 0), new Vector3(0, 0, 1), 1);
    expect(back.y).toBeGreaterThan(0.9);
    expect(side.z).toBeGreaterThan(0.9);
  });
  it("hanging head up, the +X flank to the viewer: the back to the viewer's right", () => {
    const { back, side } = pose(new Vector3(0, 1, 0), new Vector3(0, 0, 1), 1);
    expect(back.x).toBeGreaterThan(0.9);
    expect(side.z).toBeGreaterThan(0.9);
  });
});

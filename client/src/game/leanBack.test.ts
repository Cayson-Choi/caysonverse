import { describe, expect, it } from "vitest";
import { Object3D, Quaternion } from "three";
import { LEAN_RATE, easeLean, forgetLean, stepLean } from "./leanBack";

function rig() {
  const root = new Object3D();
  const spine = new Object3D();
  spine.name = "spine";
  const chest = new Object3D();
  chest.name = "chest";
  spine.add(chest);
  root.add(spine);
  return { root, spine, chest };
}
const angle = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

describe("easeLean", () => {
  it("moves toward the target at LEAN_RATE and never overshoots", () => {
    expect(easeLean(0, 0.2, 0.1)).toBeCloseTo(LEAN_RATE * 0.1, 9);
    expect(easeLean(0.19, 0.2, 1)).toBe(0.2);
    expect(easeLean(0.2, 0, 10)).toBe(0);
    expect(easeLean(0.1, 0.1, 1)).toBe(0.1);
  });
});

describe("stepLean — the lean-back pose of a backed seat", () => {
  it("turns the spine and the chest back by 60 / 40 % of the angle, and stands upright again at 0", () => {
    const { root, spine, chest } = rig();
    for (let i = 0; i < 40; i++) stepLean(root, 0.2, 0.1);
    expect(angle(spine.quaternion)).toBeCloseTo(0.12, 5);
    expect(angle(chest.quaternion)).toBeCloseTo(0.08, 5);
    expect(spine.quaternion.x).toBeLessThan(0); // backwards
    for (let i = 0; i < 40; i++) stepLean(root, 0, 0.1);
    expect(angle(spine.quaternion)).toBeCloseTo(0, 6);
    expect(angle(chest.quaternion)).toBeCloseTo(0, 6);
    forgetLean(root);
  });

  it("does not pile up while the mixer is paused (the same frame written again leaves the same pose)", () => {
    const { root, spine } = rig();
    for (let i = 0; i < 60; i++) stepLean(root, 0.2, 0.1);
    const a = spine.quaternion.clone();
    for (let i = 0; i < 60; i++) stepLean(root, 0.2, 0.1);
    expect(spine.quaternion.angleTo(a)).toBeLessThan(1e-6);
  });

  it("builds on a pose the mixer rewrote (a new base each time the bone is not what was written)", () => {
    const { root, spine } = rig();
    stepLean(root, 0.2, 5);
    spine.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 0.3); // the mixer wrote its own pose
    stepLean(root, 0.2, 5);
    expect(spine.quaternion.y).toBeGreaterThan(0.1); // still the mixer's turn about y, with the lean on top
  });

  it("an avatar that never leans is left alone", () => {
    const { root, spine } = rig();
    expect(stepLean(root, 0, 0.1)).toBe(0);
    expect(spine.quaternion.w).toBe(1);
  });
});

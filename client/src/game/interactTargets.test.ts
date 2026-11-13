import { afterEach, describe, expect, it } from "vitest";
import { fireTarget, getTargets, setTargetHandler, setTargetSource } from "./interactTargets";
import type { InteractTarget } from "./interact";
import type { Pose } from "./types";

const pose: Pose = { x: 3, z: -4, yaw: 0 };
const target: InteractTarget = { kind: "object", id: "bench_note", dist: 1, icon: "💬", label: "말 걸기" };

afterEach(() => {
  setTargetSource(null);
  setTargetHandler(null);
});

describe("interactTargets (the scene's target plug)", () => {
  it("offers nothing until a scene plugs a source in, and nothing again once it unplugs", () => {
    expect(getTargets(pose)).toEqual([]);
    setTargetSource(() => [target]);
    expect(getTargets(pose)).toEqual([target]);
    setTargetSource(null);
    expect(getTargets(pose)).toEqual([]);
  });

  it("hands the source the pose it was asked about, and returns what the source returned", () => {
    const seen: Pose[] = [];
    const list = [target];
    setTargetSource((p) => {
      seen.push(p);
      return list;
    });
    expect(getTargets(pose)).toBe(list);
    expect(seen).toEqual([pose]);
  });

  it("the empty answer is one shared frozen list (the 5 Hz tick allocates nothing for it)", () => {
    expect(getTargets(pose)).toBe(getTargets({ x: 0, z: 0, yaw: 1 }));
    expect(Object.isFrozen(getTargets(pose))).toBe(true);
  });

  it("fireTarget calls the handler with the target and the phase; no handler → nothing happens", () => {
    expect(() => fireTarget(target, "press")).not.toThrow();
    const calls: string[] = [];
    setTargetHandler((t, phase) => calls.push(`${t.id}:${phase}`));
    fireTarget(target, "press");
    fireTarget(target, "release");
    expect(calls).toEqual(["bench_note:press", "bench_note:release"]);
    setTargetHandler(null);
    fireTarget(target, "press");
    expect(calls).toHaveLength(2);
  });
});

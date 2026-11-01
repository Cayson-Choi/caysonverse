import { describe, it, expect } from "vitest";
import { MessageType } from "../messages";
import { ClassMsg } from "./messages";

describe("ClassMsg", () => {
  it("every value is unique, c_-prefixed and never collides with a world MessageType", () => {
    const values = Object.values(ClassMsg);
    expect(values).toHaveLength(12);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v, v).toMatch(/^c_[a-z_]+$/);
    // One room hears both families (ClassRoom registers the world messages too), so one value
    // shared by both would route a class message to a world handler or vice versa.
    const world = new Set<string>(Object.values(MessageType));
    for (const v of values) expect(world.has(v), v).toBe(false);
  });
});

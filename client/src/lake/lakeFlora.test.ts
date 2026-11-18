import { describe, expect, it } from "vitest";
import { floraOld, installLakeFlora } from "./lakeFlora";
import { Group } from "three";

describe("lakeFlora", () => {
  it("?flora=old only counts in a DEV build", () => {
    expect(floraOld("?flora=old", true)).toBe(true);
    expect(floraOld("?flora=old", false)).toBe(false);
    expect(floraOld("?flora=new", true)).toBe(false);
    expect(floraOld("", true)).toBe(false);
  });
  it("draws nothing (and changes nothing) where there is no DOM or the file has no flora", () => {
    expect(installLakeFlora(new Group(), "high")).toBeNull();
  });
});

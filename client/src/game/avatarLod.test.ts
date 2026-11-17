import { describe, expect, it } from "vitest";
import { AVATAR_LOD, avatarTreeCadence, behindCamera } from "./avatarLod";

describe("avatarLod", () => {
  it("near avatars refresh every frame, far ones less often, ones behind the camera least", () => {
    expect(avatarTreeCadence(5, false)).toBe(1);
    expect(avatarTreeCadence(5, true)).toBe(1); // near: always, even beside/behind
    expect(avatarTreeCadence(25, false)).toBe(2);
    expect(avatarTreeCadence(45, false)).toBe(3);
    expect(avatarTreeCadence(80, false)).toBe(4);
    expect(avatarTreeCadence(30, true)).toBe(AVATAR_LOD.cadence[4]);
  });
  it("tells what is behind the camera", () => {
    expect(behindCamera(0, -20, 0, 0, 0, -1)).toBe(false); // ahead
    expect(behindCamera(0, 20, 0, 0, 0, -1)).toBe(true); // behind
    expect(behindCamera(20, 0, 0, 0, 0, -1)).toBe(false); // beside: still drawn at the edge of a wide view
    expect(behindCamera(0, 2, 0, 0, 0, -1)).toBe(false); // too close to tell
  });
});

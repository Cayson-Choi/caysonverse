import { describe, expect, it, vi } from "vitest";
import { Bone, Group, Scene } from "three";
import { AVATAR_LOD, RemoteAvatarGroup, avatarTreeCadence, behindCamera } from "./avatarLod";

describe("avatarLod", () => {
  it("traverses a resting rig once, keeps its tag live, and updates a moved or newly animated body", () => {
    const scene = new Scene();
    const group = new RemoteAvatarGroup();
    const body = new Group();
    const tag = new Group();
    const bone = new Bone();
    body.add(bone);
    group.add(body, tag);
    scene.add(group);
    group.matrixAutoUpdate = group.matrixWorldAutoUpdate = false;
    group.restingBody = body;
    group.position.x = 5;
    group.refreshTransform();
    const compose = vi.spyOn(bone, "updateMatrix");
    for (let i = 0; i < 12; i++) {
      tag.position.y = i;
      scene.updateMatrixWorld();
      expect(tag.matrixWorld.elements[13]).toBe(i);
    }
    expect(compose).toHaveBeenCalledTimes(1);
    expect(bone.matrixWorld.elements[12]).toBe(5);
    group.position.x = 9;
    group.refreshTransform();
    scene.updateMatrixWorld();
    expect(compose).toHaveBeenCalledTimes(2);
    expect(bone.matrixWorld.elements[12]).toBe(9);
    group.restingBody = null;
    bone.position.y = 2;
    scene.updateMatrixWorld();
    expect(bone.matrixWorld.elements[13]).toBe(2);
  });
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

import { afterEach, describe, expect, it } from "vitest";
import { Bone, Group, PerspectiveCamera, Scene, Sprite, Vector3 } from "three";
import { FP_EYE_LOCAL, HEAD_COLLAPSED, NEIGHBOUR_CLEAR, beforeRender, fpBody, fpEye, headEyeWorld, installFpBody, neighbourPull, restoreHead } from "./fpBody";

/** A body: group > model > chest > head (the head bone 1.24 up, as character.glb's), a name tag sprite in the group. */
function rig() {
  const scene = new Scene();
  const group = new Group();
  const model = new Group();
  const chest = new Bone();
  chest.position.set(0, 0.97, 0);
  const head = new Bone();
  head.name = "head";
  head.position.set(0, 0.27, 0);
  chest.add(head);
  model.add(chest);
  const tag = new Sprite();
  group.add(model, tag);
  group.position.set(5, 0, -3);
  scene.add(group);
  scene.updateMatrixWorld(true);
  fpBody.head = head;
  fpBody.group = group;
  fpBody.keep = [model];
  const camera = new PerspectiveCamera();
  return { scene, group, model, head, tag, camera };
}

afterEach(() => {
  restoreHead();
  fpBody.head = null;
  fpBody.group = null;
  fpBody.keep = [];
  fpBody.active = false;
  fpEye.armed = false;
  fpEye.camera = null;
});

describe("fpBody (true first person)", () => {
  it("the eye point is in front of and above the head bone, in its frame", () => {
    const { head } = rig();
    const eye = headEyeWorld(head, new Vector3());
    expect(eye.x).toBeCloseTo(5 + FP_EYE_LOCAL.x);
    expect(eye.y).toBeCloseTo(1.24 + FP_EYE_LOCAL.y);
    expect(eye.z).toBeCloseTo(-3 + FP_EYE_LOCAL.z);
  });

  it("moves the camera onto the head's eye by the first person's weight, once per frame", () => {
    const { head, camera } = rig();
    camera.position.set(5, 1.5, -3);
    Object.assign(fpEye, { armed: true, w: 1, x: 5, y: 1.5, z: -3, camera });
    beforeRender(camera);
    const eye = headEyeWorld(head, new Vector3());
    expect(camera.position.distanceTo(eye)).toBeLessThan(1e-9);
    // a second render of the same frame (the post chain's label pass) does not move it again
    beforeRender(camera);
    expect(camera.position.distanceTo(eye)).toBeLessThan(1e-9);
  });

  it("half way between third and first person: half the correction", () => {
    const { head, camera } = rig();
    camera.position.set(0, 3, 0);
    Object.assign(fpEye, { armed: true, w: 0.5, x: 5, y: 1.5, z: -3, camera });
    beforeRender(camera);
    const eye = headEyeWorld(head, new Vector3());
    expect(camera.position.x).toBeCloseTo((eye.x - 5) * 0.5);
    expect(camera.position.y).toBeCloseTo(3 + (eye.y - 1.5) * 0.5);
  });

  it("another camera (a warm-up render) is left alone", () => {
    const { camera } = rig();
    const other = new PerspectiveCamera();
    camera.position.set(5, 1.5, -3);
    Object.assign(fpEye, { armed: true, w: 1, x: 5, y: 1.5, z: -3, camera });
    beforeRender(other);
    expect(other.position.length()).toBe(0);
    expect(fpEye.armed).toBe(true);
  });

  it("shrinks the head and hides the own labels while active, and puts both back", () => {
    const { head, tag, model } = rig();
    fpBody.active = true;
    beforeRender(new PerspectiveCamera());
    expect(head.scale.x).toBe(HEAD_COLLAPSED);
    expect(head.matrixWorld.elements[0]).toBeCloseTo(HEAD_COLLAPSED);
    expect(tag.visible).toBe(false);
    expect(model.visible).toBe(true);
    restoreHead();
    expect(head.scale.x).toBe(1);
    expect(tag.visible).toBe(true);
    expect(fpBody.collapsed).toBe(false);
  });

  it("a head scale the mixer rewrote since is kept as the mixer left it", () => {
    const { head } = rig();
    fpBody.active = true;
    beforeRender(new PerspectiveCamera());
    head.scale.setScalar(1.02); // the mixer's head.scale track this frame
    restoreHead();
    expect(head.scale.x).toBe(1.02);
  });

  it("inactive (third person): nothing is shrunk or hidden", () => {
    const { head, tag } = rig();
    fpBody.active = false;
    beforeRender(new PerspectiveCamera());
    expect(head.scale.x).toBe(1);
    expect(tag.visible).toBe(true);
  });

  it("installs on the scene's onBeforeRender, chained, with the head's shadow stand-in", () => {
    const { scene, group, head } = rig();
    let prevCalls = 0;
    scene.onBeforeRender = () => {
      prevCalls += 1;
    };
    const off = installFpBody(scene, group);
    const shadow = group.getObjectByName("fp-head-shadow");
    expect(shadow?.castShadow).toBe(true);
    expect(shadow?.visible).toBe(false);
    fpBody.active = true;
    const cam = new PerspectiveCamera();
    (scene.onBeforeRender as unknown as (...a: unknown[]) => void)(null, scene, cam, null);
    expect(prevCalls).toBe(1);
    expect(head.scale.x).toBe(HEAD_COLLAPSED);
    expect(shadow?.visible).toBe(true);
    off();
    expect(group.getObjectByName("fp-head-shadow")).toBeUndefined();
    expect(head.scale.x).toBe(1);
    (scene.onBeforeRender as unknown as (...a: unknown[]) => void)(null, scene, cam, null);
    expect(prevCalls).toBe(2);
  });
});

describe("fpBody: the eye slides back from a neighbour's head", () => {
  it("no one near: the eye point", () => {
    const { head } = rig();
    expect(neighbourPull(head, (fn) => fn(20, 20))).toBe(1);
  });
  it("someone 0.7 m in front: the eye goes back until it is NEIGHBOUR_CLEAR from them", () => {
    const { head } = rig();
    // the head faces +z; the head bone is over (5, -3)
    const each = (fn: (x: number, z: number) => void) => fn(5, -3 + 0.7);
    const k = neighbourPull(head, each);
    expect(k).toBeLessThan(1);
    const eye = headEyeWorld(head, new Vector3(), k);
    expect(Math.hypot(eye.x - 5, eye.z - (-3 + 0.7))).toBeGreaterThanOrEqual(NEIGHBOUR_CLEAR - 1e-9);
  });
  it("someone beside (not ahead) is clear of the forward eye already", () => {
    const { head } = rig();
    expect(neighbourPull(head, (fn) => fn(5 + 0.9, -3))).toBe(1);
  });
  it("the render hook eases the eye back when a neighbour stands in front", () => {
    const { head, camera } = rig();
    fpBody.forEachNeighbour = (fn) => fn(5, -3 + 0.7);
    fpBody.pull = 1;
    fpBody.pullAt = 0; // the first frame: no ease (dt 1 s)
    Object.assign(fpEye, { armed: true, w: 1, x: 5, y: 1.5, z: -3, camera });
    beforeRender(camera);
    expect(Math.hypot(camera.position.x - 5, camera.position.z - (-3 + 0.7))).toBeGreaterThanOrEqual(NEIGHBOUR_CLEAR - 1e-9);
    fpBody.forEachNeighbour = null;
    fpBody.pull = 1;
    fpBody.pullAt = 0;
    void head;
  });
});

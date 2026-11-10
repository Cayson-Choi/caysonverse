import { describe, it, expect } from "vitest";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from "three";
import { CLICK_PICK_KEY, NEAR_FADE_KEY, asSurface, isSeeThrough, pickSurface, surfaceHeightAt } from "./clickPick";
import { isWalkableSurface } from "./clickPlan";

/** A flat floor of `size` m at height `y` (a ground layer). */
function floor(y: number, size = 40, material: Material = new MeshBasicMaterial()) {
  const m = new Mesh(new PlaneGeometry(size, size), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}
function box(x: number, y: number, z: number, w = 1, h = 1, d = 1) {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
  m.position.set(x, y, z);
  return m;
}
/** A ray from a camera-like point toward a world point. */
function rayAt(from: [number, number, number], to: [number, number, number]) {
  const r = new Raycaster();
  const o = new Vector3(...from);
  r.set(o, new Vector3(...to).sub(o).normalize());
  return r;
}
function scene(...children: Parameters<Scene["add"]>) {
  const s = new Scene();
  s.add(...children);
  s.updateMatrixWorld(true);
  return s;
}

describe("clickPick — the first visible surface under the click", () => {
  it("a click on the ground returns that ground (the top layer, with its height), not the plane y = 0", () => {
    const s = scene(floor(0.001), floor(0.017, 6)); // the grass, and a lane 1.7 cm up
    const pick = pickSurface(rayAt([0, 3, 6], [1, 0.017, 0]), s)!;
    expect(pick.y).toBeCloseTo(0.017, 6);
    expect(pick.x).toBeCloseTo(1, 4);
    expect(pick.z).toBeCloseTo(0, 4);
    expect(pick.ny).toBeCloseTo(1, 6);
    expect(isWalkableSurface(pick)).toBe(true);
  });

  it("a wall in front is what is clicked: upright normal 0, not ground", () => {
    const s = scene(floor(0), box(0, 1.5, -2, 6, 3, 0.3));
    const pick = pickSurface(rayAt([0, 1.6, 6], [0, 0.8, -6]), s)!;
    expect(pick.z).toBeCloseTo(-1.85, 3); // the wall's near face
    expect(Math.abs(pick.ny)).toBeLessThan(0.01);
    expect(isWalkableSurface(pick)).toBe(false);
  });

  it("a bench seat faces up but is too high to be ground", () => {
    const s = scene(floor(0), box(0, 0.225, 0, 2, 0.45, 0.6));
    const pick = pickSurface(rayAt([0, 3, 4], [0, 0.45, 0]), s)!;
    expect(pick.y).toBeCloseTo(0.45, 4);
    expect(pick.ny).toBeCloseTo(1, 4);
    expect(isWalkableSurface(pick)).toBe(false);
  });

  it("a body (a subtree tagged block) is never ground, even where it faces up", () => {
    const avatar = new Group();
    avatar.userData[CLICK_PICK_KEY] = "block";
    avatar.add(box(0, 0.05, 0, 0.6, 0.1, 0.6)); // the feet: low and flat on top
    const s = scene(floor(0), avatar);
    const pick = pickSurface(rayAt([0, 3, 3], [0, 0.1, 0]), s)!;
    expect(pick.blocker).toBe(true);
    expect(asSurface(pick)!.ny).toBe(0);
    expect(isWalkableSurface(asSurface(pick)!)).toBe(false);
  });

  it("see-through things are skipped: shadows, decals, sprites, colliders, hidden and ignored subtrees", () => {
    const shadow = floor(0.05, 10, new ShadowMaterial());
    const decal = floor(0.06, 10, new MeshBasicMaterial({ transparent: true, depthWrite: false }));
    const sprite = new Sprite(new SpriteMaterial());
    sprite.position.set(0, 1, 2);
    const collider = box(0, 0.5, 1);
    collider.name = "col__bench";
    const hidden = box(0, 0.5, 1.5);
    hidden.visible = false;
    const marker = new Group();
    marker.userData[CLICK_PICK_KEY] = "ignore";
    marker.add(floor(0.07, 4));
    const s = scene(floor(0.01), shadow, decal, sprite, collider, hidden, marker);
    // no `raycaster.camera`: a sprite would throw if it were raycast at all
    const pick = pickSurface(rayAt([0, 3, 4], [0, 0, 0]), s)!;
    expect(pick.y).toBeCloseTo(0.01, 6);
    expect(isSeeThrough(new MeshBasicMaterial({ visible: false }))).toBe(true);
    expect(isSeeThrough(new MeshBasicMaterial({ transparent: true }))).toBe(false); // glass that writes depth is solid
  });

  it("an instanced piece's normal includes its instance matrix (a tilted copy is a wall, not ground)", () => {
    const geo = new PlaneGeometry(2, 2); // faces +z
    const inst = new InstancedMesh(geo, new MeshBasicMaterial(), 2);
    inst.setMatrixAt(0, new Matrix4().makeTranslation(0, 1, -3)); // upright: a wall
    inst.setMatrixAt(1, new Matrix4().makeRotationX(-Math.PI / 2).setPosition(5, 0.01, 0)); // laid flat: ground
    const s = scene(inst);
    const wall = pickSurface(rayAt([0, 1, 5], [0, 1, -3]), s)!;
    expect(Math.abs(wall.ny)).toBeLessThan(0.01);
    const flat = pickSurface(rayAt([5, 3, 3], [5, 0.01, 0]), s)!;
    expect(flat.ny).toBeCloseTo(1, 4);
  });

  it("leaves faded out near the camera are clicked through; farther ones are what is clicked", () => {
    const leaves = new MeshBasicMaterial();
    leaves.userData[NEAR_FADE_KEY] = 1.6;
    const near = box(0, 2.5, 3, 2, 0.1, 2); // a crown slab the camera looks through, 0.5 m below it
    near.material = leaves;
    const s = scene(floor(0.001), near);
    const pick = pickSurface(rayAt([0, 3, 3], [0, 0, 3]), s)!; // the crown's top 0.45 m away
    expect(pick.y).toBeCloseTo(0.001, 6); // the ground under the crown
    const far = pickSurface(rayAt([0, 6, 3], [0, 0, 3]), s)!; // 3.45 m away
    expect(far.y).toBeCloseTo(2.55, 6); // the crown's top
  });

  it("nothing under the click (the sky) is null", () => {
    expect(pickSurface(rayAt([0, 2, 0], [0, 5, -10]), scene(floor(0)))).toBeNull();
  });

  it("surfaceHeightAt reads the ground under a moved destination, past bodies, under the crowns", () => {
    const avatar = new Group();
    avatar.userData[CLICK_PICK_KEY] = "block";
    avatar.add(box(5, 0.9, 0, 0.6, 1.8, 0.6));
    const crown = box(5, 3, 0, 3, 2, 3);
    const s = scene(floor(0.001), floor(0.03, 4), avatar, crown);
    const r = new Raycaster();
    r.near = 0.2;
    r.far = 500;
    expect(surfaceHeightAt(r, s, 1, 1, -1)).toBeCloseTo(0.03, 6); // the forecourt layer
    expect(surfaceHeightAt(r, s, 5, 0, -1)).toBeCloseTo(0.001, 6); // under the body and the crown: the grass
    expect(surfaceHeightAt(r, s, 30, 30, -1)).toBe(-1); // off every floor: the fallback
    expect([r.near, r.far]).toEqual([0.2, 500]); // the caller's limits are given back
  });
});

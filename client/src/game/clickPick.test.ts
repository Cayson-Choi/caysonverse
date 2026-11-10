import { describe, it, expect, vi } from "vitest";
import {
  Bone,
  BoxGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Skeleton,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  type Intersection,
  type Material,
} from "three";
import { CLICK_PICK_KEY, NEAR_FADE_KEY, asSurface, isCutAway, isSeeThrough, pickSurface, surfaceHeightAt, warmPick } from "./clickPick";
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
    expect(asSurface(pick)).toBeNull(); // planned as "nothing": no walk, no ring
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

/** A leaf card: a 2 x 2 m plane whose left half is cut away (texel alpha 0) and right half is leaf (alpha 255). */
function leafCard(): Mesh {
  const tex = new DataTexture(new Uint8Array([40, 120, 30, 0, 40, 120, 30, 255]), 2, 1);
  tex.needsUpdate = true;
  return new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: 2 }));
}

describe("clickPick — leaves are clicked through where their texture cuts them away (round 2, review blocker)", () => {
  it("a ray through a cut-away texel of an alpha-tested card goes on to the ground behind; an opaque texel is the leaf", () => {
    const card = leafCard();
    card.position.set(0, 1, 0); // upright, facing +z, 1 m up: its lower edge at y = 0
    const s = scene(floor(0.01), card);
    // from the camera at z = 6, aim through the card's left (cut) half at the ground behind it
    const through = pickSurface(rayAt([-0.5, 1.2, 6], [-0.5, 0.01, -1.5]), s)!;
    expect(through.y).toBeCloseTo(0.01, 6);
    expect(through.z).toBeLessThan(0); // behind the card
    // the same aim through the right (opaque) half stops at the leaf
    const leaf = pickSurface(rayAt([0.5, 1.2, 6], [0.5, 0.01, -1.5]), s)!;
    expect(leaf.z).toBeCloseTo(0, 4);
    expect(leaf.y).toBeCloseTo(0.248, 3); // on the card, 25 cm up
  });

  it("the same for one instance of an instanced card (its uv, its own matrix)", () => {
    const one = leafCard();
    const inst = new InstancedMesh(one.geometry, one.material, 2);
    inst.setMatrixAt(0, new Matrix4().makeTranslation(0, 1, 0));
    inst.setMatrixAt(1, new Matrix4().makeTranslation(30, 1, 0));
    const s = scene(floor(0.01, 80), inst);
    expect(pickSurface(rayAt([-0.5, 1.2, 6], [-0.5, 0.01, -1.5]), s)!.y).toBeCloseTo(0.01, 6);
    const leaf = pickSurface(rayAt([0.5, 1.2, 6], [0.5, 0.01, -1.5]), s)!;
    expect(leaf.z).toBeCloseTo(0, 4);
    const far = pickSurface(rayAt([30.5, 1.2, 6], [30.5, 0.01, -1.5]), s)!; // the second instance
    expect(far.z).toBeCloseTo(0, 4);
  });

  it("isCutAway: the material's opacity and alphaTest, the map's alpha at the hit's uv; no alphaTest is never cut", () => {
    const card = leafCard();
    const hit = (u: number) => ({ uv: new Vector2(u, 0.5), object: card, face: { materialIndex: 0 } }) as unknown as Intersection;
    const m = card.material as MeshBasicMaterial;
    expect(isCutAway(hit(0.25), m)).toBe(true);
    expect(isCutAway(hit(0.75), m)).toBe(false);
    expect(isCutAway(hit(0.25), new MeshBasicMaterial({ map: m.map }))).toBe(false); // no alpha test: drawn whole
    expect(isCutAway(hit(0.75), new MeshBasicMaterial({ map: m.map, alphaTest: 0.5, opacity: 0.4 }))).toBe(true);
    expect(isCutAway({ object: card } as unknown as Intersection, m)).toBe(false); // no uv: kept (solid)
  });
});

/** A skinned "arm": a 0.2 x 1 x 0.2 box bound wholly to a bone 1 m up, inside a body (a subtree tagged block). */
function skinnedArm() {
  const geo = new BoxGeometry(0.2, 1, 0.2);
  geo.translate(0, 1.5, 0); // y 1..2 in the bind pose
  const n = geo.attributes.position.count;
  const idx: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < n; i++) idx.push(1, 0, 0, 0), w.push(1, 0, 0, 0);
  geo.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new Float32BufferAttribute(w, 4));
  const root = new Bone();
  const arm = new Bone();
  arm.position.y = 1;
  root.add(arm);
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial());
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton([root, arm]));
  const body = new Group();
  body.userData[CLICK_PICK_KEY] = "block";
  body.position.set(2, 0, 0);
  body.add(mesh);
  return { body, mesh, arm };
}

describe("clickPick — bodies are picked as drawn, posed, without three's per-vertex skinned raycast (round 2, review: 22 ms an avatar)", () => {
  it("a posed limb is where the click lands on the body; where the limb was in the bind pose is open now", () => {
    const { body, mesh, arm } = skinnedArm();
    const s = scene(floor(0.01, 80), body);
    arm.rotation.z = Math.PI / 2; // the arm swings out to -x: it now lies along y = 1, x 1..2 (the body is at x = 2)
    s.updateMatrixWorld(true);
    const spy = vi.spyOn(mesh, "raycast");
    const onArm = pickSurface(rayAt([1.5, 5, 0], [1.5, 0, 0]), s)!;
    expect(onArm.blocker).toBe(true);
    expect(onArm.y).toBeCloseTo(1.1, 3); // the arm's top face, as three's exact skinned raycast finds it
    const exact: Intersection[] = [];
    SkinnedMesh.prototype.raycast.call(mesh, rayAt([1.5, 5, 0], [1.5, 0, 0]), exact);
    expect(onArm.distance).toBeCloseTo(exact[0].distance, 3);
    // a level ray through where the arm stood in the bind pose (x = 2, y 1..2) passes: nothing there now
    const past = pickSurface(rayAt([6, 1.8, 0], [-6, 1.8, 0]), s);
    expect(past === null || !past.blocker).toBe(true);
    expect(spy).not.toHaveBeenCalled(); // no per-vertex skinning on a click
  });

  it("a limb blended between two bones is hit where three's own skinning draws it", () => {
    const geo = new BoxGeometry(0.2, 1, 0.2, 1, 4, 1);
    geo.translate(0, 1.5, 0);
    const n = geo.attributes.position.count;
    const idx: number[] = [];
    const w: number[] = [];
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, p.getY(i) - 1)); // 0 at the shoulder, 1 at the hand: the blend between the bones
      idx.push(0, 1, 0, 0);
      w.push(1 - t, t, 0, 0);
    }
    geo.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new Float32BufferAttribute(w, 4));
    const root = new Bone();
    const arm = new Bone();
    arm.position.y = 1;
    root.add(arm);
    const mesh = new SkinnedMesh(geo, new MeshBasicMaterial());
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton([root, arm]));
    const body = new Group();
    body.userData[CLICK_PICK_KEY] = "block";
    body.position.set(-1, 0, 2);
    body.rotation.y = 0.5;
    body.add(mesh);
    const s = scene(floor(0.01, 80), body);
    arm.rotation.z = 1.1;
    root.rotation.x = 0.2;
    s.updateMatrixWorld(true);
    let met = 0;
    // aimed at triangles as three skins them (their centres), from three sides, and once past the arm
    const rays: Array<[[number, number, number], [number, number, number]]> = [];
    const v = new Vector3();
    for (const t of [2, 9, 17, 25]) {
      const c = new Vector3();
      for (let k = 0; k < 3; k++) c.add(mesh.getVertexPosition(geo.index!.getX(3 * t + k), v).applyMatrix4(mesh.matrixWorld));
      c.divideScalar(3);
      for (const off of [[3, 2, 4], [-4, 1, 1], [0.5, 5, -0.3]]) rays.push([[c.x + off[0], c.y + off[1], c.z + off[2]], [c.x, c.y, c.z]]);
    }
    rays.push([[-6, 2.9, 2], [6, 2.9, 2]]);
    for (const [from, to] of rays) {
      const exact: Intersection[] = [];
      SkinnedMesh.prototype.raycast.call(mesh, rayAt(from, to), exact);
      exact.sort((x, y) => x.distance - y.distance);
      const pick = pickSurface(rayAt(from, to), s);
      if (exact.length) {
        met++;
        expect(pick?.blocker).toBe(true);
        expect(pick!.distance).toBeCloseTo(exact[0].distance, 5);
      } else expect(pick === null || !pick.blocker).toBe(true);
    }
    expect(met).toBeGreaterThan(0);
  });

  it("no box stands in for the body: a ray through the empty corner of a slanted limb's box misses it", () => {
    // a thin plate leaning 45 degrees in its bone's space: its box is a 1.4 m square, the plate a diagonal of it
    const geo = new BoxGeometry(0.05, 2, 0.2);
    geo.rotateZ(Math.PI / 4);
    geo.translate(0, 1, 0);
    const n = geo.attributes.position.count;
    const idx: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < n; i++) idx.push(0, 0, 0, 0), w.push(1, 0, 0, 0);
    geo.setAttribute("skinIndex", new Uint16BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new Float32BufferAttribute(w, 4));
    const bone = new Bone();
    const mesh = new SkinnedMesh(geo, new MeshBasicMaterial());
    mesh.add(bone);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton([bone]));
    const body = new Group();
    body.userData[CLICK_PICK_KEY] = "block";
    body.add(mesh);
    const s = scene(floor(0.01, 80), body);
    // the plate runs from (0.71, 0.29) to (-0.71, 1.71) in x/y; the corner near (0.6, 1.6) is empty
    const corner = pickSurface(rayAt([0.6, 1.6, 5], [0.6, 1.6, -5]), s);
    expect(corner === null || !corner.blocker).toBe(true);
    const onPlate = pickSurface(rayAt([0, 1, 5], [0, 1, -5]), s)!;
    expect(onPlate.blocker).toBe(true);
    expect(onPlate.z).toBeCloseTo(0.1, 3);
  });
});

describe("clickPick — only what can matter inside the area is raycast (round 2, review: 20-80 ms a click)", () => {
  const AREA = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

  it("a mesh wholly outside the area and behind it is never raycast; the ray ends where it leaves the area", () => {
    const hill = box(0, 2, -40, 20, 4, 4); // far past the area's north edge, on the ray
    const s = scene(floor(0, 8), hill); // the floor ends at z = -4
    const spy = vi.spyOn(hill, "raycast");
    // aim over the floor's end: inside the area the ray finds nothing; the hill would be hit past the edge
    expect(pickSurface(rayAt([0, 1.6, 4], [0, 1.4, -40]), s, { area: AREA })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(pickSurface(rayAt([0, 1.6, 4], [0, 1.4, -40]), s)!.z).toBeCloseTo(-38, 3); // without an area: the hill
  });

  it("a camera outside the area still sees what stands between it and the area", () => {
    const wall = box(0, 1, 8, 6, 2, 0.2); // outside the area (z 7.9..8.1), between the camera and it
    const s = scene(floor(0, 30), wall);
    const pick = pickSurface(rayAt([0, 1.5, 12], [0, 0, 0]), s, { area: AREA })!;
    expect(pick.z).toBeCloseTo(8.1, 3);
  });

  it("instances far behind the first hit are not raycast (a forest of cards on a hill)", () => {
    const one = leafCard();
    const inst = new InstancedMesh(one.geometry, new MeshBasicMaterial(), 50);
    for (let i = 0; i < 50; i++) inst.setMatrixAt(i, new Matrix4().makeTranslation(0, 1, -2 - i));
    const s = scene(floor(0, 200), inst);
    const spy = vi.spyOn(Mesh.prototype, "raycast");
    const pick = pickSurface(rayAt([0, 1.2, 6], [0, 1, -60]), s)!;
    expect(pick.z).toBeCloseTo(-2, 4);
    expect(spy.mock.calls.length).toBeLessThan(10); // the floor and the first card or two, not 50 cards
    spy.mockRestore();
  });
});

describe("clickPick — a large mesh is raycast cell by cell (round 2 review: the village's 10-34k-triangle chunks)", () => {
  /** A bumpy 60 x 60 m ground of 2 x 80 x 80 triangles, its two halves in two materials, turned and moved. */
  function bigGround() {
    const geo = new PlaneGeometry(60, 60, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, 0.3 * Math.sin(p.getX(i) * 0.7) * Math.cos(p.getZ(i) * 0.5));
    geo.computeVertexNormals();
    const half = geo.index!.count / 2;
    geo.addGroup(0, half, 0);
    geo.addGroup(half, half, 1);
    const a = new MeshBasicMaterial({ name: "A" });
    const b = new MeshBasicMaterial({ name: "B" });
    const mesh = new Mesh(geo, [a, b]);
    mesh.position.set(5, 0.2, -3);
    mesh.rotation.y = 0.4;
    mesh.scale.set(1.5, 1, 1.5);
    return mesh;
  }

  it("finds the same first hit as three's whole-mesh raycast, with the right group's material", () => {
    const mesh = bigGround();
    const s = scene(mesh);
    let rnd = 7;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) {
      const from: [number, number, number] = [rand() * 80 - 40, 2 + rand() * 6, rand() * 80 - 40];
      const to: [number, number, number] = [rand() * 80 - 40, 0, rand() * 80 - 40];
      const exact: Intersection[] = [];
      Mesh.prototype.raycast.call(mesh, rayAt(from, to), exact);
      exact.sort((x, y) => x.distance - y.distance);
      const pick = pickSurface(rayAt(from, to), s);
      if (!exact.length) {
        expect(pick).toBeNull();
        continue;
      }
      expect(pick).not.toBeNull();
      expect(pick!.distance).toBeCloseTo(exact[0].distance, 6);
      expect(pick!.x).toBeCloseTo(exact[0].point.x, 5);
      expect(pick!.z).toBeCloseTo(exact[0].point.z, 5);
    }
    // the cut-away rule reads the hit's material: a group in a material with an alpha test that cuts all is passed through
    const mats = mesh.material as MeshBasicMaterial[];
    mats[1] = new MeshBasicMaterial({ transparent: true, depthWrite: false }); // half B now see-through
    const both: Intersection[] = [];
    Mesh.prototype.raycast.call(mesh, rayAt([0, 8, 0], [30, 0, 30]), both);
    const pick = pickSurface(rayAt([0, 8, 0], [30, 0, 30]), s);
    const firstA = both.sort((x, y) => x.distance - y.distance).find((h) => h.face!.materialIndex === 0);
    if (firstA) expect(pick!.distance).toBeCloseTo(firstA.distance, 6);
    else expect(pick).toBeNull();
  });

  it("warmPick builds it ahead of the first click, a budget at a time, and says when it is done", () => {
    const s = scene(bigGround(), bigGround());
    let rounds = 0;
    while (!warmPick(s, 0) && rounds < 10) rounds++;
    expect(rounds).toBeGreaterThan(0); // a zero budget does one thing a call
    expect(warmPick(s, 0)).toBe(true);
  });
});

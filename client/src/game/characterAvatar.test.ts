import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Bone,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint16BufferAttribute,
  Uint8BufferAttribute,
} from "three";
import { appearanceFromIds } from "@caysonverse/shared/appearance";
import { lookFromAppearance, lookKey, visibleParts, type AvatarLook } from "./characterLook";
import { attachNpcAccessories } from "./npcLook";
import {
  AVATAR_BOUNDS,
  MAX_DRAW_MESHES,
  assembleAvatar as assembleAvatarImpl,
  buildAvatar as buildAvatarImpl,
  releaseAvatar,
  releaseAvatarSoon,
  retainAvatar,
  setAvatarOpacity,
  solidGeometryRefs,
  type BuiltAvatar,
} from "./characterAvatar";

// ── fake character scene (GLTFLoader's shape, no WebGL) ───────────────────────

/**
 * Every primitive of the fake scene, in scene order. A primitive's triangle sits at
 * x = its index + 1, so a merged vertex can be traced back to the part it came from.
 */
const PRIMITIVES = [
  "body__head", "body__hands", "body__torso", "body__legs", "body__feet",
  "hair__short", "hair__short__hat", "hair__ponytail", "hair__ponytail__hat",
  "top__tee", "top__hoodie_1", "top__hoodie_2", "hat__cap",
  "bottom__pants", "bottom__shorts", "shoes__sneakers", "item__book", "face__smile",
] as const;
type Primitive = (typeof PRIMITIVES)[number];
const xOf = (name: Primitive): number => PRIMITIVES.indexOf(name) + 1;

/** mat_fixed_white's authored colour, already linear (as GLTFLoader stores baseColorFactor). */
const STRING_WHITE = new Color().setRGB(0.9, 0.8, 0.7);

/** The (y, z) of a triangle's three vertices; x identifies the primitive. */
const CORNERS = [[0, 0], [1, 0], [0, 1]] as const;
/**
 * Per-vertex skinning of every fake triangle: four influences per vertex (joint indices may repeat).
 * Vertex 0's four weights all differ and the joint patterns pin every component, so a merge that
 * drops, zeroes, swaps or reorders components or vertices is caught.
 */
const JOINTS = [[0, 1, 1, 0], [1, 0, 0, 1], [0, 0, 1, 1]] as const;
const WEIGHTS = [[0.4, 0.3, 0.2, 0.1], [0.7, 0.2, 0.1, 0], [0.25, 0.25, 0.25, 0.25]] as const;
/** hat__cap stores its skinning as Uint16 joints + normalised Uint8 weights (another exporter's layout). */
const PACKED: Primitive = "hat__cap";
const WEIGHT_BYTES = WEIGHTS.map((v) => v.map((w) => Math.round(w * 255)));

/**
 * One triangle, skinned with Uint8 joints and Float32 weights like the GLB — or, for PACKED, with
 * Uint16 joints and normalised Uint8 weights, so the merge has to unify the types.
 */
function triangle(name: string, x: number, material: Material, skeleton: Skeleton): SkinnedMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(CORNERS.flatMap(([y, z]) => [x, y, z]), 3));
  geometry.setAttribute("normal", new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  const joints = JOINTS.flat();
  if (name === PACKED) {
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new Uint8BufferAttribute(WEIGHT_BYTES.flat(), 4, true));
  } else {
    geometry.setAttribute("skinIndex", new Uint8BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(WEIGHTS.flat(), 4));
  }
  geometry.setIndex([0, 1, 2]);
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(skeleton, new Matrix4()); // GLTFLoader binds every part with an identity bind matrix
  return mesh;
}

/** `Rig` ─ Bone `root` ─ Bone `head`, plus one-triangle part meshes sharing one Skeleton and shared materials. */
function fakeScene(): Object3D {
  const rig = new Object3D();
  rig.name = "Rig";
  const rootBone = new Bone();
  rootBone.name = "root";
  const head = new Bone();
  head.name = "head";
  head.position.y = 1;
  rootBone.add(head);
  rig.add(rootBone);
  rig.updateMatrixWorld(true);
  const skeleton = new Skeleton([rootBone, head]);

  // Like the GLB, every material is double-sided (glTF doubleSided: true).
  const material = (name: string, color?: Color): MeshStandardMaterial =>
    new MeshStandardMaterial({ name, side: DoubleSide, ...(color ? { color } : {}) });
  const skin = material("mat_skin");
  const hair = material("mat_tint_hair");
  const top = material("mat_tint_top");
  const hat = material("mat_tint_hat");
  const bottom = material("mat_tint_bottom");
  const shoes = material("mat_tint_shoes");
  const item = material("mat_tint_item");
  const white = material("mat_fixed_white", STRING_WHITE);
  const face = new MeshStandardMaterial({
    name: "mat_face_smile",
    map: new Texture(),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const single: [Primitive, Material][] = [
    ["body__head", skin], ["body__hands", skin], ["body__torso", skin], ["body__legs", skin], ["body__feet", skin],
    ["hair__short", hair], ["hair__short__hat", hair], ["hair__ponytail", hair], ["hair__ponytail__hat", hair],
    ["top__tee", top], ["hat__cap", hat], ["bottom__pants", bottom], ["bottom__shorts", bottom],
    ["shoes__sneakers", shoes], ["item__book", item], ["face__smile", face],
  ];
  for (const [name, m] of single) rig.add(triangle(name, xOf(name), m, skeleton));

  // A multi-material part: GLTFLoader makes a Group named after the node, children `<part>_1`, `<part>_2`.
  const hoodie = new Group();
  hoodie.name = "top__hoodie";
  hoodie.add(triangle("top__hoodie_1", xOf("top__hoodie_1"), top, skeleton));
  hoodie.add(triangle("top__hoodie_2", xOf("top__hoodie_2"), white, skeleton));
  rig.add(hoodie);
  return rig;
}

const assets = { scene: fakeScene() };

const CAP_WHITE_TEE: AvatarLook = lookFromAppearance(
  appearanceFromIds(
    { hat: "cap", hair: "short", face: "smile", top: "tee", bottom: "shorts", shoes: "sneakers", item: "book" },
    { hatColor: 6, hairColor: 0, topColor: 10, bottomColor: 7, shoesColor: 0, itemColor: 0, skin: 0, voice: 0 },
  ),
);
const HOODIE: AvatarLook = lookFromAppearance(
  appearanceFromIds(
    { hat: null, hair: "ponytail", face: "smile", top: "hoodie", bottom: "pants", shoes: "sneakers", item: null },
    { hatColor: 0, hairColor: 3, topColor: 0, bottomColor: 4, shoesColor: 2, itemColor: 0, skin: 3, voice: 1 },
  ),
);
const L = CAP_WHITE_TEE;
const LOOKS = [CAP_WHITE_TEE, HOODIE];
/** For the deliberately broken scenes: a look no other test uses, so nothing cached can stand in for the merge. */
const BROKEN_SCENE_LOOK: AvatarLook = lookFromAppearance(
  appearanceFromIds(
    { hat: null, hair: null, face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null },
    { hatColor: 0, hairColor: 0, topColor: 1, bottomColor: 1, shoesColor: 1, itemColor: 0, skin: 1, voice: 0 },
  ),
);

// ── helpers ────────────────────────────────────────────────────────────────────

function meshNames(root: Object3D): string[] {
  const names: string[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) names.push(o.name);
  });
  return names;
}

function solidOf(a: BuiltAvatar): SkinnedMesh {
  const solid = a.root.getObjectByName("avatar__solid") as SkinnedMesh | undefined;
  if (!solid) throw new Error("no avatar__solid");
  return solid;
}

function faceMaterial(a: BuiltAvatar): Material {
  return (a.root.getObjectByName("face__smile") as Mesh).material as Material;
}

/** The baked colour of the merged vertices that came from `part` (all three of its vertices must agree). */
function colorAt(a: BuiltAvatar, part: Primitive): Color {
  const { geometry } = solidOf(a);
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const found: Color[] = [];
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) === xOf(part)) found.push(new Color(color.getX(i), color.getY(i), color.getZ(i)));
  }
  expect({ part, vertices: found.length }).toEqual({ part, vertices: 3 });
  for (const c of found) expect(c.equals(found[0])).toBe(true);
  return found[0];
}

/** The merged joints and weights of `part`'s vertices, in the source vertex order (traced by position). */
function skinAt(a: BuiltAvatar, part: Primitive): { joints: number[]; weights: number[] }[] {
  const { geometry } = solidOf(a);
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  return CORNERS.map(([y, z]) => {
    const found: number[] = [];
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) === xOf(part) && position.getY(i) === y && position.getZ(i) === z) found.push(i);
    }
    expect({ part, y, z, vertices: found.length }).toEqual({ part, y, z, vertices: 1 });
    const i = found[0];
    return {
      joints: [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)],
      weights: [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)],
    };
  });
}

function expectColor(actual: Color, expected: Color): void {
  expect(actual.r).toBeCloseTo(expected.r, 5);
  expect(actual.g).toBeCloseTo(expected.g, 5);
  expect(actual.b).toBeCloseTo(expected.b, 5);
}

/** Lets every microtask queued so far run (releaseAvatarSoon's deferred release). */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

/** Every avatar a test made, so afterEach can clean up after a failed test instead of leaking into the next. */
const made: BuiltAvatar[] = [];
const buildAvatar: typeof buildAvatarImpl = (...args) => {
  const a = buildAvatarImpl(...args);
  made.push(a);
  return a;
};
const assembleAvatar: typeof assembleAvatarImpl = (...args) => {
  const a = assembleAvatarImpl(...args);
  made.push(a);
  return a;
};

afterEach(() => {
  const leaked = LOOKS.map((look) => solidGeometryRefs(lookKey(look)));
  for (const a of made.splice(0)) releaseAvatar(a);
  // Every test lets go of what it builds, so no test inherits another's shared geometry.
  expect(leaked).toEqual(LOOKS.map(() => 0));
});

// ── assembly ──────────────────────────────────────────────────────────────────

describe("buildAvatar", () => {
  it("keeps only the visible parts and merges every untextured primitive into one solid mesh", () => {
    const a = buildAvatar(assets, CAP_WHITE_TEE);
    expect(a.parts).toEqual(visibleParts(CAP_WHITE_TEE.parts));
    // 티셔츠·캡은 틴트 재질뿐이라 solid에 합쳐진다
    expect(meshNames(a.root).sort()).toEqual(["avatar__solid", "face__smile"]);
    expect(a.drawMeshes).toBe(2);
    expect(a.drawMeshes).toBeLessThanOrEqual(MAX_DRAW_MESHES);
    // 9 visible parts, one triangle each: 8 merged into the solid + the face
    expect(a.triangles).toBe(9);
    // three draws a double-sided translucent material twice; the face decal needs one pass (one draw call)
    expect(faceMaterial(a).forceSinglePass).toBe(true);
    // the parts are double-sided, so the merged body is too (open brims and hems keep their inside)
    expect((solidOf(a).material as Material).side).toBe(DoubleSide);
    expect(a.solidKey).toBe(lookKey(CAP_WHITE_TEE));
    // Hidden parts are gone from the clone, not merely invisible.
    expect(a.root.getObjectByName("hair__short")).toBeUndefined();
    expect(a.root.getObjectByName("top__hoodie")).toBeUndefined();
    releaseAvatar(a);
  });

  it("removes a multi-material part's emptied group and keeps the cull-safe bounds", () => {
    const a = buildAvatar(assets, HOODIE);
    expect(meshNames(a.root).sort()).toEqual(["avatar__solid", "face__smile"]);
    expect(a.root.getObjectByName("top__hoodie")).toBeUndefined();
    a.root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isMesh) return;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.boundingSphere?.center.toArray()).toEqual([...AVATAR_BOUNDS.center]);
      expect(mesh.boundingSphere?.radius).toBe(AVATAR_BOUNDS.radius);
    });
    releaseAvatar(a);
  });

  it("bakes look colors into the solid vertex colors and keeps fixed colors", () => {
    const a = buildAvatar(assets, CAP_WHITE_TEE);
    expectColor(colorAt(a, "body__head"), new Color(CAP_WHITE_TEE.colors.skin));
    expectColor(colorAt(a, "body__hands"), new Color(CAP_WHITE_TEE.colors.skin));
    expectColor(colorAt(a, "hat__cap"), new Color(CAP_WHITE_TEE.colors.hat));
    expectColor(colorAt(a, "hair__short__hat"), new Color(CAP_WHITE_TEE.colors.hair));
    expectColor(colorAt(a, "top__tee"), new Color(CAP_WHITE_TEE.colors.top));
    expectColor(colorAt(a, "item__book"), new Color(CAP_WHITE_TEE.colors.item));
    // '#RRGGBB' is sRGB; the vertex colour is in the linear working space.
    expect(new Color(CAP_WHITE_TEE.colors.top).r).toBeLessThan(0.95);

    // 후드티: 몸판은 웃옷 색, 흰 끈은 mat_fixed_white 의 색 그대로
    const h = buildAvatar(assets, HOODIE);
    expectColor(colorAt(h, "top__hoodie_1"), new Color(HOODIE.colors.top));
    expectColor(colorAt(h, "top__hoodie_2"), STRING_WHITE);
    expectColor(colorAt(h, "body__head"), new Color(HOODIE.colors.skin));
    expectColor(colorAt(h, "hair__ponytail"), new Color(HOODIE.colors.hair));
    releaseAvatar(a);
    releaseAvatar(h);
  });

  it("drives every kept skinned mesh from one skeleton", () => {
    const a = buildAvatar(assets, HOODIE);
    const skinned: SkinnedMesh[] = [];
    a.root.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
    });
    expect(skinned).toHaveLength(2);
    const skeleton = skinned[0].skeleton;
    for (const mesh of skinned) expect(mesh.skeleton).toBe(skeleton);
    // ...whose bones are the clone's own bones, never the cached scene's.
    expect(skeleton.bones.map((b) => b.name)).toEqual(["root", "head"]);
    for (const bone of skeleton.bones) {
      let top: Object3D = bone;
      while (top.parent) top = top.parent;
      expect(top).toBe(a.root);
    }
    // the merged skinning attributes are uniform across primitives
    const { geometry } = solidOf(a);
    expect(geometry.getAttribute("skinIndex").array).toBeInstanceOf(Uint16Array);
    expect(geometry.getAttribute("skinWeight").array).toBeInstanceOf(Float32Array);
    expect(Object.keys(geometry.attributes).sort()).toEqual(["color", "normal", "position", "skinIndex", "skinWeight"]);
    releaseAvatar(a);
  });

  it("carries every vertex's joints and weights into the merged geometry, whatever their storage type", () => {
    const a = buildAvatar(assets, CAP_WHITE_TEE);
    const merged = a.parts.filter((p) => p !== "face__smile") as Primitive[];
    expect(merged).toContain(PACKED); // the Uint16-joint / normalised-Uint8-weight primitive is in this look
    for (const part of merged) {
      skinAt(a, part).forEach(({ joints, weights }, v) => {
        expect({ part, v, joints }).toEqual({ part, v, joints: [...JOINTS[v]] });
        // normalised bytes decode to byte / 255; Float32 weights come through unchanged
        const expected = part === PACKED ? WEIGHT_BYTES[v].map((b) => b / 255) : [...WEIGHTS[v]];
        weights.forEach((w, c) => expect({ part, v, c, w: +w.toFixed(6) }).toEqual({ part, v, c, w: +expected[c].toFixed(6) }));
      });
    }
    releaseAvatar(a);
  });

  it("lists every material it renders, so ghost opacity reaches all of them", () => {
    const sourceMaterials = new Set<Material>();
    assets.scene.traverse((o) => {
      if ((o as Mesh).isMesh) sourceMaterials.add((o as Mesh).material as Material);
    });
    for (const look of LOOKS) {
      const a = buildAvatar(assets, look);
      a.root.traverse((o) => {
        if ((o as Mesh).isMesh) expect(a.materials).toContain((o as Mesh).material);
      });
      for (const m of a.materials) expect(sourceMaterials.has(m)).toBe(false);
      releaseAvatar(a);
    }
  });

  it("keeps a shared solid geometry until its last avatar is released (Review Focus 1)", () => {
    const a = buildAvatar(assets, L);
    const b = buildAvatar(assets, L);
    expect(solidOf(a).geometry).toBe(solidOf(b).geometry);
    expect(solidGeometryRefs(lookKey(L))).toBe(2);
    const disposed = vi.fn();
    solidOf(a).geometry.addEventListener("dispose", disposed);
    releaseAvatar(a);
    expect(disposed).not.toHaveBeenCalled();
    expect(solidGeometryRefs(lookKey(L))).toBe(1);
    releaseAvatar(b);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(solidGeometryRefs(lookKey(L))).toBe(0);
  });

  it("setAvatarOpacity restores the authored BLEND state (Review Focus 2)", () => {
    const a = buildAvatar(assets, L);
    setAvatarOpacity(a, 0.5);
    for (const m of a.materials) {
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeCloseTo(0.5);
      expect(m.depthWrite).toBe(false);
    }
    setAvatarOpacity(a, 1);
    expect(faceMaterial(a).transparent).toBe(true);
    expect(faceMaterial(a).depthWrite).toBe(false);
    expect(faceMaterial(a).opacity).toBe(1);
    expect((solidOf(a).material as Material).transparent).toBe(false);
    expect((solidOf(a).material as Material).depthWrite).toBe(true);
    expect((solidOf(a).material as Material).opacity).toBe(1);
    releaseAvatar(a);
  });

  it("counts decorate() meshes and materials", () => {
    const halo = new MeshStandardMaterial();
    const a = buildAvatar(assets, L, (b) => {
      b.materials.push(halo);
      b.root.add(new Mesh(new BufferGeometry(), halo));
    });
    expect(a.drawMeshes).toBe(3);
    expect(a.triangles).toBe(9);
    expect(Number.isFinite(a.topY)).toBe(true); // an empty decoration does not turn the measured top into -Infinity
    expect(a.materials).toContain(halo);
    setAvatarOpacity(a, 0.5);
    expect(halo.opacity).toBeCloseTo(0.5);
    releaseAvatar(a);
  });

  it("does not mutate the cached source scene", () => {
    const snapshot = (): unknown[] => {
      const out: unknown[] = [];
      assets.scene.traverse((o) => {
        const mesh = o as SkinnedMesh;
        out.push([o.name, o.parent?.name, mesh.material, mesh.geometry, mesh.skeleton]);
        if (mesh.isMesh) {
          const m = mesh.material as Material;
          out.push([m.transparent, m.opacity, m.depthWrite, Object.keys(m.userData).length]);
          out.push(Object.keys(mesh.geometry.attributes).sort().join());
        }
      });
      return out;
    };
    const before = snapshot();
    const a = buildAvatar(assets, CAP_WHITE_TEE);
    const b = buildAvatar(assets, HOODIE);
    setAvatarOpacity(a, 0.5);
    setAvatarOpacity(b, 0.5);
    releaseAvatar(a);
    releaseAvatar(b);
    const after = snapshot();
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) expect(after[i]).toEqual(before[i]);
    // identity, not just equality: the same objects are still there
    for (let i = 0; i < before.length; i++) {
      const [x, y] = [before[i], after[i]];
      if (Array.isArray(x) && Array.isArray(y)) x.forEach((v, j) => expect(y[j]).toBe(v));
    }
  });

  it("names the parts when the solid primitives cannot be merged", () => {
    const broken = fakeScene();
    (broken.getObjectByName("body__hands") as SkinnedMesh).geometry.setIndex(null);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => buildAvatar({ scene: broken }, BROKEN_SCENE_LOOK)).toThrow(/body__hands/);
    expect(solidGeometryRefs(lookKey(BROKEN_SCENE_LOOK))).toBe(0);
    quiet.mockRestore();
  });

  it("refuses to merge a part bound with a different bind matrix", () => {
    const broken = fakeScene();
    (broken.getObjectByName("body__hands") as SkinnedMesh).bindMatrix.makeTranslation(0, 1, 0);
    expect(() => buildAvatar({ scene: broken }, BROKEN_SCENE_LOOK)).toThrow(/body__hands.*bind matrix/);
    expect(solidGeometryRefs(lookKey(BROKEN_SCENE_LOOK))).toBe(0);
  });

  it("refuses to share one skeleton with a part skinned to other bones", () => {
    const broken = fakeScene();
    const hands = broken.getObjectByName("body__hands") as SkinnedMesh;
    const [rootBone, head] = hands.skeleton.bones;
    hands.bind(new Skeleton([head, rootBone]), hands.bindMatrix); // same bones, other order: joint 0 means another bone
    expect(() => buildAvatar({ scene: broken }, BROKEN_SCENE_LOOK)).toThrow(/body__hands.*skeleton/);
    expect(solidGeometryRefs(lookKey(BROKEN_SCENE_LOOK))).toBe(0);
  });
});

// ── ownership: what the useAvatar hook relies on in StrictMode ────────────────

describe("avatar ownership", () => {
  it("releasing an avatar twice lets go of its share once", () => {
    const a = buildAvatar(assets, L);
    const b = buildAvatar(assets, L);
    const geometryDisposed = vi.fn();
    solidOf(a).geometry.addEventListener("dispose", geometryDisposed);
    const materialDisposed = vi.fn();
    for (const m of a.materials) m.addEventListener("dispose", materialDisposed);

    releaseAvatar(a);
    releaseAvatar(a);
    expect(solidGeometryRefs(lookKey(L))).toBe(1); // b still draws it
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(materialDisposed).toHaveBeenCalledTimes(a.materials.length);

    releaseAvatar(b);
    releaseAvatar(b);
    expect(solidGeometryRefs(lookKey(L))).toBe(0);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
  });

  it("a StrictMode effect replay (setup → cleanup → setup → cleanup) disposes exactly once, at the end", async () => {
    // render: StrictMode calls the useMemo factory twice and keeps the first result
    const rendered = assembleAvatar(assets, L);
    const discarded = assembleAvatar(assets, L);
    expect(solidOf(discarded).geometry).toBe(solidOf(rendered).geometry); // merged once
    expect(solidGeometryRefs(lookKey(L))).toBe(0); // rendering holds nothing

    const geometryDisposed = vi.fn();
    solidOf(rendered).geometry.addEventListener("dispose", geometryDisposed);
    const materialDisposed = vi.fn();
    for (const m of rendered.materials) m.addEventListener("dispose", materialDisposed);

    retainAvatar(rendered); // setup
    expect(solidGeometryRefs(lookKey(L))).toBe(1);
    releaseAvatarSoon(rendered); // replayed cleanup
    retainAvatar(rendered); // replayed setup, same task
    await flushMicrotasks();
    expect(solidGeometryRefs(lookKey(L))).toBe(1);
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(materialDisposed).not.toHaveBeenCalled();

    releaseAvatarSoon(rendered); // unmount
    expect(solidGeometryRefs(lookKey(L))).toBe(1); // not before the microtask
    await flushMicrotasks();
    expect(solidGeometryRefs(lookKey(L))).toBe(0);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(rendered.materials.length);

    // the discarded twin never held anything, so releasing it changes nothing
    releaseAvatar(discarded);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
  });

  it("assembling holds nothing: a render that never commits leaves no reference behind", () => {
    const orphan = assembleAvatar(assets, L);
    expect(solidGeometryRefs(lookKey(L))).toBe(0);
    // The next avatar to take a share drops the never-claimed merge from the cache (GC frees it).
    const other = buildAvatar(assets, HOODIE);
    const fresh = buildAvatar(assets, L);
    expect(solidOf(fresh).geometry).not.toBe(solidOf(orphan).geometry);
    expect(solidGeometryRefs(lookKey(L))).toBe(1);
    releaseAvatar(fresh);
    releaseAvatar(other);
  });

  it("an avatar whose look was re-merged before its setup ran switches to the shared geometry", () => {
    const late = assembleAvatar(assets, L); // rendered, effect not run yet
    const other = buildAvatar(assets, HOODIE); // drops late's unclaimed merge
    const early = buildAvatar(assets, L); // merges the look again and holds it
    retainAvatar(late);
    expect(solidOf(late).geometry).toBe(solidOf(early).geometry);
    expect(solidGeometryRefs(lookKey(L))).toBe(2);
    const disposed = vi.fn();
    solidOf(early).geometry.addEventListener("dispose", disposed);
    releaseAvatar(early);
    releaseAvatar(late);
    expect(disposed).toHaveBeenCalledTimes(1);
    releaseAvatar(other);
  });

  it("an avatar shown again after a release takes its geometry back into the cache", () => {
    const a = buildAvatar(assets, L);
    const geometry = solidOf(a).geometry;
    releaseAvatar(a); // hidden (Activity / Suspense fallback): its layout effect was cleaned up
    expect(solidGeometryRefs(lookKey(L))).toBe(0);
    retainAvatar(a); // shown again
    expect(solidOf(a).geometry).toBe(geometry);
    expect(solidGeometryRefs(lookKey(L))).toBe(1);
    const b = buildAvatar(assets, L);
    expect(solidOf(b).geometry).toBe(geometry);
    expect(solidGeometryRefs(lookKey(L))).toBe(2);
    releaseAvatar(a);
    releaseAvatar(b);
  });
});

// ── top of the avatar (name tag and bubble height) ─────────────────────────────

/**
 * A fake scene whose parts have different heights: each part's triangle peaks at `heights[part]` (metres)
 * instead of 1, so the avatar's top depends on which parts are worn.
 */
function tallScene(heights: Partial<Record<Primitive, number>>): { scene: Object3D } {
  const scene = fakeScene();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    const height = heights[o.name as Primitive];
    if (!mesh.isMesh || height === undefined) return;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) if (position.getY(i) === 1) position.setY(i, height);
  });
  return { scene };
}

/** Looks nothing else uses (skin 4), so the merged geometry of one test never stands in for another's. */
const tallLook = (hat: string | null): AvatarLook =>
  lookFromAppearance(
    appearanceFromIds(
      { hat, hair: "short", face: "smile", top: "tee", bottom: "pants", shoes: "sneakers", item: null },
      { hatColor: 1, hairColor: 1, topColor: 1, bottomColor: 1, shoesColor: 1, itemColor: 1, skin: 4, voice: 0 },
    ),
  );

describe("topY", () => {
  const heights = { body__head: 1.8, hair__short: 2.0, hair__short__hat: 2.0, hat__cap: 3.0 } as const;

  it("is the top of the worn parts: a bare head stops at the hair, a tall hat raises it", () => {
    const tall = tallScene(heights);
    const bare = buildAvatar(tall, tallLook(null));
    expect(bare.topY).toBeCloseTo(2.0, 9); // the hair, not the (taller) hat in the closet
    const capped = buildAvatar(tall, tallLook("cap"));
    expect(capped.topY).toBeCloseTo(3.0, 9);
    expect(capped.topY).toBeGreaterThan(bare.topY);
    releaseAvatar(bare);
    releaseAvatar(capped);
  });

  it("includes what decorate adds: the AI 조교 halo ring rises above the hair", () => {
    const tall = tallScene(heights);
    const plain = buildAvatar(tall, tallLook(null));
    const halo = buildAvatar(tall, tallLook(null), (b) => attachNpcAccessories(b.root, "#e8833a", b.materials));
    // head bone y 1 + ring at 1.1 above it + the tube's radius 0.025 (the ring lies flat: its thickness is its
    // height; a 10-sided tube peaks a hair under its radius, hence the 2 digits)
    expect(halo.topY).toBeCloseTo(1 + 1.1 + 0.025, 2);
    expect(halo.topY).toBeLessThan(1 + 1.1 + 0.025 + 1e-9);
    expect(halo.topY).toBeGreaterThan(plain.topY);
    expect(plain.topY).toBeCloseTo(2.0, 9);
    releaseAvatar(plain);
    releaseAvatar(halo);
  });

  it("a decoration lower than the hair changes nothing, and the source scene stays untouched", () => {
    const tall = tallScene({ ...heights, hair__short: 5.0 });
    const before = tall.scene.children.length;
    const a = buildAvatar(tall, tallLook(null), (b) => attachNpcAccessories(b.root, "#4d8df0", b.materials));
    expect(a.topY).toBeCloseTo(5.0, 9);
    expect(tall.scene.children).toHaveLength(before);
    expect((tall.scene.getObjectByName("head") as Object3D).children).toHaveLength(0); // the halo hangs on the clone only
    releaseAvatar(a);
  });

  it("is the same for every avatar of the same look, and finite for the stock fake scene", () => {
    const a = buildAvatar(assets, L);
    const b = buildAvatar(assets, L);
    expect(a.topY).toBe(b.topY);
    expect(a.topY).toBeCloseTo(1, 9); // every fake triangle peaks at 1 m
    releaseAvatar(a);
    releaseAvatar(b);
  });
});

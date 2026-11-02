import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Quaternion, SRGBColorSpace, Texture, Vector3, type Material } from "three";
import { COUNSEL_VISUALS } from "@caysonverse/shared/school/counselMap";
import { LIGHTMAP_CHANNEL, LIGHTMAP_INTENSITY } from "../game/hub/hubModelPrep";
import {
  BROKEN_TINT,
  DOOR_GLOW_ADD,
  EASE_SECONDS,
  GLOW_ADD,
  disposeCounsel,
  disposeModel,
  paintCounsel,
  placeDoor,
  prepareCounsel,
  setPartTargets,
  stepParts,
  tintFor,
} from "./counselModelPrep";
import { easeInOut } from "./escapeTimeline";

/**
 * A node tree with the names and materials the counsel.glb contract promises (art/school/notes.md): the shape the
 * GLTFLoader hands over, built by hand so no loader or WebGL is needed. `counsel_static` is ONE mesh with three materials
 * (wood, plaster, palette), as in the real file; every `obj__*` node of COUNSEL_VISUALS is a root node with the palette
 * material (the screen's face has its own glowing one) and a hinge origin; the exit door is among them.
 */
interface Fixture {
  scene: Object3D;
  mats: Record<string, MeshBasicMaterial>;
}

function mat(name: string): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: "#ffffff" });
  m.name = name;
  return m;
}

function fixture(): Fixture {
  const mats = {
    wood: mat("LM_wood"),
    plaster: mat("LM_plaster"),
    palette: mat("LM_palette"),
    cloud: mat("M_cloud"),
    glow: mat("M_glow"),
    screen: mat("M_glow_screen"),
  };
  const scene = new Object3D();
  const add = (name: string, material: Material | Material[], x = 0, y = 0, z = 0): Mesh => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), material);
    m.name = name;
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  add("counsel_static", [mats.wood, mats.plaster, mats.palette]);
  add("counsel_glow", mats.glow);
  add("backdrop__clouds", mats.cloud);
  add("col__desk", mats.cloud);
  for (const v of COUNSEL_VISUALS) add(v.node, v.node === "obj__screen_ari" ? mats.screen : mats.palette, 1, 0.5, 2);
  add("deco__bandit", mats.palette, 1.75, 0, 4.45);
  for (const [i, yaw] of [Math.PI / 2, Math.PI].entries()) {
    const s = new Object3D();
    s.name = `shaft__${i + 1}`;
    s.position.set(5.98, 2.275, i);
    s.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
    scene.add(s);
  }
  return { scene, mats };
}

const lightmap = () => new Texture();
const prep = (f = fixture()) => ({ f, nodes: prepareCounsel(f.scene, lightmap(), COUNSEL_VISUALS) });
const part = (nodes: ReturnType<typeof prepareCounsel>, node: string) => nodes.parts.find((p) => p.binding.node === node)!;

describe("prepareCounsel: dressing the model", () => {
  it("gives every LM_ material a private copy with the light map recipe, and leaves the cached originals alone", () => {
    const { f, nodes } = prep();
    const lm = lightmap();
    const again = prepareCounsel(f.scene, lm, COUNSEL_VISUALS);
    expect(lm.flipY).toBe(false);
    expect(lm.colorSpace).toBe(SRGBColorSpace);
    expect(lm.channel).toBe(LIGHTMAP_CHANNEL);
    const stat = nodes.root.getObjectByName("counsel_static") as Mesh;
    const used = stat.material as MeshBasicMaterial[];
    expect(used).toHaveLength(3);
    for (const m of used) {
      expect(m.name.startsWith("LM_")).toBe(true);
      expect(m.lightMap).not.toBeNull();
      expect(m.lightMapIntensity).toBeCloseTo(LIGHTMAP_INTENSITY, 10);
    }
    // The originals (what the loader cache holds) were never touched.
    for (const name of ["wood", "plaster", "palette"] as const) {
      expect(f.mats[name]!.lightMap).toBeNull();
      expect(f.mats[name]!.lightMapIntensity).toBe(1);
      expect(used).not.toContain(f.mats[name]);
    }
    // ...and the source scene's own meshes still use them.
    expect(((f.scene.getObjectByName("counsel_static") as Mesh).material as Material[])[0]).toBe(f.mats.wood);
    expect(again.tinted.length).toBe(nodes.tinted.length);
  });

  it("one copy per original material, shared by every mesh that used it", () => {
    const { nodes } = prep();
    const flash = nodes.root.getObjectByName("obj__flashlight") as Mesh;
    const stat = (nodes.root.getObjectByName("counsel_static") as Mesh).material as Material[];
    expect(flash.material).toBe(stat[2]); // the palette copy
    expect(nodes.tinted.map((m) => m.name).sort()).toEqual(["LM_palette", "LM_plaster", "LM_wood"]);
  });

  it("M_ materials get no light map; the clouds ignore the fog; col__ boxes are hidden", () => {
    const { f, nodes } = prep();
    expect((nodes.root.getObjectByName("counsel_glow") as Mesh).material).toBe(f.mats.glow);
    expect(f.mats.glow!.lightMap).toBeNull();
    expect(f.mats.cloud!.fog).toBe(false);
    expect(nodes.root.getObjectByName("col__desk")!.visible).toBe(false);
    expect(nodes.root.getObjectByName("counsel_static")!.visible).toBe(true);
  });

  it("collects a part for every binding but the exit door, which is the show's door", () => {
    const { nodes } = prep();
    expect(nodes.parts.map((p) => p.binding.node)).toEqual(COUNSEL_VISUALS.map((v) => v.node).filter((n) => n !== "obj__exit_door"));
    expect(nodes.door).not.toBeNull();
    expect(nodes.door!.angle).toBe(1.6);
    expect(nodes.bandit?.name).toBe("deco__bandit");
  });

  it("a binding whose node is missing is left out (no crash)", () => {
    const f = fixture();
    f.scene.getObjectByName("obj__flashlight")!.removeFromParent();
    const nodes = prepareCounsel(f.scene, lightmap(), COUNSEL_VISUALS);
    expect(nodes.parts.some((p) => p.binding.node === "obj__flashlight")).toBe(false);
  });

  it("glow parts and the door get their own material; the screen face is not tinted, the board cards are", () => {
    const { f, nodes } = prep();
    const cards = part(nodes, "obj__board_cards");
    const screen = part(nodes, "obj__screen_ari");
    expect(cards.glow).not.toBeNull();
    expect(cards.glow!.tinted).toBe(true);
    expect(screen.glow!.tinted).toBe(false);
    expect(screen.glow!.material).not.toBe(f.mats.screen);
    expect(cards.glow!.material).not.toBe(nodes.tinted.find((m) => m.name === "LM_palette"));
    expect(cards.glow!.material.lightMap).not.toBeNull();
    // the door's copy is painted on its own, not in the room-wide list
    expect(nodes.tinted).not.toContain(nodes.door!.material);
    expect(nodes.door!.material.lightMap).not.toBeNull();
    // every private material is in `own`
    for (const m of [cards.glow!.material, screen.glow!.material, nodes.door!.material, ...nodes.tinted]) expect(nodes.own).toContain(m);
    // hide / open parts have none
    expect(part(nodes, "obj__flashlight").glow).toBeNull();
    expect(part(nodes, "obj__safe_door").glow).toBeNull();
  });

  it("the last door as a group of two meshes (palette frame + glowing heart): one private copy per source material, so the heart keeps its glow look", () => {
    const f = fixture();
    const old = f.scene.getObjectByName("obj__exit_door")!;
    const door = new Object3D();
    door.name = "obj__exit_door";
    door.position.copy(old.position);
    const frame = new Mesh(new BoxGeometry(1, 1, 1), f.mats.palette);
    frame.name = "door_frame";
    const heart = new Mesh(new BoxGeometry(1, 1, 1), f.mats.glow);
    heart.name = "door_heart";
    door.add(frame, heart);
    old.removeFromParent();
    f.scene.add(door);
    const { nodes } = prep(f);
    const d = nodes.door!;
    const frameMat = (nodes.root.getObjectByName("door_frame") as Mesh).material as MeshBasicMaterial;
    const heartMat = (nodes.root.getObjectByName("door_heart") as Mesh).material as MeshBasicMaterial;
    // two different copies, each made from its own source (the heart did not get the palette's material)
    expect(heartMat).not.toBe(frameMat);
    expect(frameMat.name).toBe("LM_palette");
    expect(heartMat.name).toBe("M_glow");
    expect(frameMat).not.toBe(f.mats.palette);
    expect(heartMat).not.toBe(f.mats.glow);
    // the door's own, not the room-wide ones; every private copy is released with the scene
    expect(nodes.tinted).not.toContain(frameMat);
    expect(nodes.tinted).not.toContain(heartMat);
    for (const m of [frameMat, heartMat]) expect(nodes.own).toContain(m);
    // the light map is the baked surface's only
    expect(frameMat.lightMap).not.toBeNull();
    expect(heartMat.lightMap).toBeNull();
    expect(d.material).toBe(frameMat);
    expect(d.copies.map((c) => [c.material, c.tinted])).toEqual([[frameMat, true], [heartMat, false]]);
    // painting: the frame wears tint x door glow, the heart only the door glow
    paintCounsel(nodes, 0.72, 1);
    expect(frameMat.color.r).toBeCloseTo(BROKEN_TINT.r * (1 + DOOR_GLOW_ADD.r), 5);
    expect(heartMat.color.r).toBeCloseTo(1 + DOOR_GLOW_ADD.r, 5);
    paintCounsel(nodes, 1, 0);
    expect(frameMat.color.r).toBeCloseTo(1, 5);
    expect(heartMat.color.r).toBeCloseTo(1, 5);
    // the source scene still uses the cached originals
    expect((f.scene.getObjectByName("door_heart") as Mesh).material).toBe(f.mats.glow);
    expect((f.scene.getObjectByName("door_frame") as Mesh).material).toBe(f.mats.palette);
  });

  it("reads the five sunny windows as shaft points (position and the yaw of the inward direction)", () => {
    const { nodes } = prep();
    expect(nodes.shafts).toHaveLength(2);
    expect(nodes.shafts[0]!.x).toBeCloseTo(5.98, 6);
    expect(nodes.shafts[0]!.rotY).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(nodes.shafts[1]!.rotY)).toBeCloseTo(Math.PI, 6);
  });
});

describe("flags drive the nodes (hide / open / glow over EASE_SECONDS)", () => {
  const flagSet = (...f: string[]) => new Set(f);

  it("snap puts every part where the flags say at once (a refresh mid-game)", () => {
    const { nodes } = prep();
    const moving = setPartTargets(nodes.parts, flagSet("picked:flashlight", "solved:cabinet_lock", "solved:board_lock"), true);
    expect(moving).toBe(false);
    expect(part(nodes, "obj__flashlight").node.visible).toBe(false);
    expect(part(nodes, "obj__uv_film").node.visible).toBe(true);
    expect(part(nodes, "obj__cabinet_door").node.rotation.y).toBeCloseTo(-1.75, 10);
    expect(part(nodes, "obj__board_cover").node.rotation.y).toBeCloseTo(0, 10);
    expect(part(nodes, "obj__board_cards").value).toBe(1);
  });

  it("an open part swings with a smooth ease and arrives after 0.4 s, not before", () => {
    const { nodes } = prep();
    setPartTargets(nodes.parts, flagSet(), true);
    expect(setPartTargets(nodes.parts, flagSet("safe_open"), false)).toBe(true);
    const door = part(nodes, "obj__safe_door");
    expect(door.node.rotation.y).toBe(0);
    expect(stepParts(nodes.parts, EASE_SECONDS / 2)).toBe(true);
    expect(door.node.rotation.y).toBeCloseTo(-1.9 * easeInOut(0.5), 10);
    expect(stepParts(nodes.parts, EASE_SECONDS / 4)).toBe(true);
    expect(door.node.rotation.y).toBeLessThan(-1.9 * 0.5);
    expect(door.node.rotation.y).toBeGreaterThan(-1.9);
    expect(stepParts(nodes.parts, EASE_SECONDS)).toBe(false);
    expect(door.node.rotation.y).toBeCloseTo(-1.9, 10);
    // nothing moves once at rest
    expect(stepParts(nodes.parts, 1)).toBe(false);
  });

  it("a hide part shrinks away and then stops being drawn; a lowered flag brings it back", () => {
    const { nodes } = prep();
    setPartTargets(nodes.parts, flagSet(), true);
    const flash = part(nodes, "obj__flashlight");
    setPartTargets(nodes.parts, flagSet("picked:flashlight"), false);
    stepParts(nodes.parts, EASE_SECONDS / 2);
    expect(flash.node.visible).toBe(true);
    expect(flash.node.scale.x).toBeCloseTo(0.5, 10);
    stepParts(nodes.parts, EASE_SECONDS);
    expect(flash.node.visible).toBe(false);
    setPartTargets(nodes.parts, flagSet(), false);
    stepParts(nodes.parts, EASE_SECONDS / 2);
    expect(flash.node.visible).toBe(true);
    stepParts(nodes.parts, EASE_SECONDS);
    expect(flash.node.scale.x).toBeCloseTo(1, 10);
  });

  it("a hinge part swings from the yaw the model has it at", () => {
    const f = fixture();
    f.scene.getObjectByName("obj__cabinet_door")!.rotation.y = 0.3;
    const nodes = prepareCounsel(f.scene, lightmap(), COUNSEL_VISUALS);
    setPartTargets(nodes.parts, flagSet("solved:cabinet_lock"), true);
    expect(part(nodes, "obj__cabinet_door").node.rotation.y).toBeCloseTo(0.3 - 1.75, 10);
  });

  it("a long frame cannot overshoot", () => {
    const { nodes } = prep();
    setPartTargets(nodes.parts, flagSet("safe_open"), false);
    stepParts(nodes.parts, 5);
    expect(part(nodes, "obj__safe_door").value).toBe(1);
    expect(part(nodes, "obj__safe_door").node.rotation.y).toBeCloseTo(-1.9, 10);
  });

  it("the last door follows the show's openness (a swing of its binding's angle about its pivot)", () => {
    const { nodes } = prep();
    const d = nodes.door!;
    placeDoor(d, 0);
    expect(d.node.rotation.y).toBe(0);
    placeDoor(d, 0.5);
    expect(d.node.rotation.y).toBeCloseTo(1.6 * 0.5, 10);
    placeDoor(d, 1);
    expect(d.node.rotation.y).toBeCloseTo(1.6, 10);
  });
});

describe("the broken room and the glow (paintCounsel)", () => {
  it("tintFor: the broken multiplier at 0.72, the room's own colour at 1, in between linear; a bad value is clamped", () => {
    const k = { r: 0, g: 0, b: 0 };
    tintFor(0.72, k);
    expect(k).toEqual({ r: BROKEN_TINT.r, g: BROKEN_TINT.g, b: BROKEN_TINT.b });
    tintFor(1, k);
    expect(k).toEqual({ r: 1, g: 1, b: 1 });
    tintFor(0.86, k);
    expect(k.r).toBeCloseTo((BROKEN_TINT.r + 1) / 2, 10);
    tintFor(0.2, k);
    expect(k.r).toBe(BROKEN_TINT.r);
    tintFor(3, k);
    expect(k.r).toBe(1);
    // the multiplier is a blue-grey about the plan's 72 %: dimmer than 1 everywhere, bluest in blue
    expect((BROKEN_TINT.r + BROKEN_TINT.g + BROKEN_TINT.b) / 3).toBeCloseTo(0.72, 1);
    expect(BROKEN_TINT.b).toBeGreaterThan(BROKEN_TINT.r);
  });

  it("paints the room-wide materials with the tint, never touching the cached originals", () => {
    const { f, nodes } = prep();
    paintCounsel(nodes, 0.72, 0);
    for (const m of nodes.tinted) expect(m.color.r).toBeCloseTo(BROKEN_TINT.r, 5);
    paintCounsel(nodes, 1, 0);
    for (const m of nodes.tinted) expect([m.color.r, m.color.g, m.color.b]).toEqual([1, 1, 1]);
    for (const name of ["wood", "plaster", "palette"] as const) expect(f.mats[name]!.color.getHex()).toBe(0xffffff);
  });

  it("a glowing part is pushed past 1 as its flag comes in (warm), on top of the tint where it is tinted", () => {
    const { nodes } = prep();
    const cards = part(nodes, "obj__board_cards");
    const screen = part(nodes, "obj__screen_ari");
    paintCounsel(nodes, 0.72, 0);
    expect(cards.glow!.material.color.r).toBeCloseTo(BROKEN_TINT.r, 5);
    expect(screen.glow!.material.color.r).toBeCloseTo(1, 5); // not tinted
    setPartTargets(nodes.parts, new Set(["solved:board_lock", "finale_ready"]), true);
    paintCounsel(nodes, 0.72, 0);
    expect(cards.glow!.material.color.r).toBeCloseTo(BROKEN_TINT.r * (1 + GLOW_ADD.r), 5);
    expect(cards.glow!.material.color.b).toBeCloseTo(BROKEN_TINT.b * (1 + GLOW_ADD.b), 5);
    expect(screen.glow!.material.color.r).toBeCloseTo(1 + GLOW_ADD.r, 5);
    expect(screen.glow!.material.color.r).toBeGreaterThan(screen.glow!.material.color.b); // warm
  });

  it("the door glows with the show's doorGlow, over the tint", () => {
    const { nodes } = prep();
    paintCounsel(nodes, 0.72, 0);
    expect(nodes.door!.material.color.r).toBeCloseTo(BROKEN_TINT.r, 5);
    paintCounsel(nodes, 0.72, 1);
    expect(nodes.door!.material.color.r).toBeCloseTo(BROKEN_TINT.r * (1 + DOOR_GLOW_ADD.r), 5);
    paintCounsel(nodes, 1, 0);
    expect(nodes.door!.material.color.r).toBeCloseTo(1, 5);
  });
});

describe("releasing the room", () => {
  it("disposeCounsel frees the copies and nothing else; disposeModel frees the model's geometry and materials", () => {
    const { f, nodes } = prep();
    const disposed: Material[] = [];
    for (const m of nodes.own) m.addEventListener("dispose", () => disposed.push(m));
    let originalDisposed = 0;
    for (const m of Object.values(f.mats)) m.addEventListener("dispose", () => originalDisposed++);
    disposeCounsel(nodes);
    expect(disposed).toHaveLength(nodes.own.length);
    expect(originalDisposed).toBe(0);
    disposeModel(f.scene);
    expect(originalDisposed).toBe(Object.keys(f.mats).length);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BoxGeometry, CompressedTexture, MeshStandardMaterial, BufferGeometry, Float32BufferAttribute, Group, Mesh, Uint8BufferAttribute, Vector3 } from "three";
import { LOT_DETAIL_LOD, LOT_INTERIORS, LOT_ROOMS, VILLAGE_LOTS, lotFootprint, lotRoomDoor, type LotId } from "@caysonverse/shared/village/villageLots";
import { pbrSetInfo } from "../pbr/pbrLibrary";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { LOT_TREE_SPECS } from "../veg/treeSkeleton";
import { PHONE_GOODS_REACH, VESTIBULE_FLOOR_MIN_Y, innerHingePivot, lotSurfaceMaterial, mergeReady, pickLotLevels, setLotDoor, vestibuleFloor, type LotLevel } from "./lotsPrep";
import { LOT_DOOR_PADS, LOT_SLOT_HOOKS, lotDoorNotice, lotDoorTarget, lotExitTarget, lotSlotHandlers, onLotSlot } from "./lotTargets";
import { lotTrimFootprints } from "./LotsVillagePatch";
import { manifestPaths } from "./lotTextures";
import { LOT_ROOM_PHONE_FILES, SACRED_MAP_MAX, capMips, isSacredHero, sacredCaps, sacredFile, sacredUrl } from "./LotRoom";

const LOTS_DIR = resolve(__dirname, "..", "..", "..", "public", "models", "village", "lots");
/** A GLB's JSON chunk. */
function glbJson(file: string): { asset: { extras?: Record<string, unknown> }; materials?: Array<{ name: string }>; nodes: Array<{ name?: string }> } {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

/** The lots with the triangle counts the game measured (L5v2, window.__cvLots, 2026-11-17). */
const MEASURED: Record<Exclude<LotId, "lot_cafe">, [number, number]> = {
  lot_school: [7622, 8570],
  lot_chapel: [6467, 8427],
  lot_library: [6758, 10500],
  lot_temple: [10227, 9364],
  lot_church: [5411, 2772],
  lot_gate: [7130, 7630],
};
const LOTS = VILLAGE_LOTS.map((l) => ({ id: l.id, box: lotFootprint(l), detailTris: MEASURED[l.id as keyof typeof MEASURED][0], goodsTris: MEASURED[l.id as keyof typeof MEASURED][1] }));
const at = (x: number, z: number) => [{ x, z }];

describe("lot LOD (one pool, nearest first)", () => {
  it("from the plaza: shells only", () => {
    const lv = pickLotLevels(new Map(), at(0, 0), LOTS, "pc");
    expect([...lv.values()].every((v) => v === 0)).toBe(true);
  });
  it("PC at the school's gate: everything there", () => {
    expect(pickLotLevels(new Map(), at(46, 15), LOTS, "pc").get("lot_school")).toBe(2);
  });
  it("phone: goods only within 15 m, structure within 25 m, at most two lots anywhere", () => {
    expect(pickLotLevels(new Map(), at(46, 15), LOTS, "phone").get("lot_school")).toBe(2);
    expect(pickLotLevels(new Map(), at(48.5 - (PHONE_GOODS_REACH + 3), 15), LOTS, "phone").get("lot_school")).toBe(1);
    expect(pickLotLevels(new Map(), at(48.5 - (LOT_DETAIL_LOD.phone + 6), 15), LOTS, "phone").get("lot_school")).toBe(0);
    for (const x of [-60, -30, 0, 30, 60]) for (const z of [-50, -20, 0, 20, 50, 80]) {
      const lv = pickLotLevels(new Map(), at(x, z), LOTS, "phone");
      expect([...lv.values()].filter((v) => v > 0).length).toBeLessThanOrEqual(LOT_DETAIL_LOD.phoneMaxDetailed);
    }
  });
  it("hysteresis: a shown lot stays until 4 m farther", () => {
    const edge = 48.5 - LOT_DETAIL_LOD.pc - 2;
    expect(pickLotLevels(new Map<LotId, LotLevel>([["lot_school", 2]]), at(edge, 15), LOTS, "pc").get("lot_school")).toBe(2);
    expect(pickLotLevels(new Map(), at(edge, 15), LOTS, "pc").get("lot_school")).toBe(0);
  });
});

describe("the v2 models and their manifests", () => {
  // (the café's room has no GLB: it is built at run time, cafe/CafeRoom.tsx)
  const models = [...VILLAGE_LOTS.map((l) => l.id as string), ...LOT_INTERIORS.filter((i) => i.unit !== "lot_cafe_room").map((i) => i.unit)];
  it("every model names its texture manifest, and every material it has is in it (a library set that exists, or a kind)", () => {
    for (const m of models) {
      const j = glbJson(join(LOTS_DIR, `${m}.glb`));
      const paths = manifestPaths(j.asset.extras?.textures);
      expect(paths.length, m).toBe(1);
      const man = JSON.parse(readFileSync(join(LOTS_DIR, "..", paths[0]!), "utf8")) as { materials: Record<string, { pbr?: string; kind?: string; maps?: { albedo: string } }> };
      for (const mat of j.materials ?? []) {
        const spec = man.materials[mat.name];
        expect(spec, `${m} ${mat.name}`).toBeDefined();
        if (spec!.pbr) expect(() => pbrSetInfo(spec!.pbr!)).not.toThrow();
        else expect(["glass", "screen", "garden", "fire", "own", "lightpool", "lamp", "emit"]).toContain(spec!.kind);
        if (spec!.maps?.albedo) expect(existsSync(join(LOTS_DIR, "..", paths[0]!.replace(/[^/]+$/, ""), spec!.maps.albedo)), spec!.maps.albedo).toBe(true);
      }
    }
  });
  it("manifest paths from extras: a string, a list, free text", () => {
    expect(manifestPaths("lots/school/lot_school_textures.json")).toEqual(["lots/school/lot_school_textures.json"]);
    expect(manifestPaths(["lots/a/x.json", "lots/b/y.json"])).toEqual(["lots/a/x.json", "lots/b/y.json"]);
    expect(manifestPaths("see lots/c/z.json (LM_*)")).toEqual(["lots/c/z.json"]);
    expect(manifestPaths(undefined)).toEqual([]);
  });
  it("the rooms' sacred pieces resolve to files that exist (both builders' extras shapes), phone files where the phone draws them", () => {
    let n = 0;
    for (const i of LOT_INTERIORS.filter((q) => q.unit !== "lot_cafe_room")) {
      const sacred = (glbJson(join(LOTS_DIR, `${i.unit}.glb`)).asset.extras?.sacred ?? []) as Array<{ node: string; file: string; phone?: boolean | string; phoneFile?: string }>;
      for (const s of sacred) {
        for (const phone of [false, true]) {
          const f = sacredFile(s, phone);
          if (f === null) {
            expect(phone && s.phone === false, s.node).toBe(true);
            continue;
          }
          n++;
          const url = sacredUrl(f).split("?")[0]!.replace(/^\/models\/village\//, "");
          expect(existsSync(join(LOTS_DIR, "..", url)), `${i.unit} ${s.node} ${url}`).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });
  it("the phone room files are exactly the ones B2 made", () => {
    const phoneFiles = readdirSync(LOTS_DIR).filter((f) => /_phone\.glb$/.test(f)).map((f) => f.replace(/_phone\.glb$/, ""));
    expect([...LOT_ROOM_PHONE_FILES].sort()).toEqual(phoneFiles.sort());
  });
  it("the schoolyard's trees are the vegetation's (LOT_TREE_SPECS = the models' asset.extras.vegetation)", () => {
    const spots = VILLAGE_LOTS.flatMap((l) => (glbJson(join(LOTS_DIR, `${l.id}.glb`)).asset.extras?.vegetation ?? []) as Array<{ x: number; z: number; H: number; R: number; seed: number }>);
    expect(LOT_TREE_SPECS.map(({ x, z, H, R, seed }) => ({ x, z, H, R, seed }))).toEqual(spots.map(({ x, z, H, R, seed }) => ({ x, z, H, R, seed })));
  });
});

describe("shell merge input", () => {
  it("every part gets float position / normal / uv / RGB colour and an index (white where it had no colour)", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const c = new BufferGeometry();
    c.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    c.setAttribute("color", new Uint8BufferAttribute([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 4, true));
    for (const x of [mergeReady(g), mergeReady(c)]) {
      expect(Object.keys(x.attributes).sort()).toEqual(["color", "normal", "position", "uv"]);
      expect(x.getAttribute("color").itemSize).toBe(3);
      expect(x.index).not.toBeNull();
    }
  });
});

describe("swing doors turn on their inner hinge corner (the door check's finding)", () => {
  it("shut the leaf stays where the kit put it; swung inward, no part of it crosses the jamb's plane", () => {
    const door = new Group();
    // a 1.1 m leaf, 6 cm thick, its hinge line at its origin, the room on −z (the kits' frame)
    const leaf = new Mesh(new BoxGeometry(1.1, 3, 0.06).translate(0.55, 1.5, 0));
    leaf.position.set(-1.1, 0, -0.32);
    door.add(leaf);
    door.updateMatrixWorld(true);
    const pts = () => {
      leaf.updateMatrixWorld(true);
      const pos = leaf.geometry.getAttribute("position");
      const out: Vector3[] = [];
      for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(leaf.matrixWorld));
      return out;
    };
    const before = pts().map((v) => v.toArray().map((x) => +x.toFixed(6)));
    const pivot = innerHingePivot(leaf, true);
    door.updateMatrixWorld(true);
    expect(pts().map((v) => v.toArray().map((x) => +x.toFixed(6)))).toEqual(before);
    const rig = { id: "d", lot: "lot_school" as LotId, leaves: [{ node: pivot, baseX: pivot.position.x, slide: 0, baseYaw: pivot.rotation.y, swing: Math.PI / 2 }] };
    for (const a of [0.1, 0.3, 0.6, 1]) {
      setLotDoor(rig, a);
      door.updateMatrixWorld(true);
      // the jamb's reveal is the plane x = −1.1 (the hinge edge): nothing of the leaf goes past it
      expect(Math.min(...pts().map((v) => v.x))).toBeGreaterThanOrEqual(-1.1 - 1e-6);
    }
  });
});

describe("lot doors, the rooms' ways out, the slots", () => {
  it("five room doors (들어가기), the café's and the gate (곧 문을 열어요)", () => {
    expect(LOT_DOOR_PADS.map((p) => `${p.door}:${p.kind}`).sort()).toEqual(
      ["lot_cafe_main:enter", "lot_chapel_main:enter", "lot_church_main:enter", "lot_gate_main:soon", "lot_library_main:enter", "lot_school_main:enter", "lot_temple_main:enter"].sort(),
    );
    const church = LOT_DOOR_PADS.find((p) => p.door === "lot_church_main")!;
    expect(lotDoorTarget(church.x, church.z)).toMatchObject({ kind: "door", id: "lotenter:lot_church_main", label: "교회 들어가기", short: "들어가기" });
    const temple = LOT_DOOR_PADS.find((p) => p.door === "lot_temple_main")!;
    expect(lotDoorTarget(temple.x, temple.z)!.label).toBe("절 들어가기");
    const gate = LOT_DOOR_PADS.find((p) => p.door === "lot_gate_main")!;
    expect(lotDoorTarget(gate.x, gate.z)).toMatchObject({ kind: "object", label: "곧 문을 열어요" });
    expect(lotDoorNotice(gate)).toMatch(/곧 문을 열어요/);
    expect(lotDoorTarget(0, 0)).toBeNull();
  });
  it("inside, the way out is offered on its pad and straight in front of the door, not from the side or deeper in", () => {
    for (const r of LOT_ROOMS) {
      const d = lotRoomDoor(r);
      expect(lotExitTarget(r.area, d.exitPad.x, d.exitPad.z)).toMatchObject({ kind: "door", label: "밖으로 나가기" });
      expect(lotExitTarget(r.area, d.arrival.x, d.arrival.z)).not.toBeNull();
      expect(lotExitTarget(r.area, d.exitPad.x + 2.5, d.exitPad.z + 0.6)).toBeNull();
      expect(lotExitTarget(r.area, d.exitPad.x, d.exitPad.z + 3)).toBeNull();
      expect(lotExitTarget("village", d.exitPad.x, d.exitPad.z)).toBeNull();
    }
  });
  it("the slots are inert hooks", () => {
    expect(LOT_SLOT_HOOKS.length).toBe(VILLAGE_LOTS.reduce((s, l) => s + l.slots.length, 0));
    let fired = 0;
    const off = onLotSlot("clock", () => fired++);
    expect(lotSlotHandlers("clock")).toBe(1);
    off();
    expect(fired).toBe(0);
  });
  it("the village clone's trim: each lot's footprint, its plot's old sign post, plot_w's scaffold and crane", () => {
    const feet = lotTrimFootprints(VILLAGE_LOTS.map((l) => l.id));
    // 6 footprints, the plots' old sign posts (none since vrb2's rebuild, release 4: the plots lost their signs), the scaffold and the jib
    const posts = VILLAGE_LOTS.filter((l) => l.plot && VILLAGE_LAYOUT.plots.find((p) => p.id === l.plot)?.signPost).length;
    expect(feet.length).toBe(6 + posts + 2);
    const jib = feet[feet.length - 1]!;
    expect(jib.inside(-60, 22, 4)).toBe(true);
    expect(jib.inside(-60, 8, 4)).toBe(false);
  });
});

describe("sacred pieces' maps: capped by dropping mips (L5v2 budget pass)", () => {
  const chain = (w: number, h: number) => {
    const out: Array<{ width: number; height: number; data: Uint8Array }> = [];
    for (;;) {
      out.push({ width: w, height: h, data: new Uint8Array(1) });
      if (w === 1 && h === 1) return out;
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
  };
  const tex = (w: number, h: number) => new CompressedTexture(chain(w, h) as never, w, h);

  it("the chapel's Mary and the framed art keep their sharp maps; the saints, the glass and the temple keep the budget caps", () => {
    expect(sacredCaps("lotstatue__lot_chapel_nave_mary", false)).toMatchObject({ color: 1024, normal: 2048 });
    expect(sacredCaps("lotstatue__lot_chapel_nave_mary", true)).toMatchObject({ color: 1024, normal: 1024 });
    expect(sacredCaps("lotstatue__lot_chapel_nave_crucifix", false)).toMatchObject({ normal: 1024 });
    expect(sacredCaps("lotart__lot_chapel_nave_station_07", false).color).toBe(768);
    expect(sacredCaps("lotart__lot_church_nave_bloch_sermon", false).color).toBe(1024);
    expect(sacredCaps("lotstatue__lot_chapel_nave_saint", false)).toEqual(SACRED_MAP_MAX.desktop);
    expect(sacredCaps("lotglass__lot_chapel_nave_rose", true)).toEqual(SACRED_MAP_MAX.mobile);
    expect(sacredCaps("lotstatue__lot_temple_hall_buddha", false)).toEqual(SACRED_MAP_MAX.desktop);
    expect(isSacredHero("lotart__lot_chapel_nave_station_01")).toBe(true);
    expect(isSacredHero("lotglass__lot_chapel_nave_rose")).toBe(false);
  });

  it("a 2048 statue map drops to the cap; its image follows the new top level", () => {
    const t = tex(2048, 2048);
    capMips(t, SACRED_MAP_MAX.desktop.color);
    expect(t.mipmaps![0]).toMatchObject({ width: 1024, height: 1024 });
    expect(t.image).toMatchObject({ width: 1024, height: 1024 });
    capMips(t, SACRED_MAP_MAX.desktop.color); // twice is once (a copy shares its maps)
    expect(t.mipmaps![0]!.width).toBe(1024);
  });

  it("never a top level that is not whole 4x4 blocks (192x500 stays: 96x250 is no compressed size)", () => {
    const t = tex(384, 1000);
    capMips(t, 256);
    expect(t.mipmaps![0]).toMatchObject({ width: 192, height: 500 });
  });

  it("a map at or under its cap, or without mips, is left as it is", () => {
    const t = tex(512, 512);
    const before = t.mipmaps;
    capMips(t, 512);
    expect(t.mipmaps).toBe(before);
    const one = new CompressedTexture([{ width: 2048, height: 2048, data: new Uint8Array(1) }] as never, 2048, 2048);
    capMips(one, 256);
    expect(one.mipmaps![0]!.width).toBe(2048);
  });
});

describe("the chapel's cream limestone (albedoGain on the set's albedo)", () => {
  it("a spec's albedoGain becomes the material colour; without one it stays white", () => {
    const m = lotSurfaceMaterial(new MeshStandardMaterial({ name: "LM_chapel_stone" }), { pbr: "stone_ashlar", albedoGain: [2, 2.15, 2.6] }, false);
    expect(m.color.toArray()).toEqual([2, 2.15, 2.6]);
    expect(lotSurfaceMaterial(new MeshStandardMaterial({ name: "LM_x" }), { pbr: "stone_ashlar" }, false).color.toArray()).toEqual([1, 1, 1]);
  });
  it("the chapel's manifest carries it on its stone", () => {
    const j = JSON.parse(readFileSync(resolve(__dirname, "../../../public/models/village/lots/chapel/lot_chapel_textures.json"), "utf8"));
    expect(j.materials.LM_chapel_stone.albedoGain).toHaveLength(3);
  });
});

describe("the vestibule behind a lot's open door (owner 2026-11-19: grass inside the open chapel door)", () => {
  // the chapel's door faces west; its inside runs +x from the door line at x = 43
  const chapel = VILLAGE_LOTS.find((l) => l.id === "lot_chapel")!;
  const door = chapel.doors[0]!;
  const granite = () => new MeshStandardMaterial({ name: "LM_chapel_granite" });
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, name = "LM_chapel_granite") => {
    const m = new Mesh(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new MeshStandardMaterial({ name }));
    return m;
  };
  const room = (floors: Mesh[]) => {
    const root = new Group();
    // the inner wall and the side walls (what the floor's extent is measured against)
    root.add(box(46, 46.3, 0, 4, -41, -33), box(43, 46, 0, 4, -40.3, -40), box(43, 46, 0, 4, -34, -33.7), ...floors);
    root.updateMatrixWorld(true);
    return root;
  };
  it("a 12 cm threshold with the village lawn beyond it still gets a floor, at the ground (not grass)", () => {
    const root = room([box(43, 44, 0, 0.12, -38, -36)]);
    const f = vestibuleFloor(root, chapel, door, granite());
    expect(f).not.toBeNull();
    expect(f!.geometry.getAttribute("position").getY(0)).toBeCloseTo(VESTIBULE_FLOOR_MIN_Y, 5);
  });
  it("a kit floor raised all the way in (the temple's 마루) needs none", () => {
    const root = room([box(43, 46, 0, 0.9, -40, -34)]);
    expect(vestibuleFloor(root, chapel, door, granite())).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { HOUSE_A8, HOUSE_BODY_FRONT, HOUSE_DETAIL_LOD, houseLocalToWorld, houseSlots, porchSlabLocal, porchTreadsLocal } from "@caysonverse/shared/village/houseExterior";
import { A7_MODEL_HOUSE_BOXES, A8_TREE_MOVES } from "@caysonverse/shared/village/a8Staging";
import { HOUSE_EXTERIOR_DEFAULT } from "@caysonverse/shared/village/houseOwnership";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { HOUSE_LIFT_EASE_S, HOUSE_LIFT_ZONES, easeLift, isPorchSeat, porchesDrawn, setPorchesDrawn, stepLiftAt, withSeatLift } from "./houseLift";
import { VILLAGE_SEAT_MARKERS } from "@caysonverse/shared/village/benchSeats";
import {
  OLD_PORCH_STEPS,
  a8TreeShift,
  gapToBox,
  hasPorchSlab,
  houseNodePart,
  houseTextureFiles,
  lightVariant,
  makeHouseGrounds,
  oldHouseFootprints,
  pickDetail,
  porchLampPoints,
  type HouseTextureMeta,
} from "./housesPrep";
import { houseBoards } from "./houseSigns";

const HOUSES = VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house");
const H = (n: number) => HOUSES.find((h) => h.id === `house_${n}`)!;
const at = (n: number, lx: number, lz: number) => houseLocalToWorld(H(n), lx, lz);

describe("the porches' picture lift (houseLift.ts, contract ch. 3)", () => {
  it("lifts only the houses whose porch is drawn, by the contract's heights", () => {
    setPorchesDrawn([]);
    const pad = at(2, 0, HOUSE_BODY_FRONT + 0.65);
    expect(stepLiftAt(pad.x, pad.z)).toBe(0); // no porch drawn: nobody floats
    setPorchesDrawn(["house_2"]);
    expect(porchesDrawn().has("house_2")).toBe(true);
    expect(stepLiftAt(pad.x, pad.z)).toBe(HOUSE_A8.floorLift);
    const t = porchTreadsLocal("house_2");
    const t0 = at(2, 0, (t[0]!.z0 + t[0]!.z1) / 2);
    const t1 = at(2, 0, (t[1]!.z0 + t[1]!.z1) / 2);
    expect(stepLiftAt(t0.x, t0.z)).toBeCloseTo(0.2, 6);
    expect(stepLiftAt(t1.x, t1.z)).toBeCloseTo(0.1, 6);
    const lawn = at(2, 0, 5.375 + 0.68 + 0.5);
    expect(stepLiftAt(lawn.x, lawn.z)).toBe(0);
    const other = at(9, 0, HOUSE_BODY_FRONT + 0.65);
    expect(stepLiftAt(other.x, other.z)).toBe(0);
    setPorchesDrawn([]);
  });

  it("every keypad pad and every way-out spot stands on its porch (lifted once the porch is drawn)", () => {
    setPorchesDrawn(HOUSES.map((h) => h.id));
    for (const e of keypadEntries()) {
      expect(stepLiftAt(e.pad.x, e.pad.z), e.buildingId).toBe(0.3);
      expect(stepLiftAt(e.exit.x, e.exit.z), `${e.buildingId} exit`).toBe(0.3);
    }
    setPorchesDrawn([]);
  });

  it("zones: a porch and two treads per house", () => {
    expect(HOUSE_LIFT_ZONES).toHaveLength(HOUSES.length * 3);
  });

  it("eases in about the contract's 0.12 s and snaps within a millimetre", () => {
    let v = 0;
    for (let i = 0; i < 6; i++) v = easeLift(v, 0.3, 1 / 60); // 0.1 s
    expect(v).toBeGreaterThan(0.3 * (1 - Math.exp(-0.1 / HOUSE_LIFT_EASE_S)) - 1e-6);
    expect(v).toBeLessThan(0.3);
    for (let i = 0; i < 120; i++) v = easeLift(v, 0.3, 1 / 60);
    expect(v).toBe(0.3);
    expect(easeLift(0.2, 0.3, 0)).toBe(0.2);
  });

  it("seated on the porch bench (seatTop 0.75, already above the lawn) the porch is not added twice", () => {
    expect(withSeatLift(0.3, 0.3)).toBe(0.3);
    expect(withSeatLift(0.3, 0)).toBe(0.3);
    expect(withSeatLift(0, 0.12)).toBe(0.12);
  });
});

describe("the porch benches in the seat system (contract ch. 3)", () => {
  it("houses 2, 9 and 10: id house_N_porch, seat top 0.75, a tap only walks there (isPorchSeat)", () => {
    const porch = VILLAGE_SEAT_MARKERS.filter((m) => /_porch$/.test(m.id));
    expect(porch.map((m) => m.id).sort()).toEqual(["house_10_porch", "house_2_porch", "house_9_porch"]);
    for (const m of porch) {
      expect(m.seatTop).toBe(0.75);
      expect(isPorchSeat({ bench: m.id })).toBe(true);
    }
    expect(isPorchSeat({ bench: "plaza_bench_3" })).toBe(false);
    expect(isPorchSeat(undefined)).toBe(false);
  });
});

describe("the houses' detail (contract ch. 5 HOUSE_DETAIL_LOD)", () => {
  const boxes = HOUSES.map((h) => ({ id: h.id, box: { minX: h.centre.x - h.size.x / 2, maxX: h.centre.x + h.size.x / 2, minZ: h.centre.z - h.size.z / 2, maxZ: h.centre.z + h.size.z / 2 } }));

  it("PC: never more than four, phone: the two nearest, from anywhere on the map", () => {
    for (let x = -95; x <= 95; x += 5)
      for (let z = -95; z <= 95; z += 5) {
        const refs = [{ x, z }, { x: x + 3, z: z - 4 }];
        const pc = pickDetail(new Set(), refs, boxes, "pc");
        const phone = pickDetail(new Set(), refs, boxes, "phone");
        expect(pc.size).toBeLessThanOrEqual(HOUSE_DETAIL_LOD.pcMaxNear);
        expect(phone.size).toBeLessThanOrEqual(HOUSE_DETAIL_LOD.phoneNearest);
        for (const id of pc) expect(Math.min(...refs.map((r) => gapToBox(r.x, r.z, boxes.find((b) => b.id === id)!.box)))).toBeLessThanOrEqual(HOUSE_DETAIL_LOD.pc);
        for (const id of phone) expect(Math.min(...refs.map((r) => gapToBox(r.x, r.z, boxes.find((b) => b.id === id)!.box)))).toBeLessThanOrEqual(HOUSE_DETAIL_LOD.phone);
      }
  });

  it("a shown detail hides only 4 m farther out (no flicker at the edge)", () => {
    const b = boxes.find((x) => x.id === "house_1")!.box;
    const r = (d: number) => [{ x: (b.minX + b.maxX) / 2, z: b.maxZ + d }];
    expect(pickDetail(new Set(), r(36), boxes, "pc").has("house_1")).toBe(false);
    expect(pickDetail(new Set(["house_1"]), r(36), boxes, "pc").has("house_1")).toBe(true);
    expect(pickDetail(new Set(["house_1"]), r(39.5), boxes, "pc").has("house_1")).toBe(false);
  });

  it("standing at any house's keypad, that house's detail is drawn on both devices", () => {
    for (const e of keypadEntries()) {
      expect(pickDetail(new Set(), [e.pad], boxes, "phone").has(e.buildingId), e.buildingId).toBe(true);
      expect(pickDetail(new Set(), [e.pad], boxes, "pc").has(e.buildingId), e.buildingId).toBe(true);
    }
  });
});

describe("the old (A7) houses cut out of village.glb's clone", () => {
  it("one body (with eaves), one porch strip and one garden per house, from a8Staging's exact boxes", () => {
    const feet = oldHouseFootprints();
    expect(feet).toHaveLength(HOUSES.length * 3);
    for (const h of HOUSES) {
      const body = A7_MODEL_HOUSE_BOXES.find((b) => b.id === h.id)!.box;
      const f = feet.find((x) => x.minX === body.minX - 1 && x.maxZ === body.maxZ + 1);
      expect(f, h.id).toBeTruthy();
      expect(f!.inside((body.minX + body.maxX) / 2, 5, (body.minZ + body.maxZ) / 2)).toBe(true);
    }
  });

  it("the porch strip reaches only as far out as the new steps (they cover the cut), and keeps the lane's 2 cm paving", () => {
    const feet = oldHouseFootprints();
    const h = H(1); // door south
    const front = h.centre.z + h.size.z / 2;
    const porch = feet.find((f) => f.minTop < 0.1 && f.maxY === 4.5 && f.minX < h.centre.x && f.maxX > h.centre.x)!;
    expect(porch.maxZ).toBeCloseTo(front + OLD_PORCH_STEPS + 0.25, 6);
    expect(OLD_PORCH_STEPS).toBeCloseTo(HOUSE_A8.stepTread * HOUSE_A8.stepCount, 6);
    expect(porch.minTop).toBeGreaterThan(0.02);
    expect(porch.minTop).toBeLessThan(0.03);
  });

  it("the vegetation plants nothing on the houses' ground: old porches, new footprints, gardens", () => {
    const inside = makeHouseGrounds();
    for (const h of HOUSES) {
      expect(inside(h.centre.x, h.centre.z), h.id).toBe(true);
      const pad = keypadEntries().find((e) => e.buildingId === h.id)!.pad;
      expect(inside(pad.x, pad.z)).toBe(true);
    }
    expect(inside(0, 0)).toBe(false); // the plaza
  });

  it("the seven displaced trees move to their A8 spots (the runtime vegetation), nothing else", () => {
    let moved = 0;
    for (const m of A8_TREE_MOVES) {
      const b = A7_MODEL_HOUSE_BOXES.find((x) => x.id === m.id)!.box;
      const s = a8TreeShift((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      if (!m.id.startsWith("tree_")) {
        expect(s).toBeNull();
        continue;
      }
      expect(s, m.id).not.toBeNull();
      expect((b.minX + b.maxX) / 2 + s!.dx).toBeCloseTo(m.to.x, 6);
      expect((b.minZ + b.maxZ) / 2 + s!.dz).toBeCloseTo(m.to.z, 6);
      moved++;
    }
    expect(moved).toBe(6);
    expect(a8TreeShift(0, 0)).toBeNull();
  });
});

describe("the houses' model and maps", () => {
  it("node names: shell / detail per house", () => {
    expect(houseNodePart("houseshell__house_10")).toEqual({ part: "shell", id: "house_10" });
    expect(houseNodePart("housedetail__house_3")).toEqual({ part: "detail", id: "house_3" });
    expect(houseNodePart("slot__house_3_sign")).toBeNull();
  });

  it("tiers: the rich tier every map, the light tier the full albedo, a 512 px normal and no roughness map", () => {
    const meta: HouseTextureMeta = {
      format: "caysonverse-house-textures",
      materials: { LM_render: { maps: { albedo: "a.webp", normal: "n.webp", rough: "r.webp" } } },
    };
    expect(houseTextureFiles(meta, "high").map((f) => [f.kind, f.url.split("?")[0]])).toEqual([
      ["albedo", "/models/village/houses/a.webp"],
      ["normal", "/models/village/houses/n.webp"],
      ["rough", "/models/village/houses/r.webp"],
    ]);
    expect(houseTextureFiles(meta, "low").map((f) => [f.kind, f.url.split("?")[0]])).toEqual([
      ["albedo", "/models/village/houses/a.webp"],
      ["normal", "/models/village/houses/n_512.webp"],
    ]);
    expect(lightVariant("house_render_normal.webp")).toBe("house_render_normal_512.webp");
  });

  it("a porch is found in the model by an upward face at +0.30 over its slab", () => {
    const h = H(2);
    const slab = porchSlabLocal(h.id);
    const c = at(2, 0, (slab.z0 + slab.z1) / 2);
    const g = new BoxGeometry(4, 0.3, 1.6);
    g.translate(c.x, 0.15, c.z);
    const mesh = new Mesh(g, new MeshStandardMaterial());
    new Group().add(mesh);
    expect(hasPorchSlab([mesh], h)).toBe(true);
    const low = new BoxGeometry(4, 0.1, 1.6);
    low.translate(c.x, 0.05, c.z);
    expect(hasPorchSlab([new Mesh(low)], h)).toBe(false);
  });
});

describe("the porch lamps' night light (X2 hand-over: gable ceiling, box canopy two, else the wall lights)", () => {
  it("one or two lamps a house, each over its porch in front of the door", () => {
    for (const h of HOUSES) {
      const pts = porchLampPoints(h);
      expect(pts.length, h.id).toBe(h.id === "house_1" || h.id === "house_5" || h.id === "house_6" || h.id === "house_7" ? 1 : 2);
      for (const p of pts) {
        const d = Math.hypot(p.x - at(Number(h.id.slice(6)), 0, 3.6).x, p.z - at(Number(h.id.slice(6)), 0, 3.6).z);
        expect(d, h.id).toBeLessThan(1.6);
        expect(p.y).toBeGreaterThan(2.3);
      }
    }
  });
});

describe("the owner slots' boards (houseOwnership.ts)", () => {
  it("today: every house's nameplate 'N번 집', no mailbox strip, no sign", () => {
    const boards = houseBoards(HOUSES, HOUSE_EXTERIOR_DEFAULT);
    expect(boards).toHaveLength(10);
    for (const b of boards) {
      expect(b.kind).toBe("nameplate");
      expect(b.lines).toEqual([`${b.house.slice(6)}번 집`]);
      expect(b.slot).toEqual(houseSlots(H(Number(b.house.slice(6)))).find((s) => s.kind === "nameplate"));
    }
  });

  it("an owner: the name on the nameplate and the mailbox; for sale: the yard sign", () => {
    const states = { house_4: { n: 4, label: "4번 집", sign: "forSale" as const }, house_5: { n: 5, label: "5번 집", sign: "owned" as const, ownerName: "케이슨" } };
    const boards = houseBoards([H(4), H(5)], states);
    expect(boards.map((b) => [b.house, b.kind, b.lines])).toEqual([
      ["house_4", "nameplate", ["4번 집"]],
      ["house_4", "sign", ["분양 중", "4번 집"]],
      ["house_5", "nameplate", ["5번 집", "케이슨"]],
      ["house_5", "mailbox", ["케이슨"]],
      ["house_5", "sign", ["케이슨님 댁"]],
    ]);
  });
});

/** The exterior window table (집 외관 A8, design 3.5 / 8 A7): its format, the reader's checks, the 1:1 map to the interior. */
import { describe, expect, it } from "vitest";
import table from "./generated/exterior_windows.json";
import {
  EXTERIOR_BODY_A8,
  WINDOW_TOLERANCE,
  designExteriorWindowTable,
  exteriorLocalToInterior,
  exteriorWindowTable,
  exteriorWindowsOf,
  interiorToExteriorLocal,
  openingOnExterior,
  parseExteriorWindowTable,
} from "./exteriorWindows";
import { HOUSE_A8, HOUSE_BODY_BACK, HOUSE_BODY_FRONT, HOUSE_BODY_HALF } from "./houseExterior";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("exterior_windows.json", () => {
  it("the file in the repository is a valid table and matches the design table within 2 cm (design now, the build later)", () => {
    const t = exteriorWindowTable();
    const d = designExteriorWindowTable();
    expect(["design", "build"]).toContain(t.source);
    if (t.source === "design") expect(t).toEqual(parseExteriorWindowTable(clone(d)));
    for (const id of Object.keys(d.houses)) {
      const got = exteriorWindowsOf(id, t);
      expect(got, id).toHaveLength(d.houses[id]!.length);
      for (const w of d.houses[id]!) {
        const m = got.find((g) => g.wall === w.wall && g.floor === w.floor && g.kind === w.kind && Math.abs(g.at - w.at) <= WINDOW_TOLERANCE);
        expect(m, `${id} ${w.wall} ${w.floor} ${w.at}`).toBeDefined();
        for (const k of ["width", "height", "sill"] as const) expect(Math.abs(m![k] - w[k]), `${id} ${k}`).toBeLessThanOrEqual(WINDOW_TOLERANCE);
      }
    }
    expect(table).toBeTypeOf("object");
  });

  it("design 3.5: front door 4.4-6.2, front windows 2.0 / 8.6 (upstairs + 5.3), back 2.7 / 7.9, sides 2.35 / 5.15; 3's patio door, 9's patio", () => {
    const d = designExteriorWindowTable();
    const h1 = d.houses.house_1!;
    const door = h1.find((o) => o.kind === "door")!;
    expect(door.at - door.width / 2).toBeCloseTo(4.4, 9);
    expect(door.at + door.width / 2).toBeCloseTo(6.2, 9);
    expect(h1.filter((o) => o.wall === "front" && o.floor === 1 && o.kind === "window").map((o) => o.at)).toEqual([2.0, 8.6]);
    expect(h1.filter((o) => o.wall === "front" && o.floor === 2).map((o) => [o.at, o.sill])).toEqual([[2.0, 4.9], [5.3, 4.9], [8.6, 4.9]]);
    expect(h1.filter((o) => o.wall === "back" && o.floor === 1).map((o) => o.at)).toEqual([2.7, 7.9]);
    expect(h1.filter((o) => o.wall === "left").map((o) => [o.floor, o.at, o.width])).toEqual([[1, 2.35, 1.4], [1, 5.15, 1.8], [2, 2.35, 1.4], [2, 5.15, 1.4]]);
    expect(d.houses.house_3!.find((o) => o.kind === "patio")).toMatchObject({ wall: "front", floor: 2, at: 5.3, width: 2.2, height: 2.6 });
    expect(d.houses.house_9!.filter((o) => o.wall === "back" && o.floor === 1)).toEqual([{ wall: "back", floor: 1, kind: "patio", at: 5.3, width: 2.7, height: 2.4, sill: 0 }]);
  });

  it("the reader refuses a bad table: format, version, a missing house, an unknown wall, an opening outside its wall or storey, two doors", () => {
    const ok = designExteriorWindowTable();
    const bad = (f: (t: ReturnType<typeof clone<typeof ok>>) => void) => {
      const t = clone(ok);
      f(t);
      return () => parseExteriorWindowTable(t);
    };
    expect(() => parseExteriorWindowTable(null)).toThrow(/not an object/);
    expect(bad((t) => ((t as { format: string }).format = "x"))).toThrow(/format/);
    expect(bad((t) => ((t as { version: number }).version = 2))).toThrow(/version/);
    expect(bad((t) => delete t.houses.house_7)).toThrow(/houses/);
    expect(bad((t) => ((t.houses.house_1![1] as { wall: string }).wall = "roof"))).toThrow(/wall/);
    expect(bad((t) => (t.houses.house_1![1]!.at = 10.5))).toThrow(/outside its wall/);
    expect(bad((t) => (t.houses.house_1![4]!.sill = 6.5))).toThrow(/outside its storey/);
    expect(bad((t) => t.houses.house_2!.push({ ...t.houses.house_2![0]! }))).toThrow(/one front door/);
    expect(() => parseExteriorWindowTable(clone(ok))).not.toThrow();
  });

  it("1:1 with the A plan body: the interior contract's EXTERIOR_BODY is the inner faces (5.3, -4.975, 2.825); its proportional map is the identity shift", () => {
    expect(EXTERIOR_BODY_A8).toEqual({ halfWidth: 5.3, back: -4.975, front: 2.825 });
    // the interior's exteriorToLocal (feat/houses-g houseAreas.ts) with this body
    const ext = (x: number, z: number, b = EXTERIOR_BODY_A8) => ({ x: 5.3 + (x / b.halfWidth) * 5.3, z: ((b.front - z) / (b.front - b.back)) * 7.8 });
    for (const [x, z] of [[0, 2.825], [-5.3, -4.975], [5.3, 2.825], [-3.3, 0.5], [2.1, -1.2]] as const) {
      const a = ext(x, z);
      const b = exteriorLocalToInterior(x, z);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.z).toBeCloseTo(b.z, 9);
      expect(interiorToExteriorLocal(b.x, b.z)).toEqual({ lx: x, lz: z });
    }
    expect(EXTERIOR_BODY_A8.halfWidth).toBeCloseTo(HOUSE_BODY_HALF - HOUSE_A8.wallThickness, 9);
    expect(EXTERIOR_BODY_A8.front - EXTERIOR_BODY_A8.back).toBeCloseTo(7.8, 9);
  });

  it("each opening on the outer wall face: front at the door's plane, back at the back wall, sides at +-5.6; bottoms lifted 0.30", () => {
    const d = designExteriorWindowTable();
    for (const o of d.houses.house_1!) {
      const e = openingOnExterior(o);
      if (o.wall === "front") expect(e.lz).toBeCloseTo(HOUSE_BODY_FRONT, 9);
      if (o.wall === "back") expect(e.lz).toBeCloseTo(HOUSE_BODY_BACK, 9);
      if (o.wall === "left") expect(e.lx).toBeCloseTo(-HOUSE_BODY_HALF, 9);
      if (o.wall === "right") expect(e.lx).toBeCloseTo(HOUSE_BODY_HALF, 9);
      expect(e.yBottom).toBeCloseTo(o.sill + HOUSE_A8.floorLift, 9);
    }
    // front ground-floor windows at exterior x +-3.3 (the gable porch posts at +-2.3 stay clear of their 1.4 m frames)
    expect(d.houses.house_1!.filter((o) => o.wall === "front" && o.floor === 1 && o.kind === "window").map((o) => openingOnExterior(o).lx)).toEqual([-3.3, 3.3]);
  });
});

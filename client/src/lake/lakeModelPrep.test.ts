import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { LAKE_AREA, LAKE_DECKS, LAKE_LAMPS } from "@caysonverse/shared/village/lakeLayout";
import { B_LAMP_POSTS, DEFAULT_SEAM, cellKey, moveLamps, movedLampOf, seamOf } from "./lakeModelPrep";
import { lakeShoreField } from "./lakeWater";

const onDeck = (x: number, z: number) => LAKE_DECKS.some((d) => x >= d.box.minX && x <= d.box.maxX && z >= d.box.minZ && z <= d.box.maxZ);

describe("the lake's lamps (D1 put 2-4 in the water; F stands them on the pier)", () => {
  it("lamps 2-4 now stand on a deck, inside its edge", () => {
    for (const k of [1, 2, 3]) expect(onDeck(LAKE_LAMPS[k]!.x, LAKE_LAMPS[k]!.z), `lamp ${k + 1}`).toBe(true);
  });
  it("a vertex of B's lamp 2-4 (post, arm, head) is moved by the post's offset; the others stay", () => {
    expect(movedLampOf(120, -15.2)).toBe(1);
    expect(movedLampOf(120.3, -13.15)).toBe(1); // the head over the pier
    expect(movedLampOf(130, -14)).toBe(2);
    expect(movedLampOf(140, -18)).toBe(3);
    expect(movedLampOf(110, -15.2)).toBe(-1); // lamp 1 is on the ground
    expect(movedLampOf(103, -14.5)).toBe(-1);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([120, 1, -15.2, 110, 1, -15.2, 130, 3, -13.15], 3));
    const moved = moveLamps(g)!;
    const p = moved.getAttribute("position");
    expect([p.getX(0), p.getZ(0)]).toEqual([LAKE_LAMPS[1]!.x, expect.closeTo(LAKE_LAMPS[1]!.z, 5)]);
    expect([p.getX(1), p.getZ(1)]).toEqual([110, expect.closeTo(-15.2, 5)]);
    expect(p.getX(2)).toBeCloseTo(130 + LAKE_LAMPS[2]!.x - B_LAMP_POSTS[2]!.x, 5);
    expect(g.getAttribute("position").getX(0)).toBe(120); // the loader's geometry is never edited
  });
});

describe("the seam with the village (lake.glb extras.lake.seam)", () => {
  it("takes the file's rectangles and the ridge's footprint", () => {
    const ridge = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    ridge.geometry.setAttribute("position", new Float32BufferAttribute([200, 5, 10, 201, 5, 11], 3));
    const s = seamOf({ lake: { seam: { groundHole: { minX: 95.5, maxX: 112, minZ: -69.5, maxZ: 45.5 }, backdropHole: { minX: 112, maxX: 190, minZ: -70, maxZ: 49 } } } }, ridge);
    expect(s.holes).toHaveLength(2);
    expect(s.ridgeCells.has(cellKey(200, 10))).toBe(true);
    expect(s.ridgeCells.has(cellKey(0, 0))).toBe(false);
  });
  it("without extras: the lake zone", () => {
    expect(seamOf(undefined, null).holes).toEqual([LAKE_AREA]);
    expect(DEFAULT_SEAM.ridgeCells.size).toBe(0);
  });
});

describe("the water's shore distance field", () => {
  it("is 0 on land and grows toward the middle", () => {
    const f = lakeShoreField();
    const { width, height } = f.texture.image as { width: number; height: number };
    const at = (x: number, z: number) => {
      const i = Math.floor(((x - f.box.minX) / (f.box.maxX - f.box.minX)) * width);
      const j = Math.floor(((z - f.box.minZ) / (f.box.maxZ - f.box.minZ)) * height);
      return (f.texture.image.data as Uint8Array)[(j * width + i) * 4]!;
    };
    expect(at(f.box.minX + 0.5, f.box.minZ + 0.5)).toBe(0);
    expect(at(150, -12)).toBeGreaterThan(at(114, -12));
  });
});

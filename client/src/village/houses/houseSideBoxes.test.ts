import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { readCards } from "../veg/vegCards";
import { bedAt, PALETTES } from "../veg/flowerPlacement";
import { builderGeometry } from "./houseShutters";
import { HOUSE_SIDE_BOXES, SIDE_BOX, cardGeometry, houseSideBoxParts, sideBoxWindows, type BoxBed } from "./houseSideBoxes";
import { flowerMassGeometry } from "./houseFlowerMass";

const H = { id: "house_1", centre: { x: 10, z: 20 }, doorSide: "s" as const };

function geo(tris: number[][]): BufferGeometry {
  const g = new BufferGeometry();
  const pos = tris.flat();
  const n = pos.length / 3;
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute("color", new BufferAttribute(new Float32Array(n * 3).fill(0.8), 3));
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

/** A window's glass on a wall (local rect, 12.5 cm in from the face), as two world triangles. */
function pane(wall: "back" | "left" | "right", u0: number, u1: number, v0: number, v1: number): number[][] {
  const P = (u: number, y: number): number[] => {
    const [lx, lz] = wall === "back" ? [u, -5.275 + 0.125] : wall === "right" ? [5.6 - 0.125, u] : [-5.6 + 0.125, u];
    return [H.centre.x + lx, y, H.centre.z + lz];
  };
  return [[...P(u0, v0), ...P(u1, v0), ...P(u1, v1)], [...P(u0, v0), ...P(u1, v1), ...P(u0, v1)]];
}

describe("window boxes under the side and back windows", () => {
  it("gives a box to both storeys' side windows, none to a door, a gable window, or where the kit has one", () => {
    const g = geo([
      ...pane("right", -1, 0.17, 1.3, 3.1), // ground floor
      ...pane("right", -1, 0.17, 5.3, 7.1), // first floor
      ...pane("right", 1.5, 2.6, 0.35, 2.5), // a door's glass (from 0.35 m: too low for a box)
      ...pane("left", -0.4, 0.4, 8.6, 9.6), // a gable window
      ...pane("left", -1, 0.17, 1.3, 3.1), // the kit's box is here already
    ]);
    const kit: BoxBed[] = [{ kind: "box", x0: 10 - 5.9, x1: 10 - 5.7, z0: 20 - 0.95, z1: 20 + 0.1, y: 1.17, out: [-1, 0], plant: "window" }];
    const wins = sideBoxWindows([g], H, kit);
    expect(wins.map((w) => `${w.wall}:${w.v0.toFixed(1)}`).sort()).toEqual(["right:1.3", "right:5.3"]);
  });

  it("hangs the trough under the sill, out from the wall, between the window's sides, on brackets, in the house's colours", () => {
    const g = geo(pane("right", -1, 0.17, 1.3, 3.1));
    const parts = houseSideBoxParts([g], H, []);
    expect(parts.windows).toBe(1);
    const wood = builderGeometry(parts.wood, g)!;
    const metal = builderGeometry(parts.metal, g)!;
    expect(Object.keys(wood.attributes).sort()).toEqual(Object.keys(g.attributes).sort());
    const p = wood.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const out = p.getX(i) - H.centre.x - 5.6;
      expect(out).toBeGreaterThan(SIDE_BOX.dIn - 0.001);
      expect(out).toBeLessThan(SIDE_BOX.dOut + SIDE_BOX.lip + 0.001);
      // never over the glass (its bottom at 1.3 m): the box's top is 10 cm under it
      expect(p.getY(i)).toBeLessThan(1.3 - SIDE_BOX.drop + 0.01);
      expect(p.getZ(i) - H.centre.z).toBeGreaterThan(-1 - 0.001);
      expect(p.getZ(i) - H.centre.z).toBeLessThan(0.17 + 0.001);
    }
    // ~60 triangles a box: the trough (front, ends, bottom, lip, soil) and two brackets (strap, arm, brace)
    const t = p.count / 3 + metal.getAttribute("position").count / 3;
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThanOrEqual(64);
    // one bed, out of the right wall, with the house's own flowers
    expect(parts.beds).toHaveLength(1);
    const bed = parts.beds[0]!;
    expect(bed.out).toEqual([1, 0]);
    expect(bed.palette).toBe(HOUSE_SIDE_BOXES.house_1!.palette);
    expect(bed.x1 - bed.x0).toBeLessThan(0.25);
    expect(bed.z1 - bed.z0).toBeGreaterThan(1);
  });

  it("varies the flowers between neighbours, every palette real", () => {
    for (let i = 1; i < 10; i++) expect(HOUSE_SIDE_BOXES[`house_${i}`]!.palette === HOUSE_SIDE_BOXES[`house_${i + 1}`]!.palette).toBe(false);
    for (const s of Object.values(HOUSE_SIDE_BOXES)) expect(PALETTES[s.palette]).toBeDefined();
  });

  it("plants cards the vegetation reads, one card a quad, on the box's bed", () => {
    const g = geo(pane("left", -1, 0.17, 5.3, 7.1));
    const parts = houseSideBoxParts([g], H, []);
    const cards = cardGeometry(parts.cards, H, g)!;
    const read = readCards(cards.getAttribute("position"), cards.index!.array as ArrayLike<number>, cards.getAttribute("uv"), cards.getAttribute("color"));
    expect(read).toHaveLength(parts.cards.length);
    for (const c of read) {
      expect(c.v).toBeLessThan(0.25); // the pink row
      expect(c.h).toBeGreaterThan(0.05);
      expect(bedAt(parts.beds, (c.ax + c.bx) / 2, (c.az + c.bz) / 2, c.floor)?.bed).toBe(parts.beds[0]);
    }
  });

  it("recolours only a side box's flower mass (the kit's keep the picture's reds)", () => {
    const kit: BoxBed = { kind: "box", x0: 0, x1: 1.2, z0: 0, z1: 0.2, y: 1, out: [0, 1], plant: "window" };
    const side: BoxBed = { ...kit, y: 5, palette: "geraniumPink" };
    const { geometry } = flowerMassGeometry([kit, side]);
    const a = geometry.getAttribute("aBloomA");
    const y = geometry.getAttribute("position");
    let kitOff = 0;
    let sideOn = 0;
    for (let i = 0; i < a.count; i++) {
      if (y.getY(i) < 3 && a.getX(i) < 0) kitOff++;
      if (y.getY(i) > 3 && a.getX(i) >= 0) sideOn++;
    }
    expect(kitOff + sideOn).toBe(a.count);
    expect(sideOn).toBeGreaterThan(0);
  });
});

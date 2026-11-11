import { describe, expect, it } from "vitest";
import { floraRow, keepTriangles, readCards, type AttributeLike } from "./vegCards";

/** A tiny attribute over a flat array. */
const attr = (a: number[], size: number): AttributeLike => ({
  count: a.length / size,
  getX: (i) => a[i * size]!,
  getY: (i) => a[i * size + 1]!,
  getZ: (i) => (size > 2 ? a[i * size + 2]! : 0),
});

/** A standing card as the art script draws it: base A-B on the floor, top edge tilted, 2 triangles. */
function card(ax: number, az: number, bx: number, bz: number, floor: number, h: number, row: number, light: number) {
  const pos = [ax, floor, az, bx, floor, bz, bx + 0.05, floor + h, bz, ax + 0.05, floor + h, az];
  const v0 = row * 0.25 + 0.004;
  const v1 = (row + 1) * 0.25 - 0.004;
  const uv = [0, v1, 0.3, v1, 0.3, v0, 0, v0];
  const col = [light, light, light, light, light, light, light, light, light, light, light, light];
  return { pos, uv, col };
}

function mesh(cards: ReturnType<typeof card>[], shuffleTris = false) {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  let idx: number[] = [];
  cards.forEach((c, k) => {
    pos.push(...c.pos);
    uv.push(...c.uv);
    col.push(...c.col);
    const o = k * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  if (shuffleTris) {
    // Draco may reorder triangles: interleave them
    const tris: number[][] = [];
    for (let t = 0; t < idx.length / 3; t++) tris.push(idx.slice(t * 3, t * 3 + 3));
    tris.sort((a, b) => (a[0]! % 3) - (b[0]! % 3) || a[0]! - b[0]!);
    idx = tris.flat();
  }
  return { pos: attr(pos, 3), uv: attr(uv, 2), col: attr(col, 3), idx };
}

describe("readCards", () => {
  it("finds every card, its base edge, floor, height, row and light", () => {
    const m = mesh([card(0, 0, 0.6, 0, 0.38, 0.35, 0, 0.8), card(2, 1, 2, 1.7, 0.52, 0.3, 2, 0.6)]);
    const cards = readCards(m.pos, m.idx, m.uv, m.col);
    expect(cards).toHaveLength(2);
    const a = cards.find((c) => c.x < 1)!;
    expect(a.floor).toBeCloseTo(0.38);
    expect(a.h).toBeCloseTo(0.35);
    expect(floraRow(a.v)).toBe(0);
    expect(a.light).toBeCloseTo(0.8);
    expect([a.ax, a.bx].sort()).toEqual([0, 0.6]);
    const b = cards.find((c) => c.x > 1)!;
    expect(floraRow(b.v)).toBe(2);
    expect(b.tris).toHaveLength(2);
  });

  it("does not depend on the triangle order", () => {
    const cs = [card(0, 0, 0.5, 0, 0, 0.3, 1, 1), card(1, 0, 1.5, 0, 0, 0.3, 2, 1), card(2, 0, 2.5, 0, 0, 0.3, 3, 1)];
    const a = readCards(mesh(cs).pos, mesh(cs).idx, mesh(cs).uv, null);
    const m2 = mesh(cs, true);
    const b = readCards(m2.pos, m2.idx, m2.uv, null);
    expect(b.map((c) => floraRow(c.v)).sort()).toEqual(a.map((c) => floraRow(c.v)).sort());
    for (const c of b) expect(c.tris).toHaveLength(2);
  });

  it("keepTriangles drops exactly the given cards' triangles", () => {
    const cs = [card(0, 0, 0.5, 0, 0, 0.3, 0, 1), card(1, 0, 1.5, 0, 0, 0.3, 3, 1), card(2, 0, 2.5, 0, 0, 0.3, 1, 1)];
    const m = mesh(cs, true);
    const cards = readCards(m.pos, m.idx, m.uv, null);
    const drop = cards.filter((c) => floraRow(c.v) !== 3);
    const kept = keepTriangles(m.idx, m.pos.count, drop);
    expect(kept.length).toBe(6);
    // the kept triangles are the grass card's (vertices 4..7)
    for (const v of kept) expect(v >= 4 && v < 8).toBe(true);
  });
});

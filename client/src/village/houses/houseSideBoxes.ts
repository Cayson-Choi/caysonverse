/**
 * Window boxes for the houses' side and back windows (2026-11-27, owner: "옆 창문엔 꽃상자가 없어"). The Colmar build (colmar_kit.py
 * `flower_box`) gives a planted box only to the front windows and one back window upstairs; a real Alsace house has them under
 * nearly every window. Here, from the house's own glass (houseShutters.ts `wallWindows`: one window = one cluster of panes), every
 * side-wall window of both storeys and every back window without a kit box gets the kit's box, made the same way:
 *
 *  - a board trough 0.20 tall, 9-30 cm out from the wall face under the sill (its top 10 cm under the glass), a moulded lip round
 *    its top, the dark soil inside, painted in the house's shutter colour or terracotta (HOUSE_SIDE_BOXES, varied per house);
 *  - two black wrought-iron brackets: a wall strap, an arm under the box and a diagonal brace;
 *  - the kit's planting cards (M_leaf_flora, the pink row) in the box: the village vegetation grows them into 3D geraniums and
 *    trailing petunias spilling over the rim (houseFlowerBoxes.ts beds), and the flower mass (houseFlowerMass.ts) fills the box
 *    from the street, both in the house's own flower colours (`palette`).
 *
 * The trough goes into the house's detail LM_wood mesh, the brackets into its LM_metal one, the cards into its M_leaf_flora one
 * (no extra draw, shown with the detail only, like the front boxes). ~60 triangles a box (and ~60 more in the flower mass).
 * The box sits between the shutter leaves (which fold back beside the window, not under it) and under the sill: neither the glass
 * nor a shutter's swing is covered.
 */
import { BufferAttribute, BufferGeometry } from "three";
import { HOUSES_LPG_MIRRORED, HOUSE_LPG } from "@caysonverse/shared/village/houseExterior";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import type { Bed, PaletteName } from "../veg/flowerPlacement";
import {
  FIRST_FLOOR,
  GLASS_REVEAL,
  HOUSE_SHUTTER_PAINT,
  WALL_TOP,
  builder,
  closedWindowRects,
  houseDirToWorld,
  houseLocalToWorldExact,
  lin,
  poly,
  wallAlong,
  wallOut,
  wallPoint,
  wallWindows,
  type Builder,
  type WallWindow,
} from "./houseShutters";

type House = Pick<SceneryHouse, "id" | "centre" | "doorSide">;
export type BoxBed = Extract<Bed, { kind: "box" }>;

/**
 * Each house's side boxes: the trough's paint ("paint" = the house's shutter colour, as most of its front boxes) and the flowers'
 * palette (flowerPlacement.ts PALETTES) — reds, pinks, corals or white with purple, so no two neighbours are alike.
 */
export const HOUSE_SIDE_BOXES: Readonly<Record<string, { box: "paint" | "terracotta"; palette: PaletteName }>> = Object.freeze({
  house_1: { box: "terracotta", palette: "geranium" },
  house_2: { box: "paint", palette: "geraniumPink" },
  house_3: { box: "terracotta", palette: "geraniumCoral" },
  house_4: { box: "paint", palette: "boxWhite" },
  house_5: { box: "terracotta", palette: "geraniumPink" },
  house_6: { box: "paint", palette: "geranium" },
  house_7: { box: "terracotta", palette: "boxWhite" },
  house_8: { box: "paint", palette: "geraniumCoral" },
  house_9: { box: "terracotta", palette: "geranium" },
  house_10: { box: "paint", palette: "geraniumPink" },
});
const TERRACOTTA = "#B5653E";
const SOIL = "#3E2F24";
const IRON = "#26262A";

/** The kit's box (m): its top under the glass, height, depth out from the wall face (inner, outer), the inset from the window's sides. */
export const SIDE_BOX = Object.freeze({ drop: 0.1, h: 0.2, dIn: 0.09, dOut: 0.3, inset: 0.03, lip: 0.012 });

/** The lowest glass a box goes under (a box and its trailing flowers need the wall below: the ground-floor windows are ~1.3 m up). */
const MIN_SILL = 0.95;

/** Where a house already has a box (the kit's, world beds), a window gets none. */
function hasBox(beds: readonly BoxBed[], x: number, y: number, z: number): boolean {
  return beds.some((b) => Math.abs(b.y - y) < 0.5 && x > b.x0 - 0.5 && x < b.x1 + 0.5 && z > b.z0 - 0.5 && z < b.z1 + 0.5);
}

/** The side and back windows that get a box (wall rectangles), from the house's glass. */
export function sideBoxWindows(glass: readonly BufferGeometry[], h: House, kitBeds: readonly BoxBed[]): WallWindow[] {
  const wins = wallWindows(glass, h);
  const closed = closedWindowRects(glass, h);
  const out: WallWindow[] = [];
  for (const w of wins) {
    const width = w.u1 - w.u0;
    if (width < 0.4 || width > 1.6 || w.v1 - w.v0 > 2.2 || w.v1 > WALL_TOP || w.v0 < MIN_SILL) continue;
    if (closed.some((c) => c.wall === w.wall && c.u0 < w.u1 && c.u1 > w.u0 && c.v0 < w.v1 && c.v1 > w.v0)) continue;
    if (w.wall === "back" && w.v0 < FIRST_FLOOR) {
      // the ground floor's back keeps clear of the LPG cage and the meters by it
      const m = HOUSES_LPG_MIRRORED.includes(h.id);
      const x0 = m ? -HOUSE_LPG.x1 : HOUSE_LPG.x0;
      const x1 = m ? -HOUSE_LPG.x0 : HOUSE_LPG.x1;
      if (w.u1 > x0 - 0.6 && w.u0 < x1 + 0.6) continue;
    }
    const face = (w.g ?? -GLASS_REVEAL) + GLASS_REVEAL;
    const [lx, , lz] = wallPoint(w.wall, (w.u0 + w.u1) / 2, 0, face + (SIDE_BOX.dIn + SIDE_BOX.dOut) / 2);
    const c = houseLocalToWorldExact(h, lx, lz);
    if (hasBox(kitBeds, c.x, w.v0 - SIDE_BOX.drop - 0.03, c.z)) continue;
    out.push(w);
  }
  return out;
}

/** One house's side boxes: the troughs (LM_wood), brackets (LM_metal), planting cards (M_leaf_flora) and their beds (world). */
export function houseSideBoxParts(
  glass: readonly BufferGeometry[],
  h: House,
  kitBeds: readonly BoxBed[],
): { wood: Builder; metal: Builder; cards: Array<Array<[number, number, number]>>; beds: BoxBed[]; windows: number } {
  const wood = builder();
  const metal = builder();
  const cards: Array<Array<[number, number, number]>> = [];
  const beds: BoxBed[] = [];
  const style = HOUSE_SIDE_BOXES[h.id] ?? { box: "terracotta", palette: "geranium" as PaletteName };
  const paint = lin(style.box === "paint" ? HOUSE_SHUTTER_PAINT[h.id] ?? TERRACOTTA : TERRACOTTA);
  const edge = paint.map((c) => c * 0.84) as [number, number, number];
  const under = paint.map((c) => c * 0.55) as [number, number, number];
  const soil = lin(SOIL);
  const iron = lin(IRON);
  const wins = sideBoxWindows(glass, h, kitBeds);
  const { drop, h: bh, dIn, dOut, inset, lip } = SIDE_BOX;
  for (const w of wins) {
    const face = (w.g ?? -GLASS_REVEAL) + GLASS_REVEAL;
    const P = (u: number, y: number, d: number) => wallPoint(w.wall, u, y, face + d);
    const out = wallOut(w.wall);
    const al = wallAlong(w.wall);
    const down: [number, number, number] = [0, -1, 0];
    const up: [number, number, number] = [0, 1, 0];
    const a = w.u0 + inset;
    const b = w.u1 - inset;
    const yt = w.v0 - drop;
    const yb = yt - bh;
    // the painted-board band (LM_wood v 0.5-1): two boards along the box, U along it
    const U = (u: number) => u / 1.13;
    const V = (y: number) => 0.5 + (0.495 * (y - yb)) / 0.565;
    // the front, flaring 1.5 cm out to the top (a real trough is wider at the top)
    const fb = dOut - 0.015;
    poly(wood, h, [P(a, yb, fb), P(b, yb, fb), P(b, yt, dOut), P(a, yt, dOut)], out, [[U(a), V(yb)], [U(b), V(yb)], [U(b), V(yt)], [U(a), V(yt)]], paint);
    // the two ends
    for (const [u, s] of [[a, -1], [b, 1]] as const) {
      const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
      poly(wood, h, [P(u, yb, dIn), P(u, yb, fb), P(u, yt, dOut), P(u, yt, dIn)], n, [[U(dIn), V(yb)], [U(fb), V(yb)], [U(dOut), V(yt)], [U(dIn), V(yt)]], edge);
    }
    // the bottom (in its own shade)
    poly(wood, h, [P(a, yb, dIn), P(b, yb, dIn), P(b, yb, fb), P(a, yb, fb)], down, [[U(a), V(yb)], [U(b), V(yb)], [U(b), V(yb + 0.02)], [U(a), V(yb + 0.02)]], under);
    // the moulded lip round the top: a band proud of the front, its underside, its top, and its ends
    const la = a - lip;
    const lb = b + lip;
    const lo = dOut + lip;
    const ly = yt - 0.035;
    poly(wood, h, [P(la, ly, lo), P(lb, ly, lo), P(lb, yt + 0.006, lo), P(la, yt + 0.006, lo)], out, [[U(la), V(ly)], [U(lb), V(ly)], [U(lb), V(yt)], [U(la), V(yt)]], paint);
    poly(wood, h, [P(la, ly, dOut - 0.004), P(lb, ly, dOut - 0.004), P(lb, ly, lo), P(la, ly, lo)], down, [[U(la), V(ly)], [U(lb), V(ly)], [U(lb), V(ly)], [U(la), V(ly)]], under);
    poly(wood, h, [P(la, yt + 0.006, dIn), P(lb, yt + 0.006, dIn), P(lb, yt + 0.006, lo), P(la, yt + 0.006, lo)], up, [[U(la), V(yt)], [U(lb), V(yt)], [U(lb), V(yt - 0.03)], [U(la), V(yt - 0.03)]], edge);
    for (const [u, s] of [[la, -1], [lb, 1]] as const) {
      const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
      poly(wood, h, [P(u, ly, dIn), P(u, ly, lo), P(u, yt + 0.006, lo), P(u, yt + 0.006, dIn)], n, [[U(dIn), V(ly)], [U(lo), V(ly)], [U(lo), V(yt)], [U(dIn), V(yt)]], edge);
    }
    // the soil, 3 cm under the lip (the planting hides most of it)
    const sy = yt - 0.03;
    poly(wood, h, [P(a + 0.02, sy + 0.007, dIn + 0.01), P(b - 0.02, sy + 0.007, dIn + 0.01), P(b - 0.02, sy + 0.007, dOut - 0.01), P(a + 0.02, sy + 0.007, dOut - 0.01)], up, [[0.02, 0.52], [0.06, 0.52], [0.06, 0.53], [0.02, 0.53]], soil);
    // two wrought-iron brackets: a wall strap, an arm under the box, a diagonal brace (LM_metal's iron band, v < 0.5)
    const IU: Array<[number, number]> = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.12], [0.1, 0.12]];
    const span = b - a;
    for (const uu of [a + Math.min(0.15, span * 0.2), b - Math.min(0.15, span * 0.2)]) {
      const t = 0.012; // half the iron's width
      const s0 = yb - 0.17;
      // the strap on the wall (its face and two edges)
      poly(metal, h, [P(uu - t, s0, 0.012), P(uu + t, s0, 0.012), P(uu + t, yb, 0.012), P(uu - t, yb, 0.012)], out, IU, iron);
      for (const s of [-1, 1] as const) {
        const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
        poly(metal, h, [P(uu + s * t, s0, 0), P(uu + s * t, s0, 0.012), P(uu + s * t, yb, 0.012), P(uu + s * t, yb, 0)], n, IU, iron);
      }
      // the arm under the box: its underside, two sides, its turned-up end
      const ay = yb - 0.012;
      poly(metal, h, [P(uu - t, ay, 0), P(uu + t, ay, 0), P(uu + t, ay, dOut + 0.005), P(uu - t, ay, dOut + 0.005)], down, IU, iron);
      for (const s of [-1, 1] as const) {
        const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
        poly(metal, h, [P(uu + s * t, ay, 0), P(uu + s * t, ay, dOut + 0.005), P(uu + s * t, yb, dOut + 0.005), P(uu + s * t, yb, 0)], n, IU, iron);
      }
      poly(metal, h, [P(uu - t, ay, dOut + 0.005), P(uu + t, ay, dOut + 0.005), P(uu + t, yb + 0.03, dOut + 0.005), P(uu - t, yb + 0.03, dOut + 0.005)], out, IU, iron);
      // the brace from low on the strap to the arm's outer third (a flat bar: two faces and its underside)
      const bd = dOut * 0.72;
      const bt = 0.008;
      for (const s of [-1, 1] as const) {
        const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
        poly(metal, h, [P(uu + s * bt, s0 + 0.02, 0.012), P(uu + s * bt, ay, bd), P(uu + s * bt, ay + 0.02, bd), P(uu + s * bt, s0 + 0.045, 0.012)], n, IU, iron);
      }
      poly(metal, h, [P(uu - bt, s0 + 0.02, 0.012), P(uu + bt, s0 + 0.02, 0.012), P(uu + bt, ay, bd), P(uu - bt, ay, bd)], [out[0] * 0.6, -0.8, out[2] * 0.6], IU, iron);
    }
    // the planting cards: one per ~0.22 m, leaning out a little (the vegetation grows them into 3D plants and hides them)
    const n = Math.max(3, Math.round(span / 0.22));
    const dd = (dIn + dOut) / 2;
    for (let k = 0; k < n; k++) {
      const uu = a + 0.1 + ((span - 0.2) * (k + 0.5)) / n;
      cards.push([P(uu - 0.13, sy, dd), P(uu + 0.13, sy, dd), P(uu + 0.13, sy + 0.3, dd + 0.06), P(uu - 0.13, sy + 0.3, dd + 0.06)]);
    }
    // the bed (world): the soil's box, its height, the way out of the wall
    const p0 = houseLocalToWorldExact(h, ...xz(P(a + 0.02, sy, dIn)));
    const p1 = houseLocalToWorldExact(h, ...xz(P(b - 0.02, sy, dOut - 0.01)));
    const o = houseDirToWorld(h, out);
    beds.push({
      kind: "box",
      x0: Math.min(p0.x, p1.x),
      x1: Math.max(p0.x, p1.x),
      z0: Math.min(p0.z, p1.z),
      z1: Math.max(p0.z, p1.z),
      y: sy,
      out: [Math.round(o[0]), Math.round(o[2])],
      plant: "window",
      palette: style.palette,
    });
  }
  return { wood, metal, cards, beds, windows: wins.length };
}

const xz = (p: [number, number, number]): [number, number] => [p[0], p[2]];

/**
 * The planting cards as a geometry with the house's M_leaf_flora attribute set (a quad of four shared corners each, so the
 * vegetation reads one card per quad), in world: the pink row of the flora atlas (glTF v 0.004-0.246), the template's mean vertex
 * colour (its baked light).
 */
export function cardGeometry(cards: ReadonlyArray<ReadonlyArray<[number, number, number]>>, h: House, tpl: BufferGeometry): BufferGeometry | null {
  if (!cards.length) return null;
  const n = cards.length * 4;
  const g = new BufferGeometry();
  const tc = tpl.getAttribute("color") as BufferAttribute | undefined;
  const mean = [0, 0, 0];
  if (tc) {
    for (let i = 0; i < tc.count; i++) for (let k = 0; k < 3; k++) mean[k]! += tc.getComponent(i, k) / tc.count;
  } else mean.fill(1);
  const nw = houseDirToWorld(h, [0, 1, 0]);
  for (const name of Object.keys(tpl.attributes)) {
    const t = tpl.getAttribute(name) as BufferAttribute;
    const outA = new BufferAttribute(new (t.array.constructor as new (n: number) => Float32Array)(n * t.itemSize), t.itemSize, t.normalized);
    cards.forEach((c, ci) => {
      const u0 = ((ci * 0.37) % 0.7) + 0.0;
      const u1 = u0 + 0.11;
      const uvs: Array<[number, number]> = [[u0, 0.246], [u1, 0.246], [u1, 0.004], [u0, 0.004]];
      for (let k = 0; k < 4; k++) {
        const i = ci * 4 + k;
        const [lx, y, lz] = c[k]!;
        if (name === "position") {
          const w = houseLocalToWorldExact(h, lx, lz);
          outA.setXYZ(i, w.x, y, w.z);
        } else if (name === "normal") outA.setXYZ(i, nw[0], nw[1], nw[2]);
        else if (name === "uv") outA.setXY(i, uvs[k]![0], uvs[k]![1]);
        else if (name === "color") for (let q = 0; q < t.itemSize; q++) outA.setComponent(i, q, q < 3 ? mean[q]! : 1);
      }
    });
    g.setAttribute(name, outA);
  }
  const idx: number[] = [];
  for (let ci = 0; ci < cards.length; ci++) {
    const b = ci * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  if (tpl.index) g.setIndex(idx);
  else return g.setIndex(idx).toNonIndexed();
  return g;
}

/** The side boxes' beds, every house (set by prepareHouses: houseFlowerBoxes.ts adds them to the kit's). */
let sideBeds: BoxBed[] = [];
export function setHouseSideBeds(beds: readonly BoxBed[]): void {
  sideBeds = [...beds];
}
export function houseSideBeds(): readonly BoxBed[] {
  return sideBeds;
}

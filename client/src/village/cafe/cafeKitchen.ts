import { BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, RepeatWrapping, ShaderMaterial, SRGBColorSpace, Vector4, type Texture } from "three";
import { GeoBuilder, norm, type V3 } from "../../land/geoBuilder";

/**
 * 케이슨 카페's kitchen, seen through the back windows (#13 exteriors round 2, owner 2026-11-27 "카페 주방 창 너머"): the room behind the
 * partition was a closed plaster box (CafeShowcase's `kitchenBox`), so the three ground-floor windows at the back showed one flat beige
 * colour. Now a small believable café kitchen stands there, made for being looked at through glass from the lane:
 *
 *  - the far wall (the partition): oak base cabinets under an oak worktop, a white subway-tile splashback, a stainless range with its
 *    hood, open oak shelves of plates, jars and cups, a rail of copper pans; a tall steel fridge in one corner, an oak door to the café;
 *  - under the windows: a window-side counter (the cooks' prep bench) with a bread board and loaves, bowls, a basil pot, a kettle;
 *  - between them a stainless prep table with mixing bowls; terracotta quarry tiles on the floor, cream plaster above the tiles;
 *  - light: no live lights (it is a closed room). Each vertex carries a DAY light (the windows' daylight falling off into the room, the
 *    floor's corners darker) and a NIGHT light (three warm pendant lamps' pools), mixed by the village's lamps (`setLight`); the lamps'
 *    bulbs glow at night.
 *
 * Light on purpose: one draw for the room (a 512² canvas atlas: tiles, floor, oak, plain) and one for the bulbs, about 3 k triangles,
 * drawn only within the café's showcase distance. Built in the café's local frame (cafeRoom.ts: x across, z toward the front, y up).
 */

/** The kitchen's room (café local metres): x -6.8..6.8, from the back wall's inner face to the partition, floor to ceiling. */
export const KITCHEN = Object.freeze({ x0: -6.8, x1: 6.8, zb: -9.3, zp: -4.1, h: 4.3 });
/** The worktops' height and the cabinets' depth. */
const TOP = 0.92;
const DEPTH = 0.62;
/** The pendant lamps (local x, y of the bulb, z). */
export const KITCHEN_LAMPS: readonly V3[] = Object.freeze([
  [-3.9, 3.05, -6.9],
  [0, 3.05, -6.9],
  [3.9, 3.05, -6.9],
]);

/** Atlas tiles (the shader's `aTile`). */
const T = { wall: 0, floor: 1, oak: 2, plain: 3 } as const;
/** Metres one atlas cell covers, per tile. */
export const KITCHEN_TILE_M = [0.6, 0.6, 1.2, 1] as const;

class KitchenKit {
  readonly g = new GeoBuilder();
  readonly tile: number[] = [];
  readonly night: number[] = [];
  private mark(from: number, tile: number): void {
    for (let i = from; i < this.g.vertices; i++) this.tile.push(tile);
  }
  /** A box (centre, half sizes along x / y / z), coloured; metre uvs on each face (u along the face's horizontal, v up). */
  box(c: V3, hx: number, hy: number, hz: number, col: V3, tile: number = T.plain, skip: readonly string[] = []): void {
    const [cx, cy, cz] = c;
    const faces: Array<[string, V3, V3[]]> = [
      ["+x", [1, 0, 0], [[cx + hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz + hz]]],
      ["-x", [-1, 0, 0], [[cx - hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz + hz], [cx - hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz - hz]]],
      ["+y", [0, 1, 0], [[cx - hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz]]],
      ["-y", [0, -1, 0], [[cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy - hy, cz + hz]]],
      ["+z", [0, 0, 1], [[cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz]]],
      ["-z", [0, 0, -1], [[cx + hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz - hz], [cx - hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz - hz]]],
    ];
    for (const [name, n, pts] of faces) {
      if (skip.includes(name)) continue;
      this.quad(pts, n, col, tile);
    }
  }
  /** One flat quad (counter-clockwise seen from its normal's side). */
  quad(pts: V3[], n: V3, col: V3, tile: number): void {
    const from = this.g.vertices;
    const ids = pts.map((p) => {
      const u = Math.abs(n[0]) > 0.5 ? p[2] : p[0];
      const v = Math.abs(n[1]) > 0.5 ? p[2] : p[1];
      return this.g.rawVertex(p, n, u, v, col);
    });
    this.g.idx.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
    this.mark(from, tile);
  }
  cylinder(p0: V3, p1: V3, r0: number, r1: number, sides: number, col: V3, cap = false): void {
    const from = this.g.vertices;
    this.g.cylinder(p0, p1, r0, r1, sides, col, cap);
    this.mark(from, T.plain);
  }
  tube(points: V3[], r: number, col: V3): void {
    const from = this.g.vertices;
    this.g.tube(points, r, 6, col);
    this.mark(from, T.plain);
  }
  /** Bake the day and night light into the vertices (see the file's head). */
  light(): void {
    const p = this.g.pos;
    const n = this.g.nor;
    const day: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
      const nx = n[i]!, ny = n[i + 1]!, nz = n[i + 2]!;
      // daylight: through the back windows (z = zb), falling off into the room; faces turned toward the windows (−z) catch more of it
      const fromWin = Math.max(0, z - KITCHEN.zb);
      let d = 0.5 + 0.42 * Math.exp(-fromWin / 2.6) + 0.12 * Math.max(0, -nz) + 0.05 * Math.max(0, ny);
      // corners and the floor's edges a little darker (contact occlusion)
      const edge = Math.min(x - KITCHEN.x0, KITCHEN.x1 - x, z - KITCHEN.zb, KITCHEN.zp - z);
      d *= 0.86 + 0.14 * Math.min(1, Math.max(0, edge) / 0.6);
      d *= 0.8 + 0.2 * Math.min(1, y / 0.5);
      if (y > KITCHEN.h - 0.05) d *= 0.78; // the ceiling
      // night: the pendants' warm pools (a soft inverse square), a faint fill
      let r = 0.07, g = 0.06, b = 0.05;
      for (const [lx, ly, lz] of KITCHEN_LAMPS) {
        const dx = lx - x, dy = ly - y, dz = lz - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const facing = Math.max(0.25, (dx * nx + dy * ny + dz * nz) / Math.sqrt(d2 + 1e-6));
        const k = (1.5 * facing) / (1 + d2 * 0.32);
        r += k * 1.0;
        g += k * 0.76;
        b += k * 0.5;
      }
      if (y > 2.95) {
        // the shades' undersides and the ceiling over them: lit from the bulbs
        r *= 0.8;
        g *= 0.8;
        b *= 0.8;
      }
      day.push(d);
      this.night.push(Math.min(r, 1.1), Math.min(g, 0.88), Math.min(b, 0.64));
    }
    // the colour keeps the albedo; the day light goes into its own attribute
    this.dayLight = day;
  }
  dayLight: number[] = [];
  build(toWorld: (p: V3) => V3, rot: (n: V3) => V3): BufferGeometry {
    this.light();
    for (let i = 0; i < this.g.pos.length; i += 3) {
      const w = toWorld([this.g.pos[i]!, this.g.pos[i + 1]!, this.g.pos[i + 2]!]);
      const nn = rot([this.g.nor[i]!, this.g.nor[i + 1]!, this.g.nor[i + 2]!]);
      this.g.pos[i] = w[0];
      this.g.pos[i + 1] = w[1];
      this.g.pos[i + 2] = w[2];
      this.g.nor[i] = nn[0];
      this.g.nor[i + 1] = nn[1];
      this.g.nor[i + 2] = nn[2];
    }
    const geo = this.g.build();
    geo.setAttribute("aTile", new Float32BufferAttribute(this.tile, 1));
    geo.setAttribute("aDay", new Float32BufferAttribute(this.dayLight, 1));
    geo.setAttribute("aNight", new Float32BufferAttribute(this.night, 3));
    return geo;
  }
}

const OAK: V3 = [0.72, 0.5, 0.3];
const OAK_DARK: V3 = [0.55, 0.36, 0.2];
const STEEL: V3 = [0.72, 0.74, 0.76];
const STEEL_DARK: V3 = [0.42, 0.44, 0.47];
const BLACK: V3 = [0.06, 0.06, 0.065];
const COPPER: V3 = [0.78, 0.42, 0.24];
const CREAM: V3 = [0.93, 0.89, 0.8];
const WHITE: V3 = [0.95, 0.95, 0.93];
const TILE: V3 = [1, 1, 1];

/** Every surface of the kitchen in café-local metres (pure: unit-tested). */
export function buildKitchen(): KitchenKit {
  const k = new KitchenKit();
  const { x0, x1, zb, zp, h } = KITCHEN;
  const W = (x1 - x0) / 2;
  const cx = (x0 + x1) / 2;
  // ── the room: floor, ceiling, walls (faces turned inward)
  k.quad([[x0, 0.005, zb], [x0, 0.005, zp], [x1, 0.005, zp], [x1, 0.005, zb]], [0, 1, 0], TILE, T.floor);
  k.quad([[x0, h, zp], [x0, h, zb], [x1, h, zb], [x1, h, zp]], [0, -1, 0], CREAM, T.plain);
  const tileTop = 2.1;
  // the partition (looks toward the windows: −z) and the side walls, tiled to 2.1 m and plastered above
  for (const [y0, y1, col, tile] of [[0, tileTop, TILE, T.wall], [tileTop, h, CREAM, T.plain]] as const) {
    k.quad([[x1, y0, zp], [x0, y0, zp], [x0, y1, zp], [x1, y1, zp]], [0, 0, -1], col, tile);
    k.quad([[x0, y0, zb], [x0, y0, zp], [x0, y1, zp], [x0, y1, zb]], [1, 0, 0], col, tile);
    k.quad([[x1, y0, zp], [x1, y0, zb], [x1, y1, zb], [x1, y1, zp]], [-1, 0, 0], col, tile);
  }
  // (no quad on the window wall's inside: the panes look through it; the village's wall stands there)
  // a cornice line where the tiles stop
  k.box([cx, tileTop + 0.025, zp - 0.02], W, 0.025, 0.02, WHITE, T.plain, ["+z"]);

  // ── the far wall: base cabinets, worktop, range, hood, shelves, pans, fridge, door
  const zc = zp - DEPTH / 2; // the cabinets' centre line
  const fridge = { x: x1 - 0.55, hw: 0.45 };
  const door = { x: x0 + 1.05, hw: 0.48 };
  const rangeX = -0.6;
  const runs: Array<[number, number]> = [
    [door.x + door.hw + 0.15, rangeX - 0.5],
    [rangeX + 0.5, fridge.x - fridge.hw - 0.05],
  ];
  for (const [a, b] of runs) {
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    k.box([mid, 0.06, zc + 0.04], half, 0.06, DEPTH / 2 - 0.04, BLACK, T.plain, ["-y", "+z"]); // the toe kick
    k.box([mid, (0.12 + TOP - 0.04) / 2, zc], half, (TOP - 0.04 - 0.12) / 2, DEPTH / 2, OAK, T.oak, ["-y", "+z"]);
    k.box([mid, TOP - 0.02, zc - 0.02], half + 0.02, 0.02, DEPTH / 2 + 0.02, OAK_DARK, T.oak, ["+z"]);
    // the cabinet fronts: door panels (a groove between them) and brass knobs
    const n = Math.max(1, Math.round((b - a) / 0.6));
    for (let i = 0; i < n; i++) {
      const fx = a + ((b - a) * (i + 0.5)) / n;
      const fw = (b - a) / n / 2 - 0.02;
      k.box([fx, 0.5, zp - DEPTH - 0.008], fw, 0.33, 0.008, OAK_DARK, T.oak, ["+z"]);
      k.box([fx, 0.5, zp - DEPTH - 0.016], fw - 0.06, 0.27, 0.006, OAK, T.oak, ["+z"]);
      k.cylinder([fx + (i % 2 ? -1 : 1) * (fw - 0.08), 0.74, zp - DEPTH - 0.016], [fx + (i % 2 ? -1 : 1) * (fw - 0.08), 0.74, zp - DEPTH - 0.04], 0.016, 0.016, 6, [0.82, 0.62, 0.3]);
    }
  }
  // the range: a steel body, an oven door with its dark window and bar, a black hob with four rings, knobs
  k.box([rangeX, (0.06 + TOP) / 2, zc], 0.5, (TOP - 0.06) / 2, DEPTH / 2, STEEL, T.plain, ["+z", "-y"]);
  k.box([rangeX, 0.46, zp - DEPTH - 0.01], 0.4, 0.26, 0.01, STEEL_DARK, T.plain, ["+z"]);
  k.box([rangeX, 0.46, zp - DEPTH - 0.022], 0.3, 0.16, 0.004, BLACK, T.plain, ["+z"]);
  k.cylinder([rangeX - 0.36, 0.78, zp - DEPTH - 0.05], [rangeX + 0.36, 0.78, zp - DEPTH - 0.05], 0.012, 0.012, 6, STEEL);
  for (let i = 0; i < 5; i++) k.cylinder([rangeX - 0.32 + i * 0.16, 0.86, zp - DEPTH], [rangeX - 0.32 + i * 0.16, 0.86, zp - DEPTH - 0.03], 0.02, 0.02, 6, BLACK);
  k.box([rangeX, TOP + 0.01, zc], 0.5, 0.01, DEPTH / 2, BLACK, T.plain, ["-y", "+z"]);
  for (const [ox, oz] of [[-0.24, -0.14], [0.24, -0.14], [-0.24, 0.14], [0.24, 0.14]]) k.cylinder([rangeX + ox, TOP + 0.02, zc + oz], [rangeX + ox, TOP + 0.035, zc + oz], 0.09, 0.08, 8, [0.16, 0.16, 0.17]);
  // a stockpot and a pan on the hob
  k.cylinder([rangeX - 0.24, TOP + 0.035, zc + 0.14], [rangeX - 0.24, TOP + 0.3, zc + 0.14], 0.13, 0.13, 8, STEEL);
  k.cylinder([rangeX + 0.24, TOP + 0.035, zc - 0.14], [rangeX + 0.24, TOP + 0.09, zc - 0.14], 0.14, 0.15, 8, BLACK);
  k.cylinder([rangeX + 0.38, TOP + 0.07, zc - 0.14], [rangeX + 0.62, TOP + 0.08, zc - 0.2], 0.012, 0.012, 5, BLACK, false);
  // the hood: a steel canopy narrowing to its flue
  k.box([rangeX, 2.02, zp - 0.3], 0.55, 0.06, 0.3, STEEL, T.plain, ["+z"]);
  {
    const y0 = 2.08, y1 = 2.62, z1 = zp - 0.12;
    const a: V3 = [rangeX - 0.55, y0, zp - 0.6], b: V3 = [rangeX + 0.55, y0, zp - 0.6], c: V3 = [rangeX + 0.2, y1, z1], d: V3 = [rangeX - 0.2, y1, z1];
    k.quad([a, b, c, d], norm([0, 0.6 - 0.12, -(y1 - y0)]), STEEL, T.plain);
    k.quad([[rangeX - 0.55, y0, zp], a, d, [rangeX - 0.2, y1, zp]], norm([-(y1 - y0), 0.35, 0]), STEEL_DARK, T.plain);
    k.quad([b, [rangeX + 0.55, y0, zp], [rangeX + 0.2, y1, zp], c], norm([y1 - y0, 0.35, 0]), STEEL_DARK, T.plain);
    k.box([rangeX, (y1 + h) / 2, zp - 0.12], 0.2, (h - y1) / 2, 0.12, STEEL, T.plain, ["+z", "+y"]);
  }
  // open oak shelves either side of the hood: plates on edge, stacked bowls, jars, cups
  for (const [a, b] of [[runs[0]![0], rangeX - 0.75], [rangeX + 0.75, runs[1]![1]]] as const) {
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    for (const sy of [1.55, 2.0]) {
      k.box([mid, sy, zp - 0.15], half, 0.02, 0.15, OAK_DARK, T.oak, ["+z"]);
      let x = a + 0.12;
      let i = 0;
      while (x < b - 0.15) {
        const kind = (i + Math.round(sy * 10)) % 4;
        if (kind === 0) {
          // plates standing on edge against the wall
          for (let p = 0; p < 3; p++) k.cylinder([x + p * 0.03, sy + 0.13, zp - 0.12], [x + p * 0.03 + 0.012, sy + 0.13, zp - 0.12], 0.11, 0.11, 8, WHITE);
          x += 0.2;
        } else if (kind === 1) {
          // a glass storage jar with its contents and a lid
          const col: V3 = [[0.86, 0.72, 0.46], [0.6, 0.38, 0.2], [0.95, 0.93, 0.86]][i % 3] as V3;
          k.cylinder([x + 0.06, sy + 0.02, zp - 0.15], [x + 0.06, sy + 0.2, zp - 0.15], 0.055, 0.055, 8, col);
          k.cylinder([x + 0.06, sy + 0.2, zp - 0.15], [x + 0.06, sy + 0.23, zp - 0.15], 0.058, 0.05, 10, OAK_DARK);
          x += 0.16;
        } else if (kind === 2) {
          // a stack of bowls
          for (let s = 0; s < 3; s++) k.cylinder([x + 0.09, sy + 0.02 + s * 0.045, zp - 0.15], [x + 0.09, sy + 0.06 + s * 0.045, zp - 0.15], 0.06, 0.09, 8, [0.9, 0.86, 0.78]);
          x += 0.22;
        } else {
          // cups
          for (let s = 0; s < 3; s++) k.cylinder([x + 0.05 + s * 0.1, sy + 0.02, zp - 0.18], [x + 0.05 + s * 0.1, sy + 0.11, zp - 0.18], 0.035, 0.04, 8, s % 2 ? [0.74, 0.32, 0.24] : WHITE);
          x += 0.32;
        }
        i++;
        x += 0.12; // a little air between things
      }
    }
  }
  // the pan rail over the worktop with copper pans hanging on hooks
  {
    const ra = runs[1]![0] + 0.2, rb = runs[1]![1] - 0.2;
    k.cylinder([ra, 1.3, zp - 0.07], [rb, 1.3, zp - 0.07], 0.012, 0.012, 6, STEEL);
    let i = 0;
    for (let x = ra + 0.2; x < rb - 0.1; x += 0.34, i++) {
      const r = 0.09 + (i % 3) * 0.025;
      const cy = 1.3 - 0.08 - r;
      k.cylinder([x, cy + r * 0.6, zp - 0.1], [x, cy - r, zp - 0.1], 0.006, 0.006, 4, STEEL, false);
      k.cylinder([x, cy, zp - 0.09], [x, cy, zp - 0.15], r, r * 0.95, 8, COPPER);
    }
  }
  // the fridge: a tall steel cabinet with two doors and bar handles
  k.box([fridge.x, 1.0, zp - 0.36], fridge.hw, 1.0, 0.36, STEEL, T.plain, ["+z", "-y"]);
  k.box([fridge.x, 1.42, zp - 0.725], fridge.hw - 0.01, 0.005, 0.005, STEEL_DARK, T.plain, ["+z"]);
  for (const hy of [[0.9, 1.3], [1.5, 1.95]]) k.cylinder([fridge.x - fridge.hw + 0.08, hy[0]!, zp - 0.77], [fridge.x - fridge.hw + 0.08, hy[1]!, zp - 0.77], 0.012, 0.012, 6, STEEL_DARK);
  // the door to the café: an oak leaf with two panels in a painted frame, a brass knob
  k.box([door.x, 1.085, zp - 0.015], door.hw + 0.07, 1.085, 0.015, WHITE, T.plain, ["+z"]);
  k.box([door.x, 1.03, zp - 0.04], door.hw, 1.03, 0.02, OAK, T.oak, ["+z"]);
  for (const py of [0.55, 1.5]) k.box([door.x, py, zp - 0.064], door.hw - 0.12, py > 1 ? 0.4 : 0.32, 0.006, OAK_DARK, T.oak, ["+z"]);
  k.cylinder([door.x + door.hw - 0.09, 1.0, zp - 0.06], [door.x + door.hw - 0.09, 1.0, zp - 0.11], 0.025, 0.03, 8, [0.82, 0.62, 0.3]);

  // ── under the windows: the cooks' bench along the back wall, things on it
  const zw = zb + 0.32;
  k.box([cx, (0.1 + TOP - 0.04) / 2, zw], W - 0.05, (TOP - 0.04 - 0.1) / 2, 0.3, OAK, T.oak, ["-y", "-z"]);
  k.box([cx, TOP - 0.02, zw + 0.01], W - 0.04, 0.02, 0.32, OAK_DARK, T.oak, ["-z"]);
  for (let x = x0 + 0.6; x < x1 - 0.4; x += 0.6) k.box([x, 0.5, zw + 0.302], 0.27, 0.32, 0.004, OAK_DARK, T.oak, ["-z"]);
  const items: Array<(x: number) => void> = [
    (x) => {
      // a bread board with three loaves
      k.box([x, TOP + 0.015, zw], 0.28, 0.015, 0.17, [0.8, 0.6, 0.38], T.oak);
      for (let i = 0; i < 3; i++) k.cylinder([x - 0.16 + i * 0.16, TOP + 0.07, zw - 0.08], [x - 0.16 + i * 0.16, TOP + 0.07, zw + 0.08], 0.05 + 0.01 * (i % 2), 0.045, 8, [0.72, 0.46, 0.22]);
    },
    (x) => {
      // a basil pot
      k.cylinder([x, TOP, zw], [x, TOP + 0.14, zw], 0.07, 0.09, 8, [0.72, 0.36, 0.22]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.box([x + Math.cos(a) * 0.06, TOP + 0.2 + (i % 2) * 0.04, zw + Math.sin(a) * 0.06], 0.05, 0.035, 0.05, [0.24, 0.5, 0.2]);
      }
    },
    (x) => {
      // a fruit bowl
      k.cylinder([x, TOP, zw], [x, TOP + 0.1, zw], 0.09, 0.16, 8, WHITE);
      for (let i = 0; i < 5; i++) k.box([x - 0.08 + (i % 3) * 0.08, TOP + 0.13 + Math.floor(i / 3) * 0.05, zw - 0.04 + (i % 2) * 0.08], 0.035, 0.035, 0.035, i % 2 ? [0.9, 0.7, 0.2] : [0.75, 0.2, 0.15]);
    },
    (x) => {
      // a kettle and two mugs
      k.cylinder([x, TOP, zw], [x, TOP + 0.2, zw], 0.1, 0.075, 8, [0.78, 0.2, 0.18]);
      k.cylinder([x, TOP + 0.2, zw], [x, TOP + 0.25, zw], 0.04, 0.02, 8, BLACK);
      for (const o of [0.2, 0.32]) k.cylinder([x + o, TOP, zw + 0.05], [x + o, TOP + 0.1, zw + 0.05], 0.04, 0.04, 8, WHITE);
    },
    (x) => {
      // stacked mixing bowls
      for (let s = 0; s < 3; s++) k.cylinder([x, TOP + s * 0.06, zw], [x, TOP + 0.08 + s * 0.06, zw], 0.09 - s * 0.015, 0.15 - s * 0.02, 12, s === 1 ? [0.92, 0.88, 0.8] : STEEL);
    },
  ];
  let j = 0;
  for (let x = x0 + 0.9; x < x1 - 0.6; x += 1.35, j++) items[j % items.length]!(x);

  // ── the prep table between: a stainless top on four legs with a shelf, mixing bowls and a tray of buns
  const pt = { x: -0.4, z: -6.75, hx: 1.6, hz: 0.42 };
  k.box([pt.x, TOP - 0.02, pt.z], pt.hx, 0.02, pt.hz, STEEL, T.plain);
  k.box([pt.x, 0.22, pt.z], pt.hx - 0.06, 0.01, pt.hz - 0.06, STEEL_DARK, T.plain);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box([pt.x + sx * (pt.hx - 0.04), (TOP - 0.04) / 2, pt.z + sz * (pt.hz - 0.04)], 0.02, (TOP - 0.04) / 2, 0.02, STEEL_DARK, T.plain, ["-y", "+y"]);
  for (let s = 0; s < 2; s++) k.cylinder([pt.x - 0.9 + s * 0.4, TOP, pt.z], [pt.x - 0.9 + s * 0.4, TOP + 0.12, pt.z], 0.1, 0.17, 8, STEEL);
  k.box([pt.x + 0.7, TOP + 0.01, pt.z], 0.36, 0.01, 0.26, STEEL_DARK, T.plain);
  for (let i = 0; i < 8; i++) k.cylinder([pt.x + 0.45 + (i % 4) * 0.165, TOP + 0.02, pt.z - 0.1 + Math.floor(i / 4) * 0.2], [pt.x + 0.45 + (i % 4) * 0.165, TOP + 0.07, pt.z - 0.1 + Math.floor(i / 4) * 0.2], 0.06, 0.045, 8, [0.84, 0.6, 0.3]);

  // ── the pendants: a cord, a dark enamel dome (its inside cream) and a bulb (the bulbs are their own mesh, bulbGeometry)
  for (const [lx, ly, lz] of KITCHEN_LAMPS) {
    k.cylinder([lx, h, lz], [lx, ly + 0.2, lz], 0.006, 0.006, 4, BLACK, false);
    k.cylinder([lx, ly + 0.2, lz], [lx, ly + 0.14, lz], 0.03, 0.05, 8, [0.16, 0.24, 0.2]);
    k.cylinder([lx, ly + 0.14, lz], [lx, ly - 0.06, lz], 0.05, 0.22, 14, [0.16, 0.24, 0.2], false);
  }
  return k;
}

/** The pendants' bulbs (café-local): small spheres-ish (two cones) at each lamp. */
export function bulbGeometry(toWorld: (p: V3) => V3): BufferGeometry {
  const g = new GeoBuilder();
  for (const [lx, ly, lz] of KITCHEN_LAMPS) {
    const p = toWorld([lx, ly, lz]);
    g.cylinder([p[0], p[1] + 0.06, p[2]], [p[0], p[1], p[2]], 0.02, 0.05, 10, [1, 1, 1], false);
    g.cylinder([p[0], p[1], p[2]], [p[0], p[1] - 0.05, p[2]], 0.05, 0.015, 10, [1, 1, 1], true);
  }
  return g.build();
}

// ─────────────────────────────── the atlas and the material ───────────────────────────────

/** The 512² atlas (2 × 2 cells): white subway tiles, terracotta quarry tiles, oak boards, plain white. */
export function kitchenAtlas(): CanvasTexture {
  const N = 512;
  const H = N / 2;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d")!;
  let seed = 4111;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // cell 0 (top left): white glazed subway tiles, 0.15 × 0.075 m in 0.6 m (64 × 32 px), brick bond, pale grout
  g.fillStyle = "#cfc8bd";
  g.fillRect(0, 0, H, H);
  for (let r = 0; r < 8; r++)
    for (let col = -1; col < 5; col++) {
      const x = col * 64 + (r % 2 ? 32 : 0);
      const y = r * 32;
      const t = 240 + Math.floor(rnd() * 10);
      g.fillStyle = `rgb(${t},${t - 2},${t - 6})`;
      g.fillRect(x + 1.5, y + 1.5, 61, 29);
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillRect(x + 3, y + 3, 57, 3);
      g.fillStyle = "rgba(0,0,0,0.05)";
      g.fillRect(x + 3, y + 26, 57, 3);
    }
  // cell 1 (top right): terracotta quarry tiles, 0.3 m (128 px), tight grout
  g.fillStyle = "#8a5a44";
  g.fillRect(H, 0, H, H);
  for (let r = 0; r < 2; r++)
    for (let col = 0; col < 2; col++) {
      const t = rnd();
      g.fillStyle = `rgb(${176 + Math.floor(t * 22)},${92 + Math.floor(t * 16)},${62 + Math.floor(t * 10)})`;
      g.fillRect(H + col * 128 + 2, r * 128 + 2, 124, 124);
      for (let s = 0; s < 40; s++) {
        g.fillStyle = `rgba(${rnd() > 0.5 ? "255,220,190" : "90,40,20"},0.06)`;
        g.beginPath();
        g.arc(H + col * 128 + 8 + rnd() * 112, r * 128 + 8 + rnd() * 112, 3 + rnd() * 9, 0, Math.PI * 2);
        g.fill();
      }
    }
  // cell 2 (bottom left): oak boards along u, 1.2 m: grain streaks, a few board joints
  g.fillStyle = "#c08c58";
  g.fillRect(0, H, H, H);
  for (let i = 0; i < 160; i++) {
    const y = H + rnd() * H;
    g.strokeStyle = `rgba(${rnd() > 0.4 ? "110,70,35" : "235,200,150"},${0.1 + rnd() * 0.16})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= H; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 1.5);
    g.stroke();
  }
  for (let b = 1; b < 4; b++) {
    g.fillStyle = "rgba(70,40,20,0.35)";
    g.fillRect(0, H + b * 64, H, 1.2);
  }
  // cell 3 (bottom right): plain white with a faint plaster tooth
  g.fillStyle = "#f6f4ef";
  g.fillRect(H, H, H, H);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "0,0,0" : "255,255,255"},0.025)`;
    g.fillRect(H + rnd() * H, H + rnd() * H, 2, 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  return t;
}

const VERT = /* glsl */ `
attribute float aTile;
attribute float aDay;
attribute vec3 aNight;
attribute vec3 color;
varying vec2 vUv;
varying float vTile;
varying float vDay;
varying vec3 vNight;
varying vec3 vCol;
void main() {
  vUv = uv;
  vTile = aTile;
  vDay = aDay;
  vNight = aNight;
  vCol = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec4 uTileM;
uniform float uDay;
uniform float uNight;
varying vec2 vUv;
varying float vTile;
varying float vDay;
varying vec3 vNight;
varying vec3 vCol;
void main() {
  float id = floor(vTile + 0.5);
  float m = id < 0.5 ? uTileM.x : id < 1.5 ? uTileM.y : id < 2.5 ? uTileM.z : uTileM.w;
  vec2 cell = vec2(mod(id, 2.0), 1.0 - floor(id / 2.0)) * 0.5;
  vec2 q = vUv / m;
  vec2 t = cell + fract(q) * 0.5;
  // derivatives of the unwrapped coordinate: no mip seam where fract() wraps
  vec3 albedo = textureGrad(uAtlas, t, dFdx(q) * 0.5, dFdy(q) * 0.5).rgb * vCol;
  vec3 light = vec3(vDay * uDay) * vec3(1.0, 0.98, 0.95) + vNight * uNight;
  gl_FragColor = vec4(albedo * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The kitchen's one material: the atlas, the baked day / night light, `uDay` / `uNight` driven by the village's light (setKitchenLight). */
export function kitchenMaterial(atlas: Texture): ShaderMaterial {
  return new ShaderMaterial({
    name: "cafe_kitchen",
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAtlas: { value: atlas },
      uTileM: { value: new Vector4(...KITCHEN_TILE_M) },
      uDay: { value: 1 },
      uNight: { value: 0 },
    },
    side: DoubleSide,
  });
}

/** Day light through the windows (0..1 of a bright day) and the pendants (0 off .. 1 on). */
export function setKitchenLight(m: ShaderMaterial, bulbs: MeshBasicMaterial, day: number, lamps: number): void {
  m.uniforms.uDay!.value = 0.1 + 0.72 * day;
  m.uniforms.uNight!.value = lamps;
  bulbs.color.copy(BULB_OFF).lerp(BULB_ON, lamps);
}
const BULB_OFF = new Color(0.55, 0.52, 0.48);
const BULB_ON = new Color(4.0, 3.1, 2.0);

/** The kitchen as meshes in the village (`toWorld` / `rot`: café local -> village), with its own disposal. */
export function makeKitchen(toWorld: (p: V3) => V3, rot: (n: V3) => V3): { room: Mesh; bulbs: Mesh; material: ShaderMaterial; bulbMaterial: MeshBasicMaterial; triangles: number; dispose(): void } {
  const geo = buildKitchen().build(toWorld, rot);
  const atlas = kitchenAtlas();
  const material = kitchenMaterial(atlas);
  const room = new Mesh(geo, material);
  room.name = "cafe_kitchen";
  room.raycast = () => {};
  const bulbMaterial = new MeshBasicMaterial({ color: BULB_OFF.clone(), toneMapped: true });
  const bulbGeo = bulbGeometry(toWorld);
  const bulbs = new Mesh(bulbGeo, bulbMaterial);
  bulbs.name = "cafe_kitchen_bulbs";
  bulbs.raycast = () => {};
  const triangles = (geo.index ? geo.index.count : 0) / 3 + (bulbGeo.index ? bulbGeo.index.count : 0) / 3;
  return {
    room,
    bulbs,
    material,
    bulbMaterial,
    triangles,
    dispose() {
      geo.dispose();
      bulbGeo.dispose();
      atlas.dispose();
      material.dispose();
      bulbMaterial.dispose();
    },
  };
}

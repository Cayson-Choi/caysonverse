import { BufferGeometry, type Matrix4 } from "three";
import { CAFE_BACK_BAR, CAFE_COUNTER } from "@caysonverse/shared/village/cafeRoom";
import { BRASS, MATTE, MeshBuilder, POLISH, WOOD, lin, type V3 } from "./meshBuilder";
import { BEAMS_Z, ROOM } from "./cafeLayout";
import { C, cupStack, jar } from "./cafeBuild";

/**
 * The café room's shell, built for the walk-in room (CafeRoom.tsx): what the village model bakes into its café — the oak floor, the
 * plaster walls over an oak wainscot, the ceiling, the shop windows and the door in the front wall, the side windows, the kitchen
 * partition's door, the white counter with its machines and the back bar with its open shelves — as geometry in the café's local frame,
 * then turned into the room's world by `matrix` (cafeBuild.localToRoom). Four meshes: the floor (PBR floor_wood), the plaster, the oak
 * (wainscot, beams, PBR wood_oak) — each with metre-true uv for its set's tile — the lit-vertex-colour trim and fittings, and the
 * glass (every pane shows the real village: the window-view shader, CafeRoom.tsx).
 *
 * Local frame as cafeLayout.ts: x to the right seen from the front, z toward the door side, y up; the walls' faces are ROOM.
 * Reference (2026-11-20, small Alsatian pâtisseries): oak boards, plaster over an oak wainscot, shop windows of three lites under a
 * transom, a bent-oak counter with an espresso machine and a glass pastry case, open shelves of jars and cups.
 */

/** The outer walls' thickness (m): how deep a window's reveal is, and where its glass stands. */
const WALL_T = 0.3;
const GLASS_AT = 0.15;

export const SHELL_TILES = { floor: 1.7, plaster: 2, oak: 1.83 } as const;

type Hole = readonly [number, number, number, number]; // u0, u1, v0, v1

interface Wall {
  /** The point at (u, v) and depth d out of the room (negative: into it). */
  at(u: number, v: number, d?: number): V3;
  /** The normal into the room. */
  n: V3;
  /** The wall's extent along u. */
  u0: number;
  u1: number;
  /** The unit vector of +u. */
  du: V3;
}

const FRONT: Wall = { at: (u, v, d = 0) => [u, v, ROOM.zFront + d], n: [0, 0, -1], u0: ROOM.x0, u1: ROOM.x1, du: [1, 0, 0] };
const BACK: Wall = { at: (u, v, d = 0) => [u, v, ROOM.zBack - d], n: [0, 0, 1], u0: ROOM.x0, u1: ROOM.x1, du: [1, 0, 0] };
const LEFT: Wall = { at: (u, v, d = 0) => [ROOM.x0 - d, v, u], n: [1, 0, 0], u0: ROOM.zBack, u1: ROOM.zFront, du: [0, 0, 1] };
const RIGHT: Wall = { at: (u, v, d = 0) => [ROOM.x1 + d, v, u], n: [-1, 0, 0], u0: ROOM.zBack, u1: ROOM.zFront, du: [0, 0, 1] };

/** The shop windows of the front wall, the door, and the side windows (the bake's: parts_cafe.py). */
export const FRONT_HOLES: readonly Hole[] = [
  [-5.25, -1.85, 0.45, 3.35],
  [1.85, 5.25, 0.45, 3.35],
];
export const DOOR_HOLE: Hole = [-1.2, 1.2, 0, 3.0];
export const SIDE_HOLES: readonly Hole[] = [
  [-4.0, -1.6, 0.9, 2.7],
  [0.2, 2.6, 0.9, 2.7],
];

/** Call `emit` for every rectangle of the wall's field u0..u1 x v0..v1 that no hole covers. */
function bands(u0: number, u1: number, v0: number, v1: number, holes: readonly Hole[], emit: (ua: number, ub: number, va: number, vb: number) => void): void {
  const vs = [v0, v1];
  for (const h of holes) for (const v of [h[2], h[3]]) if (v > v0 + 1e-9 && v < v1 - 1e-9) vs.push(v);
  vs.sort((a, b) => a - b);
  for (let i = 0; i + 1 < vs.length; i++) {
    const va = vs[i]!;
    const vb = vs[i + 1]!;
    if (vb - va < 1e-6) continue;
    const mid = (va + vb) / 2;
    const cov = holes.filter((h) => h[2] < mid && h[3] > mid).map((h) => [h[0], h[1]] as const).sort((a, b) => a[0] - b[0]);
    let u = u0;
    for (const [a, b] of cov) {
      if (a > u + 1e-9) emit(u, a, va, vb);
      u = Math.max(u, b);
    }
    if (u < u1 - 1e-9) emit(u, u1, va, vb);
  }
}

/** An axis-aligned box from two wall points (u, v, depth). */
function wbox(b: MeshBuilder, w: Wall, ua: number, ub: number, va: number, vb: number, d0: number, d1: number, color: V3, m = WOOD, skip: readonly string[] = []): void {
  const p = w.at(ua, va, d0);
  const q = w.at(ub, vb, d1);
  b.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[2], q[2]), color, m, skip);
}

function wboxTiled(b: MeshBuilder, w: Wall, ua: number, ub: number, va: number, vb: number, d0: number, d1: number, color: V3, tile: number, skip: readonly string[] = []): void {
  const p = w.at(ua, va, d0);
  const q = w.at(ub, vb, d1);
  b.boxTiled(Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[2], q[2]), color, WOOD, tile, skip);
}

export interface ShellParts {
  floor: BufferGeometry;
  plaster: BufferGeometry;
  oak: BufferGeometry;
  trim: BufferGeometry;
  glass: BufferGeometry;
  triangles: number;
}

const FRAME = lin("#3C3F44");
const FRAME_LIGHT = lin("#4A4D52");

/** The panes' frame: an outer frame, `lites` lites across, a transom at `transomV` (or none). */
function windowFrame(trim: MeshBuilder, glass: MeshBuilder, w: Wall, h: Hole, lites: number, transomV: number | null): void {
  const [u0, u1, v0, v1] = h;
  const g = (ua: number, ub: number, va: number, vb: number) => glass.quad(w.at(ua, va, GLASS_AT), w.at(ub, va, GLASS_AT), w.at(ub, vb, GLASS_AT), w.at(ua, vb, GLASS_AT), [1, 1, 1], MATTE, w.n);
  g(u0, u1, v0, v1);
  const t = 0.07;
  const d0 = GLASS_AT - 0.05;
  const d1 = GLASS_AT + 0.05;
  wbox(trim, w, u0, u0 + t, v0, v1, d0, d1, FRAME, WOOD);
  wbox(trim, w, u1 - t, u1, v0, v1, d0, d1, FRAME, WOOD);
  wbox(trim, w, u0, u1, v0, v0 + t, d0, d1, FRAME, WOOD);
  wbox(trim, w, u0, u1, v1 - t, v1, d0, d1, FRAME, WOOD);
  for (let k = 1; k < lites; k++) {
    const u = u0 + ((u1 - u0) * k) / lites;
    wbox(trim, w, u - 0.022, u + 0.022, v0, v1, d0 + 0.01, d1 - 0.01, FRAME_LIGHT, WOOD);
  }
  if (transomV !== null) wbox(trim, w, u0, u1, transomV - 0.025, transomV + 0.025, d0 + 0.01, d1 - 0.01, FRAME_LIGHT, WOOD);
  // the oak sill on the room's side
  wbox(trim, w, u0 - 0.05, u1 + 0.05, v0 - 0.035, v0, -0.13, 0.05, lin("#B98B5E"), WOOD);
}

/** A café curtain on a brass rod: pleated cream cloth over the window's lower part. */
function curtain(trim: MeshBuilder, w: Wall, u0: number, u1: number, vTop: number, vBot: number): void {
  const cream = lin("#F4EBDD");
  const shade = lin("#E3D6BF");
  const folds = 20;
  const dep = -0.1;
  for (let i = 0; i < folds; i++) {
    const ua = u0 + ((u1 - u0) * i) / folds;
    const ub = u0 + ((u1 - u0) * (i + 1)) / folds;
    const da = dep + (i % 2 ? 0.035 : -0.0);
    const db = dep + ((i + 1) % 2 ? 0.035 : -0.0);
    trim.quad(w.at(ua, vBot, da), w.at(ub, vBot, db), w.at(ub, vTop, db), w.at(ua, vTop, da), i % 2 ? shade : cream, MATTE, w.n);
  }
  const rod = [w.at(u0 - 0.04, vTop + 0.03, dep - 0.02), w.at(u1 + 0.04, vTop + 0.03, dep - 0.02)];
  trim.tube(rod, 0.011, C.brass, BRASS, 6);
  for (const e of [rod[0]!, rod[1]!]) trim.lathe(e[0], e[2], [[0.0, e[1] - 0.025], [0.025, e[1]], [0.0, e[1] + 0.025]], C.brass, BRASS, 8);
}

/**
 * The glass double door in the front wall: an oak frame, two leaves with dark stiles and rails, brass bar handles, a stone sill. The
 * leaves hang flush with the wall's face, on the room's side of it (depth -0.07..-0.02): a tap on the door is picked on them, and the
 * game's pick only meets what stands inside the room's rectangle (a leaf out in the wall's thickness, like the windows' glass, is never hit).
 */
function door(trim: MeshBuilder, glass: MeshBuilder, w: Wall): void {
  const [u0, u1, , v1] = DOOR_HOLE;
  const oak = lin("#8A5A3A");
  const dark = lin("#6E4429");
  const jw = 0.1;
  // the opening's frame: in the wall's thickness, and an architrave on the room's face
  wbox(trim, w, u0, u0 + jw, 0, v1, 0.04, 0.2, oak, WOOD);
  wbox(trim, w, u1 - jw, u1, 0, v1, 0.04, 0.2, oak, WOOD);
  wbox(trim, w, u0, u1, v1 - jw, v1, 0.04, 0.2, oak, WOOD);
  wbox(trim, w, u0 - 0.06, u0 + jw, 0, v1 + 0.06, -0.012, 0.0, oak, WOOD);
  wbox(trim, w, u1 - jw, u1 + 0.06, 0, v1 + 0.06, -0.012, 0.0, oak, WOOD);
  wbox(trim, w, u0 - 0.06, u1 + 0.06, v1 - jw, v1 + 0.06, -0.012, 0.0, oak, WOOD);
  wbox(trim, w, u0, u1, 0, 0.03, -0.1, 0.32, lin("#8C8A86"), POLISH);
  const top = v1 - jw;
  const d0 = -0.07;
  const d1 = -0.02;
  for (const [a, b] of [[u0 + jw, -0.005], [0.005, u1 - jw]] as const) {
    const st = 0.1;
    wbox(trim, w, a, a + st, 0.03, top, d0, d1, dark, WOOD);
    wbox(trim, w, b - st, b, 0.03, top, d0, d1, dark, WOOD);
    wbox(trim, w, a + st, b - st, top - 0.1, top, d0, d1, dark, WOOD);
    wbox(trim, w, a + st, b - st, 0.03, 0.32, d0, d1, dark, WOOD);
    wbox(trim, w, a + st, b - st, 1.05, 1.12, d0 - 0.005, d1 + 0.005, dark, WOOD);
    glass.quad(w.at(a + st, 0.32, -0.045), w.at(b - st, 0.32, -0.045), w.at(b - st, top - 0.1, -0.045), w.at(a + st, top - 0.1, -0.045), [1, 1, 1], MATTE, w.n);
  }
  for (const u of [-0.17, 0.17]) trim.tube([w.at(u, 0.85, -0.16), w.at(u, 1.55, -0.16)], 0.014, C.brass, BRASS, 6);
  for (const u of [-0.17, 0.17]) for (const v of [0.85, 1.55]) trim.tube([w.at(u, v, -0.16), w.at(u, v, -0.07)], 0.008, C.brass, BRASS, 4);
}

/** The kitchen door in the partition: a walnut frame, a leaf with a round port light, and the clock's brass over it is in cafeBuild. */
function kitchenDoor(trim: MeshBuilder): void {
  const w = BACK;
  const walnut = lin("#6B4A33");
  const leafC = lin("#8A5F3F");
  const [ua, ub] = [4.05, 5.15];
  wbox(trim, w, ua, ua + 0.07, 0, 2.25, -0.075, 0, walnut, WOOD);
  wbox(trim, w, ub - 0.07, ub, 0, 2.25, -0.075, 0, walnut, WOOD);
  wbox(trim, w, ua, ub, 2.18, 2.25, -0.075, 0, walnut, WOOD);
  wbox(trim, w, ua + 0.07, ub - 0.07, 0.03, 2.18, -0.04, -0.0, leafC, WOOD);
  // a brass push plate and a round port light
  wbox(trim, w, 4.68, 4.98, 0.95, 1.35, -0.05, -0.04, C.brass, BRASS);
  const cx = 4.6;
  const cy = 1.7;
  const ring: V3[] = [];
  const r = 0.14;
  for (let k = 0; k <= 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    ring.push(w.at(cx + Math.cos(a) * r, cy + Math.sin(a) * r, -0.05));
  }
  trim.tube(ring, 0.012, C.brass, BRASS, 5);
  for (let k = 0; k < 20; k++) {
    const a0 = (k / 20) * Math.PI * 2;
    const a1 = ((k + 1) / 20) * Math.PI * 2;
    trim.tri(w.at(cx, cy, -0.045), w.at(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, -0.045), w.at(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, -0.045), lin("#36424A"), POLISH, w.n);
  }
  // the chalk menu's frame (the slate itself is the art atlas's, cafeBuild.ts): 2.2 x 1.3 m on the partition over the back bar
  const walnut2 = lin("#5E3F2A");
  const f = 0.06;
  const [m0, m1, y0, y1] = [1.3, 3.5, 1.75, 3.05];
  wbox(trim, w, m0 - f, m1 + f, y0 - f, y0, -0.07, 0, walnut2, WOOD);
  wbox(trim, w, m0 - f, m1 + f, y1, y1 + f, -0.07, 0, walnut2, WOOD);
  wbox(trim, w, m0 - f, m0, y0, y1, -0.07, 0, walnut2, WOOD);
  wbox(trim, w, m1, m1 + f, y0, y1, -0.07, 0, walnut2, WOOD);
  wbox(trim, w, m0, m1, y0, y1, -0.07, -0.025, lin("#26302B"), MATTE);
}

/** The white panelled counter with its oak top, the espresso machine, the grinder, the till and the pastry case. */
function counter(trim: MeshBuilder): void {
  const { x0, x1, z0, z1 } = CAFE_COUNTER;
  const white = C.white;
  const oak = lin("#B98B5E");
  // plinth (dark, set back), body, oak top with a front overhang
  trim.box(x0 + 0.03, x1 - 0.03, 0, 0.1, z0 + 0.03, z1 - 0.03, lin("#2A2B2E"), MATTE);
  trim.box(x0, x1, 0.1, 1.03, z0, z1, white, MATTE, ["bot"]);
  trim.box(x0 - 0.04, x1 + 0.04, 1.03, 1.07, z0 - 0.04, z1 + 0.04, oak, WOOD, ["bot"]);
  // the front panels: shaker frames (thin dark lines) on the customer's side
  const nP = 9;
  const pw = (x1 - x0) / nP;
  for (let i = 0; i <= nP; i++) trim.box(x0 + i * pw - 0.007, x0 + i * pw + 0.007, 0.16, 0.97, z1, z1 + 0.012, lin("#D4CFC6"), MATTE);
  trim.box(x0, x1, 0.16, 0.176, z1, z1 + 0.012, lin("#D4CFC6"), MATTE);
  trim.box(x0, x1, 0.954, 0.97, z1, z1 + 0.012, lin("#D4CFC6"), MATTE);
  // an espresso machine (steel, black tray, two groups, a steam wand)
  const mx = -3.0;
  const y = 1.07;
  trim.box(mx - 0.27, mx + 0.27, y, y + 0.03, -2.3, -1.9, C.black, POLISH);
  trim.box(mx - 0.25, mx + 0.25, y + 0.03, y + 0.4, -2.28, -1.94, C.steel, POLISH);
  trim.box(mx - 0.25, mx + 0.25, y + 0.4, y + 0.42, -2.29, -1.93, C.black, POLISH);
  for (const gx of [-0.12, 0.12]) {
    trim.lathe(mx + gx, -1.92, [[0.03, y + 0.2], [0.045, y + 0.19], [0.04, y + 0.16], [0.0, y + 0.15]], C.black, POLISH, 10);
    trim.tube([[mx + gx, y + 0.14, -1.92], [mx + gx, y + 0.07, -1.92]], 0.012, C.steel, BRASS, 5);
  }
  trim.tube([[mx + 0.23, y + 0.3, -1.93], [mx + 0.3, y + 0.2, -1.88], [mx + 0.31, y + 0.07, -1.87]], 0.006, C.steel, BRASS, 4);
  trim.lathe(mx, -2.1, [[0.05, y + 0.42], [0.045, y + 0.46], [0.0, y + 0.47]], C.brass, BRASS, 10);
  // the grinder: a body and a glass-clear hopper of beans
  trim.box(-2.5 - 0.09, -2.5 + 0.09, y, y + 0.34, -2.2, -2.0, C.black, POLISH);
  trim.lathe(-2.5, -2.1, [[0.09, y + 0.34], [0.115, y + 0.46], [0.07, y + 0.52]], lin("#5B3A22"), MATTE, 12);
  // the till
  trim.box(-4.7, -4.3, y, y + 0.12, -2.28, -1.96, C.black, POLISH);
  trim.box(-4.66, -4.34, y + 0.12, y + 0.14, -2.22, -1.98, lin("#2D3A3F"), POLISH);
  // the pastry case: a steel frame round a glass hood over a white tray (the hood's glass is just the frame: no see-through card)
  const cx0 = -0.95;
  const cx1 = -0.28;
  const cz0 = -2.32;
  const cz1 = -1.84;
  trim.box(cx0, cx1, y, y + 0.05, cz0, cz1, white, POLISH);
  const top = y + 0.42;
  for (const [px, pz] of [[cx0, cz0], [cx1, cz0], [cx1, cz1], [cx0, cz1]] as const) trim.tube([[px, y + 0.05, pz], [px, top, pz]], 0.008, C.steel, BRASS, 5);
  for (const [a, b] of [[[cx0, cz0], [cx1, cz0]], [[cx1, cz0], [cx1, cz1]], [[cx1, cz1], [cx0, cz1]], [[cx0, cz1], [cx0, cz0]]] as const) trim.tube([[a[0], top, a[1]], [b[0], top, b[1]]], 0.008, C.steel, BRASS, 5);
  // two little tarts inside
  for (const [tx, col] of [[-0.78, "#E8C46A"], [-0.46, "#B02B3A"]] as const) {
    trim.lathe(tx, -2.08, [[0.09, y + 0.05], [0.095, y + 0.085], [0.0, y + 0.09]], C.crust, MATTE, 12);
    trim.lathe(tx, -2.08, [[0.08, y + 0.085], [0.0, y + 0.092]], lin(col), POLISH, 12);
  }
}

/** The back bar under the open shelves (as the bake: a white cabinet, oak top 0.94 m up, two walnut shelves of cups and jars). */
function backBar(trim: MeshBuilder): void {
  const { x0, x1, z0, z1 } = CAFE_BACK_BAR;
  const oak = lin("#B98B5E");
  trim.box(x0 + 0.03, x1 - 0.03, 0, 0.1, z0, z1 - 0.03, lin("#2A2B2E"), MATTE);
  trim.box(x0, x1, 0.1, 0.9, z0, z1, C.white, MATTE, ["bot"]);
  trim.box(x0 - 0.02, x1 + 0.02, 0.9, 0.94, z0, z1 + 0.04, oak, WOOD, ["bot"]);
  const n = 8;
  const pw = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) trim.box(x0 + i * pw - 0.007, x0 + i * pw + 0.007, 0.16, 0.84, z1, z1 + 0.012, lin("#D4CFC6"), MATTE);
  // the shelves: two walnut boards between uprights, 0.3 m deep, from the partition's face
  const sx0 = -5.4;
  const sx1 = 0.6;
  const zb = z0 + 0.025;
  const zf = zb + 0.3;
  for (const ux of [sx0, sx1 - 0.04]) trim.box(ux, ux + 0.04, 1.4, 2.2, zb, zf, C.walnut, WOOD);
  for (const sy of [1.46, 1.95]) trim.box(sx0, sx1, sy - 0.03, sy, zb, zf, C.walnut, WOOD);
  const zc = zb + 0.15;
  const jarCol = ["#4A2E20", "#EEE8D8", "#E9DFC2", "#7C5B3A", "#9AA37A", "#4A2E20", "#EEE8D8", "#C97B5A"];
  for (const [i, c] of jarCol.entries()) jar(trim, -5.15 + i * 0.28, zc, 1.46, 0.2 + (i % 3) * 0.03, 0.065, c);
  for (let i = 0; i < 7; i++) cupStack(trim, -5.0 + i * 0.5, zc, 1.95, 3 + (i % 3));
}

/** Everything of the shell as geometry in the room's world (`matrix`: cafeBuild.localToRoom). */
export function buildCafeShell(matrix: Matrix4): ShellParts {
  const floor = new MeshBuilder();
  const plaster = new MeshBuilder();
  const oak = new MeshBuilder();
  const trim = new MeshBuilder();
  const glass = new MeshBuilder();
  const white: V3 = [1, 1, 1];
  // (linear, above 1: the plaster set is a mid grey-beige; the lit model multiplies it down by the room's ambient)
  const plasterTint: V3 = [1.7, 1.58, 1.4];
  const oakTint: V3 = [1.0, 0.93, 0.82];
  const { x0, x1, zBack, zFront, ceil } = ROOM;

  // --- the oak floor and the plaster ceiling
  floor.quadTiled([x0, 0, zBack], [x1, 0, zBack], [x1, 0, zFront], [x0, 0, zFront], white, { glow: 0, gloss: 0.12 }, [0, 1, 0], SHELL_TILES.floor);
  plaster.quadTiled([x0, ceil, zBack], [x1, ceil, zBack], [x1, ceil, zFront], [x0, ceil, zFront], plasterTint, MATTE, [0, -1, 0], SHELL_TILES.plaster);

  // --- the walls: plaster with the windows and the door cut out, reveals, an oak wainscot (0.95 on the partition, 0.88 elsewhere)
  const walls: readonly [Wall, readonly Hole[], number][] = [
    [FRONT, [...FRONT_HOLES, DOOR_HOLE], 0.88],
    [BACK, [], 0.95],
    [LEFT, SIDE_HOLES, 0.88],
    [RIGHT, SIDE_HOLES, 0.88],
  ];
  for (const [w, holes, wain] of walls) {
    bands(w.u0, w.u1, 0, ceil, holes, (ua, ub, va, vb) => plaster.quadTiled(w.at(ua, va), w.at(ub, va), w.at(ub, vb), w.at(ua, vb), plasterTint, MATTE, w.n, SHELL_TILES.plaster));
    bands(w.u0, w.u1, 0.03, wain, holes, (ua, ub, va, vb) => wboxTiled(oak, w, ua, ub, va, vb, 0, -0.03, oakTint, SHELL_TILES.oak, ["bot"]));
    bands(w.u0, w.u1, wain, wain + 0.045, holes, (ua, ub, va, vb) => wboxTiled(oak, w, ua, ub, va, vb, 0, -0.05, oakTint, SHELL_TILES.oak, ["bot"]));
    for (const h of w === BACK ? [] : holes) {
      const [u0, u1, v0, v1] = h;
      const into = (s: number): V3 => [w.du[0] * s, w.du[1] * s, w.du[2] * s];
      const q = (a: V3, b: V3, c: V3, d: V3, hint: V3) => plaster.quadTiled(a, b, c, d, plasterTint, MATTE, hint, SHELL_TILES.plaster);
      q(w.at(u0, v0, 0), w.at(u1, v0, 0), w.at(u1, v0, WALL_T), w.at(u0, v0, WALL_T), [0, 1, 0]);
      q(w.at(u0, v1, 0), w.at(u1, v1, 0), w.at(u1, v1, WALL_T), w.at(u0, v1, WALL_T), [0, -1, 0]);
      q(w.at(u0, v0, 0), w.at(u0, v1, 0), w.at(u0, v1, WALL_T), w.at(u0, v0, WALL_T), into(1));
      q(w.at(u1, v0, 0), w.at(u1, v1, 0), w.at(u1, v1, WALL_T), w.at(u1, v0, WALL_T), into(-1));
    }
  }

  // --- the glass front: the shop windows with a curtain each, the door; the side windows
  FRONT_HOLES.forEach((h) => {
    windowFrame(trim, glass, FRONT, h, 3, 2.55);
    curtain(trim, FRONT, h[0] + 0.05, h[1] - 0.05, 1.6, 0.5);
  });
  door(trim, glass, FRONT);
  for (const h of SIDE_HOLES) {
    windowFrame(trim, glass, LEFT, h, 2, 2.1);
    windowFrame(trim, glass, RIGHT, h, 2, 2.1);
  }

  // --- exposed oak beams across the ceiling (oak set, uv by metre)
  for (const z of BEAMS_Z) oak.boxTiled(x0, x1, ceil - 0.28, ceil, z - 0.1, z + 0.1, [0.72, 0.6, 0.5], WOOD, SHELL_TILES.oak, ["top"]);

  // --- the partition's door, the chalk menu's frame, the counter and the back bar
  kitchenDoor(trim);
  counter(trim);
  backBar(trim);

  const geos = [floor, plaster, oak, trim, glass].map((b) => b.build());
  for (const g of geos) g.applyMatrix4(matrix);
  const [fg, pg, og, tg, gg] = geos as [BufferGeometry, BufferGeometry, BufferGeometry, BufferGeometry, BufferGeometry];
  return { floor: fg, plaster: pg, oak: og, trim: tg, glass: gg, triangles: floor.triangles + plaster.triangles + oak.triangles + trim.triangles + glass.triangles };
}

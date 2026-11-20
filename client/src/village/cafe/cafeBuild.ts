import { BufferGeometry, Matrix4 } from "three";
import { BRASS, BULB, LEAF, MATTE, MeshBuilder, POLISH, WOOD, lin, rng, type Mat, type V3 } from "./meshBuilder";
import { CAFE_ALL_TABLES, CAFE_STOOL, cafeToRoom } from "@caysonverse/shared/village/cafeRoom";
import {
  BAKED_PENDANTS,
  BANQUETTE,
  BEAMS_Z,
  CAFE_CENTRE,
  CHALKBOARD,
  PENDANT_Y,
  ROOM,
  SHELF_UNIT,
  STOOLS,
  TABLES,
  TABLE_RADIUS,
  TILE_MAT,
  allNewPendants,
  tableChairs,
} from "./cafeLayout";

// ---------------------------------------------------------------------------------------------------------------
// Colours (linear): the bake's oak and walnut, brass, steel, a cream glaze, terracotta, Kelsch red and cream.
export const C = {
  oak: lin("#A47649"),
  oakDark: lin("#7E5636"),
  walnut: lin("#5E3F2A"),
  beam: lin("#4F3824"),
  black: lin("#1E1F22"),
  steel: lin("#A9AEB2"),
  brass: lin("#C9A04A"),
  cream: lin("#F1E8D6"),
  white: lin("#F4F1EA"),
  terracotta: lin("#B5643E"),
  soil: lin("#3B2C20"),
  kelschRed: lin("#A8262E"),
  kelschCream: lin("#F2EADA"),
  opal: lin("#F6EEDC"),
  wicker: lin("#B58C55"),
  crust: lin("#B9793A"),
  crustDark: lin("#8B5A2B"),
  sugar: lin("#F7F2E6"),
  leaf: [lin("#3F6B35"), lin("#4F7D3E"), lin("#335A2E"), lin("#5C8A45")] as const,
  frond: [lin("#2F5E33"), lin("#3A6D3A"), lin("#2A5230")] as const,
};

/** Local (x, y, z) frame to the world: world = (cx - z, y, cz + x). A proper rotation, so windings and normals carry over. */
export function localToWorld(): Matrix4 {
  return new Matrix4().set(0, 0, -1, CAFE_CENTRE.x, 0, 1, 0, 0, 1, 0, 0, CAFE_CENTRE.z, 0, 0, 0, 1);
}

/**
 * Local (x, y, z) frame to the walk-in room's world (origin = the room frame's corner in the game): the half turn of cafeRoom.ts
 * (room x = 6.8 - x, room z = 3.7 - z), a proper rotation, so windings and normals carry over.
 */
export function localToRoom(origin: { x: number; z: number }): Matrix4 {
  const at = cafeToRoom(0, 0);
  return new Matrix4().set(-1, 0, 0, origin.x + at.x, 0, 1, 0, 0, 0, 0, -1, origin.z + at.z, 0, 0, 0, 1);
}

/** A round counter stool: an oak seat on four splayed black steel legs with a foot ring (the seat top at CAFE_STOOL.seatTop). */
export function stoolGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const r = CAFE_STOOL.radius;
  const top = CAFE_STOOL.seatTop;
  b.lathe(0, 0, [[r - 0.03, top - 0.05], [r, top - 0.035], [r + 0.005, top - 0.012], [r - 0.01, top], [0, top]], C.oak, WOOD, 16, [C.oakDark, C.oak, C.oak, C.oak]);
  for (let k = 0; k < 4; k++) {
    const a = k * (Math.PI / 2) + Math.PI / 4;
    const c = Math.cos(a);
    const s2 = Math.sin(a);
    b.tube([[c * (r - 0.05), top - 0.05, s2 * (r - 0.05)], [c * (r + 0.06), 0.01, s2 * (r + 0.06)]], 0.011, C.black, POLISH, 5);
  }
  const ring: V3[] = [];
  for (let i = 0; i <= 16; i++) ring.push([Math.cos((i / 16) * Math.PI * 2) * (r + 0.02), 0.25, Math.sin((i / 16) * Math.PI * 2) * (r + 0.02)]);
  b.tube(ring, 0.008, C.steel, BRASS, 4);
  return b.build();
}

// ---------------------------------------------------------------------------------------------------------------
// Pieces (each built in its own frame, origin on the floor).

/** A bentwood café chair (Thonet-style; the bake's terrace chair, parts_cafe.py `cafe_chair`): front +z, seat 0.46 m up. */
export function chairGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const frame = C.walnut;
  const o: [number, number][] = [[-0.16, -0.21], [0.16, -0.21], [0.21, -0.15], [0.21, 0.17], [0.17, 0.21], [-0.17, 0.21], [-0.21, 0.17], [-0.21, -0.15]];
  b.prism(o, 0.42, 0.46, C.oak, WOOD, C.oakDark);
  for (const s of [-1, 1]) {
    b.tube([[s * 0.185, 0, 0.18], [s * 0.17, 0.42, 0.16]], 0.017, frame, WOOD, 5);
    b.tube([[s * 0.185, 0, -0.19], [s * 0.17, 0.42, -0.17], [s * 0.16, 0.89, -0.215]], 0.017, frame, WOOD, 5);
    b.tube([[s * 0.18, 0.17, 0.17], [s * 0.18, 0.17, -0.18]], 0.009, frame, WOOD, 4);
  }
  b.tube([[-0.18, 0.21, 0.17], [0.18, 0.21, 0.17]], 0.009, frame, WOOD, 4);
  const railB = (a: number) => -0.205 - 0.035 * (1 - (a / 0.165) ** 2);
  const us = [-0.165, -0.08, 0, 0.08, 0.165];
  const y0 = 0.77;
  const y1 = 0.89;
  const t = 0.022;
  for (let i = 0; i + 1 < us.length; i++) {
    const a0 = us[i]!;
    const a1 = us[i + 1]!;
    b.quad([a0, y0, railB(a0)], [a1, y0, railB(a1)], [a1, y1, railB(a1)], [a0, y1, railB(a0)], frame, WOOD, [0, 0, 1]);
    b.quad([a0, y0, railB(a0) - t], [a1, y0, railB(a1) - t], [a1, y1, railB(a1) - t], [a0, y1, railB(a0) - t], frame, WOOD, [0, 0, -1]);
    b.quad([a0, y1, railB(a0) - t], [a1, y1, railB(a1) - t], [a1, y1, railB(a1)], [a0, y1, railB(a0)], frame, WOOD, [0, 1, 0]);
  }
  for (const a of [-0.07, 0, 0.07]) b.tube([[a, 0.46, -0.185], [a, y0, railB(a) - t / 2]], 0.011, frame, WOOD, 4);
  return b.build();
}

/** A round bistro table: an oak top (0.33 m radius, rim eased) on a black steel pedestal and a round foot. */
export function tableGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  const r = TABLE_RADIUS;
  b.lathe(0, 0, [[r - 0.03, 0.735], [r, 0.752], [r, 0.772], [r - 0.015, 0.78], [0, 0.78]], C.oak, WOOD, 16, [C.oakDark, C.oakDark, C.oak, C.oak]);
  b.tube([[0, 0.06, 0], [0, 0.735, 0]], 0.03, C.black, POLISH, 6);
  b.lathe(0, 0, [[0.22, 0.0], [0.21, 0.04], [0.06, 0.07], [0.03, 0.09]], C.black, POLISH, 12);
  return b.build();
}

/** A pendant lamp over (x, z): a cord from the ceiling, then a brass dome or an opal globe with its bulb. */
export function pendant(b: MeshBuilder, x: number, z: number, kind: "dome" | "globe"): void {
  const y = PENDANT_Y;
  if (kind === "dome") {
    b.tube([[x, ROOM.ceil, z], [x, y + 0.24, z]], 0.006, C.black, MATTE, 4);
    b.lathe(x, z, [[0.17, y], [0.15, y + 0.1], [0.08, y + 0.18], [0.02, y + 0.23]], C.brass, BRASS, 12);
    b.lathe(x, z, [[0.16, y + 0.004], [0.14, y + 0.094], [0.075, y + 0.172], [0.0, y + 0.215]], C.cream, { glow: 0.5, gloss: 0 }, 12);
    b.lathe(x, z, [[0.0, y + 0.05], [0.05, y + 0.08], [0.06, y + 0.13], [0.0, y + 0.17]], lin("#FFE2AE"), BULB, 8);
  } else {
    const R = 0.14;
    const cy = y + R;
    b.tube([[x, ROOM.ceil, z], [x, cy + R + 0.05, z]], 0.006, C.black, MATTE, 4);
    b.lathe(x, z, [[0.025, cy + R + 0.05], [0.03, cy + R + 0.01], [0.05, cy + R - 0.01]], C.brass, BRASS, 8);
    const prof: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * (Math.PI * 0.94);
      prof.push([R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    b.lathe(x, z, prof, C.opal, { glow: 0.85, gloss: 0 }, 14);
  }
}

/** One check-pattern rectangle: `nu` x `nv` cells from `o` along `du` and `dv` (unit axes), two colours. */
export function checkGrid(b: MeshBuilder, o: V3, du: V3, dv: V3, nu: number, nv: number, cell: number, a: V3, c: V3, hint: V3, m: Mat): void {
  const P = (i: number, j: number): V3 => [o[0] + du[0] * i * cell + dv[0] * j * cell, o[1] + du[1] * i * cell + dv[1] * j * cell, o[2] + du[2] * i * cell + dv[2] * j * cell];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) b.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), (i + j) % 2 ? a : c, m, hint);
}

/** How far from `base` along `d` (horizontal unit) before the room's wall (a hand's breadth short of it; the leaf's half width is allowed for). */
function reach(base: V3, d: readonly [number, number]): number {
  const m = 0.1;
  let r = 10;
  if (d[0] > 1e-6) r = Math.min(r, (ROOM.x1 - m - base[0]) / d[0]);
  if (d[0] < -1e-6) r = Math.min(r, (ROOM.x0 + m - base[0]) / d[0]);
  if (d[1] > 1e-6) r = Math.min(r, (ROOM.zFront - m - base[2]) / d[1]);
  if (d[1] < -1e-6) r = Math.min(r, (ROOM.zBack + m - base[2]) / d[1]);
  return Math.max(0, r);
}

/** Cross sections of the blade: fraction of length and half-width. The vine leaves have broad shoulders near their petiole. */
const BLADES = {
  oval: [[0.17, 0.55], [0.44, 1], [0.74, 0.78]],
  heart: [[0.09, 0.8], [0.26, 1], [0.63, 0.68]],
  lance: [[0.2, 0.66], [0.48, 1], [0.78, 0.55]],
} as const;

export function leaf(b: MeshBuilder, base: V3, d: readonly [number, number], L0: number, W: number, lift: number, color: V3, shape: keyof typeof BLADES = "oval"): void {
  const L = Math.min(L0, reach(base, d));
  if (L < 0.02) return;
  const tip: V3 = [base[0] + d[0] * L, base[1] + lift, base[2] + d[1] * L];
  const up: V3 = [0, 1, 0];
  let left = base, mid = base, right = base;
  for (const [t, width] of BLADES[shape]) {
    const r = 0.5 * W * width;
    const x = base[0] + d[0] * L * t;
    const y = base[1] + lift * t + L * 0.13 * Math.sin(Math.PI * t);
    const z = base[2] + d[1] * L * t;
    const l: V3 = [x - d[1] * r, y - r * (0.16 + t * 0.28), z + d[0] * r];
    const m: V3 = [x, y, z];
    const rr: V3 = [x + d[1] * r, y - r * (0.46 - t * 0.25), z - d[0] * r];
    if (mid === base) {
      b.tri(base, l, m, color, LEAF, up);
      b.tri(base, m, rr, color, LEAF, up);
    } else {
      b.quad(left, l, m, mid, color, LEAF, up);
      b.quad(mid, m, rr, right, color, LEAF, up);
    }
    left = l;
    mid = m;
    right = rr;
  }
  b.tri(left, tip, mid, color, LEAF, up);
  b.tri(mid, tip, right, color, LEAF, up);
}

export function pot(b: MeshBuilder, x: number, z: number, r: number, h: number, y = 0): void {
  b.lathe(x, z, [[r * 0.72, y], [r, y + h * 0.92], [r * 1.04, y + h], [r * 0.9, y + h * 1.02]], C.terracotta, MATTE, 10);
  b.lathe(x, z, [[r * 0.9, y + h * 0.98], [0, y + h * 0.98]], C.soil, MATTE, 10);
}

/** A kentia palm: arching fronds with paired leaflets, from a pot. */
function palm(b: MeshBuilder, x: number, z: number, H: number, seed: number): void {
  const r = rng(seed);
  pot(b, x, z, 0.26, 0.5);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.5;
    const up = 0.55 + r() * 0.3;
    const reach = 0.45 + r() * 0.3;
    const top = H * (0.62 + 0.3 * up);
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const h = 0.5 + (top - 0.5) * Math.sin(t * Math.PI * 0.5) * (1 - 0.15 * t);
      const rr = reach * t * t * (1.2 - 0.2 * t);
      const px = Math.min(ROOM.x1 - 0.1, Math.max(ROOM.x0 + 0.1, x + Math.cos(a) * rr));
      const pz = Math.min(ROOM.zFront - 0.1, Math.max(ROOM.zBack + 0.1, z + Math.sin(a) * rr));
      pts.push([px, h - 0.35 * t * t * reach, pz]);
    }
    b.tube(pts, 0.012, lin("#5A6B33"), LEAF, 4, 0.004);
    for (let i = 3; i <= 8; i++) {
      const p = pts[i]!;
      const q = pts[Math.min(i + 1, 8)]!;
      const L = 0.3 * (1 - (i - 3) * 0.1);
      for (const s of [-1, 1]) {
        const d: [number, number] = [Math.cos(a + s * 1.15), Math.sin(a + s * 1.15)];
        leaf(b, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], d, L, 0.07, -0.1, C.frond[(i + k) % 3]!, "lance");
      }
    }
  }
}

/** A pothos in a hanging pot: trailing vines with small heart leaves. */
function hangingPlant(b: MeshBuilder, x: number, z: number, y: number, seed: number): void {
  const r = rng(seed);
  b.lathe(x, z, [[0, y], [0.056, y], [0.08, y + 0.018], [0.112, y + 0.12], [0.117, y + 0.15], [0.124, y + 0.155], [0.124, y + 0.17], [0.112, y + 0.17], [0.11, y + 0.15]], C.white, POLISH, 16);
  b.lathe(x, z, [[0.111, y + 0.151], [0, y + 0.151]], C.soil, MATTE, 16);
  const join = y + 0.55;
  for (const a of [0, 2.1, 4.2]) b.tube([[x + Math.cos(a) * 0.118, y + 0.16, z + Math.sin(a) * 0.118], [x, join, z]], 0.004, C.wicker, MATTE, 4);
  b.lathe(x, z, [[0.009, join - 0.016], [0.014, join], [0.009, join + 0.015]], C.brass, BRASS, 8);
  b.tube([[x, join, z], [x, ROOM.ceil - 0.012, z]], 0.005, C.wicker, MATTE, 5);
  b.lathe(x, z, [[0, ROOM.ceil - 0.018], [0.031, ROOM.ceil - 0.018], [0.035, ROOM.ceil]], C.brass, BRASS, 10);
  for (let v = 0; v < 6; v++) {
    const a = (v / 6) * Math.PI * 2 + r();
    const len = 0.5 + r() * 0.6;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([x + Math.cos(a) * (0.1 + 0.12 * Math.sin(t * Math.PI)), y + 0.15 - len * t, z + Math.sin(a) * (0.1 + 0.12 * Math.sin(t * Math.PI))]);
    }
    b.tube(pts, 0.004, lin("#4C6B34"), LEAF, 3);
    for (let i = 1; i <= 6; i++) leaf(b, pts[i]!, [Math.cos(a + i), Math.sin(a + i)], 0.075, 0.055, -0.02, C.leaf[(i + v) % 4]!, "heart");
  }
}

/** A potted herb: a small terracotta pot with a basil clump. */
export function herb(b: MeshBuilder, x: number, z: number, y: number, seed: number): void {
  const r = rng(seed);
  pot(b, x, z, 0.05, 0.08, y);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    leaf(b, [x + Math.cos(a) * 0.015, y + 0.08, z + Math.sin(a) * 0.015], [Math.cos(a), Math.sin(a)], 0.06 + r() * 0.03, 0.045, 0.03 + r() * 0.03, C.leaf[i % 4]!);
  }
}

/** A fiddle-leaf fig (taller, broad leaves), like the bake's two. */
export function fig(b: MeshBuilder, x: number, z: number, H: number, seed: number): void {
  const r = rng(seed);
  pot(b, x, z, 0.23, 0.42);
  b.tube([[x, 0.4, z], [x + 0.03, 0.4 + H * 0.5, z - 0.02], [x, 0.4 + H, z]], 0.018, lin("#6E5440"), WOOD, 4, 0.01);
  for (let k = 0; k < 18; k++) {
    const t = 0.3 + 0.7 * (k / 17);
    const a = k * 2.4 + r() * 0.3;
    leaf(b, [x + 0.02, 0.4 + H * t, z], [Math.cos(a), Math.sin(a)], 0.3 + 0.12 * (1 - t), 0.2, -0.04 + r() * 0.1, C.leaf[k % 4]!);
  }
}

/** A cake stand (white ceramic: plate on a stem and foot) with a bundt kougelhopf or a fruit tart on it. */
export function cakeStand(b: MeshBuilder, x: number, z: number, y: number, kind: "kougelhopf" | "tart", seed: number): void {
  const r = rng(seed);
  b.lathe(x, z, [[0.09, y], [0.07, y + 0.01], [0.015, y + 0.04], [0.012, y + 0.12]], C.white, POLISH, 12);
  b.lathe(x, z, [[0.15, y + 0.115], [0.17, y + 0.125], [0.0, y + 0.13]], C.white, POLISH, 14);
  const top = y + 0.13;
  if (kind === "kougelhopf") {
    // a fluted bundt: a ring cake with a turned cone, dusted white on top
    const flutes = 12;
    for (let k = 0; k < flutes; k++) {
      const a0 = (k / flutes) * Math.PI * 2;
      const a1 = ((k + 1) / flutes) * Math.PI * 2;
      const prof: [number, number, number][] = [[0.045, 0.0, 0], [0.1, 0.0, 0.0], [0.115, 0.05, 0.012], [0.1, 0.1, 0.0], [0.062, 0.135, 0], [0.03, 0.145, 0]];
      for (let i = 0; i + 1 < prof.length; i++) {
        const [r0, h0] = prof[i]!;
        const [r1, h1, f1] = prof[i + 1]!;
        const P = (rad: number, ang: number, h: number, f: number): V3 => [x + (rad + f) * Math.cos(ang), top + h, z + (rad + f) * Math.sin(ang)];
        const white = i >= prof.length - 3;
        const colr = white ? C.sugar : k % 2 ? C.crust : C.crustDark;
        b.quad(P(r0, a0, h0, 0), P(r0, a1, h0, 0), P(r1, a1, h1, f1), P(r1, a0, h1, f1), colr, MATTE);
      }
    }
  } else {
    b.lathe(x, z, [[0.14, top], [0.145, top + 0.03], [0.12, top + 0.035]], C.crust, MATTE, 16);
    b.lathe(x, z, [[0.12, top + 0.035], [0.0, top + 0.036]], lin("#E8C46A"), POLISH, 16);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 0.1;
      const bx = x + Math.cos(a) * rr;
      const bz = z + Math.sin(a) * rr;
      b.lathe(bx, bz, [[0.014, top + 0.036], [0.018, top + 0.05], [0.0, top + 0.06]], i % 3 ? lin("#B02B3A") : lin("#6B2C5E"), POLISH, 6);
    }
  }
}

/** A bread basket on its end: wicker, with baguettes standing in it. */
function baguetteBasket(b: MeshBuilder, x: number, z: number, y: number, seed: number): void {
  const r = rng(seed);
  b.lathe(x, z, [[0.09, y], [0.115, y + 0.12], [0.12, y + 0.2]], C.wicker, MATTE, 10);
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    const lean = 0.05 + r() * 0.05;
    const h = 0.34 + r() * 0.08;
    b.tube([[x + Math.cos(a) * 0.03, y + 0.1, z + Math.sin(a) * 0.03], [x + Math.cos(a) * (0.03 + lean * 0.5), y + 0.1 + h * 0.5, z + Math.sin(a) * (0.03 + lean * 0.5)], [x + Math.cos(a) * (0.03 + lean), y + 0.1 + h, z + Math.sin(a) * (0.03 + lean)]], 0.03, i % 2 ? lin("#C98E4B") : lin("#B87A3A"), MATTE, 6, 0.022);
  }
}

/** A small wicker bowl of pretzels (bretzels) on a counter. */
function bretzelBowl(b: MeshBuilder, x: number, z: number, y: number): void {
  b.lathe(x, z, [[0.07, y], [0.125, y + 0.05], [0.13, y + 0.07]], C.wicker, MATTE, 10);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    const cx = x + Math.cos(a) * 0.045;
    const cz = z + Math.sin(a) * 0.045;
    const ring: V3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = (k / 10) * Math.PI * 2;
      ring.push([cx + Math.cos(t) * 0.05 * Math.cos(a) - Math.sin(t) * 0.036 * Math.sin(a), y + 0.075 + 0.012 * i + 0.006 * Math.sin(t * 2), cz + Math.cos(t) * 0.05 * Math.sin(a) + Math.sin(t) * 0.036 * Math.cos(a)]);
    }
    b.tube(ring, 0.011, lin("#8A4B21"), MATTE, 5);
  }
}

/** Cross section across a baker's score. The raised crust curls over the lighter crumb exposed in the split. */
const LOAF_SECTION = [
  [-90, 0, "heel"], [-62, 0, "crust"], [-36, 0, "crust"], [-16, 0, "crust"],
  [-9, 0.11, "ear"], [-4, -0.09, "crumb"], [5, -0.07, "crumb"], [14, 0.035, "crust"],
  [34, 0, "crust"], [60, 0, "heel"], [90, 0, "heel"],
] as const;

/** A hand-shaped, scored loaf on a board or in a shallow bread basket. */
function loaf(b: MeshBuilder, x: number, z: number, y: number, R: number, seed: number, board = true): void {
  const r = rng(seed);
  if (board) b.box(x - R * 1.25, x + R * 1.25, y, y + 0.02, z - R * 1.1, z + R * 1.1, C.oak, WOOD);
  const bottom = y + (board ? 0.02 : 0);
  const yaw = seed + r() * Math.PI;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const colours = { crust: r() > 0.5 ? lin("#BF7B3F") : lin("#B27335"), crumb: lin("#DDB477"), ear: C.crustDark, heel: lin("#9B602E") };
  let previous: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const phase = i * Math.PI / 10;
    const along = -Math.cos(phase);
    const width = Math.sin(phase);
    const row = LOAF_SECTION.map(([degrees, ridge]): V3 => {
      const t = degrees * Math.PI / 180;
      // Bend the score diagonally while the outside edges stay on the board.
      const a = t + (0.36 * along + 0.07) * Math.cos(t);
      const across = 0.91 * width * Math.sin(a);
      const rise = 0.75 * width * Math.cos(a) + ridge * width ** 2;
      return [x + R * (along * cos - across * sin), bottom + R * rise, z + R * (along * sin + across * cos)];
    });
    if (previous.length) {
      for (let j = 0; j < row.length - 1; j++) {
        const colour = colours[LOAF_SECTION[j]![2]];
        b.quad(previous[j]!, previous[j + 1]!, row[j + 1]!, row[j]!, colour, MATTE, [0, 1, 0]);
      }
    }
    previous = row;
  }
}

/** Glazed pantry canisters with a foot ring, rounded shoulder and a wire bail over the lid. */
export function jar(b: MeshBuilder, x: number, z: number, y: number, h: number, radius: number, content: string): void {
  const foot = radius * 0.82;
  const neck = radius * 0.73;
  const glaze = lin(content);
  b.lathe(x, z, [[foot, y], [foot, y + 0.005], [radius, y + 0.015], [radius, y + h * 0.64],
    [radius, y + h * 0.68], [radius, y + h * 0.76], [radius * 0.95, y + h * 0.82],
    [neck, y + h * 0.86], [neck, y + h * 0.90]], glaze, POLISH, 14,
  [C.cream, glaze, glaze, C.cream, glaze, glaze, glaze, C.cream]);
  b.lathe(x, z, [[neck, y + h * 0.90], [neck * 1.13, y + h * 0.91], [neck * 1.1, y + h * 0.95],
    [neck * 0.84, y + h * 0.98], [0, y + h * 0.99]], C.cream, POLISH, 14);
  const wire = 0.0024;
  const bailZ = z + radius * 0.22;
  b.tube([[x - radius, y + h * 0.79, bailZ], [x - neck * 1.12, y + h * 0.97, bailZ],
    [x - neck * 0.55, y + h + wire, bailZ], [x + neck * 0.55, y + h + wire, bailZ],
    [x + neck * 1.12, y + h * 0.97, bailZ], [x + radius, y + h * 0.79, bailZ]], wire, C.steel, BRASS, 4);
}

/** A stack of cups on saucers. */
export function cupStack(b: MeshBuilder, x: number, z: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const yy = y + i * 0.07;
    b.lathe(x, z, [[0.05, yy], [0.075, yy + 0.012], [0.0, yy + 0.014]], C.white, POLISH, 10);
    b.lathe(x, z, [[0.03, yy + 0.012], [0.04, yy + 0.06], [0.034, yy + 0.062]], C.white, POLISH, 8);
  }
}

/** A cup of coffee on a saucer on a table (with a bud vase). */
function tableSetting(b: MeshBuilder, x: number, z: number, seed: number): void {
  const r = rng(seed);
  const y = 0.78;
  const a = r() * 6;
  const cx = x + Math.cos(a) * 0.14;
  const cz = z + Math.sin(a) * 0.14;
  b.lathe(cx, cz, [[0.06, y], [0.085, y + 0.01], [0.0, y + 0.012]], C.white, POLISH, 10);
  b.lathe(cx, cz, [[0.035, y + 0.012], [0.045, y + 0.065], [0.04, y + 0.067]], C.white, POLISH, 10);
  b.lathe(cx, cz, [[0.038, y + 0.062], [0.0, y + 0.062]], lin("#3A2316"), POLISH, 10);
  b.lathe(x - Math.cos(a) * 0.1, z - Math.sin(a) * 0.1, [[0.02, y], [0.028, y + 0.05], [0.012, y + 0.1], [0.011, y + 0.12]], lin("#8FB3A6"), POLISH, 8);
  const vx = x - Math.cos(a) * 0.1;
  const vz = z - Math.sin(a) * 0.1;
  b.tube([[vx, y + 0.1, vz], [vx + 0.015, y + 0.22, vz]], 0.003, C.leaf[2]!, LEAF, 3);
  const pet = [lin("#E9D36B"), lin("#F2A5B4"), lin("#FFFFFF")][Math.floor(r() * 3)]!;
  b.lathe(vx + 0.015, vz, [[0.0, y + 0.2], [0.03, y + 0.225], [0.0, y + 0.25]], pet, MATTE, 6);
}

/** A framed print on a side wall: `wall` is the wall's local x, `facing` +1 (the wall at -x faces +x) or -1; (zc, yc) the centre. */
function frame(art: MeshBuilder, solid: MeshBuilder, wall: number, facing: 1 | -1, zc: number, yc: number, w: number, h: number, uv: readonly [number, number, number, number]): void {
  const t = 0.035;
  const x0 = facing > 0 ? wall : wall - t;
  const x1 = facing > 0 ? wall + t : wall;
  const m = 0.03;
  solid.box(x0, x1, yc - h / 2 - m, yc + h / 2 + m, zc - w / 2 - m, zc + w / 2 + m, C.walnut, WOOD);
  const xf = facing > 0 ? x1 + 0.0015 : x0 - 0.0015;
  // viewer's right: -z for a wall facing +x, +z for a wall facing -x
  const zl = facing > 0 ? zc + w / 2 : zc - w / 2;
  const zr = facing > 0 ? zc - w / 2 : zc + w / 2;
  art.quad([xf, yc - h / 2, zl], [xf, yc - h / 2, zr], [xf, yc + h / 2, zr], [xf, yc + h / 2, zl], lin("#FFFFFF"), MATTE, [facing, 0, 0], [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]);
}

// ---------------------------------------------------------------------------------------------------------------
// The atlas regions (u0, v0, u1, v1; v up) painted in cafeTextures.ts.
export const ATLAS_REGIONS = {
  board: [0, 0.5, 0.5, 1],
  counterMenu: [0.5, 208 / 1024, 1, 0.5],
  printCup: [0.5, 0.5, 0.75, 0.84],
  printTown: [0.75, 0.5, 1, 0.84],
  printWide: [0.5, 0.84, 1, 1],
  printKugel: [0, 0, 0.25, 0.34],
  printVines: [0.25, 0, 0.5, 0.34],
} as const;

export interface CafeParts {
  /** One merged mesh: everything fixed (counter and shelf dressing, banquette, beams, pendants, plants, tiles ...). */
  fixed: BufferGeometry;
  /** The art: the chalkboard and the framed prints (a textured atlas). */
  art: BufferGeometry;
  /** One chair and one table, drawn as instances. */
  chair: BufferGeometry;
  table: BufferGeometry;
  chairMatrices: Matrix4[];
  tableMatrices: Matrix4[];
  /** The counter stools, drawn as instances. */
  stool: BufferGeometry;
  stoolMatrices: Matrix4[];
  /** Contact shadows under chairs, tables and furniture (soft dark quads), and the warm pools under the new pendants. */
  blobs: BufferGeometry;
  pools: BufferGeometry;
  triangles: number;
}

/** A soft square decal on the floor, its edges held inside the room's walls (the picture's edge fades, so a cut one just ends). */
function decal(b: MeshBuilder, x: number, z: number, rx: number, rz: number, y: number, c: V3): void {
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
  const xa = Math.max(x - rx, ROOM.x0 + 0.02);
  const xb = Math.min(x + rx, ROOM.x1 - 0.02);
  const za = Math.max(z - rz, ROOM.zBack + 0.02);
  const zb = Math.min(z + rz, ROOM.zFront - 0.02);
  b.quad([xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], c, MATTE, [0, 1, 0], uv);
}

export interface BuildOptions {
  /**
   * The walk-in room (CafeRoom.tsx) rather than the village facade's glass view: the matrix to the room's world, and the furniture the
   * village model has baked in (the bake's two tables and their chairs, the counter's three pendants, two more figs) is built too; the
   * facade's round mirror (a probe of the village room) is left out.
   */
  room?: { matrix: Matrix4 };
}

/** All the café's added furniture as geometry in the café's local frame, then moved to the world. */
export function buildCafe(opts: BuildOptions = {}): CafeParts {
  const room = opts.room;
  const f = new MeshBuilder();
  const art = new MeshBuilder();
  const blobs = new MeshBuilder();
  const pools = new MeshBuilder();
  const white: V3 = [1, 1, 1];
  const tables = room ? CAFE_ALL_TABLES : TABLES;

  // --- the entrance's tile mat: 0.26 m cement tiles, charcoal and cream, with a charcoal border
  {
    const { x0, x1, z0, z1 } = TILE_MAT;
    const cell = 0.25;
    const nu = Math.round((x1 - x0) / cell);
    const nv = Math.round((z1 - z0) / cell);
    checkGrid(f, [x0, 0.036, z0], [1, 0, 0], [0, 0, 1], nu, nv, cell, lin("#2F4A3F"), lin("#E6DABF"), [0, 1, 0], MATTE);
  }
  // --- exposed oak beams across the ceiling, with a plaster-white gap between and a darker underside
  if (!room) {
    for (const z of BEAMS_Z) {
      f.box(ROOM.x0, ROOM.x1, ROOM.ceil - 0.28, ROOM.ceil, z - 0.1, z + 0.1, C.beam, WOOD, ["top"]);
    }
  }
  // --- the banquette along the left wall: an oak base, a Kelsch-check seat and back
  {
    const { x0, x1, z0, z1 } = BANQUETTE;
    const xs = x0 + 0.03;
    f.box(xs, x1, 0.0, 0.38, z0, z1, C.oakDark, WOOD, ["bot"]);
    f.box(xs, x1 + 0.01, 0.38, 0.385, z0 - 0.01, z1 + 0.01, C.walnut, WOOD, ["bot"]);
    const cell = 0.078;
    const nu = Math.round((x1 - xs) / cell);
    const nv = Math.round((z1 - z0) / cell);
    f.box(xs, x1, 0.385, 0.46, z0, z1, C.kelschCream, MATTE, ["top", "bot", "xm"]);
    checkGrid(f, [xs, 0.461, z0], [1, 0, 0], [0, 0, 1], nu, nv, (x1 - xs) / nu, C.kelschRed, C.kelschCream, [0, 1, 0], MATTE);
    // the back: a thin padded panel on the wall (3 cm: the sitter's back plane, cafeRoom.ts, stops at its cloth), 0.88 m up (under the windows' sills)
    const bx1 = xs + 0.03;
    f.box(xs, bx1, 0.46, 0.86, z0, z1, C.kelschCream, MATTE, ["xp", "bot", "xm"]);
    checkGrid(f, [bx1 + 0.0005, 0.465, z0], [0, 0, 1], [0, 1, 0], Math.round((z1 - z0) / cell), 5, 0.08, C.kelschRed, C.kelschCream, [1, 0, 0], MATTE);
    f.box(xs, bx1, 0.86, 0.885, z0, z1, C.walnut, WOOD);
  }
  // --- new tables: settings on them; chairs and tables themselves are instances
  for (const [i, t] of TABLES.entries()) tableSetting(f, t.x, t.z, 90 + i);
  for (const [i, x] of [2.9, 5.3].entries()) tableSetting(f, x, 0.3, 190 + i); // the bake's two tables

  // --- pendants over every table
  for (const p of allNewPendants()) pendant(f, p.x, p.z, p.lamp);
  // (in the room the counter's three brass domes are built here too: the village model bakes them)
  if (room) for (const p of BAKED_PENDANTS) pendant(f, p.x, p.z, "dome");

  // --- the counter's top (y 1.07): kougelhopf and a fruit tart on cake stands, pretzels, a stack of cups by the machine
  cakeStand(f, -1.68, -2.05, 1.07, "kougelhopf", 11);
  cakeStand(f, -1.22, -2.05, 1.07, "tart", 12);
  bretzelBowl(f, -5.03, -2.0, 1.07);
  cupStack(f, -3.55, -1.95, 1.07, 4);
  // --- the back bar's top (y 0.94): boules on boards, a baguette basket, tins and herbs (under the shelves' 1.46 underside)
  loaf(f, -4.1, -3.7, 0.94, 0.12, 21);
  loaf(f, -3.45, -3.72, 0.94, 0.13, 22);
  loaf(f, -2.7, -3.7, 0.94, 0.11, 23);
  baguetteBasket(f, 0.62, -3.78, 0.94, 24);
  jar(f, -5.28, -3.75, 0.94, 0.22, 0.07, "#6B4A33");
  jar(f, -5.03, -3.75, 0.94, 0.22, 0.07, "#E4D8B8");
  herb(f, -1.9, -3.78, 0.94, 31);
  herb(f, -1.55, -3.78, 0.94, 32);

  // --- the open shelf unit right of the kitchen door
  {
    const { x0, x1, z0, height } = SHELF_UNIT;
    const zb = z0 + 0.025; // the partition's face is at z0 + 0.025
    const zf = zb + 0.3;
    for (const sx of [x0, x1 - 0.04]) f.box(sx, sx + 0.04, 0, height, zb, zf, C.walnut, WOOD);
    const ys = [0.45, 0.95, 1.45, 1.95];
    for (const y of ys) f.box(x0, x1, y - 0.03, y, zb, zf, C.walnut, WOOD);
    f.box(x0, x1, height - 0.03, height, zb, zf, C.walnut, WOOD);
    const zc = zb + 0.15;
    // bottom shelf (y .45 top): wicker baskets of loaves
    for (const [x, radius] of [[5.85, 0.13], [6.2, 0.14], [6.52, 0.12]] as const) {
      const shelf = ys[0]!;
      const base = radius * 0.77;
      f.lathe(x, zc, [[base, shelf], [base, shelf + 0.01], [radius, shelf + 0.047],
        [radius * 1.025, shelf + 0.052], [radius, shelf + 0.057], [radius * 0.94, shelf + 0.055],
        [base, shelf + 0.012], [0, shelf + 0.012]], C.wicker, MATTE, 20);
      // Willow stakes turn out from the foot into the rolled rim.
      for (let i = 0; i < 20; i++) {
        const a = i * Math.PI / 10;
        f.tube([[x + base * Math.cos(a), shelf + 0.009, zc + base * Math.sin(a)],
          [x + radius * Math.cos(a + 0.12), shelf + 0.049, zc + radius * Math.sin(a + 0.12)]],
        0.0025, C.crustDark, MATTE, 3);
      }
      loaf(f, x, zc, shelf + 0.012, base, 40 + Math.round(x * 10), false);
    }
    // y .95: jars of beans, sugar, flour, tea
    const jars = ["#4A2E20", "#EEE8D8", "#E9DFC2", "#7C5B3A", "#9AA37A", "#4A2E20"];
    for (const [i, c] of jars.entries()) jar(f, 5.62 + i * 0.2, zc, 0.95, 0.18 + (i % 2) * 0.04, 0.065, c);
    // y 1.45: books, a plant and cups
    const bookColours = ["#7A2F35", "#2F5D4A", "#C9A04A", "#3B4F7A", "#8A5A3C"];
    for (const [i, c] of bookColours.entries()) f.box(5.52 + i * 0.045, 5.52 + (i + 1) * 0.045 - 0.004, 1.45, 1.45 + 0.2 + (i % 3) * 0.02, zb + 0.03, zb + 0.24, lin(c), MATTE);
    herb(f, 5.98, zc, 1.45, 51);
    cupStack(f, 6.25, zc, 1.45, 3);
    cupStack(f, 6.45, zc, 1.45, 2);
    // y 1.95: jugs and boules
    f.lathe(5.7, zc, [[0.05, 1.95], [0.07, 2.02], [0.045, 2.1], [0.05, 2.14]], C.cream, POLISH, 8);
    f.lathe(5.9, zc, [[0.06, 1.95], [0.075, 2.03], [0.05, 2.08]], lin("#C97B5A"), POLISH, 8);
    loaf(f, 6.2, zc, 1.95, 0.1, 61);
    loaf(f, 6.5, zc, 1.95, 0.09, 62);
  }

  // --- plants: a kentia palm in the front-left corner, two pothos high up, herbs on the right-hand table
  palm(f, -6.15, 3.3, 2.3, 101);
  hangingPlant(f, 1.55, 2.1, 2.5, 102);
  hangingPlant(f, -3.9, -0.5, 2.45, 103);
  hangingPlant(f, 6.2, 2.9, 2.5, 104);
  fig(f, 6.3, 3.25, 1.5, 105);
  if (room) {
    // the bake's two figs (by the door and by the counter's end)
    fig(f, 1.8, 3.15, 1.5, 106);
    fig(f, -6.3, -1.2, 1.5, 107);
  }

  // --- a round mirror (brass frame) on the front wall's right end and a clock over the kitchen door
  {
    const zf = ROOM.zFront;
    const cx = 6.0;
    const cy = 1.75;
    const ring: V3[] = [];
    const mr = 0.4;
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ring.push([cx + mr * Math.cos(a), cy + mr * Math.sin(a), zf - 0.025]);
    }
    if (!room) f.tube(ring, 0.022, C.brass, BRASS, 5);
    for (let k = 0; k < (room ? 0 : 24); k++) {
      const a0 = (k / 24) * Math.PI * 2;
      const a1 = ((k + 1) / 24) * Math.PI * 2;
      // The mirror shares the art draw. Its fully polished surface samples the captured café in the reflected direction.
      art.tri([cx, cy, zf - 0.02], [cx + mr * Math.cos(a1), cy + mr * Math.sin(a1), zf - 0.02], [cx + mr * Math.cos(a0), cy + mr * Math.sin(a0), zf - 0.02], white, { glow: 0, gloss: 1 }, [0, 0, -1]);
    }
    // the clock
    const kx = 4.6;
    const ky = 2.75;
    const kz = ROOM.zBack + 0.03;
    const cr = 0.2;
    const kr: V3[] = [];
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      kr.push([kx + cr * Math.cos(a), ky + cr * Math.sin(a), kz + 0.02]);
    }
    f.tube(kr, 0.015, C.brass, BRASS, 5);
    for (let k = 0; k < 20; k++) {
      const a0 = (k / 20) * Math.PI * 2;
      const a1 = ((k + 1) / 20) * Math.PI * 2;
      f.tri([kx, ky, kz + 0.015], [kx + cr * Math.cos(a0), ky + cr * Math.sin(a0), kz + 0.015], [kx + cr * Math.cos(a1), ky + cr * Math.sin(a1), kz + 0.015], C.white, MATTE, [0, 0, 1]);
    }
    f.box(kx - 0.006, kx + 0.006, ky, ky + 0.14, kz + 0.02, kz + 0.026, C.black, MATTE);
    f.box(kx, kx + 0.1, ky - 0.006, ky + 0.006, kz + 0.026, kz + 0.032, C.black, MATTE);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      f.box(kx + 0.165 * Math.cos(a) - 0.004, kx + 0.165 * Math.cos(a) + 0.004, ky + 0.165 * Math.sin(a) - 0.004, ky + 0.165 * Math.sin(a) + 0.004, kz + 0.016, kz + 0.02, C.black, MATTE);
    }
  }

  // --- the chalkboard on the right wall (a walnut frame, a slate painted with the menu, a ledge with chalk) and the prints on the left
  {
    const { wall, z0, z1, y0, y1 } = CHALKBOARD;
    const fr = 0.05;
    const t = 0.04;
    f.box(wall - t, wall, y0 - fr, y1 + fr, z0 - fr, z1 + fr, C.walnut, WOOD);
    f.box(wall - t - 0.06, wall - t, y0 - fr - 0.03, y0 - fr, z0 - fr, z1 + fr, C.walnut, WOOD);
    for (const [i, zz] of [z0 + 0.2, z0 + 0.4, z0 + 0.52].entries()) f.box(wall - t - 0.04, wall - t - 0.015, y0 - fr, y0 - fr + 0.012, zz, zz + 0.05 + (i % 2) * 0.01, C.white, MATTE);
    const xf = wall - t - 0.0015;
    const [u0, v0, u1, v1] = ATLAS_REGIONS.board;
    // looking at the right wall from inside (facing +x) the viewer's right is +z
    art.quad([xf, y0, z0], [xf, y0, z1], [xf, y1, z1], [xf, y1, z0], white, MATTE, [-1, 0, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    // The back counter's existing wooden frame encloses a 2.2 × 1.3 m placeholder in village.glb.
    // Keep the lettering just in front of its baked face at z = -4.04, clear of the depth buffer at plaza distance.
    const [left, bottom, right, top] = ATLAS_REGIONS.counterMenu;
    const z = -4.02;
    art.quad([1.3, 1.75, z], [3.5, 1.75, z], [3.5, 3.05, z], [1.3, 3.05, z], white, MATTE, [0, 0, 1],
      [[left, bottom], [right, bottom], [right, top], [left, top]]);
    // the prints on the left wall (viewer's right is -z)
    const L = ROOM.x0;
    const reg = (k: keyof typeof ATLAS_REGIONS) => ATLAS_REGIONS[k];
    frame(art, f, L, 1, -0.45, 1.75, 0.5, 0.65, reg("printCup"));
    frame(art, f, L, 1, -1.15, 1.75, 0.5, 0.65, reg("printTown"));
    frame(art, f, L, 1, -0.8, 2.45, 0.9, 0.3, reg("printWide"));
    frame(art, f, L, 1, 3.15, 1.7, 0.5, 0.65, reg("printKugel"));
    frame(art, f, ROOM.x1, -1, 2.4, 1.7, 0.5, 0.65, reg("printVines"));
  }

  // --- contact shadows (soft, dark) and the warm pools under the pendants
  const dark = lin("#000000");
  for (const t of tables) {
    decal(blobs, t.x, t.z, 0.55, 0.55, 0.04, dark);
    for (const c of tableChairs(t)) decal(blobs, c.x, c.z, 0.34, 0.34, 0.04, dark);
  }
  decal(blobs, BANQUETTE.x0 + 0.33, (BANQUETTE.z0 + BANQUETTE.z1) / 2, 0.55, (BANQUETTE.z1 - BANQUETTE.z0) / 2 + 0.2, 0.04, dark);
  decal(blobs, 6.07, -3.7, 0.9, 0.35, 0.04, dark);
  for (const st of STOOLS) decal(blobs, st.x, st.z, 0.3, 0.3, 0.04, dark);
  if (room) {
    decal(blobs, 1.8, 3.15, 0.45, 0.45, 0.04, dark);
    decal(blobs, -6.3, -1.2, 0.45, 0.45, 0.04, dark);
  }
  decal(blobs, -6.15, 3.3, 0.5, 0.4, 0.04, dark);
  decal(blobs, 6.3, 3.25, 0.45, 0.45, 0.04, dark);
  const warm = lin("#FFB45E");
  for (const p of allNewPendants()) decal(pools, p.x, p.z, 1.15, 1.15, 0.045, warm);

  // --- instances: chairs and tables (merged geometry each, drawn as one instanced mesh)
  const chair = chairGeometry();
  const table = tableGeometry();
  const l2w = localToWorld();
  const l2wFinal = room ? room.matrix : l2w;
  const chairMatrices: Matrix4[] = [];
  const tableMatrices: Matrix4[] = [];
  const stool = stoolGeometry();
  const stoolMatrices: Matrix4[] = [];
  const inst = (x: number, z: number, yaw: number): Matrix4 => {
    const m = new Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    return new Matrix4().multiplyMatrices(l2wFinal, m);
  };
  for (const st of STOOLS) stoolMatrices.push(inst(st.x, st.z, 0));
  for (const t of tables) {
    tableMatrices.push(inst(t.x, t.z, 0));
    for (const c of tableChairs(t)) chairMatrices.push(inst(c.x, c.z, c.yaw));
  }
  // the banquette's tables have one chair on the room side: the chair faces the table (yaw from tableChairs)

  const fixed = f.build();
  const artG = art.build();
  const blobG = blobs.build();
  const poolG = pools.build();
  for (const g of [fixed, artG, blobG, poolG]) g.applyMatrix4(l2wFinal);
    return {
    fixed,
    art: artG,
    chair,
    table,
    chairMatrices,
    tableMatrices,
    stool,
    stoolMatrices,
    blobs: blobG,
    pools: poolG,
    triangles: f.triangles + art.triangles + blobs.triangles + pools.triangles + (chair.attributes.position!.count / 3) * chairMatrices.length + (table.attributes.position!.count / 3) * tableMatrices.length + (stool.attributes.position!.count / 3) * stoolMatrices.length,
  };
}

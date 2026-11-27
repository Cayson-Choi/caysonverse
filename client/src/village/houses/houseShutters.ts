/**
 * Shutters for the houses' side and back windows (third exteriors pass, 2026-11-27). The audit: "back and side walls are much
 * plainer than the fronts" — the Colmar build (colmar_kit.py `shutter_w`) gives shutters only to the front windows and the back's
 * upper floor. A real Alsace house has them on every wall. Here, from the house's own glass (the shell's M_glass panes, one
 * window = one cluster of panes), every side-wall window and every back ground-floor window clear of the LPG cage gets the kit's
 * plain board shutters: two leaves folded back flat 5.5-8.5 cm out from the wall, in the house's shutter paint, a heart cut out
 * near the top, two black strap hinges each. Windows too close to a neighbour, a wall end or the gable top get none.
 *
 * The leaves are LM_wood's painted-board band (glTF v 0.5-1, boards running up the leaf), the hinges LM_metal's iron band
 * (glTF v < 0.5), merged into the house's detail meshes of those materials (no extra draw; shown with the detail only).
 * ~14 triangles per leaf (front, two edges, heart, two hinge straps): ~30 per window.
 *
 * Some windows on every wall have their shutters CLOSED instead (HOUSE_CLOSED_WINDOWS, 2026-11-27): where the room behind the clear
 * glass shows a door or its own window's edge. Their leaves go into the always-drawn shell; the model's open leaves beside them go.
 */
import { BufferAttribute, BufferGeometry, Color } from "three";
import {
  HOUSE_BODY_BACK,
  HOUSE_BODY_FRONT,
  HOUSE_BODY_HALF,
  HOUSES_LPG_MIRRORED,
  HOUSE_LPG,
  houseWorldToLocal,
} from "@caysonverse/shared/village/houseExterior";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";

type House = Pick<SceneryHouse, "id" | "centre" | "doorSide">;

/** colmar_kit.py COLORS[...]["shutter"] (sRGB): each house's shutter paint. */
export const HOUSE_SHUTTER_PAINT: Readonly<Record<string, string>> = Object.freeze({
  house_1: "#4E7A55",
  house_2: "#F2EFE8",
  house_3: "#5D7D96",
  house_4: "#8A3A2E",
  house_5: "#4E6E8E",
  house_6: "#3F6B55",
  house_7: "#F2EFE8",
  house_8: "#B44A3A",
  house_9: "#5D7D96",
  house_10: "#3F6B55",
});
const IRON = "#2A2A2C";

/** The kit's numbers (m): the leaves' depth out from the wall, the wall top (gable windows above it get none). */
const D0 = 0.085;
const D1 = 0.055;
const WALL_TOP = 8.3;
const FIRST_FLOOR = 4.3;
/** A leaf's outer edge stays this far from a wall's end (corner posts, quoins, the downpipes 0.30 in). */
const END_CLEAR = 0.45;

export type WallName = "back" | "left" | "right";
/** Every body wall, the front included (the closed shutters go on any of them). */
export type AnyWall = WallName | "front";

export interface WallWindow<W extends AnyWall = WallName> {
  wall: W;
  /** Along the wall (local: x on the back wall, z on the side walls), and height (m). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** The glass's plane, out from the body's outer face (m; about -0.125 where the wall face is the body's, more on a jettied storey). */
  g?: number;
}

/** The glass sits this far in from its wall's outer face (m). */
export const GLASS_REVEAL = 0.125;

/** A wall's along-range (local). */
function wallSpan(wall: AnyWall): [number, number] {
  return wall === "back" || wall === "front" ? [-HOUSE_BODY_HALF, HOUSE_BODY_HALF] : [HOUSE_BODY_BACK, HOUSE_BODY_FRONT];
}

/** A point on a wall (u along, y up, d out from the outer face) as a local (lx, y, lz). */
function wallPoint(wall: AnyWall, u: number, y: number, d: number): [number, number, number] {
  if (wall === "front") return [u, y, HOUSE_BODY_FRONT + d];
  if (wall === "back") return [u, y, HOUSE_BODY_BACK - d];
  if (wall === "right") return [HOUSE_BODY_HALF + d, y, u];
  return [-HOUSE_BODY_HALF - d, y, u];
}

/**
 * The windows of a house's back and side walls, from its glass (world triangles): the panes near each wall plane, clustered
 * (panes within 0.2 m are one window), as wall rectangles.
 */
export function wallWindows(glass: readonly BufferGeometry[], h: House): WallWindow[] {
  const out = clusterWindows(glass, h, ["back", "left", "right"]);
  // a casement standing ajar adds its swung pane's reach to the cluster: such a window (up to 1.7 m) is the house's usual
  // window width (the commonest, to 5 cm), centred
  const widths = new Map<number, number>();
  for (const w of out) {
    const k = Math.round((w.u1 - w.u0) / 0.05);
    widths.set(k, (widths.get(k) ?? 0) + 1);
  }
  const common = [...widths.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (common) {
    const cw = common[0] * 0.05;
    for (const w of out) {
      const width = w.u1 - w.u0;
      if (width > cw + 0.1 && width <= 1.7 && w.v1 - w.v0 <= 2.2) {
        const c = (w.u0 + w.u1) / 2;
        const real = out.find((o) => o !== w && Math.abs(o.u1 - o.u0 - cw) < 0.05);
        const half = real ? (real.u1 - real.u0) / 2 : cw / 2;
        w.u0 = c - half;
        w.u1 = c + half;
      }
    }
  }
  return out.sort((a, b) => a.wall.localeCompare(b.wall) || a.v0 - b.v0 || a.u0 - b.u0);
}

/** The panes near the given walls' planes, clustered into windows (panes within 0.2 m are one window), as wall rectangles. */
export function clusterWindows<W extends AnyWall>(glass: readonly BufferGeometry[], h: House, walls: readonly W[]): WallWindow<W>[] {
  const rects: WallWindow<W>[] = [];
  for (const g of glass) {
    const p = g.getAttribute("position");
    const idx = g.index;
    const count = idx ? idx.count : p.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const pts: Array<{ lx: number; y: number; lz: number }> = [];
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k;
        const l = houseWorldToLocal(h, p.getX(i), p.getZ(i));
        pts.push({ lx: l.lx, y: p.getY(i), lz: l.lz });
      }
      const lxs = pts.map((q) => q.lx);
      const lzs = pts.map((q) => q.lz);
      const ys = pts.map((q) => q.y);
      const flatX = Math.max(...lxs) - Math.min(...lxs) < 0.02;
      const flatZ = Math.max(...lzs) - Math.min(...lzs) < 0.02;
      let wall: AnyWall | null = null;
      if (flatZ && Math.abs(lzs[0]! - HOUSE_BODY_BACK) < 0.45) wall = "back";
      else if (flatZ && Math.abs(lzs[0]! - HOUSE_BODY_FRONT) < 0.45) wall = "front";
      else if (flatX && Math.abs(lxs[0]! - HOUSE_BODY_HALF) < 0.45) wall = "right";
      else if (flatX && Math.abs(lxs[0]! + HOUSE_BODY_HALF) < 0.45) wall = "left";
      if (!wall || !(walls as readonly AnyWall[]).includes(wall)) continue;
      const us = wall === "back" || wall === "front" ? lxs : lzs;
      const g = wall === "front" ? lzs[0]! - HOUSE_BODY_FRONT : wall === "back" ? HOUSE_BODY_BACK - lzs[0]! : wall === "right" ? lxs[0]! - HOUSE_BODY_HALF : -HOUSE_BODY_HALF - lxs[0]!;
      rects.push({ wall: wall as W, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...ys), v1: Math.max(...ys), g });
    }
  }
  // merge the panes into windows
  const out: WallWindow<W>[] = [];
  const pending = [...rects];
  while (pending.length) {
    const w = { ...pending.pop()! };
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const r = pending[i]!;
        if (r.wall !== w.wall || r.u0 > w.u1 + 0.2 || r.u1 < w.u0 - 0.2 || r.v0 > w.v1 + 0.2 || r.v1 < w.v0 - 0.2) continue;
        w.u0 = Math.min(w.u0, r.u0);
        w.u1 = Math.max(w.u1, r.u1);
        w.v0 = Math.min(w.v0, r.v0);
        w.v1 = Math.max(w.v1, r.v1);
        w.g = Math.max(w.g ?? -1, r.g ?? -1);
        pending.splice(i, 1);
        grew = true;
      }
    }
    out.push(w);
  }
  return out;
}

/** The kit's leaf width for a window (w / 2 + 2 cm), or 0 where shutters do not fit or are not wanted. */
export function shutterWidth(w: WallWindow, all: readonly WallWindow[], h: Pick<SceneryHouse, "id">): number {
  const width = w.u1 - w.u0;
  if (width > 1.5 || w.v1 - w.v0 > 2.2 || w.v1 > WALL_TOP) return 0;
  const sw = width / 2 + 0.02;
  const [lo, hi] = wallSpan(w.wall);
  if (w.u0 - sw < lo + END_CLEAR || w.u1 + sw > hi - END_CLEAR) return 0;
  for (const o of all) {
    if (o === w || o.wall !== w.wall || o.v1 < w.v0 - 0.1 || o.v0 > w.v1 + 0.1) continue;
    const gap = o.u0 >= w.u1 ? o.u0 - w.u1 : w.u0 - o.u1;
    if (gap < 2 * sw + 0.06) return 0;
  }
  if (w.wall === "back") {
    // the back's upper floor has the kit's own shutters; its ground floor keeps clear of the LPG cage and the meters by it
    if (w.v0 > FIRST_FLOOR) return 0;
    const m = HOUSES_LPG_MIRRORED.includes(h.id);
    const x0 = m ? -HOUSE_LPG.x1 : HOUSE_LPG.x0;
    const x1 = m ? -HOUSE_LPG.x0 : HOUSE_LPG.x1;
    if (w.u1 + sw > x0 - 0.6 && w.u0 - sw < x1 + 0.6) return 0;
  }
  return sw;
}

const lin = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

interface Builder {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
}
const builder = (): Builder => ({ pos: [], nor: [], uv: [], col: [] });

/** A polygon (local points, a quad or a triangle) facing `n` (local; wound to face it), with its UVs and colour, into world. */
function poly(b: Builder, h: House, pts: Array<[number, number, number]>, n: [number, number, number], uvs: Array<[number, number]>, c: [number, number, number]): void {
  const [p0, p1, p2] = pts as [[number, number, number], [number, number, number], [number, number, number]];
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const keep = cr[0]! * n[0] + cr[1]! * n[1] + cr[2]! * n[2] >= 0;
  const idx = pts.length === 4 ? (keep ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) : keep ? [0, 1, 2] : [0, 2, 1];
  const nw = houseDirToWorld(h, n);
  for (const i of idx) {
    const [lx, y, lz] = pts[i]!;
    const w = houseLocalToWorldExact(h, lx, lz);
    b.pos.push(w.x, y, w.z);
    b.nor.push(...nw);
    b.uv.push(...uvs[i]!);
    b.col.push(...c);
  }
}

/** houseLocalToWorld without its centimetre rounding (that rounding is the colliders'). */
function houseLocalToWorldExact(h: House, lx: number, lz: number): { x: number; z: number } {
  const { x: cx, z: cz } = h.centre;
  switch (h.doorSide) {
    case "s": return { x: cx + lx, z: cz + lz };
    case "n": return { x: cx - lx, z: cz - lz };
    case "e": return { x: cx + lz, z: cz - lx };
    case "w": return { x: cx - lz, z: cz + lx };
  }
}

function houseDirToWorld(h: House, n: [number, number, number]): [number, number, number] {
  const o = houseLocalToWorldExact(h, 0, 0);
  const p = houseLocalToWorldExact(h, n[0], n[2]);
  return [p.x - o.x, n[1], p.z - o.z];
}

/** A wall's outward normal and its along axis (local). */
function wallOut(wall: AnyWall): [number, number, number] {
  return wall === "front" ? [0, 0, 1] : wall === "back" ? [0, 0, -1] : wall === "right" ? [1, 0, 0] : [-1, 0, 0];
}
function wallAlong(wall: AnyWall): [number, number, number] {
  return wall === "back" || wall === "front" ? [1, 0, 0] : [0, 0, 1];
}

/** One leaf from a to b along the wall (a < b), bottom to top; `side` -1 left of the window (along the wall), +1 right. */
function leaf(wood: Builder, metal: Builder, h: House, w: AnyWall, a: number, b: number, bottom: number, top: number, side: -1 | 1, paint: [number, number, number]): void {
  const out = wallOut(w);
  const al = wallAlong(w);
  const P = (u: number, y: number, d: number) => wallPoint(w, u, y, d);
  // the painted-board band: boards up the leaf (U along y), the leaf's width across the band (V 0.5-1)
  const U = (y: number) => y / 1.13;
  const span = Math.max(0.565, b - a);
  const V = (u: number) => 0.5 + (0.495 * (u - a)) / span;
  poly(wood, h, [P(a, bottom, D0), P(b, bottom, D0), P(b, top, D0), P(a, top, D0)], out, [[U(bottom), V(a)], [U(bottom), V(b)], [U(top), V(b)], [U(top), V(a)]], paint);
  // the two edges (the boards' thickness)
  const edge = paint.map((c) => c * 0.82) as [number, number, number];
  for (const [u, s] of [[a, -1], [b, 1]] as const) {
    const n: [number, number, number] = [al[0] * s, 0, al[2] * s];
    poly(wood, h, [P(u, bottom, D1), P(u, bottom, D0), P(u, top, D0), P(u, top, D1)], n, [[U(bottom), V(u)], [U(bottom), V(u)], [U(top), V(u)], [U(top), V(u)]], edge);
  }
  // the heart cut out near the top (dark: the wall's shadow seen through it), 1 mm proud of the face
  const cu = (a + b) / 2;
  const cy = top - 0.32;
  const dark = paint.map((c) => c * 0.12) as [number, number, number];
  const heart: Array<[number, number]> = [[cu, cy - 0.07], [cu + 0.06, cy + 0.01], [cu + 0.035, cy + 0.06], [cu, cy + 0.03], [cu - 0.035, cy + 0.06], [cu - 0.06, cy + 0.01]];
  const hv = (k: number): [number, number, number] => P(heart[k]![0], heart[k]![1], D0 + 0.001);
  for (const [i, j, k] of [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]] as const) poly(wood, h, [hv(i), hv(j), hv(k)], out, [[U(cy), V(cu)], [U(cy), V(cu)], [U(cy), V(cu)]], dark);
  // two strap hinges from the hinge side (the window's side) across the leaf
  const iron = lin(IRON);
  for (const yy of [bottom + 0.19, top - 0.19]) {
    const [ha, hb] = side < 0 ? [b - 0.34, b - 0.01] : [a + 0.01, a + 0.34];
    poly(metal, h, [P(ha, yy - 0.018, D0 + 0.004), P(hb, yy - 0.018, D0 + 0.004), P(hb, yy + 0.018, D0 + 0.004), P(ha, yy + 0.018, D0 + 0.004)], out, [[0.1, 0.1], [0.3, 0.1], [0.3, 0.12], [0.1, 0.12]], iron);
  }
}

/** The shutters of one house (world geometry: the painted leaves and the iron hinges), or empty builders when none fit. */
export function houseShutterParts(glass: readonly BufferGeometry[], h: House): { wood: Builder; metal: Builder; windows: number } {
  const wood = builder();
  const metal = builder();
  const paint = lin(HOUSE_SHUTTER_PAINT[h.id] ?? "#4E7A55");
  const wins = wallWindows(glass, h);
  const closed = closedWindowRects(glass, h);
  let n = 0;
  for (const w of wins) {
    const sw = shutterWidth(w, wins, h);
    if (sw <= 0) continue;
    // a window whose shutters are closed (HOUSE_CLOSED_WINDOWS) gets no open leaves beside it
    if (closed.some((c) => c.wall === w.wall && c.u0 < w.u1 && c.u1 > w.u0 && c.v0 < w.v1 && c.v1 > w.v0)) continue;
    const bottom = w.v0 - 0.01;
    const top = w.v1 + 0.01;
    leaf(wood, metal, h, w.wall, w.u0 - sw, w.u0 - 0.01, bottom, top, -1, paint);
    leaf(wood, metal, h, w.wall, w.u1 + 0.01, w.u1 + sw, bottom, top, 1, paint);
    n++;
  }
  return { wood, metal, windows: n };
}

// ───────────────────────────────────────── closed shutters ─────────────────────────────────────────

/**
 * Why a window's shutters are closed: an interior door or opening stands behind its glass ("door"), or the room's own window is
 * off to one side of it ("jamb": its edge and the dark slot beside it showed through the clear glass as a pale panel).
 */
export type ClosedReason = "door" | "jamb";
/** One closed window: its wall, floor, centre along the wall in the INTERIOR frame (x on the front / back, z on the sides), why. */
export type ClosedWindow = readonly [wall: AnyWall, floor: 1 | 2, at: number, why: ClosedReason];

/**
 * The windows whose shutters are shut (2026-11-27, owner: the clear glass showed the back of an interior door casing as a strange
 * blue-white panel). Behind these panes the house's own room (house_N.glb, drawn by HouseShowcase) shows something no window looks
 * onto: a door, or the edge of the room's window, which sits elsewhere in the wall (the rooms keep the cottage's window places, the
 * shells have the Colmar ones), and the dark slot beside it. Recomputed from both models by houseWindowViews.test.ts: a window is
 * listed when straight looks through it meet an interior door or opening at knee height, or meet the room's own window opening over
 * 10-75 % of its width. Windows that look onto the room's plain wall (an even lit plaster, like a drawn blind) or mostly into the
 * room stay open.
 */
export const HOUSE_CLOSED_WINDOWS: Readonly<Record<string, readonly ClosedWindow[]>> = Object.freeze({
  house_1: [["back", 1, 2.7, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 5.3, "door"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_2: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_3: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 5.3, "door"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"]],
  house_4: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 5.3, "door"], ["front", 2, 8.6, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_5: [["front", 2, 2.0, "jamb"], ["front", 2, 5.3, "door"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_6: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"]],
  house_7: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_8: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_9: [["back", 1, 5.3, "door"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "door"], ["left", 2, 2.35, "door"], ["left", 2, 5.15, "jamb"], ["right", 1, 5.15, "jamb"], ["right", 2, 5.15, "jamb"]],
  house_10: [["back", 1, 7.9, "jamb"], ["back", 2, 7.9, "jamb"], ["front", 1, 2.0, "jamb"], ["front", 1, 8.6, "jamb"], ["front", 2, 2.0, "jamb"], ["front", 2, 8.6, "jamb"], ["left", 1, 5.15, "jamb"], ["left", 2, 5.15, "jamb"]],
});

/** The interior frame (exteriorWindows.ts): x = lx + 5.3 on the front / back, z = 2.825 - lz on the sides. */
const IN_HALF = HOUSE_BODY_HALF - 0.3;
const IN_FRONT = HOUSE_BODY_FRONT - 0.3;
/** A window's centre along its wall in the interior frame. */
export function windowAt(w: Pick<WallWindow<AnyWall>, "wall" | "u0" | "u1">): number {
  const c = (w.u0 + w.u1) / 2;
  return w.wall === "front" || w.wall === "back" ? c + IN_HALF : IN_FRONT - c;
}
/** A window's floor from its glass bottom (floors 4.0 m apart above the 0.3 m lift; 3 = the gable). */
export function windowFloor(w: Pick<WallWindow<AnyWall>, "v0">): 1 | 2 | 3 {
  return w.v0 < 3.8 ? 1 : w.v0 < 7.8 ? 2 : 3;
}

/**
 * A house's closed windows as wall rectangles of their glass: the listed centre, the glass's height, and its width without an ajar
 * casement's swung pane (the narrowest width of the house's windows of the same height, when that is narrower).
 */
export function closedWindowRects(glass: readonly BufferGeometry[], h: House): WallWindow<AnyWall>[] {
  const list = HOUSE_CLOSED_WINDOWS[h.id];
  if (!list?.length) return [];
  const all = clusterWindows(glass, h, ["front", "back", "left", "right"]);
  const out: WallWindow<AnyWall>[] = [];
  for (const [wall, floor, at] of list) {
    const w = all.find((o) => o.wall === wall && windowFloor(o) === floor && Math.abs(windowAt(o) - at) < 0.35 && o.v1 - o.v0 > 0.8);
    if (!w) continue;
    // centred on the listed place; a cluster off centre carries an ajar casement's swung pane: the near side gives the half width
    const c = wall === "front" || wall === "back" ? at - IN_HALF : IN_FRONT - at;
    const half = Math.abs((w.u0 + w.u1) / 2 - c) < 0.05 ? (w.u1 - w.u0) / 2 : Math.min(c - w.u0, w.u1 - c);
    out.push({ wall, u0: c - half, u1: c + half, v0: w.v0, v1: w.v1, g: w.g ?? -GLASS_REVEAL });
  }
  return out;
}

/** A closed shutter's reach beyond the glass (m): over the casement frame to the reveal's edge; the leaves' gap at the meeting stiles. */
export const CLOSED_OVER = Object.freeze({ side: 0.05, top: 0.04, bottom: 0.03, gap: 0.004 });

/**
 * The closed shutters of one house (world geometry, all in the painted LM_wood: the leaves, their edges, the hearts, and the iron
 * strap hinges and latch as dark-painted wood, as the shell has no metal mesh): two leaves meeting in the middle over the glass, in
 * the house's shutter paint, for the always-drawn shell (the rooms behind the glass are drawn beyond the detail's range).
 * ~34 triangles a window.
 */
export function closedShutterParts(glass: readonly BufferGeometry[], h: House): { wood: Builder; windows: WallWindow<AnyWall>[] } {
  const wood = builder();
  const paint = lin(HOUSE_SHUTTER_PAINT[h.id] ?? "#4E7A55");
  const edge = paint.map((c) => c * 0.82) as [number, number, number];
  const dark = paint.map((c) => c * 0.12) as [number, number, number];
  const iron = lin(IRON);
  const rects = closedWindowRects(glass, h);
  for (const w of rects) {
    const a = w.u0 - CLOSED_OVER.side;
    const b = w.u1 + CLOSED_OVER.side;
    const bottom = w.v0 - CLOSED_OVER.bottom;
    const top = w.v1 + CLOSED_OVER.top;
    const mid = (a + b) / 2;
    const out = wallOut(w.wall);
    const al = wallAlong(w.wall);
    // out from the window's own wall face (a jettied upper storey stands proud of the body)
    const face = (w.g ?? -GLASS_REVEAL) + GLASS_REVEAL;
    const P = (u: number, y: number, d: number) => wallPoint(w.wall, u, y, face + d);
    const U = (y: number) => y / 1.13;
    for (const [la, lb, hingeLeft] of [[a, mid - CLOSED_OVER.gap, true], [mid + CLOSED_OVER.gap, b, false]] as const) {
      const span = Math.max(0.565, lb - la);
      const V = (u: number) => 0.5 + (0.495 * (u - la)) / span;
      poly(wood, h, [P(la, bottom, D0), P(lb, bottom, D0), P(lb, top, D0), P(la, top, D0)], out, [[U(bottom), V(la)], [U(bottom), V(lb)], [U(top), V(lb)], [U(top), V(la)]], paint);
      // the boards' thickness: both stiles, the top and the bottom
      for (const [u, sgn] of [[la, -1], [lb, 1]] as const) {
        const n: [number, number, number] = [al[0] * sgn, 0, al[2] * sgn];
        poly(wood, h, [P(u, bottom, D1), P(u, bottom, D0), P(u, top, D0), P(u, top, D1)], n, [[U(bottom), V(u)], [U(bottom), V(u)], [U(top), V(u)], [U(top), V(u)]], edge);
      }
      for (const [y, sgn] of [[bottom, -1], [top, 1]] as const)
        poly(wood, h, [P(la, y, D1), P(lb, y, D1), P(lb, y, D0), P(la, y, D0)], [0, sgn, 0], [[U(y), V(la)], [U(y), V(lb)], [U(y), V(lb)], [U(y), V(la)]], edge);
      // the heart cut out near the top (dark: the shut window behind it)
      const cu = (la + lb) / 2;
      const cy = top - 0.32;
      const heart: Array<[number, number]> = [[cu, cy - 0.07], [cu + 0.06, cy + 0.01], [cu + 0.035, cy + 0.06], [cu, cy + 0.03], [cu - 0.035, cy + 0.06], [cu - 0.06, cy + 0.01]];
      const hv = (k: number): [number, number, number] => P(heart[k]![0], heart[k]![1], D0 + 0.001);
      for (const [i, j, k] of [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]] as const) poly(wood, h, [hv(i), hv(j), hv(k)], out, [[U(cy), V(cu)], [U(cy), V(cu)], [U(cy), V(cu)]], dark);
      // two strap hinges from the hinge side (the leaf's outer edge) across the leaf
      const [ha, hb] = hingeLeft ? [la + 0.01, la + 0.34] : [lb - 0.34, lb - 0.01];
      for (const yy of [bottom + 0.19, top - 0.19])
        poly(wood, h, [P(ha, yy - 0.018, D0 + 0.004), P(hb, yy - 0.018, D0 + 0.004), P(hb, yy + 0.018, D0 + 0.004), P(ha, yy + 0.018, D0 + 0.004)], out, [[U(yy), 0.52], [U(yy), 0.52], [U(yy), 0.52], [U(yy), 0.52]], iron);
    }
    // the latch bar across the meeting stiles, at mid height
    const ly = (bottom + top) / 2;
    poly(wood, h, [P(mid - 0.07, ly - 0.012, D0 + 0.006), P(mid + 0.07, ly - 0.012, D0 + 0.006), P(mid + 0.07, ly + 0.012, D0 + 0.006), P(mid - 0.07, ly + 0.012, D0 + 0.006)], out, [[U(ly), 0.52], [U(ly), 0.52], [U(ly), 0.52], [U(ly), 0.52]], iron);
  }
  return { wood, windows: rects };
}

/**
 * Whether a world point is on one of a closed window's OPEN kit leaves (the model's own shutters folded back beside the front
 * windows and the back's upper ones: painted boards or louvres and their hinges 4.5-12 cm out from the window's wall face, beside
 * the glass). Those come out
 * of the detail where the window's shutters are shut.
 */
export function onOpenLeafOfClosed(h: House, rects: readonly WallWindow<AnyWall>[], x: number, y: number, z: number): boolean {
  const { lx, lz } = houseWorldToLocal(h, x, z);
  for (const w of rects) {
    // the kit's leaves are on the front and the back's upper floor only (the side and back ground-floor ones are ours)
    if (w.wall === "left" || w.wall === "right" || (w.wall === "back" && w.v0 < FIRST_FLOOR)) continue;
    const u = w.wall === "front" || w.wall === "back" ? lx : lz;
    const d = w.wall === "front" ? lz - HOUSE_BODY_FRONT : w.wall === "back" ? HOUSE_BODY_BACK - lz : w.wall === "right" ? lx - HOUSE_BODY_HALF : -HOUSE_BODY_HALF - lx;
    const reach = (w.u1 - w.u0) / 2 + 0.27;
    const rel = d - ((w.g ?? -GLASS_REVEAL) + GLASS_REVEAL);
    if (rel < 0.045 || rel > 0.12 || y < w.v0 - 0.15 || y > w.v1 + 0.15) continue;
    if ((u > w.u0 - reach && u < w.u0 - 0.005) || (u > w.u1 + 0.005 && u < w.u1 + reach)) return true;
  }
  return false;
}

/** A builder as a geometry with a template's attribute set (others zero; colour alpha 1), indexed. */
export function builderGeometry(b: Builder, tpl: BufferGeometry): BufferGeometry | null {
  const n = b.pos.length / 3;
  if (n === 0) return null;
  const g = new BufferGeometry();
  for (const name of Object.keys(tpl.attributes)) {
    const t = tpl.getAttribute(name) as BufferAttribute;
    const out = new BufferAttribute(new (t.array.constructor as new (n: number) => Float32Array)(n * t.itemSize), t.itemSize, t.normalized);
    const src = name === "position" ? b.pos : name === "normal" ? b.nor : name === "uv" ? b.uv : name === "color" ? b.col : null;
    const w = name === "color" ? 3 : t.itemSize;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < t.itemSize; k++) out.setComponent(i, k, src && k < w ? src[i * w + k]! : name === "color" ? 1 : 0);
    g.setAttribute(name, out);
  }
  if (tpl.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

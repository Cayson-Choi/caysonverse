/**
 * The exterior window table (집 외관 A8, design 3.5): where every window and door of the ten houses is, in the INTERIOR's local
 * frame, so the inside (houses interior contract, feat/houses-g houseAreas.ts) puts its openings exactly where the outside has
 * them. With the A plan the body is the interior plus its 0.30 m walls, so the mapping is 1:1 (`EXTERIOR_BODY_A8`).
 *
 * The file: shared/src/village/generated/exterior_windows.json. The house build (art/village/tools/build_houses.py, X4) writes
 * it from the openings it really cut (`source: "build"`); until then it holds the design table (`source: "design"`,
 * scripts/export-exterior-windows.ts). Either way every opening must match the design table within 2 cm (8 A7,
 * exteriorWindows.test.ts) — the interior builders can rely on the design numbers today.
 *
 * Interior local frame (houses interior contract 2.4): x 0..10.6 from the visitor's left to right as they come in, z 0..7.8
 * from the front wall's inner face to the back's, y up from the ground floor's floor (the exterior's floorLift above the lawn).
 */

import table from "./generated/exterior_windows.json";
import { HOUSE_A8, HOUSE_BODY_BACK, HOUSE_BODY_FRONT, HOUSE_BODY_HALF } from "./houseExterior";

export const EXTERIOR_WINDOWS_FORMAT = "caysonverse-exterior-windows";
export const EXTERIOR_WINDOWS_VERSION = 1;

/** Interior room (m): the body's inner faces. */
export const INTERIOR_ROOM = Object.freeze({ width: 10.6, depth: 7.8, storey: 4.0 });

/** The wall an opening is in: front (z 0, the door's), back (z 7.8), left (x 0), right (x 10.6). */
export type WindowWall = "front" | "back" | "left" | "right";
export type OpeningKind = "window" | "patio" | "door";

export interface ExteriorOpening {
  wall: WindowWall;
  floor: 1 | 2;
  kind: OpeningKind;
  /** Centre along the wall: interior x on the front / back walls, interior z on the side walls (m). */
  at: number;
  width: number;
  height: number;
  /** Bottom of the opening above the ground floor's floor (m; floor 2 openings include the 4.0 m storey). */
  sill: number;
}

export interface ExteriorWindowTable {
  format: typeof EXTERIOR_WINDOWS_FORMAT;
  version: typeof EXTERIOR_WINDOWS_VERSION;
  /** "design" (design 3.5, written by scripts/export-exterior-windows.ts) or "build" (written by the house build). */
  source: "design" | "build";
  houses: Record<string, ExteriorOpening[]>;
}

/** The body as the interior contract's `exteriorToLocal` takes it — the INNER wall faces, so its proportional map is 1:1. */
export const EXTERIOR_BODY_A8 = Object.freeze({
  halfWidth: Math.round((HOUSE_BODY_HALF - HOUSE_A8.wallThickness) * 1000) / 1000, // 5.3
  back: Math.round((HOUSE_BODY_BACK + HOUSE_A8.wallThickness) * 1000) / 1000, // -4.975
  front: Math.round((HOUSE_BODY_FRONT - HOUSE_A8.wallThickness) * 1000) / 1000, // 2.825
});

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** An exterior local point (houseExterior.ts frame: origin the footprint's centre, z out of the door) in the interior frame. */
export function exteriorLocalToInterior(lx: number, lz: number): { x: number; z: number } {
  return { x: r3(lx + EXTERIOR_BODY_A8.halfWidth), z: r3(EXTERIOR_BODY_A8.front - lz) };
}

/** An interior point in the exterior local frame (the inverse). */
export function interiorToExteriorLocal(x: number, z: number): { lx: number; lz: number } {
  return { lx: r3(x - EXTERIOR_BODY_A8.halfWidth), lz: r3(EXTERIOR_BODY_A8.front - z) };
}

/**
 * The opening's centre on the OUTER wall face, in the exterior local frame, and its height above the lawn — what the kit cuts
 * (X1) and what the build checks against its mesh.
 */
export function openingOnExterior(o: ExteriorOpening): { lx: number; lz: number; yBottom: number; normal: "+z" | "-z" | "+x" | "-x" } {
  const t = HOUSE_A8.wallThickness;
  const yBottom = r3(o.sill + HOUSE_A8.floorLift);
  switch (o.wall) {
    case "front": return { ...interiorToExteriorLocal(o.at, -t), yBottom, normal: "+z" };
    case "back": return { ...interiorToExteriorLocal(o.at, INTERIOR_ROOM.depth + t), yBottom, normal: "-z" };
    case "left": return { ...interiorToExteriorLocal(-t, o.at), yBottom, normal: "-x" };
    case "right": return { ...interiorToExteriorLocal(INTERIOR_ROOM.width + t, o.at), yBottom, normal: "+x" };
  }
}

const W = (wall: WindowWall, floor: 1 | 2, at: number, width = 1.4, height = 2.0, kind: OpeningKind = "window"): ExteriorOpening => ({
  wall,
  floor,
  kind,
  at,
  width,
  height,
  sill: floor === 1 ? (kind === "window" ? 0.9 : 0) : r3(INTERIOR_ROOM.storey + (kind === "window" ? 0.9 : 0.1)),
});

/** Design 3.5 for one house: the common set, house 3's upper patio door and house 9's ground-floor back patio window. */
function designOpenings(id: string): ExteriorOpening[] {
  const out: ExteriorOpening[] = [
    { wall: "front", floor: 1, kind: "door", at: 5.3, width: 2 * HOUSE_A8.doorHalfWidth, height: HOUSE_A8.doorHeight, sill: 0 },
    W("front", 1, 2.0),
    W("front", 1, 8.6),
    W("front", 2, 2.0),
    id === "house_3" ? W("front", 2, 5.3, 2.2, 2.6, "patio") : W("front", 2, 5.3),
    W("front", 2, 8.6),
  ];
  if (id === "house_9") out.push(W("back", 1, 5.3, 2.7, 2.4, "patio"));
  else out.push(W("back", 1, 2.7), W("back", 1, 7.9));
  out.push(W("back", 2, 2.7), W("back", 2, 7.9));
  for (const wall of ["left", "right"] as const) out.push(W(wall, 1, 2.35), W(wall, 1, 5.15, 1.8), W(wall, 2, 2.35), W(wall, 2, 5.15));
  return out;
}

/** The ten houses' design table (design 3.5), the reference every written table is held to. */
export function designExteriorWindowTable(): ExteriorWindowTable {
  const houses: Record<string, ExteriorOpening[]> = {};
  for (let n = 1; n <= 10; n++) houses[`house_${n}`] = designOpenings(`house_${n}`);
  return { format: EXTERIOR_WINDOWS_FORMAT, version: EXTERIOR_WINDOWS_VERSION, source: "design", houses };
}

const WALLS: readonly WindowWall[] = ["front", "back", "left", "right"];
const KINDS: readonly OpeningKind[] = ["window", "patio", "door"];

function fail(msg: string): never {
  throw new Error(`exterior_windows.json: ${msg}`);
}

/**
 * Read a window table (the JSON the build writes) and check it: format and version, ten houses `house_1..10`, every opening on a
 * known wall and floor, inside its wall (with a 0.3 m margin from the corners), above the floor and under the storey's top, and
 * exactly one door per house in the front wall. Throws on anything else.
 */
export function parseExteriorWindowTable(raw: unknown): ExteriorWindowTable {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const t = raw as Record<string, unknown>;
  if (t.format !== EXTERIOR_WINDOWS_FORMAT) fail(`format ${String(t.format)}`);
  if (t.version !== EXTERIOR_WINDOWS_VERSION) fail(`version ${String(t.version)}`);
  if (t.source !== "design" && t.source !== "build") fail(`source ${String(t.source)}`);
  const hs = t.houses as Record<string, unknown> | undefined;
  if (typeof hs !== "object" || hs === null) fail("no houses");
  const ids = Object.keys(hs).sort();
  const want = Array.from({ length: 10 }, (_, i) => `house_${i + 1}`).sort();
  if (JSON.stringify(ids) !== JSON.stringify(want)) fail(`houses ${ids.join(",")}`);
  const houses: Record<string, ExteriorOpening[]> = {};
  for (const id of want) {
    const list = hs[id];
    if (!Array.isArray(list)) fail(`${id}: not a list`);
    houses[id] = list.map((o: unknown, i: number): ExteriorOpening => {
      const w = o as Record<string, unknown>;
      const where = `${id}[${i}]`;
      if (!WALLS.includes(w.wall as WindowWall)) fail(`${where}: wall ${String(w.wall)}`);
      if (w.floor !== 1 && w.floor !== 2) fail(`${where}: floor ${String(w.floor)}`);
      if (!KINDS.includes(w.kind as OpeningKind)) fail(`${where}: kind ${String(w.kind)}`);
      for (const k of ["at", "width", "height", "sill"] as const) if (typeof w[k] !== "number" || !Number.isFinite(w[k])) fail(`${where}: ${k}`);
      const op = w as unknown as ExteriorOpening;
      const len = op.wall === "front" || op.wall === "back" ? INTERIOR_ROOM.width : INTERIOR_ROOM.depth;
      if (op.width <= 0 || op.height <= 0) fail(`${where}: size`);
      if (op.at - op.width / 2 < 0.3 - 1e-9 || op.at + op.width / 2 > len - 0.3 + 1e-9) fail(`${where}: outside its wall`);
      const base = (op.floor - 1) * INTERIOR_ROOM.storey;
      if (op.sill < base - 1e-9 || op.sill + op.height > base + INTERIOR_ROOM.storey - 0.3 + 1e-9) fail(`${where}: outside its storey`);
      return { wall: op.wall, floor: op.floor, kind: op.kind, at: op.at, width: op.width, height: op.height, sill: op.sill };
    });
    const doors = houses[id]!.filter((o) => o.kind === "door");
    if (doors.length !== 1 || doors[0]!.wall !== "front" || doors[0]!.floor !== 1) fail(`${id}: one front door on floor 1`);
  }
  return { format: EXTERIOR_WINDOWS_FORMAT, version: EXTERIOR_WINDOWS_VERSION, source: t.source, houses };
}

let cached: ExteriorWindowTable | null = null;

/** The table in the repository (generated/exterior_windows.json), checked on first use (a bad file throws then). */
export function exteriorWindowTable(): ExteriorWindowTable {
  return (cached ??= parseExteriorWindowTable(table));
}

/** One house's openings (interior frame). */
export function exteriorWindowsOf(houseId: string, t: ExteriorWindowTable = exteriorWindowTable()): readonly ExteriorOpening[] {
  const list = t.houses[houseId];
  if (!list) throw new Error(`no exterior windows for ${houseId}`);
  return list;
}

/** The 8 A7 tolerance: a written opening may differ from the design's by this much on every number (m). */
export const WINDOW_TOLERANCE = 0.02;

/**
 * 집 실내 2~4단계의 약속(P0, 2026-11-16) — the shared CONTRACT of the ten house interiors, as code. Every chunk builds against
 * these numbers and names and nothing else: K (the furniture kit), HA / HB (houses 1–5 / 6–10 art), F (the floor-sit pose) and
 * G (the game integration). The human-readable version is docs/designs/houses-interior/contract.md; the Blender side reads the
 * same values from docs/designs/houses-interior/contract.json (written by `npx tsx scripts/export-house-contract.ts`, and a
 * unit test keeps the committed file equal to this module).
 *
 * Owner decisions (2026-11-16, "추천대로 해" to all ten questions of design.md ch. 10): anyone who knows the code may enter, at most
 * 8 people per house (both floors together); chat is heard on both floors of the same house; floor seats get a new cross-legged
 * pose (chunk F); beds are sat on at the edge only; floor cushions face the table only; windows show a real village panorama;
 * the ten themes as designed; the bathroom is a closed door only; the code is entered again on every entry; furniture too small
 * for the avatar is not sittable (no seat marker at all).
 *
 * COORDINATES. One coordinate space for the whole server (like the memorial hall at x 300). Each house floor is its own
 * walkable rectangle at y = 0, far east of everything else:
 *   - LOCAL (the design's room frame): origin at the inner corner of the entrance wall on the visitor's LEFT as they come in;
 *     x 0..10.6 left → right as seen coming in, z 0..7.8 from the entrance wall to the back wall. The front door is at
 *     x 4.4..6.2 on z = 0. "Facing into the room" is local +z.
 *   - WORLD: house N, floor F → origin (360 + 24 (N − 1), 0) for floor 1 and (same x, 30) for floor 2;
 *     world x = originX + local x, world z = originZ − local z. A visitor coming in faces world −z (north), so the visitor's
 *     right is world +x (east) — the same handedness as the mock-ups (mockup_rooms.py: door on the south wall).
 *     The z flip makes local→world a MIRROR, so a yaw converts as worldYaw = π − localYaw (`localYawToWorld`).
 *   - Each floor's rectangle: x originX..originX + 10.6, z originZ − 7.8..originZ (interior clear size; the 0.30 m walls are
 *     outside it). Floor 2 is a separate space at y = 0 too (stairs teleport, like a door); its stairwell shows the floor-1
 *     stair below y = 0. Houses are 13.4 m apart in x, the two floors 22.2 m apart in z: no floor sees another.
 */

import type { AABB } from "../collision";
import type { Bounds } from "../school/geometry";
import type { Point2 } from "./villageLayout";

// ------------------------------------------------------------------------------------------------ houses & areas --

/** The ten private houses (VILLAGE_LAYOUT.sceneryHouses kind "house"), in number order: house_1 … house_10. */
export const HOUSE_NUMBERS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const);
export type HouseNumber = (typeof HOUSE_NUMBERS)[number];
export const HOUSE_FLOORS = Object.freeze([1, 2] as const);
export type HouseFloor = (typeof HOUSE_FLOORS)[number];

/** `house_<N>`: the building id the village layout and the keypad use. */
export function houseBuildingId(n: HouseNumber): string {
  return `house_${n}`;
}

/** The house number of a building id (`house_7` → 7), or null. */
export function houseNumberOf(buildingId: string): HouseNumber | null {
  const m = /^house_(\d+)$/.exec(buildingId);
  if (!m) return null;
  const n = Number(m[1]);
  return (HOUSE_NUMBERS as readonly number[]).includes(n) ? (n as HouseNumber) : null;
}

/** A player's area inside a house: `house:<buildingId>:<floor>`, e.g. `house:house_3:2` (design 5.4). */
export type HouseFloorAreaId = `house:${string}:${HouseFloor}`;

export function houseFloorArea(n: HouseNumber, floor: HouseFloor): HouseFloorAreaId {
  return `house:${houseBuildingId(n)}:${floor}`;
}

/** The house and floor of an area id, or null for anything that is not exactly `house:house_<1..10>:<1|2>`. */
export function parseHouseFloorArea(area: string): { n: HouseNumber; buildingId: string; floor: HouseFloor } | null {
  const m = /^house:(house_\d+):([12])$/.exec(area);
  if (!m) return null;
  const n = houseNumberOf(m[1]!);
  if (n === null) return null;
  return { n, buildingId: m[1]!, floor: Number(m[2]) as HouseFloor };
}

/** Every house floor area, house 1 floor 1, house 1 floor 2, house 2 floor 1, … (20). */
export const HOUSE_FLOOR_AREAS: readonly HouseFloorAreaId[] = Object.freeze(
  HOUSE_NUMBERS.flatMap((n) => HOUSE_FLOORS.map((f) => houseFloorArea(n, f))),
);

/** HUD place name (design 5.2 step 5): "3번 집 · 2층". */
export function houseFloorLabel(n: HouseNumber, floor: HouseFloor): string {
  return `${n}번 집 · ${floor}층`;
}

// ------------------------------------------------------------------------------------------------- owner policy --

/** Owner decisions of 2026-11-16 (design.md ch. 10, all recommended options) the code must follow. */
export const HOUSE_POLICY = Object.freeze({
  /** Q1: whoever knows the code may enter; at most this many players in one house (both floors together). The 9th is refused ("집이 가득 찼어요"). */
  maxOccupants: 8,
  /** Q1: the guide NPC may tell players the code (chunk G adds the line later; the server keeps only the hash). */
  guideTellsCode: true,
  /** Q2: chat inside a house is heard on BOTH floors of that house; avatars are seen on the same floor only. */
  chatScope: "house" as "house" | "floor",
  /** Q4: beds are sat on at the edge only (no lying down). */
  bedSit: "edge" as "edge" | "lie",
  /** Q5: floor cushions face the table only (one facing, approached from any side). */
  cushionFacing: "table" as "table" | "either",
  /** Q6: windows show a panorama rendered from the real village at the house's spot. */
  windowView: "panorama" as "panorama" | "curtain",
  /** Q8: one closed bathroom door per floor, no bathroom interior. */
  bathroom: "door-only" as "door-only" | "room",
  /** Q9: the code is entered again on every entry (nothing remembered). */
  rememberCode: false,
  /** Q10: furniture too small for the avatar (e.g. house 2's baby chair) gets no seat marker. */
  tinyFurnitureSittable: false,
});

// --------------------------------------------------------------------------------------------------- dimensions --

/** The room (design 2): interior clear size, walls, storey and ceiling heights (m). */
export const HOUSE_ROOM = Object.freeze({
  /** Interior clear width along local x (m). */
  width: 10.6,
  /** Interior clear depth along local z (m). */
  depth: 7.8,
  /** Wall thickness, outside the clear rectangle (m). */
  wall: 0.3,
  /** Storey height: the stair rises this much (m). */
  storey: 4.0,
  /** Ceiling height above the walking floor (m). Attic / beam rooms may hang lower (see `cameraCeiling`). */
  ceiling: 3.7,
  /** Front door: local x range on the z = 0 wall, and its height (m). Glass double door like the exterior. */
  frontDoor: Object.freeze({ minX: 4.4, maxX: 6.2, height: 2.9 }),
  /** Openings between rooms: at least this wide and this high, no door leaf (m). */
  openingMinWidth: 1.6,
  openingHeight: 2.6,
  /** Clear walking passage width (m; body radius 0.4). */
  passageMin: 0.9,
  /** Clear floor in front of every seat (m). */
  seatFrontClear: 1.0,
  /** Entrance (현관) on floor 1, local: tiled, 3 cm sill at z = 1.5 (walk plane stays y = 0), the inner glass door (중문) on that line, fixed open. */
  entrance: Object.freeze({ minX: 3.6, maxX: 7.0, minZ: 0, maxZ: 1.5 }),
});

/** World origin of house N's floor F room (local 0, 0). */
export function houseOrigin(n: HouseNumber, floor: HouseFloor): Point2 {
  return { x: 360 + 24 * (n - 1), z: floor === 1 ? 0 : 30 };
}

/** Local room point → world. */
export function localToWorld(n: HouseNumber, floor: HouseFloor, lx: number, lz: number): Point2 {
  const o = houseOrigin(n, floor);
  return { x: round6(o.x + lx), z: round6(o.z - lz) };
}

/** World point → local room point of house N floor F. */
export function worldToLocal(n: HouseNumber, floor: HouseFloor, x: number, z: number): Point2 {
  const o = houseOrigin(n, floor);
  return { x: round6(x - o.x), z: round6(o.z - z) };
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/**
 * Local yaw → world (game) yaw. Local yaw: 0 faces local +z (into the room), π/2 faces local +x (the visitor's right);
 * a direction is (sin a, cos a) in (x, z). Game yaw: atan2(dirX, dirZ), 0 faces world +z. The z flip makes it π − a.
 */
export function localYawToWorld(localYaw: number): number {
  return round6(wrapAngle(Math.PI - localYaw));
}

/** World (game) yaw → local yaw (the same mirror: its own inverse). */
export function worldYawToLocal(worldYaw: number): number {
  return round6(wrapAngle(Math.PI - worldYaw));
}

/** The walkable rectangle of house N floor F in world coordinates (= the client's ActiveMap.bounds for that floor). */
export function houseFloorBounds(n: HouseNumber, floor: HouseFloor): Bounds {
  const o = houseOrigin(n, floor);
  return { minX: o.x, maxX: round6(o.x + HOUSE_ROOM.width), minZ: round6(o.z - HOUSE_ROOM.depth), maxZ: o.z };
}

/** A local axis-aligned rectangle → world. */
export function localRectToWorld(n: HouseNumber, floor: HouseFloor, r: AABB): AABB {
  const a = localToWorld(n, floor, r.minX, r.minZ);
  const b = localToWorld(n, floor, r.maxX, r.maxZ);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/** The camera's ceiling per floor (m above the walk plane): the room ceiling minus a pad, lower in attic / beam rooms (design 7.6). */
export const HOUSE_CAMERA = Object.freeze({
  /** How far below the ceiling (or a beam / the slope's low edge) the camera stays (m). */
  ceilingPad: 0.25,
  /** Rooms with a sloped attic ceiling (house 8 floor 2, house 10 floor 2): the slope starts at this height (m). */
  slopeStart: 2.9,
});

/** Floors whose usable height is lower than HOUSE_ROOM.ceiling: attic slope from 2.9 m (design 3.2, 4). */
export const HOUSE_LOW_CEILINGS: readonly { n: HouseNumber; floor: HouseFloor; lowest: number; why: string }[] = Object.freeze([
  { n: 8, floor: 2, lowest: 2.9, why: "다락방 한쪽 경사 천장" },
  { n: 10, floor: 2, lowest: 2.9, why: "다락 침실 경사 천장" },
]);

// -------------------------------------------------------------------------------------------------------- stairs --

/** The stair (design 3): 17 risers × 0.235 m = 4.0 m (rounded), 16 treads × 0.34 m = 5.44 m run, 1.3 m wide, 0.9 m rail. */
export const HOUSE_STAIR = Object.freeze({
  risers: 17,
  riser: 0.235,
  treads: 16,
  tread: 0.34,
  run: 5.44,
  width: 1.3,
  railHeight: 0.9,
  /** Floor 2's top landing next to the top step: 1.0 m along the climb × 1.3 m (kept free of furniture and rail). */
  landingLength: 1.0,
  /** How many of the floor-1 stair's top steps are repeated under floor 2's stairwell (seen looking down; design 3, 6–8). */
  wellSteps: 8,
});

export type StairType = "A" | "B" | "C" | "D";

/** Which stair each house has (design 3.1). */
export const HOUSE_STAIR_TYPE: Readonly<Record<HouseNumber, StairType>> = Object.freeze({
  1: "A", 2: "B", 3: "C", 4: "D", 5: "A", 6: "C", 7: "B", 8: "D", 9: "A", 10: "C",
});

/** A circular pad on the floor with the side it is used from (`facing`: the local yaw a user faces, toward the stair / door). */
export interface HousePad {
  /** Local centre. */
  x: number;
  z: number;
  radius: number;
  /** Local yaw a user faces when using it (toward the thing). */
  facing: number;
}

/** An arrival spot (local) and the local yaw the player faces on arrival. */
export interface HouseSpot {
  x: number;
  z: number;
  yaw: number;
}

/** Everything about one stair type, in LOCAL coordinates of its floor. */
export interface StairPlan {
  type: StairType;
  /** The stair's footprint on floor 1 (= floor 2's stairwell hole, railed all round except the landing side). */
  footprint: AABB;
  /** Unit climb direction (local x, z): from the first step toward the top. */
  climb: Point2;
  /** Local point at the middle of the first riser (floor 1) and of the top edge (floor 2's floor level). */
  foot: Point2;
  top: Point2;
  /** Floor 2: the clear landing beside / beyond the top step, where floor 2 is entered and left. */
  landing: AABB;
  /** Floor 1: `stair__h<N>_up`, in front of the lowest steps on the room side. */
  upPad: HousePad;
  /** Floor 2: `stair__h<N>_down`, on the landing, facing the stair. */
  downPad: HousePad;
  /** Floor 2 arrival after going up (`spawn__h<N>_2`): back to the stair, looking into the room. */
  arriveUp: HouseSpot;
  /** Floor 1 arrival after coming down (`spawn__h<N>_1s`). */
  arriveDown: HouseSpot;
}

/** Stair / door pads: radius (m). A pad is used within radius, or within radius + reach in its front band (`padUsableFrom`). */
export const HOUSE_PAD_RADIUS = 0.5;
/** Like the memorial door (villageDoor.ts DOOR_REACH_M / DOOR_INSIDE_HALF_WIDTH_M): reach past the pad's edge and the band's half width (m). */
export const HOUSE_PAD_REACH = 1.3;
export const HOUSE_PAD_HALF_WIDTH = 0.8;
/** How far an arrival spot sits from its pad's centre, away from the stair (m). */
const ARRIVAL_BACKOFF = 0.35;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** Local yaw of a local direction (x, z). */
function yawOf(dx: number, dz: number): number {
  return round6(Math.atan2(dx, dz));
}

/** The room centre (local): arrivals face it. */
export const ROOM_CENTRE: Readonly<Point2> = Object.freeze({ x: HOUSE_ROOM.width / 2, z: HOUSE_ROOM.depth / 2 });

function facingCentre(p: Point2): number {
  return yawOf(ROOM_CENTRE.x - p.x, ROOM_CENTRE.z - p.z);
}

function stairPlan(type: StairType): StairPlan {
  const S = HOUSE_STAIR;
  const W = HOUSE_ROOM.width;
  const R = HOUSE_PAD_RADIUS;
  // Along the back wall (A, B): z 6.4..7.7; along a side wall (C, D): from z 1.9 to 1.9 + run.
  const backZ0 = 6.4;
  const backZ1 = backZ0 + S.width;
  const sideZ0 = 1.9;
  const sideZ1 = r3(sideZ0 + S.run);
  let footprint: AABB;
  let climb: Point2;
  let landing: AABB;
  let upPad: Point2;
  let downFacing: number;
  switch (type) {
    case "A": // back wall, right: first step at the east end (x 10.5), climbing west
      footprint = { minX: r3(W - 0.1 - S.run), maxX: r3(W - 0.1), minZ: backZ0, maxZ: backZ1 };
      climb = { x: -1, z: 0 };
      landing = { minX: r3(footprint.minX - S.landingLength), maxX: footprint.minX, minZ: backZ0, maxZ: backZ1 };
      // the foot is against the side wall: the pad is on the room side of the lowest 1.3 m of the run
      upPad = { x: r3(footprint.maxX - S.width / 2), z: r3(backZ0 - R - 0.1) };
      downFacing = yawOf(1, 0);
      break;
    case "B": // back wall, left: first step at the west end (x 0.1), climbing east
      footprint = { minX: 0.1, maxX: r3(0.1 + S.run), minZ: backZ0, maxZ: backZ1 };
      climb = { x: 1, z: 0 };
      landing = { minX: footprint.maxX, maxX: r3(footprint.maxX + S.landingLength), minZ: backZ0, maxZ: backZ1 };
      upPad = { x: r3(footprint.minX + S.width / 2), z: r3(backZ0 - R - 0.1) };
      downFacing = yawOf(-1, 0);
      break;
    case "C": // right side wall: first step at the front (z 1.9), climbing toward the back; step off to the left at the top
      footprint = { minX: r3(W - 0.1 - S.width), maxX: r3(W - 0.1), minZ: sideZ0, maxZ: sideZ1 };
      climb = { x: 0, z: 1 };
      landing = { minX: r3(footprint.minX - S.landingLength), maxX: footprint.minX, minZ: r3(sideZ1 - S.width), maxZ: sideZ1 };
      upPad = { x: r3((footprint.minX + footprint.maxX) / 2), z: r3(sideZ0 - R - 0.1) };
      downFacing = yawOf(1, 0);
      break;
    case "D": // left side wall: mirror of C
      footprint = { minX: 0.1, maxX: r3(0.1 + S.width), minZ: sideZ0, maxZ: sideZ1 };
      climb = { x: 0, z: 1 };
      landing = { minX: footprint.maxX, maxX: r3(footprint.maxX + S.landingLength), minZ: r3(sideZ1 - S.width), maxZ: sideZ1 };
      upPad = { x: r3((footprint.minX + footprint.maxX) / 2), z: r3(sideZ0 - R - 0.1) };
      downFacing = yawOf(-1, 0);
      break;
  }
  const midX = r3((footprint.minX + footprint.maxX) / 2);
  const midZ = r3((footprint.minZ + footprint.maxZ) / 2);
  const foot = climb.x !== 0 ? { x: climb.x < 0 ? footprint.maxX : footprint.minX, z: midZ } : { x: midX, z: footprint.minZ };
  const top = climb.x !== 0 ? { x: climb.x < 0 ? footprint.minX : footprint.maxX, z: midZ } : { x: midX, z: footprint.maxZ };
  const downCentre = { x: r3((landing.minX + landing.maxX) / 2), z: r3((landing.minZ + landing.maxZ) / 2) };
  const upFacing = yawOf(0, 1); // every up pad faces local +z: the back wall (A, B: the stair's side; C, D: its foot)
  const back = (p: Point2, facing: number): Point2 => ({
    x: r3(p.x - Math.sin(facing) * ARRIVAL_BACKOFF),
    z: r3(p.z - Math.cos(facing) * ARRIVAL_BACKOFF),
  });
  const arriveUpAt = back(downCentre, downFacing);
  const arriveDownAt = back(upPad, upFacing);
  return {
    type,
    footprint,
    climb,
    foot,
    top,
    landing,
    upPad: { ...upPad, radius: R, facing: upFacing },
    downPad: { ...downCentre, radius: R, facing: downFacing },
    arriveUp: { ...arriveUpAt, yaw: facingCentre(arriveUpAt) },
    arriveDown: { ...arriveDownAt, yaw: facingCentre(arriveDownAt) },
  };
}

/** The four stair types (design 3.1), in local coordinates. */
export const STAIR_PLANS: Readonly<Record<StairType, StairPlan>> = Object.freeze({
  A: stairPlan("A"),
  B: stairPlan("B"),
  C: stairPlan("C"),
  D: stairPlan("D"),
});

/** Floor 1's way out: `door__h<N>_exit`, in the entrance, facing the front door (local −z). */
export const EXIT_PAD: Readonly<HousePad> = Object.freeze({ x: 5.3, z: 0.9, radius: 0.7, facing: yawOf(0, -1) });
/** Floor 1 arrival through the front door: `spawn__h<N>_in`, 1.6 m inside the 중문 line (z 1.5), facing into the room. */
export const ENTRY_SPAWN: Readonly<HouseSpot> = Object.freeze({ x: 5.3, z: 3.1, yaw: 0 });

/**
 * Areas of each floor that must stay free of furniture colliders (HA / HB keep them clear; the generator checks), local:
 * the entry corridor from the front door to past the arrival spot, every pad's disc grown by the body radius, the landing.
 */
export function houseKeepClear(n: HouseNumber, floor: HouseFloor): { name: string; box: AABB }[] {
  const s = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
  const disc = (name: string, p: { x: number; z: number; radius: number }) => ({
    name,
    box: { minX: r3(p.x - p.radius), maxX: r3(p.x + p.radius), minZ: r3(p.z - p.radius), maxZ: r3(p.z + p.radius) },
  });
  if (floor === 1) {
    return [
      { name: "entry_corridor", box: { minX: 4.3, maxX: 6.3, minZ: 0, maxZ: r3(ENTRY_SPAWN.z + 0.5) } },
      disc("exit_pad", EXIT_PAD),
      disc("up_pad", s.upPad),
      disc("arrive_down", { ...s.arriveDown, radius: 0.45 }),
    ];
  }
  return [{ name: "landing", box: s.landing }, disc("down_pad", s.downPad), disc("arrive_up", { ...s.arriveUp, radius: 0.45 })];
}

/**
 * Whether a player at LOCAL (x, z) may use a pad: inside its radius, or up to radius + HOUSE_PAD_REACH from its centre while
 * no more than HOUSE_PAD_HALF_WIDTH to the side of its axis and on the side it is used from (not past it, toward the thing).
 * The same shape as the memorial door's inside rule (villageDoor.ts useDoor). G's useStair / exit use this on authoritative positions.
 */
export function padUsableFrom(pad: HousePad, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const dx = x - pad.x;
  const dz = z - pad.z;
  const d = Math.hypot(dx, dz);
  if (d <= pad.radius) return true;
  if (d > pad.radius + HOUSE_PAD_REACH) return false;
  const fx = Math.sin(pad.facing);
  const fz = Math.cos(pad.facing);
  const ahead = dx * fx + dz * fz; // > 0: past the pad toward the stair / door
  const side = Math.abs(dx * fz - dz * fx);
  return ahead <= 0 && side <= HOUSE_PAD_HALF_WIDTH;
}

/** A pad / spot of house N in WORLD coordinates (world yaw). */
export interface WorldSpot {
  area: HouseFloorAreaId;
  x: number;
  z: number;
  yaw: number;
}

/** Every special place of house N in world coordinates: what the server and the client use (the GLB's nodes must match). */
export interface HousePlaces {
  n: HouseNumber;
  buildingId: string;
  stair: StairType;
  /** Arrival through the front door (floor 1). */
  spawnIn: WorldSpot;
  /** Arrival on floor 2 after going up. */
  spawnUp: WorldSpot;
  /** Arrival on floor 1 after coming down. */
  spawnDown: WorldSpot;
  /** Pads (world centre, radius, world facing yaw). */
  exitPad: WorldSpot & { radius: number };
  upPad: WorldSpot & { radius: number };
  downPad: WorldSpot & { radius: number };
}

function worldSpot(n: HouseNumber, floor: HouseFloor, s: { x: number; z: number }, localYaw: number): WorldSpot {
  const p = localToWorld(n, floor, s.x, s.z);
  return { area: houseFloorArea(n, floor), x: p.x, z: p.z, yaw: localYawToWorld(localYaw) };
}

export function housePlaces(n: HouseNumber): HousePlaces {
  const s = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
  return {
    n,
    buildingId: houseBuildingId(n),
    stair: s.type,
    spawnIn: worldSpot(n, 1, ENTRY_SPAWN, ENTRY_SPAWN.yaw),
    spawnUp: worldSpot(n, 2, s.arriveUp, s.arriveUp.yaw),
    spawnDown: worldSpot(n, 1, s.arriveDown, s.arriveDown.yaw),
    exitPad: { ...worldSpot(n, 1, EXIT_PAD, EXIT_PAD.facing), radius: EXIT_PAD.radius },
    upPad: { ...worldSpot(n, 1, s.upPad, s.upPad.facing), radius: s.upPad.radius },
    downPad: { ...worldSpot(n, 2, s.downPad, s.downPad.facing), radius: s.downPad.radius },
  };
}

export const HOUSE_PLACES: Readonly<Record<HouseNumber, HousePlaces>> = Object.freeze(
  Object.fromEntries(HOUSE_NUMBERS.map((n) => [n, Object.freeze(housePlaces(n))])) as Record<HouseNumber, HousePlaces>,
);

// ---------------------------------------------------------------------------------------------------- node names --

/**
 * glTF node names of house_N.glb (design 6.2, 7.2, 7.4). Markers, colliders and helpers are ROOT nodes (no parent): the
 * extraction tools read their translation directly (world = game coordinates, y up). Visible meshes hang under the two floor
 * group nodes so the client can show one floor at a time.
 */
export const HOUSE_NODE = Object.freeze({
  /** Group node of every visible mesh of floor F (identity transform). */
  floor: (n: HouseNumber, floor: HouseFloor) => `floor__h${n}_${floor}`,
  /** Floor 1 stair pad (empty at the pad centre, y 0, rotated to the pad's facing). */
  stairUp: (n: HouseNumber) => `stair__h${n}_up`,
  /** Floor 2 stair pad. */
  stairDown: (n: HouseNumber) => `stair__h${n}_down`,
  /** Floor 1 way out (the entrance pad). */
  exit: (n: HouseNumber) => `door__h${n}_exit`,
  /** Arrival through the front door (floor 1). */
  spawnIn: (n: HouseNumber) => `spawn__h${n}_in`,
  /** Arrival on floor 2 after going up. */
  spawnUp: (n: HouseNumber) => `spawn__h${n}_2`,
  /** Arrival on floor 1 after coming down. */
  spawnDown: (n: HouseNumber) => `spawn__h${n}_1s`,
  /** Ceiling slab of floor F for the indoor camera (a 1 m cube's translation + scale, underside at the ceiling, like memorial `ceil__hall`). */
  ceiling: (n: HouseNumber, floor: HouseFloor) => `ceil__h${n}_${floor}`,
  /** A collider box: `col__h<N>_<F>_<label>`, label = [a-z0-9_]+ (walls: `wall_*`, partitions `part_*`, rails `rail_*`). */
  collider: (n: HouseNumber, floor: HouseFloor, label: string) => `col__h${n}_${floor}_${label}`,
  /** A seat marker: `seat__h<N>_<F>_<k>`, k = 0, 1, 2 … per floor without gaps. */
  seat: (n: HouseNumber, floor: HouseFloor, k: number) => `seat__h${n}_${floor}_${k}`,
});

export const HOUSE_NODE_PATTERNS = Object.freeze({
  collider: /^col__h(10|[1-9])_([12])_([a-z0-9_]+)$/,
  seat: /^seat__h(10|[1-9])_([12])_(0|[1-9]\d*)$/,
  floor: /^floor__h(10|[1-9])_([12])$/,
});

/** Nodes house_N.glb must contain (besides ≥ HOUSE_MIN_COLLIDERS col__ boxes and the seat markers of HOUSE_SEAT_PLAN). */
export function houseRequiredNodes(n: HouseNumber): string[] {
  return [
    HOUSE_NODE.floor(n, 1),
    HOUSE_NODE.floor(n, 2),
    HOUSE_NODE.stairUp(n),
    HOUSE_NODE.stairDown(n),
    HOUSE_NODE.exit(n),
    HOUSE_NODE.spawnIn(n),
    HOUSE_NODE.spawnUp(n),
    HOUSE_NODE.spawnDown(n),
    HOUSE_NODE.ceiling(n, 1),
    HOUSE_NODE.ceiling(n, 2),
  ];
}

/** Where the place nodes must be (world x, z, y 0, world yaw), for scripts/check-school-glb.ts's `placements` (tolerance 0.05 m). */
export function housePlacements(n: HouseNumber): { node: string; x: number; z: number; y: number; yaw: number; tolerance: number }[] {
  const p = HOUSE_PLACES[n];
  const t = HOUSE_PLACEMENT_TOLERANCE;
  return [
    { node: HOUSE_NODE.stairUp(n), x: p.upPad.x, z: p.upPad.z, y: 0, yaw: p.upPad.yaw, tolerance: t },
    { node: HOUSE_NODE.stairDown(n), x: p.downPad.x, z: p.downPad.z, y: 0, yaw: p.downPad.yaw, tolerance: t },
    { node: HOUSE_NODE.exit(n), x: p.exitPad.x, z: p.exitPad.z, y: 0, yaw: p.exitPad.yaw, tolerance: t },
    { node: HOUSE_NODE.spawnIn(n), x: p.spawnIn.x, z: p.spawnIn.z, y: 0, yaw: p.spawnIn.yaw, tolerance: t },
    { node: HOUSE_NODE.spawnUp(n), x: p.spawnUp.x, z: p.spawnUp.z, y: 0, yaw: p.spawnUp.yaw, tolerance: t },
    { node: HOUSE_NODE.spawnDown(n), x: p.spawnDown.x, z: p.spawnDown.z, y: 0, yaw: p.spawnDown.yaw, tolerance: t },
  ];
}

/** Place nodes may be off their contract spot by at most this much (m). */
export const HOUSE_PLACEMENT_TOLERANCE = 0.05;
/** At least this many col__ boxes per house (4 walls × 2 floors + stairwell rails + furniture). */
export const HOUSE_MIN_COLLIDERS = 20;
/** A collider at least this tall stops the camera (`extract-colliders` CAMERA_BOX_MIN_HEIGHT): walls, partitions, wardrobes, bookcases. */
export const HOUSE_CAMERA_BOX_MIN_HEIGHT = 1.6;

// --------------------------------------------------------------------------------------------------------- seats --

/**
 * Seat kinds (design 6.1):
 *  - backed:   sofas, chairs, armchairs, rocking chair, bean bags — from the front only, leaning back;
 *  - backless: stools, benches, 평상, piano bench, ottomans, bed edges, window seats — from either side (`both`) or, where one
 *              side is a bed / wall / window (`both: false`), from the front only, facing the way the player came from;
 *  - floor:    cushions (방석), 보료, floor sofas — the new cross-legged pose (chunk F). A cushion has no back and faces the
 *              table only (one facing, approached from any side); 보료 and floor sofas have a back (`back` > 0): front only.
 */
export const HOUSE_SEAT_KINDS = Object.freeze(["backed", "backless", "floor"] as const);
export type HouseSeatKind = (typeof HOUSE_SEAT_KINDS)[number];

/** The sitting pose: `chair` (today's sit), `perch` (bar / work stools, seat ≥ 0.6 m: legs bent to the foot rail), `floor` (양반다리, chunk F). */
export const HOUSE_SEAT_POSES = Object.freeze(["chair", "perch", "floor"] as const);
export type HouseSeatPose = (typeof HOUSE_SEAT_POSES)[number];

/** Furniture a seat is on. */
export const HOUSE_SEAT_FURN = Object.freeze([
  "chair", "sofa", "armchair", "beanbag", // backed
  "bench", "stool", "barstool", "ottoman", "bed", "windowseat", // backless
  "cushion", "boryo", "floorsofa", // floor
] as const);
export type HouseSeatFurn = (typeof HOUSE_SEAT_FURN)[number];

/** Which kinds a furniture's seat may be. */
export const HOUSE_SEAT_FURN_KIND: Readonly<Record<HouseSeatFurn, HouseSeatKind>> = Object.freeze({
  chair: "backed", sofa: "backed", armchair: "backed", beanbag: "backed",
  bench: "backless", stool: "backless", barstool: "backless", ottoman: "backless", bed: "backless", windowseat: "backless",
  cushion: "floor", boryo: "floor", floorsofa: "floor",
});

/** How a seat is approached: `front` = the half-plane in front only; `any` = from every side not blocked by furniture. */
export type HouseSeatApproach = "front" | "any";

/** Seat-height rules (m): chair-height seats, perch seats (bar / work stools), floor seats (the cushion's top). */
export const HOUSE_SEAT_HEIGHTS = Object.freeze({
  chair: Object.freeze({ min: 0.35, max: 0.55 }),
  perch: Object.freeze({ min: 0.6, max: 0.75 }),
  floor: Object.freeze({ min: 0.03, max: 0.3 }),
});
/** The narrowest seat (m along the furniture) a marker may have: anything smaller is "too small" (policy Q10). */
export const HOUSE_SEAT_MIN_WIDTH = 0.38;

/**
 * One seat marker of house_N.glb: an empty named `seat__h<N>_<F>_<k>` at the middle of the seat surface (world x, z; y = the
 * surface height), with these glTF node extras (Blender custom properties; booleans as 0 / 1). Positions in the extras are not
 * repeated: x, y, z come from the node's translation. Read by scripts/gen-house-seats.ts into
 * shared/src/village/generated/houses/house_N_seats.ts.
 */
export interface HouseSeatMarker {
  /** `h<N>_<F>_<k>` (the node name without `seat__`). */
  id: string;
  n: HouseNumber;
  floor: HouseFloor;
  k: number;
  furn: HouseSeatFurn;
  kind: HouseSeatKind;
  pose: HouseSeatPose;
  approach: HouseSeatApproach;
  /** World seat-surface centre and height. */
  x: number;
  z: number;
  y: number;
  /** World (game) yaw the sitter faces. A cushion faces its table; a bed edge faces away from the bed. */
  yaw: number;
  /** From the marker forward (along yaw) to the seat's front edge (m). */
  edge: number;
  /** From the marker backward to the backrest's face (m); 0 without a back. */
  back: number;
  /** Seat width along the furniture (m). */
  width: number;
  /** Seats of one group are never taken at the same time (default: the seat's own id). */
  group: string;
  /** A backless seat that can be sat from either side (two facings, one group). Only `backless` may be true. */
  both: boolean;
  /** Which way the sitter steps off, turned from the facing (rad): 0 ahead, π behind. */
  exitTurn: number;
  /** How far the sitter leans back (rad); 0 without a back. */
  lean: number;
}

/** The extras keys a seat marker node must carry (design 6.2). */
export const HOUSE_SEAT_EXTRAS = Object.freeze([
  "furn", "kind", "pose", "approach", "yaw", "edge", "back", "width", "group", "both", "exitTurn", "lean",
] as const);

/** The approach a seat must have, from its kind, its back and `both`. */
export function seatApproach(kind: HouseSeatKind, back: number, both: boolean): HouseSeatApproach {
  if (kind === "backed") return "front";
  if (kind === "backless") return both ? "any" : "front";
  return back > 0 ? "front" : "any"; // floor: 보료 / floor sofa with a back → front; a cushion → any side, one facing
}

/** Everything wrong with one marker against the rules (empty: fine). */
export function seatMarkerProblems(m: HouseSeatMarker): string[] {
  const p: string[] = [];
  const name = `seat__${m.id}`;
  if (!HOUSE_NODE_PATTERNS.seat.test(name)) p.push(`${name}: 이름이 seat__h<N>_<층>_<k> 형식이 아니에요`);
  if (m.id !== `h${m.n}_${m.floor}_${m.k}`) p.push(`${name}: id와 집·층·번호가 맞지 않아요`);
  if (!(HOUSE_SEAT_FURN as readonly string[]).includes(m.furn)) p.push(`${name}: 알 수 없는 가구 ${m.furn}`);
  else if (HOUSE_SEAT_FURN_KIND[m.furn] !== m.kind) p.push(`${name}: ${m.furn}는 ${HOUSE_SEAT_FURN_KIND[m.furn]} 자리여야 해요 (지금 ${m.kind})`);
  if (!(HOUSE_SEAT_POSES as readonly string[]).includes(m.pose)) p.push(`${name}: 알 수 없는 자세 ${m.pose}`);
  if ((m.kind === "floor") !== (m.pose === "floor")) p.push(`${name}: 바닥 자리는 자세 floor, 그 밖에는 chair/perch여야 해요`);
  for (const k of ["x", "z", "y", "yaw", "edge", "back", "width", "exitTurn", "lean"] as const) {
    if (!Number.isFinite(m[k])) p.push(`${name}: ${k}가 숫자가 아니에요`);
  }
  const h = HOUSE_SEAT_HEIGHTS[m.pose] ?? HOUSE_SEAT_HEIGHTS.chair;
  if (!(m.y >= h.min - 1e-6 && m.y <= h.max + 1e-6)) p.push(`${name}: 좌면 높이 ${m.y} m가 ${m.pose} 범위 ${h.min}~${h.max} 밖이에요`);
  if (!(m.width >= HOUSE_SEAT_MIN_WIDTH - 1e-6)) p.push(`${name}: 폭 ${m.width} m — 인형이 앉기엔 너무 작아요 (최소 ${HOUSE_SEAT_MIN_WIDTH})`);
  if (!(m.edge > 0)) p.push(`${name}: 앞 가장자리까지 거리(edge)가 없어요`);
  if (m.kind === "backed" && !(m.back > 0)) p.push(`${name}: 등받이 있는 자리인데 back이 0이에요`);
  if (m.kind === "backless" && m.back !== 0) p.push(`${name}: 등받이 없는 자리인데 back이 ${m.back}예요`);
  if (m.back === 0 && m.lean !== 0) p.push(`${name}: 등받이가 없는데 lean이 ${m.lean}예요`);
  if (m.both && m.kind !== "backless") p.push(`${name}: 양쪽 앉기(both)는 등받이 없는 자리만 돼요`);
  if (m.furn === "bed" && m.both) p.push(`${name}: 침대 가장자리는 한쪽(침대 바깥)만 봐요 (both 0)`);
  if (m.furn === "cushion" && m.both) p.push(`${name}: 방석은 상 쪽만 봐요 (both 0)`);
  if (m.approach !== seatApproach(m.kind, m.back, m.both)) {
    p.push(`${name}: approach가 ${seatApproach(m.kind, m.back, m.both)}여야 해요 (지금 ${m.approach})`);
  }
  const b = houseFloorBounds(m.n, m.floor);
  if (!(m.x > b.minX && m.x < b.maxX && m.z > b.minZ && m.z < b.maxZ)) p.push(`${name}: ${m.n}번 집 ${m.floor}층 방 밖에 있어요 (${m.x}, ${m.z})`);
  return p;
}

/** How many seats of each kind each floor has (design 4; 118 in all: floor 1 77, floor 2 41). The generator checks the GLB against it. */
export type SeatCounts = Readonly<Partial<Record<HouseSeatKind, number>>>;
export const HOUSE_SEAT_PLAN: Readonly<Record<HouseNumber, Readonly<Record<HouseFloor, SeatCounts>>>> = Object.freeze({
  // 1F 소파3·라운지1·식탁4 / 2F 침대 가장자리2·스툴1, 책상 의자1
  1: { 1: { backed: 8 }, 2: { backless: 3, backed: 1 } },
  // 1F L소파4·식탁 의자3 / 벤치2 — 2F 아이 의자2·빈백1 / 2층 침대 아래칸1·더블 침대2
  2: { 1: { backed: 7, backless: 2 }, 2: { backed: 3, backless: 3 } },
  // 1F 식탁 의자6 / 평상2 — 2F 2인 소파2 / 방석2
  3: { 1: { backed: 6, backless: 2 }, 2: { backed: 2, floor: 2 } },
  // 1F 식탁 의자2 / 방석4·보료1 — 2F 서안 방석1·차탁 방석2
  4: { 1: { backed: 2, floor: 5 }, 2: { floor: 3 } },
  // 1F 라탄 소파2·라탄 의자2·식탁4 — 2F 방석4 / 싱글 침대1
  5: { 1: { backed: 8 }, 2: { floor: 4, backless: 1 } },
  // 1F 책상 의자1·안락의자2·가죽 소파2 / 오토만2 — 2F 더블 침대2·창가 좌석2
  6: { 1: { backed: 5, backless: 2 }, 2: { backless: 4 } },
  // 1F 소파3·암체어1·식탁 의자2 / 피아노 벤치1 — 2F 높은 스툴3
  7: { 1: { backed: 6, backless: 1 }, 2: { backless: 3 } },
  // 1F 방석4 / 평상2 — 2F 매트리스 소파2 / 빈백2
  8: { 1: { floor: 4, backless: 2 }, 2: { floor: 2, backed: 2 } },
  // 1F 식탁 의자8 / 바 스툴3 — 2F 바닥 소파3 / 싱글 침대1
  9: { 1: { backed: 8, backless: 3 }, 2: { floor: 3, backless: 1 } },
  // 1F 소파3·흔들의자1 / 통나무 벤치2 — 2F 더블 침대2·창가 좌석2
  10: { 1: { backed: 4, backless: 2 }, 2: { backless: 4 } },
});

/** Seats on one floor of one house (sum over kinds). */
export function seatCount(n: HouseNumber, floor: HouseFloor): number {
  const c = HOUSE_SEAT_PLAN[n][floor];
  return (c.backed ?? 0) + (c.backless ?? 0) + (c.floor ?? 0);
}

/** All house seats: 118. */
export const HOUSE_SEAT_TOTAL = HOUSE_NUMBERS.reduce((t, n) => t + seatCount(n, 1) + seatCount(n, 2), 0);

/**
 * The order of the house seats in the ONE global seat list (`VILLAGE_SEATS`, index = Player.seatIndex): after every non-house
 * seat, by house number, then floor, then k. A backless `both` marker becomes two consecutive entries (front, back) like the hall's.
 */
export function compareHouseSeats(a: Pick<HouseSeatMarker, "n" | "floor" | "k">, b: Pick<HouseSeatMarker, "n" | "floor" | "k">): number {
  return a.n - b.n || a.floor - b.floor || a.k - b.k;
}

/**
 * `Player.seatIndex` (shared/src/schema.ts) is int8 today (max 127). With the 118 house seats after the village's own the list
 * passes 127 (design 6.3: 37 + 118 = 155 places, more with two-facing seats), so G changes it to int16. Client and server must
 * deploy together (one list).
 */
export const SEAT_INDEX_SCHEMA = Object.freeze({ type: "int16" as const, standing: -1, max: 32767, was: "int8" as const, wasMax: 127 });

// ---------------------------------------------------------------------------------------------------- files & budgets --

/** Public URLs (client/public/…) of house N's files (design 7.1). */
export function houseFiles(n: HouseNumber) {
  const base = `/models/village/houses/house_${n}`;
  return {
    glb: `${base}.glb`,
    lightmapDay: `${base}_lm.webp`,
    lightmapDay1k: `${base}_lm_1k.webp`,
    lightmapNight: `${base}_lm_night.webp`,
    lightmapNight1k: `${base}_lm_night_1k.webp`,
    /** Window panorama: day on top, night below, one 2048 × 1024 image. */
    view: `${base}_view.webp`,
  };
}

/** Shared small props of every house (books, dishes, cushions, toys, leaves): GPU-instanced, loaded once on the first entry. */
export const HOUSES_PROPS_GLB = "/models/village/houses/houses_props.glb";

/** Generated TypeScript of house N (HA / HB regenerate; G's generated/houses/index.ts imports them). */
export function houseGeneratedFiles(n: HouseNumber) {
  return {
    seats: `shared/src/village/generated/houses/house_${n}_seats.ts`,
    seatsExport: `HOUSE_${n}_SEAT_MARKERS`,
    colliders: `shared/src/village/generated/houses/house_${n}_colliders.ts`,
    collidersExport: `HOUSE_${n}_COLLIDERS`,
  };
}

const MB = 1024 * 1024;
const KB = 1024;
/** Budgets (design 7.2; 2026-11-20: 54k triangles and 56 materials since every picture is its own painting material and the stairwell shows the whole flight), checked by scripts/check-school-glb.ts kind `house` (chunk G adds it). Triangles exclude col__. */
export const HOUSE_BUDGET = Object.freeze({
  glb: Object.freeze({ maxBytes: 1.0 * MB, maxTriangles: 54_000, maxMaterials: 56, maxTextureSide: 2048 }),
  props: Object.freeze({ maxBytes: 0.6 * MB, maxTriangles: 25_000 }),
  lightmap: Object.freeze({ side: 2048, maxBytes: 450 * KB, side1k: 1024, maxBytes1k: 230 * KB }),
  view: Object.freeze({ width: 2048, height: 1024 }),
  /** Draw calls on one floor (iPhone 13: 60 fps target, 45 minimum). */
  maxDrawCallsPerFloor: 120,
  /** Memory growth while inside a house, phone (MB). */
  maxMemoryGrowthMB: 150,
  /** Time to enter, no cache, 4G profile: with prefetch / without (s). */
  enterSecondsPrefetched: 2.5,
  enterSeconds: 6,
  /** Give up loading and send the player back to the porch after this long (s). */
  loadTimeoutSeconds: 8,
  /** Unload a house this long after leaving it (s); only one house in memory. */
  unloadAfterSeconds: 60,
});

/**
 * Where an exterior window lands inside (design 2: windows match the outside). The exterior house builder
 * (art/village/tools/parts_buildings.py `house`) works in a Frame whose local x is the visitor's right (same as the interior's
 * local x) and whose local z points out of the door; its body spans x −halfWidth..halfWidth, z back..front. The interior is
 * larger than the body (a game convention, like the memorial hall), so positions map proportionally: the front wall (z = front)
 * → local z 0, the back wall → 7.8, the side walls → x 0 / 10.6. HA / HB pass the body extents of the exterior they ship with.
 */
export const EXTERIOR_BODY_DEFAULT = Object.freeze({ halfWidth: 5.15, back: -4.05, front: 2.7 });
export function exteriorToLocal(extX: number, extZ: number, body = EXTERIOR_BODY_DEFAULT): Point2 {
  const x = HOUSE_ROOM.width / 2 + (extX / body.halfWidth) * (HOUSE_ROOM.width / 2);
  const z = ((body.front - extZ) / (body.front - body.back)) * HOUSE_ROOM.depth;
  return { x: r3(x), z: r3(z) };
}

/** The whole contract as plain JSON (scripts/export-house-contract.ts → docs/designs/houses-interior/contract.json, read by Blender). */
export function houseContractJson() {
  return {
    version: 1,
    note: "GENERATED from shared/src/village/houseAreas.ts by scripts/export-house-contract.ts — do not edit",
    room: HOUSE_ROOM,
    policy: HOUSE_POLICY,
    camera: HOUSE_CAMERA,
    lowCeilings: HOUSE_LOW_CEILINGS,
    stair: HOUSE_STAIR,
    pad: { radius: HOUSE_PAD_RADIUS, reach: HOUSE_PAD_REACH, halfWidth: HOUSE_PAD_HALF_WIDTH },
    exitPad: EXIT_PAD,
    entrySpawn: ENTRY_SPAWN,
    stairPlans: STAIR_PLANS,
    seat: {
      kinds: HOUSE_SEAT_KINDS,
      poses: HOUSE_SEAT_POSES,
      furn: HOUSE_SEAT_FURN_KIND,
      heights: HOUSE_SEAT_HEIGHTS,
      minWidth: HOUSE_SEAT_MIN_WIDTH,
      extras: HOUSE_SEAT_EXTRAS,
      total: HOUSE_SEAT_TOTAL,
    },
    budget: HOUSE_BUDGET,
    exteriorBody: EXTERIOR_BODY_DEFAULT,
    houses: HOUSE_NUMBERS.map((n) => ({
      n,
      buildingId: houseBuildingId(n),
      stair: HOUSE_STAIR_TYPE[n],
      origin: { 1: houseOrigin(n, 1), 2: houseOrigin(n, 2) },
      bounds: { 1: houseFloorBounds(n, 1), 2: houseFloorBounds(n, 2) },
      areas: { 1: houseFloorArea(n, 1), 2: houseFloorArea(n, 2) },
      places: HOUSE_PLACES[n],
      requiredNodes: houseRequiredNodes(n),
      keepClear: { 1: houseKeepClear(n, 1), 2: houseKeepClear(n, 2) },
      seats: HOUSE_SEAT_PLAN[n],
      files: houseFiles(n),
    })),
  };
}

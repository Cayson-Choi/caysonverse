/**
 * scripts/lib/schoolSpec.ts — what village.glb / memorial.glb must contain, read from the TS layout data
 * (the single source of truth for positions): the village's colliders and the memorial hall's anchors
 * (shared/src/village/villageLayout.ts). Used by check-school-glb.ts.
 */

import { PLAYER_RADIUS } from "../../shared/src/worldMap";
import {
  VILLAGE_LAYOUT,
  colliderNode,
  cubbyAnchorNode,
  cubbyAnchors,
  cubbyWallBox,
  greyboxColliders,
  hallWalls,
} from "../../shared/src/village/villageLayout";
import {
  HOUSE_FLOORS,
  HOUSE_MIN_COLLIDERS,
  HOUSE_NODE,
  HOUSE_ROOM,
  houseFloorBounds,
  houseKeepClear,
  housePlacements,
  houseRequiredNodes,
  localRectToWorld,
  type HouseNumber,
} from "../../shared/src/village/houseAreas";
import type { SchoolKind, SchoolSpec } from "./schoolGlb";

/**
 * Props whose `col__` box is a plain 1 m cube in the GLB although the prop stands taller: name (without `col__`) -> height (m),
 * used by the collider extraction to keep them as camera boxes. The village's and the memorial hall's boxes state their
 * height in the node (translation.y + scale.y / 2), so both lists are empty.
 */
export const KNOWN_PROP_HEIGHTS: Readonly<Record<SchoolKind, Readonly<Record<string, number>>>> = {
  village: {},
  memorial: {},
  house: {},
};

/**
 * Materials the village game code drives itself (never light-mapped): windows, lamps, water, the plot outlines, and the
 * fountain's crescent (lit live; scripts/patch-village-moon.mjs puts it in every village.glb).
 */
export const VILLAGE_NON_LIGHTMAPPED = ["M_window", "M_lamp", "M_water", "M_glow_plot", "M_moon"] as const;

/**
 * 케이슨 마을: every layout collider exists as its `col__<id>` box with the layout's exact rectangle and a height that
 * matches its camera flag (Task 7 generates the game's colliders and camera boxes from these boxes), the night-bake light
 * points (`light__*` empties) are there, and the materials the game drives itself exist and are not light-mapped.
 */
function villageSpec(): SchoolSpec {
  const colliders = greyboxColliders(VILLAGE_LAYOUT);
  return {
    kind: "village",
    requiredNodes: colliders.map((c) => colliderNode(c.id)),
    requiredPrefixes: [
      { prefix: "col__", min: colliders.length },
      { prefix: "light__", min: 1 },
    ],
    placements: [],
    identityRotationPrefixes: [],
    requiredBoxes: colliders.map((c) => ({ node: colliderNode(c.id), box: c.box, camera: c.camera })),
    requiredMaterials: [...VILLAGE_NON_LIGHTMAPPED],
  };
}

/**
 * Materials the memorial hall's game code drives itself or that are not light-mapped: the lights (LED strips, cove, downlights, candles),
 * the garden card (day/night), the skylight diffuser, the window and cubby glass and the door's sliding leaves.
 */
export const MEMORIAL_NON_LIGHTMAPPED = ["M_lamp", "M_garden", "M_skylight", "M_glass", "M_alu"] as const;


/** How close (m) a cubby anchor must sit to the layout's opening centre (the cubbies are 0.425 m apart). */
export const CUBBY_ANCHOR_TOLERANCE = 0.02;

/** The hall's walls in hallWalls order (wallsAround: north, south, east, west) by their col__ ids. */
export const HALL_WALL_IDS = ["hall_wall_n", "hall_wall_s", "hall_wall_e", "hall_wall_w"] as const;

/**
 * 추모관 안 (memorial.glb, Task 8, rebuilt 2026-11-13): an `anchor__cubby_<id>` empty at every one of the 368 cubbies'
 * opening centres (within 2 cm, facing into the room), the hall's four walls, the four banks (A, C, B on the north wall, E) as
 * camera-height col__ boxes on the layout's rectangles, the door's two sliding leaves, no col__ box on the inside door pad or
 * where visitors arrive, the `ceil__hall` slab under the roof, and the materials the game drives itself.
 */
function memorialSpec(): SchoolSpec {
  const inn = VILLAGE_LAYOUT.memorial.interior;
  const anchors = cubbyAnchors(VILLAGE_LAYOUT);
  const [bankA, bankB, bankE, bankC] = inn.cubbyWalls;
  const walls = hallWalls(VILLAGE_LAYOUT);
  const wallNodes = HALL_WALL_IDS.map((id) => colliderNode(id));
  const boxes = [
    ...HALL_WALL_IDS.map((id, i) => ({ node: colliderNode(id), box: walls[i]!, camera: true })),
    // bank A runs to the west wall (its filler), bank B to the east wall (the dead corner behind the east bank)
    { node: colliderNode("cubby_a"), box: { ...cubbyWallBox(bankA!), minX: inn.room.minX }, camera: true },
    { node: colliderNode("cubby_b"), box: { ...cubbyWallBox(bankB!), maxX: inn.room.maxX }, camera: true },
    { node: colliderNode("cubby_e"), box: cubbyWallBox(bankE!), camera: true },
    { node: colliderNode("cubby_c"), box: cubbyWallBox(bankC!), camera: true },
  ];
  return {
    kind: "memorial",
    requiredNodes: [...anchors.map((a) => cubbyAnchorNode(a.id)), ...boxes.map((b) => b.node), "ceil__hall", "door__leaf_l", "door__leaf_r"],
    requiredPrefixes: [
      { prefix: "anchor__cubby_", min: anchors.length },
      { prefix: "col__", min: boxes.length },
    ],
    placements: anchors.map((a) => ({ node: cubbyAnchorNode(a.id), x: a.x, y: a.y, z: a.z, yaw: a.yaw, tolerance: CUBBY_ANCHOR_TOLERANCE })),
    identityRotationPrefixes: [],
    requiredBoxes: boxes,
    requiredMaterials: [...MEMORIAL_NON_LIGHTMAPPED],
    clearDiscs: [
      // the pad lies against the south wall (it reaches 0.6 m past it): the room's walls do not count
      { name: "안쪽 문 발판", x: inn.doorPad.centre.x, z: inn.doorPad.centre.z, radius: inn.doorPad.radius, ignore: wallNodes },
      { name: "들어온 자리", x: inn.spawn.x, z: inn.spawn.z, radius: PLAYER_RADIUS, ignore: wallNodes },
    ],
    ceiling: { node: "ceil__hall", y: inn.ceilingHeight, room: inn.room },
  };
}

/**
 * 집 (house_N.glb, 집 실내 G; houseAreas.ts is the contract): the required nodes (floor groups, stair / door / spawn pads, ceiling slabs), the
 * pads and arrival spots at their contract places (5 cm, 0.02 rad), at least HOUSE_MIN_COLLIDERS col__ boxes of this house, a ceiling slab
 * per floor (underside 3.7 m, covering the room), and no furniture box in the zones that stay clear (entry corridor, pads, landing).
 * The seat markers are checked by scripts/gen-house-seats.ts (`readHouse`), which check-school-glb runs for this kind.
 */
function houseSpec(n: HouseNumber): SchoolSpec {
  return {
    kind: "house",
    requiredNodes: houseRequiredNodes(n),
    requiredPrefixes: [{ prefix: `col__h${n}_`, min: HOUSE_MIN_COLLIDERS }],
    placements: housePlacements(n),
    identityRotationPrefixes: [],
    ceilings: HOUSE_FLOORS.map((f) => ({ node: HOUSE_NODE.ceiling(n, f), y: HOUSE_ROOM.ceiling, room: houseFloorBounds(n, f) })),
    clearBoxes: HOUSE_FLOORS.flatMap((f) =>
      houseKeepClear(n, f).map((z) => ({ name: `${f}층 ${z.name}`, box: localRectToWorld(n, f, z.box) })),
    ),
  };
}

export function schoolSpec(kind: SchoolKind, house?: HouseNumber): SchoolSpec {
  if (kind === "house") return houseSpec(house ?? 1);
  return kind === "village" ? villageSpec() : memorialSpec();
}

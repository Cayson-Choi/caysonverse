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
import type { SchoolKind, SchoolSpec } from "./schoolGlb";

/**
 * Props whose `col__` box is a plain 1 m cube in the GLB although the prop stands taller: name (without `col__`) -> height (m),
 * used by the collider extraction to keep them as camera boxes. The village's and the memorial hall's boxes state their
 * height in the node (translation.y + scale.y / 2), so both lists are empty.
 */
export const KNOWN_PROP_HEIGHTS: Readonly<Record<SchoolKind, Readonly<Record<string, number>>>> = {
  village: {},
  memorial: {},
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

/** Materials the memorial hall's game code drives itself: the lights (LED strips, downlights, candles) and the garden card. */
export const MEMORIAL_NON_LIGHTMAPPED = ["M_lamp", "M_garden"] as const;

/** How close (m) a cubby anchor must sit to the layout's opening centre (the cubbies are 0.425 m apart). */
export const CUBBY_ANCHOR_TOLERANCE = 0.02;

/** The hall's walls in hallWalls order (wallsAround: north, south, east, west) by their col__ ids. */
export const HALL_WALL_IDS = ["hall_wall_n", "hall_wall_s", "hall_wall_e", "hall_wall_w"] as const;

/**
 * 추모관 안 (memorial.glb, Task 8): an `anchor__cubby_<id>` empty at every cubby's opening centre (within 2 cm, facing
 * into the room), the hall's four walls and the two cubby units as camera-height col__ boxes on the layout's rectangles,
 * no col__ box on the inside door pad or where visitors arrive, the `ceil__hall` slab under the roof, and the
 * materials the game drives itself.
 */
function memorialSpec(): SchoolSpec {
  const inn = VILLAGE_LAYOUT.memorial.interior;
  const anchors = cubbyAnchors(VILLAGE_LAYOUT);
  const [back, east] = inn.cubbyWalls;
  const walls = hallWalls(VILLAGE_LAYOUT);
  const wallNodes = HALL_WALL_IDS.map((id) => colliderNode(id));
  const boxes = [
    ...HALL_WALL_IDS.map((id, i) => ({ node: colliderNode(id), box: walls[i]!, camera: true })),
    // the back unit's box runs wall to wall: its filler at the west end, the dead corner behind the east unit
    { node: colliderNode("cubby_n"), box: { ...cubbyWallBox(back!), minX: inn.room.minX, maxX: inn.room.maxX }, camera: true },
    { node: colliderNode("cubby_e"), box: cubbyWallBox(east!), camera: true },
  ];
  return {
    kind: "memorial",
    requiredNodes: [...anchors.map((a) => cubbyAnchorNode(a.id)), ...boxes.map((b) => b.node), "ceil__hall"],
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

export function schoolSpec(kind: SchoolKind): SchoolSpec {
  return kind === "village" ? villageSpec() : memorialSpec();
}

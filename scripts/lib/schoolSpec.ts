/**
 * scripts/lib/schoolSpec.ts — what hub.glb / counsel.glb / village.glb / memorial.glb must contain, read from the TS layout data
 * (the single source of truth for positions): the counselling room's anchors and visual bindings
 * (shared/src/school/counselMap.ts), the hub's corridor doors (hubMap.ts) and the village's colliders
 * (shared/src/village/villageLayout.ts). Used by check-school-glb.ts.
 */

import { ROOM_IDS } from "../../shared/src/escape/constants";
import { COUNSEL_ANCHORS, COUNSEL_VISUALS } from "../../shared/src/school/counselMap";
import { EAST_CORRIDOR, HUB_DOORS } from "../../shared/src/school/hubMap";
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
import { roundToHundredth } from "./schoolGlb";
import type { SchoolKind, SchoolSpec } from "./schoolGlb";

/** Bars in the east gate (client/src/game/hub/Gate.tsx BAR_COUNT). */
const GATE_BARS = 8;

/**
 * Props whose `col__` box is a plain 1 m cube in the GLB although the prop stands taller (the art kept every
 * counselling-room box 1 m high; the hub's lockers state their 2.2 m in their node). Name (without `col__`) -> height (m),
 * read off the model's baked geometry (the highest vertex over the box's footprint, 2026-11-02, counsel.glb), rounded down
 * to 0.05. Only the ones the camera could end up inside matter (>= 1.6 m): the extraction keeps these as camera boxes.
 */
export const KNOWN_PROP_HEIGHTS: Readonly<Record<SchoolKind, Readonly<Record<string, number>>>> = {
  // The hub's `col__` boxes are 1 m cubes too (only the lockers state their height in the node). The plants are the art's
  // `plant` builder (art/school/tools/props.py): its tallest leaf blob tops out at 1.8 x scale, and `props_b.plant` sizes the
  // box as 0.76 x scale, so scale = box width / 0.76 (hub_layout.py: 1.05 to 1.25) -> 1.85 to 2.25 m, rounded down to 0.05.
  // The two signs are the art's stated heights (2.65 m team sign on its post, 2.75 m leaderboard).
  hub: {
    team_sign: 2.65,
    leaderboard: 2.75,
    plant_20: 2.25, // box 0.95 -> scale 1.25
    plant_23: 2.25,
    plant_21: 2.15, // 0.912 -> 1.2
    plant_22: 2.15,
    plant_24: 1.95, // 0.836 -> 1.1
    plant_25: 1.95,
    plant_26: 1.85, // 0.798 -> 1.05
    plant_27: 1.85,
    plant_40: 2.05, // 0.874 -> 1.15
    plant_41: 2.05,
  },
  // The village's col__ boxes state their height in the node (translation.y + scale.y / 2).
  village: {},
  // So do the memorial hall's (memorial.glb).
  memorial: {},
  counsel: {
    east_bookcase: 2.1,
    cabinet: 1.95,
    sort_board: 2.1,
    counsel_screen: 2.4,
    exit_door: 2.8,
    floor_lamp: 1.8,
    plant_50: 1.85,
    plant_51: 1.8,
    plant_52: 1.85,
  },
};

function counselSpec(): SchoolSpec {
  const anchorNodes = COUNSEL_ANCHORS.map((a) => `obj__${a.id}`);
  const visualNodes = COUNSEL_VISUALS.map((v) => v.node);
  return {
    kind: "counsel",
    requiredNodes: [...new Set([...anchorNodes, ...visualNodes])],
    requiredPrefixes: [{ prefix: "col__", min: 1 }],
    placements: COUNSEL_ANCHORS.map((a) => ({ node: `obj__${a.id}`, x: a.x, z: a.z })),
    identityRotationPrefixes: ["obj__"],
  };
}

function hubSpec(): SchoolSpec {
  const required = ["gate__east"];
  for (let i = 1; i <= GATE_BARS; i += 1) required.push(`gate__east__bar_${i}`);
  for (const room of ROOM_IDS) required.push(`board_window__${room}`);
  const placements: SchoolSpec["placements"] = [];
  for (const d of HUB_DOORS) {
    required.push(`door__${d.room}`, `door__${d.room}__L`, `door__${d.room}__R`, `pad__${d.room}`);
    // The door sits in the corridor wall's face: north doors at the corridor's minZ, south doors at its maxZ.
    placements.push({ node: `door__${d.room}`, x: d.x, z: d.side === "n" ? EAST_CORRIDOR.minZ : EAST_CORRIDOR.maxZ });
    placements.push({ node: `pad__${d.room}`, x: roundToHundredth(d.returnPoint.x), z: roundToHundredth(d.returnPoint.z) });
  }
  return {
    kind: "hub",
    requiredNodes: required,
    requiredPrefixes: [{ prefix: "col__", min: 1 }],
    placements,
    identityRotationPrefixes: [],
  };
}

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
  if (kind === "hub") return hubSpec();
  if (kind === "village") return villageSpec();
  if (kind === "memorial") return memorialSpec();
  return counselSpec();
}

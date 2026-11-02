/**
 * scripts/lib/schoolSpec.ts — what hub.glb / counsel.glb must contain, read from the TS layout data
 * (the single source of truth for positions): the counselling room's anchors and visual bindings
 * (shared/src/school/counselMap.ts) and the hub's corridor doors (hubMap.ts). Used by check-school-glb.ts.
 */

import { ROOM_IDS } from "../../shared/src/escape/constants";
import { COUNSEL_ANCHORS, COUNSEL_VISUALS } from "../../shared/src/school/counselMap";
import { EAST_CORRIDOR, HUB_DOORS } from "../../shared/src/school/hubMap";
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

export function schoolSpec(kind: SchoolKind): SchoolSpec {
  return kind === "hub" ? hubSpec() : counselSpec();
}

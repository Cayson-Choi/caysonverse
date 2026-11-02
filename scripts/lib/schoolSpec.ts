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

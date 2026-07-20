/**
 * AI 조교 NPC roster + proximity (design 31 + 후속). THREE assistants, one per
 * room, all badged "AI 조교" — their personal names (클로드/챗지피티/제미나이)
 * live in the SERVER persona and are revealed only in conversation. Positions
 * are the SHARED map truth (worldMap.NPC_SPOTS — solid obstacles, design 33);
 * this module adds the client-side render/interaction config.
 */

import { NPC_SPOTS, type NpcId } from "@caysonverse/shared/worldMap";

export type { NpcId };

/** The badge every NPC wears (nametag + panel header) — never a personal name. */
export const NPC_LABEL = "AI 조교";

export interface NpcConfig {
  id: NpcId;
  pos: { x: number; z: number };
  /** Facing (Y rotation of the +Z-facing model). */
  rotY: number;
  /** Robe tint index (TINT_COLORS) — a subtle brand nod per assistant. */
  tint: number;
}

/**
 * The stationed assistants. Facing: hall → -X (into the hall), lobby → +X
 * (toward the central sofa set), gallery → toward the gallery door (NW-ish).
 * Tints: 클로드=orange, 챗지피티=green, 제미나이=blue.
 */
export const NPCS: readonly NpcConfig[] = [
  { id: "hall", pos: NPC_SPOTS.hall, rotY: -Math.PI / 2, tint: 2 },
  { id: "lobby", pos: NPC_SPOTS.lobby, rotY: Math.PI / 2, tint: 4 },
  { id: "gallery", pos: NPC_SPOTS.gallery, rotY: Math.atan2(-3.5, 8), tint: 5 },
];

/** Talk prompt radius (m) — walk up close to start the conversation. */
export const NPC_TALK_RADIUS = 3;

/** Auto-close radius (m) — walking away ends the side chat. */
export const NPC_CLOSE_RADIUS = 6;

/** Squared-distance helper over an NPC id. */
export function npcDistance(id: NpcId, x: number, z: number): number {
  const s = NPC_SPOTS[id];
  return Math.hypot(x - s.x, z - s.z);
}

/** The nearest NPC within `radius` of (x, z), or null. */
export function nearestNpc(x: number, z: number, radius: number): NpcConfig | null {
  let best: NpcConfig | null = null;
  let bestDist = radius;
  for (const npc of NPCS) {
    const d = Math.hypot(x - npc.pos.x, z - npc.pos.z);
    if (d <= bestDist) {
      bestDist = d;
      best = npc;
    }
  }
  return best;
}

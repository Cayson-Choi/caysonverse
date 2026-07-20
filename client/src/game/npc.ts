/**
 * AI 조교 NPC placement + proximity (design 31). Pure data/predicates — the
 * render (NpcCharacter), prompt (NpcPrompt) and panel (NpcChatPanel) all read
 * from here; there is no server/schema counterpart (the NPC is client décor,
 * its brain lives behind the server's /api/npc-chat proxy).
 */

import { SCREEN } from "@caysonverse/shared/worldMap";

/** Display name (nametag + panel header). */
export const NPC_NAME = "AI 조교";

/**
 * Standing spot: beside the lecture-hall screen's SOUTH edge, one step into the
 * room so the nametag never clips the screen box. Clear of the screen obstacle
 * (x ≥ 29.45) and far from every seat (front row chairs are at x = 17.7 —
 * the sit prompt and the talk prompt can never show together).
 */
export const NPC_POS = {
  x: SCREEN.x - 1.0,
  z: SCREEN.z - SCREEN.width / 2 - 1.2,
} as const;

/** Faces -X (west, into the hall): the +Z-facing model rotated by -π/2. */
export const NPC_ROT_Y = -Math.PI / 2;

/** Fixed tint index for the NPC's mage robe (players may coincide — fine). */
export const NPC_TINT = 2;

/** Talk prompt radius (m) — walk up close to start the conversation. */
export const NPC_TALK_RADIUS = 3;

/** Auto-close radius (m) — walking away ends the side chat. */
export const NPC_CLOSE_RADIUS = 6;

/** True when (x, z) is within `radius` of the NPC. */
export function isNearNpc(x: number, z: number, radius: number): boolean {
  return Math.hypot(x - NPC_POS.x, z - NPC_POS.z) <= radius;
}

/**
 * Context-sensitive interaction (controls overhaul, Task 10): ONE target for E / F
 * and for the on-screen action button — sit on a chair, stand up, or talk to an
 * AI 조교. Pure: the world is read once by `interactInputAt` (throttled to ~5 Hz by
 * the ActionButton, never per frame), `pickInteraction` decides, and the rest is
 * labels. The maze return portal is deliberately NOT a target — it stays behind the
 * 큐리 panel's own button (design 34), so E can never teleport anyone.
 */

import { SEATS, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { NPC_TALK_RADIUS, nearestNpc, npcDistance, type NpcId } from "./npc";

export type Interaction =
  | { kind: "sit"; seatIndex: number }
  | { kind: "stand" }
  | { kind: "talk"; npc: NpcId };

/** What is within reach right now. `dist` is metres from the player to the target. */
export interface InteractInput {
  seated: boolean;
  /** Nearest FREE seat within SEAT_REACH (null while seated). */
  seat: { index: number; dist: number } | null;
  /** Nearest AI 조교 within NPC_TALK_RADIUS. */
  npc: { id: NpcId; dist: number } | null;
  /** An NPC chat panel is already open. */
  npcPanelOpen: boolean;
}

/**
 * The one thing E / F / the button would do now, or null.
 *  - Seated → stand, whatever is nearby (the seat is the only thing you can do).
 *  - Seat and 조교 both in reach → the nearer one; an exact tie goes to sit.
 *  - While a chat panel is open, "talk" is not offered (you are already talking).
 */
export function pickInteraction(i: InteractInput): Interaction | null {
  if (i.seated) return { kind: "stand" };
  const npc = i.npcPanelOpen ? null : i.npc;
  if (i.seat && npc) {
    return npc.dist < i.seat.dist
      ? { kind: "talk", npc: npc.id }
      : { kind: "sit", seatIndex: i.seat.index };
  }
  if (i.seat) return { kind: "sit", seatIndex: i.seat.index };
  if (npc) return { kind: "talk", npc: npc.id };
  return null;
}

/** Icon for the button: the chair for sit/stand, a speech bubble for the 조교. */
export function interactionIcon(i: Interaction): "🪑" | "💬" {
  return i.kind === "talk" ? "💬" : "🪑";
}

/** Full Korean label (desktop pill text, aria-label). */
export function interactionLabel(i: Interaction): string {
  switch (i.kind) {
    case "sit":
      return "앉기";
    case "stand":
      return "일어서기";
    case "talk":
      return "조교와 대화";
  }
}

/** Short label for the 60 px round touch button ("조교와 대화" would not fit). */
export function interactionShortLabel(i: Interaction): string {
  return i.kind === "talk" ? "대화" : interactionLabel(i);
}

/** Whether two picks are the same action on the same target (null equals null). */
export function sameInteraction(a: Interaction | null, b: Interaction | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "sit" && b.kind === "sit") return a.seatIndex === b.seatIndex;
  if (a.kind === "talk" && b.kind === "talk") return a.npc === b.npc;
  return true; // stand === stand
}

/**
 * Read the world around `(x, z)` into an `InteractInput`. `seatIndex` is the local
 * player's own server-confirmed seat (-1 standing); `isOccupied` reports seats taken
 * by ANY player (self + remotes). Allocates one small object — call it at the
 * ~5 Hz UI cadence or on a key press, never per frame.
 */
export function interactInputAt(
  x: number,
  z: number,
  seatIndex: number,
  isOccupied: (index: number) => boolean,
  npcPanelOpen: boolean,
): InteractInput {
  const seated = seatIndex >= 0;
  let seat: InteractInput["seat"] = null;
  if (!seated) {
    const index = nearestFreeSeat(x, z, isOccupied);
    if (index !== null) {
      seat = { index, dist: Math.hypot(x - SEATS[index].x, z - SEATS[index].z) };
    }
  }
  const near = nearestNpc(x, z, NPC_TALK_RADIUS);
  const npc = near ? { id: near.id, dist: npcDistance(near.id, x, z) } : null;
  return { seated, seat, npc, npcPanelOpen };
}

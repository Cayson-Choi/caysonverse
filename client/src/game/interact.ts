/**
 * Context-sensitive interaction (controls overhaul, Task 10): ONE target for E / F
 * and for the on-screen action button — sit on a chair, stand up, or talk to an
 * AI 조교. Pure: the world is read once by `interactInputAt` (throttled to ~5 Hz by
 * the ActionButton, never per frame), `pickInteraction` decides, and the rest is
 * labels. The maze return portal is deliberately NOT a target — it stays behind the
 * 큐리 panel's own button (design 34), so E can never teleport anyone.
 */

import { SEATS, SEAT_REACH, nearestFreeSeat, type Seat } from "@caysonverse/shared/worldMap";
import { NPC_CLOSE_RADIUS, NPC_TALK_RADIUS, nearestNpc, npcDistance, type NpcId } from "./npc";

/**
 * Something a scene offers besides the world's chairs and 조교 (AI 학교 탈출, Task 16): the team
 * rug in the hall, a door pad in the corridor, and — in a classroom — the objects. A scene plugs
 * its list in through interactTargets.ts; `dist` is metres from the player to the target.
 */
export interface InteractTarget {
  kind: "teamDesk" | "door" | "object";
  id: string;
  dist: number;
  icon: string;
  label: string;
  /** The word for the 60 px round touch button, when `label` is too long for it. */
  short?: string;
  /** Pressed and held (a lone member's coop switch) instead of tapped. */
  hold?: boolean;
  /**
   * Which target wins when several are in reach: the higher number first, the nearer one among equals (default 0).
   * A classroom's coop key switch sits about as far from its anchor's standing spot as a note or a drawer does, so
   * "nearest wins" would often offer the note while the player is trying to reach the key.
   */
  priority?: number;
}

export type Interaction =
  | { kind: "sit"; seatIndex: number }
  | { kind: "stand" }
  | { kind: "talk"; npc: NpcId }
  | { kind: "target"; target: InteractTarget };

/** What is within reach right now. `dist` is metres from the player to the target. */
export interface InteractInput {
  seated: boolean;
  /** Nearest FREE seat within SEAT_REACH (null while seated). */
  seat: { index: number; dist: number } | null;
  /** Nearest AI 조교 within NPC_TALK_RADIUS. */
  npc: { id: NpcId; dist: number } | null;
  /** An NPC chat panel is already open. */
  npcPanelOpen: boolean;
  /** What the active scene offers (hub, classroom). Absent in the world. */
  targets?: readonly InteractTarget[];
}

/**
 * The one thing E / F / the button would do now, or null.
 *  - Seated → stand, whatever is nearby (the seat is the only thing you can do).
 *  - Seat, 조교 and scene targets in reach → the nearest; an exact tie goes seat > 조교 > target.
 *    Among scene targets the higher `priority` wins, then the nearer one, then the earlier one in the list.
 *  - While a chat panel is open, "talk" is not offered (you are already talking).
 */
export function pickInteraction(i: InteractInput): Interaction | null {
  if (i.seated) return { kind: "stand" };
  const npc = i.npcPanelOpen ? null : i.npc;
  let best: Interaction | null = null;
  let bestDist = Infinity;
  // Strict `<`: of equal distances the one considered first wins.
  if (i.seat) {
    best = { kind: "sit", seatIndex: i.seat.index };
    bestDist = i.seat.dist;
  }
  if (npc && npc.dist < bestDist) {
    best = { kind: "talk", npc: npc.id };
    bestDist = npc.dist;
  }
  const targets = i.targets;
  if (targets) {
    let nearest: InteractTarget | null = null;
    for (let k = 0; k < targets.length; k++) {
      const c = targets[k];
      if (nearest === null) {
        nearest = c;
        continue;
      }
      const cp = c.priority ?? 0;
      const np = nearest.priority ?? 0;
      if (cp > np || (cp === np && c.dist < nearest.dist)) nearest = c;
    }
    if (nearest !== null && nearest.dist < bestDist) best = { kind: "target", target: nearest };
  }
  return best;
}

/** Icon for the button: the chair for sit/stand, a speech bubble for the 조교, the target's own otherwise. */
export function interactionIcon(i: Interaction): string {
  if (i.kind === "target") return i.target.icon;
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
    case "target":
      return i.target.label;
  }
}

/** Short label for the 60 px round touch button ("조교와 대화" would not fit). */
export function interactionShortLabel(i: Interaction): string {
  if (i.kind === "target") return i.target.short ?? i.target.label;
  return i.kind === "talk" ? "대화" : interactionLabel(i);
}

/**
 * Whether the open 조교 chat panel must close because the player walked away from the
 * assistant they are talking to (more than NPC_CLOSE_RADIUS, measured from THAT
 * assistant, not the nearest one). False while no panel is open.
 */
export function shouldClosePanel(activeNpc: NpcId | null, x: number, z: number): boolean {
  return activeNpc !== null && npcDistance(activeNpc, x, z) > NPC_CLOSE_RADIUS;
}

/**
 * Do what E / the button would do, on the FRESH world: re-read the target first (the
 * button's own copy can be ~200 ms old — a chair taken or a step away since the last
 * proximity pass), act only on what that read says, then re-read so the button reflects
 * the result (talk → panel open → the button goes). `refresh` returns the current pick.
 */
export function interactNow(
  refresh: () => Interaction | null,
  perform: (it: Interaction) => void,
): void {
  const fresh = refresh();
  if (fresh) perform(fresh);
  refresh();
}

/**
 * Whether two picks are the same action on the same target (null equals null). A scene target
 * counts as the same while the button would look and do the same — its id, icon and words — not
 * its distance, which changes with every step.
 */
export function sameInteraction(a: Interaction | null, b: Interaction | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "sit" && b.kind === "sit") return a.seatIndex === b.seatIndex;
  if (a.kind === "talk" && b.kind === "talk") return a.npc === b.npc;
  if (a.kind === "target" && b.kind === "target") {
    const x = a.target;
    const y = b.target;
    return x.kind === y.kind && x.id === y.id && x.icon === y.icon && x.label === y.label && x.short === y.short && x.hold === y.hold;
  }
  return true; // stand === stand
}

/**
 * Whether a held target must be let go of now (Task 19): it is no longer the pick, or it is no longer a
 * hold (a teammate arrived, so the switch became a two-person press). The ~5 Hz proximity pass asks this,
 * which is how walking out of reach, an overlay opening or a pause end a hold on this side too.
 */
export function holdEnded(held: InteractTarget | null, next: Interaction | null): boolean {
  if (held === null) return false;
  return !(next !== null && next.kind === "target" && next.target.id === held.id && next.target.hold === true);
}

/** Which seats and whether the legacy world's AI 조교 are around (`interactInputAt`). Default: the legacy world. */
export interface InteractWorld {
  /** The active map's seats (activeMap's `seats`). */
  seats: readonly Seat[];
  /** The legacy world's AI 조교 are here (only there: the village's guides are scene targets). */
  npcs: boolean;
}

const LEGACY_WORLD: InteractWorld = { seats: SEATS, npcs: true };

/**
 * Read the world around `(x, z)` into an `InteractInput`. `seatIndex` is the local
 * player's own server-confirmed seat (-1 standing); `isOccupied` reports seats taken
 * by ANY player (self + remotes); `targets` is what the active scene offers (interactTargets.ts);
 * `world` names the seats of the map (default: the legacy world's chairs and its 조교).
 * Allocates one small object — call it at the ~5 Hz UI cadence or on a key press, never per frame.
 */
export function interactInputAt(
  x: number,
  z: number,
  seatIndex: number,
  isOccupied: (index: number) => boolean,
  npcPanelOpen: boolean,
  targets?: readonly InteractTarget[],
  world: InteractWorld = LEGACY_WORLD,
): InteractInput {
  const seated = seatIndex >= 0;
  let seat: InteractInput["seat"] = null;
  if (!seated) {
    const index = nearestFreeSeat(x, z, isOccupied, SEAT_REACH, world.seats);
    if (index !== null) {
      seat = { index, dist: Math.hypot(x - world.seats[index].x, z - world.seats[index].z) };
    }
  }
  const near = world.npcs ? nearestNpc(x, z, NPC_TALK_RADIUS) : null;
  const npc = near ? { id: near.id, dist: npcDistance(near.id, x, z) } : null;
  return { seated, seat, npc, npcPanelOpen, targets };
}

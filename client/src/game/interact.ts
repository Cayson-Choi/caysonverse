/**
 * Context-sensitive interaction (controls overhaul, Task 10): ONE target for E / F
 * and for the on-screen action button - sit on a bench, stand up, or use what the scene offers (a door,
 * the keypad, a guide). Pure: the world is read once by `interactInputAt` (throttled to ~5 Hz by
 * the ActionButton, never per frame), `pickInteraction` decides, and the rest is labels.
 */

import { SEAT_REACH, nearestFreeSeat, type Seat } from "@caysonverse/shared/worldMap";

/**
 * Something a scene offers besides the benches: the memorial hall's door, a house keypad, a guide to talk to, the
 * fishing kiosk. A scene plugs its list in through interactTargets.ts; `dist` is metres from the player to the target.
 */
export interface InteractTarget {
  kind: "door" | "object";
  id: string;
  dist: number;
  icon: string;
  label: string;
  /** The word for the 60 px round touch button, when `label` is too long for it. */
  short?: string;
  /** Pressed and held instead of tapped. */
  hold?: boolean;
  /**
   * Which target wins when several are in reach: the higher number first, the nearer one among equals (default 0).
   */
  priority?: number;
  /**
   * Gives way to a free seat in reach: while a seat is offered this target is not (the bus stop's board button: its area
   * covers the shelter, and the bus takes riders only 30 s an hour, so outside that minute it must not take the E key
   * from the bench). Absent: the target competes with the seat by distance as before.
   */
  yieldsToSeat?: boolean;
}

export type Interaction =
  | { kind: "sit"; seatIndex: number }
  | { kind: "stand" }
  | { kind: "target"; target: InteractTarget };

/** What is within reach right now. `dist` is metres from the player to the target. */
export interface InteractInput {
  seated: boolean;
  /** Nearest FREE seat within SEAT_REACH (null while seated). */
  seat: { index: number; dist: number } | null;
  /** What the active scene offers. */
  targets?: readonly InteractTarget[];
}

/**
 * The one thing E / F / the button would do now, or null.
 *  - Seated -> stand, whatever is nearby (the seat is the only thing you can do).
 *  - Seat and scene targets in reach -> the nearest; an exact tie goes seat > target.
 *    Among scene targets the higher `priority` wins, then the nearer one, then the earlier one in the list.
 *    A target that `yieldsToSeat` is not offered while a free seat is in reach.
 */
export function pickInteraction(i: InteractInput): Interaction | null {
  if (i.seated) return { kind: "stand" };
  let best: Interaction | null = null;
  let bestDist = Infinity;
  // Strict `<`: of equal distances the one considered first wins.
  if (i.seat) {
    best = { kind: "sit", seatIndex: i.seat.index };
    bestDist = i.seat.dist;
  }
  const targets = i.targets;
  if (targets) {
    let nearest: InteractTarget | null = null;
    for (let k = 0; k < targets.length; k++) {
      const c = targets[k];
      if (c.yieldsToSeat && i.seat) continue; // a free seat in reach goes first (see InteractTarget.yieldsToSeat)
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

/** Icon for the button: the chair for sit/stand, the target's own otherwise. */
export function interactionIcon(i: Interaction): string {
  return i.kind === "target" ? i.target.icon : "🪑";
}

/** Full Korean label (desktop pill text, aria-label). */
export function interactionLabel(i: Interaction): string {
  switch (i.kind) {
    case "sit":
      return "앉기";
    case "stand":
      return "일어서기";
    case "target":
      return i.target.label;
  }
}

/** Short label for the 60 px round touch button. */
export function interactionShortLabel(i: Interaction): string {
  return i.kind === "target" ? (i.target.short ?? i.target.label) : interactionLabel(i);
}

/**
 * Do what E / the button would do, on the FRESH world: re-read the target first (the
 * button's own copy can be ~200 ms old — a chair taken or a step away since the last
 * proximity pass), act only on what that read says, then re-read so the button reflects
 * the result. `refresh` returns the current pick.
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

/** The seats of the map the player stands in (`interactInputAt`). */
export interface InteractWorld {
  /** The active map's seats (activeMap's `seats`). */
  seats: readonly Seat[];
}

/**
 * Read the world around `(x, z)` into an `InteractInput`. `seatIndex` is the local
 * player's own server-confirmed seat (-1 standing); `isOccupied` reports seats taken
 * by ANY player (self + remotes); `targets` is what the active scene offers (interactTargets.ts);
 * `world` names the seats of the map.
 * Allocates one small object - call it at the ~5 Hz UI cadence or on a key press, never per frame.
 */
export function interactInputAt(
  x: number,
  z: number,
  seatIndex: number,
  isOccupied: (index: number) => boolean,
  targets: readonly InteractTarget[] | undefined,
  world: InteractWorld,
): InteractInput {
  const seated = seatIndex >= 0;
  let seat: InteractInput["seat"] = null;
  if (!seated) {
    const index = nearestFreeSeat(x, z, isOccupied, SEAT_REACH, world.seats);
    if (index !== null) {
      seat = { index, dist: Math.hypot(x - world.seats[index].x, z - world.seats[index].z) };
    }
  }
  return { seated, seat, targets };
}

/**
 * A remote avatar sitting down and getting up, ON ITS TIMELINE (pure: RemotePlayer's frame runs it, the tests
 * simulate it with the real playout and interpolation).
 *
 * The seat is server-authoritative: a patch changes `Player.seatIndex` and, in the same patch, puts the player on
 * the seat (or on its dismount spot). The record takes `seatIndex` at once — the sit prompts and the occupancy need
 * it now — but the avatar is drawn one playout lag behind the newest data (playout.ts). So each seat change is
 * stamped with the timeline time of the pose that came with it (`SeatLine`), and the avatar starts to sit down or
 * get up only when its render time reaches that stamp: where the mover really was when the server seated it, not
 * metres before (the sit clip used to start up to ~1.9 m short of the seat, the body sliding on with frozen legs and
 * then zipping onto the seat). From there the avatar moves the way the local player does (LocalPlayer):
 *
 *  - a bench (a seat with `seatY`): sitting glides from the pose it is DRAWN at onto the seat over SIT_GLIDE, and
 *    getting up glides from the drawn pose to the server's dismount spot over STAND_GLIDE — from wherever the body
 *    is, also when the stand comes while the sit-down is still under way (it used to start from the seat and jump);
 *  - a legacy chair (no `seatY`): it snaps onto the seat and onto the dismount spot, exactly as it always did.
 *
 * The pose sampled meanwhile holds the previous pose up to a seat change (`Snapshot.placed`), so nothing walks the
 * avatar through the chair or the bench before the seat motion takes over.
 */

import { liftForSeatY } from "@caysonverse/shared/sitPose";
import type { Seat } from "@caysonverse/shared/worldMap";
import { lerpAngle } from "./yaw";
import {
  SIT_GLIDE,
  STAND_GLIDE,
  glideAt,
  sitDownLift,
  standUpLift,
  windowProgress,
  type Glide,
} from "./seatMotion";

/** One seat change of a remote: the seat (-1 = got up), stamped with the timeline time of its pose. */
export interface SeatChange {
  t: number;
  seat: number;
}

/** A remote's seat changes not drawn yet (oldest first), and the seat as far as the drawn avatar has got. */
export interface SeatLine {
  /** The seat the avatar is drawn on (-1 = standing): the newest change the render time has reached. */
  drawn: number;
  pending: SeatChange[];
}

/** A line for a remote that is on `seat` (or standing, -1) when it is added: nothing to replay. */
export function createSeatLine(seat: number): SeatLine {
  return { drawn: seat, pending: [] };
}

/** Note a seat change that came with the pose stamped `t` on the remote's timeline. */
export function pushSeatChange(line: SeatLine, t: number, seat: number): void {
  line.pending.push({ t, seat });
}

/** The oldest seat change the render time has reached, taken off the line (undefined if none is due). */
export function takeDueSeatChange(line: SeatLine, renderT: number): SeatChange | undefined {
  const next = line.pending[0];
  if (!next || !(renderT >= next.t)) return undefined;
  line.pending.shift();
  line.drawn = next.seat;
  return next;
}

/** A pose on the ground: position and facing. */
export interface GroundPose {
  x: number;
  z: number;
  yaw: number;
}

export type SeatMode = "up" | "sitting" | "seated" | "standing";

/** What a seat change starts (the caller plays the clip and returns its length, s), or what ends a clip. */
export type SeatTransition = "sit" | "stand" | "seated" | "up";

/** The seat motion of one remote avatar (owned by its RemotePlayer, mutated in place). */
export interface SeatMotion {
  mode: SeatMode;
  /** The seat sat on, being sat on or got up from (-1: none). */
  seat: number;
  /** The seat is a bench (has `seatY`): glides and a lift. A legacy chair snaps. */
  bench: boolean;
  /** The bench's full lift (m) onto its surface (0 for a chair). */
  lift: number;
  /** The lift the body had when it started to get up (the sit-down may have been cut short). */
  liftFrom: number;
  /** Seconds into the current sit-down / stand-up clip, and its length. */
  elapsed: number;
  duration: number;
  /** Where the avatar sits: the seat's spot and facing. */
  seatPose: GroundPose;
  /** Sitting down on a bench: from the drawn pose onto the seat (null otherwise). */
  glide: Glide | null;
  /** Getting up: the pose drawn when it started (the glide to the dismount spot starts there). */
  standFrom: GroundPose;
}

/** The motion of a remote added while on `seat` (already seated: held on it from the first frame) or standing. */
export function createSeatMotion(seat: number, seats: readonly Seat[], at: GroundPose): SeatMotion {
  const m: SeatMotion = {
    mode: "up",
    seat: -1,
    bench: false,
    lift: 0,
    liftFrom: 0,
    elapsed: 0,
    duration: 0,
    seatPose: { x: at.x, z: at.z, yaw: at.yaw },
    glide: null,
    standFrom: { x: at.x, z: at.z, yaw: at.yaw },
  };
  if (seat >= 0) {
    noteSeat(m, seat, seats, at);
    m.mode = "seated";
  }
  return m;
}

/** Remember the seat being sat on: whether it is a bench, its lift, its spot (`fallback`: the seat is not on this map). */
function noteSeat(m: SeatMotion, seat: number, seats: readonly Seat[], fallback: GroundPose): void {
  const s = seats[seat];
  m.seat = seat;
  m.bench = s !== undefined && s.seatY !== undefined;
  m.lift = liftForSeatY(s?.seatY);
  m.seatPose.x = s ? s.x : fallback.x;
  m.seatPose.z = s ? s.z : fallback.z;
  m.seatPose.yaw = s ? s.yaw : fallback.yaw;
}

/** The lift (m) the seat motion raises the avatar by right now: eased in sitting down, held, eased out getting up. */
export function seatLift(m: SeatMotion): number {
  switch (m.mode) {
    case "sitting":
      return m.lift === 0 ? 0 : sitDownLift(m.lift, m.elapsed, m.duration);
    case "seated":
      return m.lift;
    case "standing":
      return m.liftFrom === 0 ? 0 : standUpLift(m.liftFrom, m.elapsed, m.duration);
    default:
      return 0;
  }
}

function copyPose(to: GroundPose, from: GroundPose): void {
  to.x = from.x;
  to.z = from.z;
  to.yaw = from.yaw;
}

/**
 * One frame of a remote's seat motion. `renderT` is its render time and `target` the pose sampled there; `drawn` is
 * the pose the avatar was drawn at on the previous frame, and is overwritten with the pose to draw now. Each seat
 * change the render time has reached is started (`transition("sit" | "stand")` plays the clip and returns its
 * length in seconds); a clip that ends calls `transition("seated" | "up")`. Allocation-free.
 */
export function stepSeatMotion(
  m: SeatMotion,
  line: SeatLine,
  renderT: number,
  target: GroundPose,
  delta: number,
  seats: readonly Seat[],
  drawn: GroundPose,
  transition: (what: SeatTransition) => number,
): void {
  // 1) The seat changes the render time has reached. Normally one at a time (they are a lag apart at least); when
  //    the render time jumped over several (it resynced after an outage, a hidden tab), only where they end up is
  //    played — not a sit-down and a stand-up in the same frame.
  let change = takeDueSeatChange(line, renderT);
  for (let next = change && takeDueSeatChange(line, renderT); next; next = takeDueSeatChange(line, renderT)) change = next;
  const down = m.mode === "sitting" || m.mode === "seated";
  if (change && change.seat >= 0 && !(down && change.seat === m.seat)) {
    // Sit down: a bench glides from where the avatar is drawn onto the seat; a chair snaps onto it.
    noteSeat(m, change.seat, seats, target);
    if (m.bench) {
      m.glide = {
        fromX: drawn.x,
        fromZ: drawn.z,
        fromYaw: drawn.yaw,
        toX: m.seatPose.x,
        toZ: m.seatPose.z,
        toYaw: m.seatPose.yaw,
        window: SIT_GLIDE,
      };
    } else {
      m.glide = null;
      copyPose(drawn, m.seatPose);
    }
    m.liftFrom = 0;
    m.elapsed = 0;
    m.duration = transition("sit");
    m.mode = "sitting";
  } else if (change && change.seat < 0 && down) {
    // Get up: from the drawn pose (and the lift the body has) — not from the seat, which the body may not have
    // reached yet when the stand comes right after the sit.
    m.liftFrom = seatLift(m);
    copyPose(m.standFrom, drawn);
    m.glide = null;
    m.elapsed = 0;
    m.duration = transition("stand");
    m.mode = "standing";
  }

  // 2) The clip clock, and the clips that end.
  if (m.mode === "sitting" || m.mode === "standing") m.elapsed += delta;
  if (m.mode === "sitting" && m.elapsed >= m.duration) {
    m.mode = "seated";
    m.glide = null;
    transition("seated");
  } else if (m.mode === "standing" && m.elapsed >= m.duration) {
    m.mode = "up";
    m.seat = -1;
    m.bench = false;
    m.lift = 0;
    m.liftFrom = 0;
    transition("up");
  }

  // 3) The pose to draw.
  switch (m.mode) {
    case "up":
      copyPose(drawn, target);
      break;
    case "sitting":
      if (m.glide) glideAt(m.glide, m.elapsed, m.duration, drawn);
      else copyPose(drawn, m.seatPose);
      break;
    case "seated":
      copyPose(drawn, m.seatPose);
      break;
    case "standing":
      if (m.bench) {
        // The stand-up clip carries the body from where it was to the dismount spot (the sampled pose: the server's
        // dismount spot, or on along the path once the mover walks off).
        const k = windowProgress(m.elapsed, m.duration, STAND_GLIDE);
        drawn.x = m.standFrom.x + (target.x - m.standFrom.x) * k;
        drawn.z = m.standFrom.z + (target.z - m.standFrom.z) * k;
        drawn.yaw = lerpAngle(m.standFrom.yaw, target.yaw, k);
      } else copyPose(drawn, target); // a chair: on the dismount spot at once
      break;
  }
}

/** Whether the avatar is on its bench right now (what hangs inside the bench is clipped away: benchClip.ts). */
export function onBenchNow(m: SeatMotion): boolean {
  if (!m.bench) return false;
  return m.mode === "seated" || m.mode === "standing" || (m.mode === "sitting" && m.elapsed >= m.duration * SIT_GLIDE.to);
}

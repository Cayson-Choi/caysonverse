/**
 * The village bus as a driver drives it (owner 2026-11-15: "도로에 캐릭터가 서 있으면 버스가 통과해버려" — the bus drove
 * straight through avatars standing on the road).
 *
 * The timetable (transit.ts) is still the plan: every 10 minutes the bus leaves the stop, runs the lap at its eased cruise,
 * waits at the red lights and pulls into the stop. On top of it the server's `BusDriver` looks ahead along the lap every
 * tick: an avatar in the bus's path makes it brake (a constant, comfortable deceleration, harder only when someone steps
 * right in front) and stand `gapM` short of them; once the way has been clear for a moment it drives on, re-planning the
 * rest of the lap from rest where it stood (the same eased start, the same red lights). A long hold sounds the horn.
 *
 * What the server publishes is the `BusDrive` (the plan's start, an active brake, the next departure): small, changes only
 * when the driver decides something, and every client evaluates it at the synced server time with the same functions
 * here, so the bus moves smoothly and every client sees the same bus in the same place.
 *
 * Timetable: a delay is absorbed by the 10-minute headway (a lap is under a minute). If a bus is held so long that it
 * could not be back with the boarding half minute before its next departure, that departure moves to the next 10-minute
 * slot, and the published `departMs` (what the stop's countdown reads) says so at once: the countdown never runs out on a
 * bus that is not there.
 */

import {
  PARKED_POSE,
  TRANSIT,
  buildTripTimeline,
  busMotionAt,
  nextRestDistance,
  routeLength,
  routePoseAtDistance,
  tripTimeline,
  type BusTrip,
  type TransitPoint,
} from "./transit";

/** The bus braking from `speed` (m/ms) at `atMs`, `distance` m along the lap, at `decel` (m/ms²) until it stands. */
export interface BusBrake {
  atMs: number;
  distance: number;
  speed: number;
  decel: number;
}

/** What the server publishes about the bus: everything a client needs to draw it at any instant. */
export interface BusDrive {
  /** The departure (Unix ms) the current lap left the stop at (the trip's id while it is out). */
  tripStartMs: number;
  /** The current plan: the bus left rest at `fromMs`, `fromDistance` m along the lap, and drives the timeline from there. */
  fromMs: number;
  fromDistance: number;
  /** Braking for someone in its way (null: driving its plan). */
  brake: BusBrake | null;
  /** The next departure from the stop (Unix ms, on the 10-minute grid). */
  departMs: number;
}

/** The driver's tuning (m, m/s, m/s², ms). */
export const BUS_DRIVER = {
  /** How often the server's driver looks ahead (ms). */
  tickMs: 100,
  /** Clear space the bus keeps between its nose and an avatar's body when it stops for them (m). */
  gapM: 1.5,
  /** Half the bus's width (m; village_bus.glb 2.49 m) and its mirrors' reach out (villageLayout.ts BUS_MIRROR_REACH.side). */
  halfWidthM: 1.25,
  /** How far the mirrors reach past the nose (m; busBody.ts BUS_MIRRORS.ahead): the gap is kept from them, not the nose. */
  mirrorAheadM: 0.37,
  /** An avatar's body radius (shared worldMap PLAYER_RADIUS). */
  avatarRadiusM: 0.4,
  /** Sideways slack between the bus's flank and an avatar it passes (m): someone on the pavement (kerb at r 37) is passed. */
  sideSlackM: 0.15,
  /** How far ahead of its nose the driver looks (m): a comfortable stop from the cruise plus the gap and spare. */
  lookM: 14,
  /** A comfortable stop (m/s²) and the hardest the bus brakes before it simply stands (someone stepped right in front). */
  comfortDecel: 1.6,
  minDecel: 0.6,
  maxDecel: 7,
  /** The driver's reaction (s) and spare distance (m) when deciding to brake. */
  reactionS: 0.3,
  spareM: 0.3,
  /** It drives on when nobody has been within this of its nose (beyond the gap) for `clearHoldMs`. */
  clearM: 2.5,
  clearHoldMs: 1200,
  /** The horn: after standing this long for someone, and again every `hornEveryMs` while they stay. */
  hornAfterMs: 2500,
  hornEveryMs: 10000,
} as const;

/** The timetable's own drive at `utcMs` (no one ever in the way): the lap of the current 10-minute slot. */
export function scheduledDrive(utcMs: number): BusDrive {
  const slot = Math.floor(utcMs / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
  return { tripStartMs: slot, fromMs: slot, fromDistance: 0, brake: null, departMs: slot + TRANSIT.departureEveryMs };
}

/** Where a brake has brought the bus `utcMs` (m along the lap) and its speed then (m/ms). */
export function brakeMotion(b: BusBrake, utcMs: number): { distance: number; speed: number } {
  if (!(b.speed > 0) || !(b.decel > 0)) return { distance: b.distance, speed: 0 };
  const stopAfter = b.speed / b.decel;
  const tau = Math.max(0, Math.min(stopAfter, utcMs - b.atMs));
  return { distance: b.distance + b.speed * tau - 0.5 * b.decel * tau * tau, speed: b.speed - b.decel * tau };
}

/** Where a brake brings the bus to a stand (m along the lap). */
export function brakeStopDistance(b: BusBrake): number {
  if (!(b.speed > 0) || !(b.decel > 0)) return b.distance;
  return b.distance + (b.speed * b.speed) / (2 * b.decel);
}

/** When a brake has brought the bus to a stand (Unix ms). */
export function brakeStopMs(b: BusBrake): number {
  return !(b.speed > 0) || !(b.decel > 0) ? b.atMs : b.atMs + b.speed / b.decel;
}

/** The bus's motion under a drive at `utcMs`: distance along the lap (m), speed (m/s), waiting at a light, and whether it is back at the stop. */
export function busDriveMotion(
  drive: BusDrive,
  utcMs: number,
): { distance: number; speed: number; waiting: boolean; parked: boolean } {
  if (drive.brake) {
    const m = brakeMotion(drive.brake, utcMs);
    return { distance: m.distance, speed: m.speed * 1000, waiting: false, parked: false };
  }
  if (utcMs < drive.fromMs) return { distance: drive.fromDistance, speed: 0, waiting: drive.fromDistance > 0, parked: drive.fromDistance <= 0 };
  const tl = tripTimeline(drive.fromMs, drive.fromDistance);
  if (utcMs >= tl.endMs) return { distance: routeLength(), speed: 0, waiting: false, parked: true };
  return { ...busMotionAt(utcMs, drive.fromMs, drive.fromDistance), parked: false };
}

/**
 * The drive once the bus has left on every departure due by `utcMs` (a parked bus whose departure has come leaves on a
 * fresh lap). The same object when nothing changed. The server and every client apply it, so a client draws the bus
 * pulling away on the dot without waiting for the server's next word.
 */
export function advanceDrive(drive: BusDrive, utcMs: number): BusDrive {
  let d = drive;
  for (let guard = 0; guard < 4 && utcMs >= d.departMs && busDriveMotion(d, d.departMs).parked; guard++) {
    d = { tripStartMs: d.departMs, fromMs: d.departMs, fromDistance: 0, brake: null, departMs: d.departMs + TRANSIT.departureEveryMs };
  }
  // a client (or a server) that missed more than a few laps catches up with the timetable
  if (utcMs >= d.departMs && busDriveMotion(d, d.departMs).parked) return scheduledDrive(utcMs);
  return d;
}

/** The trip as the HUD, the stop and the ride read it: the drive at `utcMs` in the shape of the timetable's `BusTrip`. */
export function busDriveTrip(driveIn: BusDrive, utcMs: number): BusTrip {
  const drive = advanceDrive(driveIn, utcMs);
  const m = busDriveMotion(drive, utcMs);
  if (!m.parked) {
    const length = routeLength();
    return {
      tripId: drive.tripStartMs,
      startMs: drive.tripStartMs,
      nextStartMs: drive.departMs,
      status: "inTransit",
      progress: length > 0 ? m.distance / length : 0,
      pose: routePoseAtDistance(m.distance),
      waiting: m.waiting,
    };
  }
  if (utcMs >= drive.departMs - TRANSIT.boardingMs) {
    return {
      tripId: drive.departMs,
      startMs: drive.departMs,
      nextStartMs: drive.departMs + TRANSIT.departureEveryMs,
      status: "boarding",
      progress: 0,
      pose: PARKED_POSE,
      waiting: false,
    };
  }
  return { tripId: drive.tripStartMs, startMs: drive.tripStartMs, nextStartMs: drive.departMs, status: "atStop", progress: 1, pose: PARKED_POSE, waiting: false };
}

/** The centre-distance limit (m along the lap) a lone avatar at `p` puts on a bus at `distance`: Infinity when it is not in the way. */
function limitFor(distance: number, p: TransitPoint, length: number): number {
  const half = TRANSIT.busLengthM / 2;
  const lateral = BUS_DRIVER.halfWidthM + BUS_DRIVER.avatarRadiusM + BUS_DRIVER.sideSlackM;
  const step = 0.4;
  // from just behind the nose (someone who slipped in at a front corner) to the look-ahead's end
  for (let s = distance + half - 0.6; s <= distance + half + BUS_DRIVER.lookM; s += step) {
    if (s > length) break;
    const at = routePoseAtDistance(s);
    const fx = Math.sin(at.yaw);
    const fz = Math.cos(at.yaw);
    const rx = p.x - at.x;
    const rz = p.z - at.z;
    const along = rx * fx + rz * fz;
    if (Math.abs(along) > step / 2 + 1e-9) continue;
    const side = Math.abs(-rx * fz + rz * fx);
    if (side > lateral) continue;
    // the avatar's body surface along the lap, less the gap and half a bus: where the bus's centre must stop
    return s + along - BUS_DRIVER.avatarRadiusM - BUS_DRIVER.gapM - BUS_DRIVER.mirrorAheadM - half;
  }
  return Number.POSITIVE_INFINITY;
}

/** The farthest the bus's centre may go (m along the lap) for the avatars at `obstacles`, from where it is (`distance`). */
export function busLimitAhead(distance: number, obstacles: readonly TransitPoint[]): number {
  const length = routeLength();
  let limit = Number.POSITIVE_INFINITY;
  const reach = TRANSIT.busLengthM / 2 + BUS_DRIVER.lookM + BUS_DRIVER.halfWidthM + 1;
  const nose = routePoseAtDistance(Math.min(length, distance + TRANSIT.busLengthM / 2));
  for (const p of obstacles) {
    // a cheap first cut: nobody farther from the nose than the look-ahead can be in the way
    if (Math.hypot(p.x - nose.x, p.z - nose.z) > reach) continue;
    limit = Math.min(limit, limitFor(distance, p, length));
  }
  return limit;
}

/** A brake from (`distance`, `speedMps`) that stands the bus within `allowed` m: comfortable when it can be, a stand on the spot when it cannot. */
export function brakeFor(utcMs: number, distance: number, speedMps: number, allowed: number): BusBrake {
  if (!(speedMps > 0.01) || allowed <= 0.05) return { atMs: utcMs, distance, speed: 0, decel: 0 };
  const a = Math.max(BUS_DRIVER.minDecel, (speedMps * speedMps) / (2 * allowed));
  if (a > BUS_DRIVER.maxDecel) return { atMs: utcMs, distance, speed: 0, decel: 0 };
  return { atMs: utcMs, distance, speed: speedMps / 1000, decel: a / 1e6 };
}

/** When a drive's bus is due back at the stop (Unix ms), taking a brake's stand (and the moment it waits) into account. */
export function projectedArrivalMs(drive: BusDrive, utcMs: number): number {
  if (!drive.brake) return tripTimeline(drive.fromMs, drive.fromDistance).endMs;
  const from = Math.max(utcMs, brakeStopMs(drive.brake)) + BUS_DRIVER.clearHoldMs;
  return buildTripTimeline(from, brakeStopDistance(drive.brake)).endMs;
}

/** The departure that leaves the bus its boarding half minute after it is back (the drive's own, or a later 10-minute slot). */
export function settledDepartMs(drive: BusDrive, utcMs: number): number {
  const due = projectedArrivalMs(drive, utcMs) + TRANSIT.boardingMs;
  if (due <= drive.departMs) return drive.departMs;
  return Math.ceil(due / TRANSIT.departureEveryMs) * TRANSIT.departureEveryMs;
}

/**
 * The server's bus driver (one per village room). `step` every BUS_DRIVER.tickMs with the avatars on the road; it returns
 * true when the drive changed (publish it at once). Pure apart from its own state: no clocks, no room.
 */
export class BusDriver {
  drive: BusDrive;
  /** Counts the horn's toots (a client toots once per new value). */
  horn = 0;
  /** Since when the bus has stood for someone (null: not standing for anyone). */
  private blockedSince: number | null = null;
  private clearSince: number | null = null;
  private lastHorn = 0;
  private lastStep: number;

  constructor(utcMs: number) {
    this.drive = scheduledDrive(utcMs);
    this.lastStep = utcMs;
  }

  /** Standing for someone in its way right now. */
  get blocked(): boolean {
    return this.drive.brake !== null;
  }

  step(utcMs: number, obstacles: readonly TransitPoint[]): boolean {
    let changed = false;
    // a clock that jumped (a test's clock, a suspended process): start from the timetable again
    if (utcMs < this.lastStep - 1000 || utcMs - this.lastStep > 10_000) {
      this.drive = scheduledDrive(utcMs);
      this.blockedSince = null;
      this.clearSince = null;
      changed = true;
    }
    this.lastStep = utcMs;
    const advanced = advanceDrive(this.drive, utcMs);
    if (advanced !== this.drive) {
      this.drive = advanced;
      changed = true;
    }
    const m = busDriveMotion(this.drive, utcMs);
    if (m.parked) {
      this.blockedSince = null;
      this.clearSince = null;
      return changed;
    }
    const limit = busLimitAhead(m.distance, obstacles);
    const brake = this.drive.brake;
    if (brake) {
      if (limit < brakeStopDistance(brake) - 0.02) {
        this.drive = { ...this.drive, brake: brakeFor(utcMs, m.distance, m.speed, limit - m.distance) };
        changed = true;
      }
      if (m.speed <= 0) {
        if (limit - m.distance > BUS_DRIVER.clearM) {
          this.clearSince ??= utcMs;
          if (utcMs - this.clearSince >= BUS_DRIVER.clearHoldMs) {
            // the way is clear: drive the rest of the lap from rest here
            this.drive = { ...this.drive, fromMs: utcMs, fromDistance: m.distance, brake: null };
            this.blockedSince = null;
            this.clearSince = null;
            changed = true;
          }
        } else {
          this.clearSince = null;
          this.blockedSince ??= utcMs;
          if (utcMs - this.blockedSince >= BUS_DRIVER.hornAfterMs && utcMs - this.lastHorn >= BUS_DRIVER.hornEveryMs) {
            this.horn++;
            this.lastHorn = utcMs;
            changed = true;
          }
        }
      }
    } else if (limit < nextRestDistance(utcMs, this.drive.fromMs, this.drive.fromDistance) - 0.01) {
      // someone stands short of where the bus would next stop anyway: brake once a comfortable stop needs the room left
      const allowed = limit - m.distance;
      const v = m.speed;
      const need = (v * v) / (2 * BUS_DRIVER.comfortDecel) + v * BUS_DRIVER.reactionS + BUS_DRIVER.spareM;
      if (allowed <= need) {
        this.drive = { ...this.drive, brake: brakeFor(utcMs, m.distance, v, allowed) };
        this.clearSince = null;
        changed = true;
      }
    }
    const depart = settledDepartMs(this.drive, utcMs);
    if (depart !== this.drive.departMs) {
      this.drive = { ...this.drive, departMs: depart };
      changed = true;
    }
    return changed;
  }
}

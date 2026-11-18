/**
 * 케이슨랜드's rides on the server (docs/designs/caysonland/DESIGN.md section 5): who sits where. A ride itself is not simulated: it is a pure
 * function of the wall clock (shared/land/*.ts), so the server only decides
 *  - RideBoard { ride }: the player is free (not on a seat, the bus or the lake chair) and standing in the park within reach of the ride's
 *    boarding pad. While the ride's station is boarding (after the unload, before the gate closes) and a seat is free, the lowest free seat of
 *    THAT ride is theirs (`Player.rideId` + `Player.rideSeat`); one ride at a time. Otherwise the seat is RESERVED (notice "reserved"): the player is
 *    seated automatically when the ride next loads, if they are still standing near the pad (first-time-player review: a press outside the window
 *    used to be refused silently);
 *  - RideLeave and a leave / disconnect: the seat is freed;
 *  - the unload: every rider of a finished cycle is put off when the next cycle begins (`tick`, twice a second).
 * (The file keeps its first name, villageCoaster.ts; the class now serves every ride in shared/land/rides.ts.)
 */
import type { Client } from "colyseus";
import { VillageMsg, VillageServerMsg, type RideNoticePayload } from "@caysonverse/shared/village/messages";
import { RIDES, rideById, rideByKey, type RideDef } from "@caysonverse/shared/land/rides";

interface PlayerLike {
  rideSeat: number;
  rideId: number;
  seatIndex: number;
  busSeat: number;
  fishSpot: number;
  area: string;
  x: number;
  z: number;
}

/** How long a reservation lasts (ms), and how much farther from the pad (m) a waiting player may drift before it is dropped. */
const WAIT_MAX_MS = 8 * 60_000;
const WAIT_SLACK_M = 5;

export interface CoasterHost {
  wallClock(): number;
  player(sessionId: string): PlayerLike | undefined;
  players(): Iterable<[string, PlayerLike]>;
  clients(): Iterable<Client>;
  onMessage(type: string, handler: (client: Client, payload: unknown) => void): void;
}

export class VillageCoaster {
  /** the cycle each rider boarded in */
  private readonly boardedIn = new Map<string, number>();
  /** players who pressed "board" outside the window (or on a full ride): the ride they wait for, and until when (wall ms) */
  private readonly waiting = new Map<string, { rideId: number; until: number }>();
  constructor(private readonly host: CoasterHost) {}

  register(): void {
    this.host.onMessage(VillageMsg.RideBoard, (client, payload) => this.board(client, payload));
    this.host.onMessage(VillageMsg.RideLeave, (client) => this.tryLeave(client));
  }

  private taken(ride: RideDef): Set<number> {
    const set = new Set<number>();
    for (const [, p] of this.host.players()) if (p.rideSeat >= 0 && p.rideId === ride.id) set.add(p.rideSeat);
    return set;
  }

  private notice(client: Client, reason: RideNoticePayload["reason"]): void {
    client.send(VillageServerMsg.RideNotice, { reason } satisfies RideNoticePayload);
  }

  /** Give `p` a seat of `ride` now (the station is boarding): "ok", or "full". */
  private seat(sid: string, p: PlayerLike, ride: RideDef, cycle: number): "ok" | "full" {
    const taken = this.taken(ride);
    let seat = -1;
    const candidates = ride.boardingSeats ? ride.boardingSeats(this.host.wallClock()) : null;
    for (let n = 0; n < (candidates ? candidates.length : ride.seats); n++) {
      const i = candidates ? candidates[n]! : n;
      if (!taken.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat < 0) return "full";
    p.rideId = ride.id;
    p.rideSeat = seat;
    this.boardedIn.set(sid, cycle);
    this.waiting.delete(sid);
    return "ok";
  }

  board(client: Client, payload?: unknown): void {
    const p = this.host.player(client.sessionId);
    if (!p || p.rideSeat >= 0) return;
    const key = payload !== null && typeof payload === "object" ? (payload as { ride?: unknown }).ride : undefined;
    const ride = key === undefined ? RIDES[0]! : rideByKey(key);
    if (!ride || ride.seats <= 0) return this.notice(client, "closed");
    if (p.seatIndex >= 0 || p.busSeat >= 0 || p.fishSpot >= 0 || p.area !== "park") return this.notice(client, "busy");
    if (!this.canBoard(p, ride, 0)) return this.notice(client, "far");
    const now = ride.statusAt(this.host.wallClock());
    if (now.status === "boarding" && this.seat(client.sessionId, p, ride, now.cycle) === "ok") return;
    // not loading now (or no seat in this gondola/train): the seat is reserved for the next load
    this.waiting.set(client.sessionId, { rideId: ride.id, until: this.host.wallClock() + WAIT_MAX_MS });
    this.notice(client, "reserved");
  }

  /** The rule a boarding player must meet: standing free in the park at the ride's boarding pad (`slack` m more for a waiting player). */
  private canBoard(p: PlayerLike, ride: RideDef, slack: number): boolean {
    if (p.seatIndex >= 0 || p.busSeat >= 0 || p.fishSpot >= 0 || p.area !== "park") return false;
    return Math.hypot(p.x - ride.pad.x, p.z - ride.pad.z) <= ride.pad.radius + ride.reach + slack;
  }

  /** A rider's own leave: refused while the ride's seat is aloft (the wheel); a waiting player's leave cancels the reservation. */
  private tryLeave(client: Client): void {
    const p = this.host.player(client.sessionId);
    if (p && p.rideSeat >= 0) {
      const ride = rideById(p.rideId);
      if (ride?.canLeave && !ride.canLeave(p.rideSeat, this.host.wallClock())) return this.notice(client, "aloft");
    }
    this.leave(client.sessionId);
  }

  leave(sessionId: string): void {
    const p = this.host.player(sessionId);
    if (p && p.rideSeat >= 0) {
      p.rideSeat = -1;
      p.rideId = 0;
    }
    this.boardedIn.delete(sessionId);
    this.waiting.delete(sessionId);
  }

  /** Twice a second: reserved players are seated when their ride loads; a cycle that is over unloads. */
  tick(): void {
    const wall = this.host.wallClock();
    for (const [sid, w] of [...this.waiting]) {
      const p = this.host.player(sid);
      const ride = rideById(w.rideId);
      if (!p || !ride || p.rideSeat >= 0 || wall > w.until || !this.canBoard(p, ride, WAIT_SLACK_M)) {
        this.waiting.delete(sid);
        continue;
      }
      const now = ride.statusAt(wall);
      if (now.status === "boarding") this.seat(sid, p, ride, now.cycle);
    }
    if (this.boardedIn.size === 0) return;
    for (const [sid, cycle] of [...this.boardedIn]) {
      const p = this.host.player(sid);
      if (!p || p.rideSeat < 0) {
        this.boardedIn.delete(sid);
        continue;
      }
      const ride = rideById(p.rideId);
      if (!ride || ride.statusAt(wall).cycle >= cycle + (ride.rideCycles ?? 1)) this.leave(sid);
    }
  }
}

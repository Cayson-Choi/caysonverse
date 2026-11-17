/**
 * 케이슨랜드 별똥별 급행 on the server (design docs/designs/caysonland/DESIGN.md §5): who sits where. The train itself is not
 * simulated: it is a pure function of the wall clock (shared/land/coaster.ts coasterAt), so the server only decides
 *  - RideBoard: allowed while the station is boarding (after the unload, before the gate closes), the player is standing in the
 *    open village (not on a seat, not on the bus, not at the lake chair), and a seat is free: the lowest free seat is theirs;
 *  - RideLeave and a leave / disconnect: the seat is freed;
 *  - the unload: every rider of a finished lap is put off when the next cycle's unloading phase begins (`tick`, twice a second).
 * Phase 2: only in the park (area "park"), standing within the queue gate's reach (parkArea.ts COASTER_QUEUE_PAD).
 */
import type { Client } from "colyseus";
import { VillageMsg, VillageServerMsg, type RideNoticePayload } from "@caysonverse/shared/village/messages";
import { COASTER_SEATS, coasterAt } from "@caysonverse/shared/land/coaster";
import { COASTER_BOARD_REACH_M, COASTER_QUEUE_PAD } from "@caysonverse/shared/village/parkArea";

interface PlayerLike {
  rideSeat: number;
  seatIndex: number;
  busSeat: number;
  fishSpot: number;
  area: string;
  x: number;
  z: number;
}

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
  constructor(private readonly host: CoasterHost) {}

  register(): void {
    this.host.onMessage(VillageMsg.RideBoard, (client) => this.board(client));
    this.host.onMessage(VillageMsg.RideLeave, (client) => this.leave(client.sessionId));
  }

  private taken(): Set<number> {
    const set = new Set<number>();
    for (const [, p] of this.host.players()) if (p.rideSeat >= 0) set.add(p.rideSeat);
    return set;
  }

  private notice(client: Client, reason: RideNoticePayload["reason"]): void {
    client.send(VillageServerMsg.RideNotice, { reason } satisfies RideNoticePayload);
  }

  board(client: Client): void {
    const p = this.host.player(client.sessionId);
    if (!p || p.rideSeat >= 0) return;
    const now = coasterAt(this.host.wallClock());
    if (now.status !== "boarding") return this.notice(client, "closed");
    if (!this.canBoard(p)) return this.notice(client, "busy");
    const taken = this.taken();
    let seat = -1;
    for (let i = 0; i < COASTER_SEATS; i++)
      if (!taken.has(i)) {
        seat = i;
        break;
      }
    if (seat < 0) return this.notice(client, "full");
    p.rideSeat = seat;
    this.boardedIn.set(client.sessionId, now.cycle);
  }

  /** The rule a boarding player must meet: standing free in the park at the coaster's queue gate. */
  private canBoard(p: PlayerLike): boolean {
    if (p.seatIndex >= 0 || p.busSeat >= 0 || p.fishSpot >= 0 || p.area !== "park") return false;
    return Math.hypot(p.x - COASTER_QUEUE_PAD.x, p.z - COASTER_QUEUE_PAD.z) <= COASTER_QUEUE_PAD.radius + COASTER_BOARD_REACH_M;
  }

  leave(sessionId: string): void {
    const p = this.host.player(sessionId);
    if (p && p.rideSeat >= 0) p.rideSeat = -1;
    this.boardedIn.delete(sessionId);
  }

  /** Twice a second: a lap that is over unloads at the start of the next cycle's unloading phase. */
  tick(): void {
    if (this.boardedIn.size === 0) return;
    const now = coasterAt(this.host.wallClock());
    for (const [sid, cycle] of [...this.boardedIn]) {
      const p = this.host.player(sid);
      if (!p || p.rideSeat < 0) {
        this.boardedIn.delete(sid);
        continue;
      }
      // the lap of `cycle` is over once the clock is in a later cycle (the unload starts with it); give the train its 5 s to arrive
      if (now.cycle > cycle) this.leave(sid);
    }
  }
}

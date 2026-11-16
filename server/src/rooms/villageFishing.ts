import type { Client } from "colyseus";
import type { Player } from "@caysonverse/shared/schema";
import { LAKE_FISHING_SPOTS } from "@caysonverse/shared/village/lakeLayout";
import { KST_OFFSET_MS, phaseAt as dayPhaseAt, sunAt } from "@caysonverse/shared/village/sunClock";
import { fishingSeatIndex, fishingSpotOfSeat } from "@caysonverse/shared/village/benchSeats";
import {
  FISHING,
  FISH_KINDS,
  castLine,
  createFishingState,
  fishingSync,
  holdLine,
  nearRentalPad,
  nearReturnPad,
  rentRod,
  returnRod,
  sitDown,
  standUp,
  strikeLine,
  tickFishing,
  type FishKind,
  type FishingAction,
  type FishingActionResult,
  type FishingReject,
  type FishingState,
} from "@caysonverse/shared/village/fishing";
import {
  VillageMsg,
  VillageServerMsg,
  type FishCatchPayload,
  type FishingBoardEntry,
  type FishingBoardPayload,
  type FishingHoldPayload,
  type FishingRejectedPayload,
  type FishingSitPayload,
  type FishingStatePayload,
  type FishingTrophyPayload,
} from "@caysonverse/shared/village/messages";
import { RateWindow } from "./rateLimit";

/** What the fishing rules need from the room (VillageRoom hands this over; tests can fake it). */
export interface FishingHost {
  /** The room's clock (ms): the fishing clock; a test seam. */
  now(): number;
  /** The server's wall clock (Unix ms), for the sun and the board day. */
  wallClock(): number;
  player(sessionId: string): Player | undefined;
  /** Every connected client. */
  clients(): Iterable<Client>;
  /** Sit `client` on village seat `seatIndex` through the room's own Sit pipeline: seated, taken by someone else, or dropped. */
  sit(client: Client, seatIndex: number): "seated" | "taken" | "dropped";
  /** Stand `client` up through the room's own Stand pipeline. */
  stand(client: Client): void;
  onMessage(type: string, handler: (client: Client, payload: unknown) => void): void;
}

/** One visitor's fishing: the pure state plus the message caps. Server memory only. */
interface Session {
  fs: FishingState;
  short: RateWindow;
  long: RateWindow;
  /** Messages dropped by the cap (a hint for abuse watching; nothing is punished). */
  warnings: number;
  lastFightSentAt: number;
}

const BOARD_PER_KIND = 5;
const FIGHT_SEND_MS = 250;
/** The board's day turns over at 04:00 Korean time (design 9.6). */
const BOARD_TURN_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function boardDay(wallMs: number): number {
  return Math.floor((wallMs + KST_OFFSET_MS - BOARD_TURN_MS) / DAY_MS);
}

/** 0 (midday) .. 1 (night): the sun clock's night weight at a wall-clock time. */
export function nightAt(wallMs: number): number {
  return dayPhaseAt(sunAt(wallMs).elevationDeg).night;
}

/** The spot index of a FishingSit payload: an integer 0..29, or a spot id ("P01"); -1 for anything else. */
export function parseSpot(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) return -1;
  const spot = (payload as Partial<FishingSitPayload>).spot;
  if (typeof spot === "number") return Number.isInteger(spot) && spot >= 0 && spot < LAKE_FISHING_SPOTS.length ? spot : -1;
  if (typeof spot === "string") return LAKE_FISHING_SPOTS.findIndex((s) => s.id === spot);
  return -1;
}

/**
 * 케이슨 낚시터 (A10) on the server: the room-facing half of shared/village/fishing.ts. It owns the per-visitor sessions, the
 * message handlers with their caps, the rental and return rules tied to the 30 spots, the synced `Player` fields, the personal
 * state / rejection messages, the trophy alerts and the "오늘의 대어" board. Every outcome is decided by the pure functions of
 * `fishing.ts` from the server's clock and dice; a message only ever says "I want to do this now".
 *
 * Seats: the 30 fishing chairs are the lake's first seats in `VILLAGE_SEATS` (`fishingSeatIndex(spot)`), sat on through the
 * room's own Sit pipeline (so `validateSit`'s front / side rules and the one-sitter-per-seat occupancy are the only way in; a
 * spot is taken exactly when its chair is). VillageRoom calls `onSeated` / `onStood` from that pipeline, whichever message
 * (Sit or FishingSit, Stand or FishingStand) started it.
 */
export class VillageFishing {
  /** The dice. Replaceable in tests. */
  random: () => number = Math.random;
  /** Dev only (never in production): force every fish to this species, or "cycle" through all of them. */
  force: FishKind | "cycle" | null;
  private cycle = 0;
  private readonly sessions = new Map<string, Session>();
  private board = new Map<FishKind, FishingBoardEntry[]>();
  private day: number;

  constructor(private readonly host: FishingHost) {
    const dev = process.env.NODE_ENV === "production" ? "" : (process.env.CV_FISHING_FORCE_KIND ?? "");
    this.force = dev === "cycle" ? "cycle" : (FISH_KINDS as readonly string[]).includes(dev) ? (dev as FishKind) : null;
    this.day = boardDay(host.wallClock());
  }

  /** The visitor's state (tests read it). */
  stateOf(sessionId: string): FishingState | undefined {
    return this.sessions.get(sessionId)?.fs;
  }
  warningsOf(sessionId: string): number {
    return this.sessions.get(sessionId)?.warnings ?? 0;
  }
  boardEntries(): FishingBoardEntry[] {
    this.rollBoardDay();
    return FISH_KINDS.flatMap((k) => this.board.get(k) ?? []);
  }

  /** Register the fishing messages and the board request. */
  register(): void {
    const h = this.host;
    h.onMessage(VillageMsg.FishingRentRod, (c) => this.guarded(c, (s, p) => this.rent(c, s, p)));
    h.onMessage(VillageMsg.FishingReturnRod, (c) => this.guarded(c, (s, p) => this.giveBack(c, s, p)));
    h.onMessage(VillageMsg.FishingSit, (c, payload) => this.guarded(c, (s, p) => this.sit(c, s, p, payload)));
    h.onMessage(VillageMsg.FishingCast, (c) => this.guarded(c, (s, p) => this.cast(c, s, p)));
    h.onMessage(VillageMsg.FishingStrike, (c) => this.guarded(c, (s, p) => this.strike(c, s, p)));
    h.onMessage(VillageMsg.FishingHold, (c, payload) => this.guarded(c, (s, p) => this.hold(c, s, p, payload)));
    h.onMessage(VillageMsg.FishingStand, (c) => this.guarded(c, (s) => this.standMessage(c, s)));
    h.onMessage(VillageMsg.FishingBoardRequest, (c) => this.guarded(c, () => this.sendBoard(c)));
  }

  /** A visitor joined: a fresh session (no rod), the state and the board. */
  join(client: Client): void {
    this.sessions.set(client.sessionId, {
      fs: createFishingState(),
      short: new RateWindow(FISHING.rateShort.count, FISHING.rateShort.windowMs),
      long: new RateWindow(FISHING.rateLong.count, FISHING.rateLong.windowMs),
      warnings: 0,
      lastFightSentAt: 0,
    });
    this.resend(client);
  }

  /** A visitor is back after a drop (same session): everything it needs again. */
  resend(client: Client): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    this.sendState(client, s.fs, null);
    this.sendBoard(client);
  }

  /** A permanent leave: the rod disappears with the session (the seat is freed by the room). */
  leave(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** The room seated `sessionId` on `seatIndex` (any seat). A fishing chair with a rod in hand makes it `ready`. */
  onSeated(sessionId: string, seatIndex: number): void {
    const s = this.sessions.get(sessionId);
    const player = this.host.player(sessionId);
    if (!s || !player) return;
    this.apply(sessionId, s, player, sitDown(s.fs, this.host.now(), fishingSpotOfSeat(seatIndex)));
  }

  /** The room stood `sessionId` up (or is about to free the seat): the line comes out. */
  onStood(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    const player = this.host.player(sessionId);
    if (!s || !player) return;
    if (s.fs.spot < 0) return; // was not on a fishing chair
    this.apply(sessionId, s, player, standUp(s.fs, this.host.now()));
  }

  /** The 100 ms tick: stages that end by themselves, the fight, the automatic return, the board's day. */
  tick(): void {
    const now = this.host.now();
    this.rollBoardDay();
    for (const [sid, s] of this.sessions) {
      const player = this.host.player(sid);
      if (!player) continue;
      if (s.fs.rod && (player.area !== "village" || player.x < FISHING.lakeZoneMinX)) {
        this.apply(sid, s, player, returnRod(s.fs, now, { nearReturn: false, seated: false, auto: true }));
        continue;
      }
      const phase = s.fs.phase;
      if (phase === "none" || phase === "carry" || phase === "ready") continue;
      const r = tickFishing(s.fs, now);
      if (r.entered.length > 0) {
        this.apply(sid, s, player, r);
      } else {
        s.fs = r.state;
        if (phase === "fighting" && now - s.lastFightSentAt >= FIGHT_SEND_MS) {
          s.lastFightSentAt = now;
          this.sync(player, s.fs); // the fight's progress for every screen (fishReel)
          const c = this.clientOf(sid);
          if (c) this.sendState(c, s.fs, null);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- handlers

  /** Every fishing message: the sender must be in the village and under the caps (over them: dropped, only counted). */
  private guarded(client: Client, fn: (s: Session, p: Player) => void): void {
    const s = this.sessions.get(client.sessionId);
    const p = this.host.player(client.sessionId);
    if (!s || !p || p.area !== "village") return;
    const now = this.host.now();
    if (!s.short.tryAccept(now) || !s.long.tryAccept(now)) {
      s.warnings++;
      return;
    }
    fn(s, p);
  }

  private seated(p: Player): boolean {
    return p.seatIndex >= 0 || p.busSeat >= 0;
  }

  private rent(c: Client, s: Session, p: Player): void {
    this.finish(c, s, p, rentRod(s.fs, this.host.now(), { nearRental: nearRentalPad(p.x, p.z), seated: this.seated(p) }));
  }

  private giveBack(c: Client, s: Session, p: Player): void {
    this.finish(c, s, p, returnRod(s.fs, this.host.now(), { nearReturn: nearReturnPad(p.x, p.z), seated: this.seated(p) }));
  }

  private sit(c: Client, s: Session, p: Player, payload: unknown): void {
    const spot = parseSpot(payload);
    if (spot < 0) return this.reject(c, "bad_spot");
    if (p.seatIndex >= 0) return this.reject(c, "stand_first");
    if (this.host.now() - s.fs.lastSitAt < FISHING.sitGapMs) return this.reject(c, "too_soon");
    const result = this.host.sit(c, fishingSeatIndex(spot)); // -> onSeated
    if (result === "taken") this.reject(c, "spot_taken");
    else if (result === "dropped") this.reject(c, "too_far");
  }

  private cast(c: Client, s: Session, p: Player): void {
    this.finish(
      c,
      s,
      p,
      castLine(s.fs, this.host.now(), { seated: this.onItsChair(s, p), random: this.random, night: nightAt(this.host.wallClock()), force: this.nextForce() }),
    );
  }

  private strike(c: Client, s: Session, p: Player): void {
    if (!this.onItsChair(s, p)) return this.reject(c, "not_seated");
    this.finish(c, s, p, strikeLine(s.fs, this.host.now()));
  }

  private hold(c: Client, s: Session, p: Player, payload: unknown): void {
    const down = (payload as Partial<FishingHoldPayload> | null)?.down;
    if (typeof down !== "boolean") return;
    if (!this.onItsChair(s, p)) return this.reject(c, "not_seated");
    this.finish(c, s, p, holdLine(s.fs, this.host.now(), down));
  }

  private standMessage(c: Client, s: Session): void {
    if (this.host.now() - s.fs.lastSitAt < FISHING.sitGapMs) return this.reject(c, "too_soon");
    this.host.stand(c); // -> onStood
  }

  /** Seated on the fishing chair the session believes it is on (position and seat both server-side). */
  private onItsChair(s: Session, p: Player): boolean {
    return p.seatIndex >= 0 && s.fs.spot >= 0 && fishingSpotOfSeat(p.seatIndex) === s.fs.spot;
  }

  private nextForce(): FishKind | undefined {
    if (this.force === null) return undefined;
    if (this.force === "cycle") return FISH_KINDS[this.cycle++ % FISH_KINDS.length];
    return this.force;
  }

  // ---------------------------------------------------------------------------------------------- commit

  /** An action's result: rejected (a personal reason; stages the call ticked past are kept) or committed. */
  private finish(c: Client, s: Session, p: Player, r: FishingActionResult): void {
    if (!r.ok) {
      if (r.state !== s.fs || r.entered.length > 0) this.apply(c.sessionId, s, p, { ...r, ok: true, action: undefined });
      if (r.reject) this.reject(c, r.reject);
      return;
    }
    this.apply(c.sessionId, s, p, r);
  }

  /** Commit a transition: the state, the synced fields, the owner's message, and what entering `landed` does. */
  private apply(sessionId: string, s: Session, p: Player, r: FishingActionResult): void {
    s.fs = r.state;
    this.sync(p, s.fs);
    const c = this.clientOf(sessionId);
    // a Hold that changes no stage is not echoed (the fight's progress goes out on the tick)
    if (c && (r.action !== "hold" || r.entered.length > 0)) this.sendState(c, s.fs, r.action === "hold" ? null : (r.action ?? null));
    if (r.entered.includes("landed") && s.fs.catch) this.landed(sessionId, p, s.fs);
  }

  private sync(p: Player, fs: FishingState): void {
    const f = fishingSync(fs);
    if (p.rod !== f.rod) p.rod = f.rod;
    if (p.fishSpot !== f.fishSpot) p.fishSpot = f.fishSpot;
    if (p.fishPhase !== f.fishPhase) p.fishPhase = f.fishPhase;
    if (p.fishSeq !== f.fishSeq) p.fishSeq = f.fishSeq;
    if (p.fishSig !== f.fishSig) p.fishSig = f.fishSig;
    if (p.fishKind !== f.fishKind) p.fishKind = f.fishKind;
    if (p.fishCm !== f.fishCm) p.fishCm = f.fishCm;
    if (p.fishAt !== f.fishAt) p.fishAt = f.fishAt;
    if (p.fishReel !== f.fishReel) p.fishReel = f.fishReel;
  }

  // ---------------------------------------------------------------------------------------------- messages out

  private clientOf(sessionId: string): Client | undefined {
    for (const c of this.host.clients()) if (c.sessionId === sessionId) return c;
    return undefined;
  }

  private reject(c: Client, reason: FishingReject): void {
    c.send(VillageServerMsg.FishingRejected, { reason } satisfies FishingRejectedPayload);
  }

  private statePayload(fs: FishingState, action: FishingAction | null): FishingStatePayload {
    const now = this.host.now();
    const plan = fs.phase === "bite" ? fs.plan : null;
    const fish: FishCatchPayload | null = fs.catch
      ? { kind: fs.catch.kind, label: fs.catch.label, cm: fs.catch.cm, needsNet: fs.catch.needsNet, disposal: fs.catch.disposal, tier: fs.catch.tier }
      : null;
    return {
      rod: fs.rod,
      spot: fs.spot,
      phase: fs.phase,
      seq: fs.seq,
      phaseAt: Math.floor(fs.phaseAt) % 4294967296,
      serverNowMs: now,
      signal: plan ? plan.signal : null,
      windowOpensInMs: plan ? Math.round(plan.windowOpensAt - now) : null,
      windowClosesInMs: plan ? Math.round(plan.windowClosesAt - now) : null,
      holdMs: Math.round(fs.holdMs),
      holdNeedMs: fs.holdNeedMs,
      holdDown: fs.holdDown,
      lastResult: fs.lastResult,
      catch: fish,
      action,
    };
  }

  private sendState(c: Client, fs: FishingState, action: FishingAction | null): void {
    c.send(VillageServerMsg.FishingState, this.statePayload(fs, action));
  }

  // ---------------------------------------------------------------------------------------------- the board and the trophies

  private rollBoardDay(): void {
    const d = boardDay(this.host.wallClock());
    if (d !== this.day) {
      this.day = d;
      this.board = new Map();
    }
  }

  private boardPayload(): FishingBoardPayload {
    return { day: this.day, entries: this.boardEntries() };
  }

  private sendBoard(c: Client): void {
    c.send(VillageServerMsg.FishingBoard, this.boardPayload());
  }

  /** At the lake: in the village area, east of the lake zone's west edge. */
  private atLake(p: Player | undefined): boolean {
    return !!p && p.area === "village" && p.x >= FISHING.lakeZoneMinX;
  }

  /** A fish was landed: the board, then the alert to the people it concerns. */
  private landed(sessionId: string, p: Player, fs: FishingState): void {
    const fish = fs.catch!;
    this.rollBoardDay();
    const list = this.board.get(fish.kind) ?? [];
    const entry: FishingBoardEntry = { kind: fish.kind, label: fish.label, cm: fish.cm, by: p.nickname, at: this.host.wallClock() };
    list.push(entry);
    list.sort((a, b) => b.cm - a.cm || a.at - b.at);
    const kept = list.slice(0, BOARD_PER_KIND);
    this.board.set(fish.kind, kept);
    if (kept.includes(entry)) {
      const payload = this.boardPayload();
      for (const c of this.host.clients()) if (this.atLake(this.host.player(c.sessionId))) c.send(VillageServerMsg.FishingBoard, payload);
    }
    if (fish.tier === "none") return;
    const alert: FishingTrophyPayload = { sid: sessionId, by: p.nickname, kind: fish.kind, label: fish.label, cm: fish.cm, tier: fish.tier };
    for (const c of this.host.clients()) {
      const q = this.host.player(c.sessionId);
      if (!q || q.area !== "village") continue;
      if (fish.tier === "village" || this.atLake(q)) c.send(VillageServerMsg.FishingTrophy, alert);
    }
  }
}

import type { Client } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { BusRideStatePayload, ChatBroadcast } from "@caysonverse/shared/messages";
import { PATCH_RATE_MS, ROLE_STUDENT, VILLAGE_MAX_CLIENTS } from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import {
  CANDLE_RATE,
  SERVER_TIME_INTERVAL_MS,
  VillageMsg,
  VillageServerMsg,
  type CandleLitPayload,
  type FishingRejectedPayload,
  type FishingResultPayload,
  type FishingStatePayload,
  type KeypadResultPayload,
  type ServerTimePayload,
} from "@caysonverse/shared/village/messages";
import {
  FISHING_POND_REACH_M,
  FISHING_RENTAL_REACH_M,
  FISHING_SPOTS,
  castLine,
  createFishingState,
  distanceSquared,
  rentRod,
  reelLine,
  tickFishing,
  type FishingState,
} from "@caysonverse/shared/village/fishing";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "./PlayerRoom";
import { validateJoinOptions } from "./joinValidation";
import { RateWindow } from "./rateLimit";
import { DOOR_RATE, useDoor } from "./villageDoor";
import { candleCubby } from "./villageCandle";
import { validateSit } from "./seating";
import {
  BUS_STATE_RATE_MS,
  transitSnapshotAt,
  validateBusRide,
} from "./transitRuntime";
import { checkHouseKeypad, initialKeypadRate } from "./villageKeypad";
import type { KeypadRateState } from "@caysonverse/shared/village/buildingAccess";

/** Per-client bookkeeping (not part of synced state): the base's, plus the door-use cap. */
interface VillageTracking extends Tracking {
  /** Sliding-window rate cap for door uses (1 per second). */
  doorRate: RateWindow;
  /** Sliding-window rate cap for lighting candles (1 per 5 seconds, Task 9). */
  candleRate: RateWindow;
  /** Whether this session has been accepted onto the current scheduled trip. */
  busBoarded: boolean;
  /** Trip id assigned at boarding; a rider is cleared when that trip returns. */
  busTripId: number | null;
  /** Server-only state for house keypad failures and lockout. */
  keypadRate: KeypadRateState;
}

/**
 * 케이슨 마을: the open countryside village, a room on the shared `PlayerRoom` base.
 *
 * The base owns Move, Chat, Emoji, Jump and Typing, their caps, the "*" catch-all and the reconnection
 * lifecycle (the default 20 s window). This room supplies the village map (`villageGeometry`: the village
 * and the memorial hall's interior in ONE coordinate space), the spawn, and what only the village has:
 *  - join: `{ nickname, appearance }`, validated like the world's (no admin code, no kick);
 *  - the benches (`MessageType.Sit` / `Stand`, the world's seat messages): `VILLAGE_SEATS`, two per bench, with the
 *    world's rules — the pure `validateSit`, one sitter per seat, a seated player held in place (no Move, no Jump,
 *    no door), the seat freed on Stand and on every permanent leave but kept through a reconnection window;
 *  - `VillageMsg.UseDoor`: the memorial hall's door is a validated teleport (see `handleUseDoor`);
 *  - `VillageMsg.LightCandle` (Task 9): a candle in a cubby, told to everyone in the hall (see `handleLightCandle`);
 *  - the hall is a quiet place (`isQuiet`): Emoji and Jump are dropped there, chat still goes through;
 *  - chat is scoped by area (`deliverChat`): a line is heard only by the clients in the sender's area, so what is
 *    said inside the hall stays in the hall and the plaza's talk does not carry in. Emoji, Jump and Typing stay
 *    unscoped (they are the world's, relayed to everyone);
 *  - the server's clock (Task 7A, `VillageServerMsg.ServerTime`): sent to each visitor on join and on reconnect, and to everyone every
 *    5 minutes. The village's sun follows real Korean time, and the client reads the time of day from this clock
 *    (plus its own offset), not from the device's, which may be wrong.
 *
 * Topology — NOT a singleton like the world: the room is not pre-created, clients `joinOrCreate` it, and
 * `maxClients` (VILLAGE_MAX_CLIENTS = 30) makes Colyseus lock a full room, so the next visitor lands in
 * a new room (a shard). `autoDispose` stays on: an empty shard goes away (a ghost waiting out its
 * reconnection window keeps its seat reserved, so the shard stays until the window ends).
 *
 * Rejection policy is the base's: an invalid player message is DROPPED silently, never partially applied.
 */
export class VillageRoom extends PlayerRoom<WorldState, VillageTracking> {
  maxClients = VILLAGE_MAX_CLIENTS;
  patchRate = PATCH_RATE_MS;
  autoDispose = true;
  // WorldState (players + the announcement banner): the client's Banner reads the same fields in every
  // room. Nothing sets the announcement here (no admin), so it stays empty.
  state = new WorldState();

  /**
   * Bench occupancy: seatIndex (into VILLAGE_SEATS) → the sessionId sitting there. Server memory only (the player's
   * `seatIndex` is the synced mirror); freed through the single `releaseSeat` helper on every removal path.
   */
  private readonly occupancy = new Map<number, string>();

  /** Player objects currently on the bus; WeakSet keeps canMove allocation-free. */
  private readonly busRiders = new WeakSet<Player>();
  /** Fishing is room memory only: disconnecting or disposing a room loses the session's catch. */
  private readonly fishing = new Map<string, FishingState>();

  onCreate(): void {
    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.onMessage(MessageType.Sit, (client, payload) => {
      this.handleSit(client, payload);
    });
    this.onMessage(MessageType.Stand, (client) => {
      this.handleStand(client);
    });
    this.onMessage(VillageMsg.UseDoor, (client) => {
      this.handleUseDoor(client);
    });
    this.onMessage(VillageMsg.LightCandle, (client, payload: unknown) => {
      this.handleLightCandle(client, payload);
    });
    this.onMessage(MessageType.BusRide, (client, payload: unknown) => {
      this.handleBusRide(client, payload);
    });
    this.onMessage(VillageMsg.FishingRentRod, (client) => {
      this.handleFishingRentRod(client);
    });
    this.onMessage(VillageMsg.FishingCast, (client) => {
      this.handleFishingCast(client);
    });
    this.onMessage(VillageMsg.FishingReel, (client) => {
      this.handleFishingReel(client);
    });
    this.onMessage(VillageMsg.Keypad, (client, payload: unknown) => {
      this.handleKeypad(client, payload);
    });
    // The time of day: everyone's clock offset is refreshed every 5 minutes (drift, a device clock changed meanwhile).
    this.clock.setInterval(() => this.broadcastServerTime(), SERVER_TIME_INTERVAL_MS);
    // The bus is server-clocked. A 250 ms cadence keeps the render smooth while the
    // client interpolates between snapshots and every client sees the same signal.
    this.clock.setInterval(() => this.broadcastTransit(), BUS_STATE_RATE_MS);
    // A short server tick moves a waiting bobber into its submerged window. The client never chooses this transition.
    this.clock.setInterval(() => this.tickFishingSessions(), 100);
  }

  /** The server's wall clock (Unix epoch ms, UTC). A seam for tests; the door and move caps use `now()`. */
  protected wallClock(): number {
    return Date.now();
  }

  /** The server's clock for one visitor (on join; queued until their join completes) or for everyone. */
  private serverTime(): ServerTimePayload {
    return { serverTimeMs: this.wallClock() };
  }

  /** Re-send the server's clock to every client in the room. */
  broadcastServerTime(): void {
    this.broadcast(VillageServerMsg.ServerTime, this.serverTime());
  }

  onJoin(client: Client, options: unknown): void {
    const result = validateJoinOptions(options);
    if ("error" in result) {
      // Reject the join; Colyseus forwards this message to the client.
      throw new Error(result.error);
    }

    const spawn = this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    // Appearance: all 15 fields, written once here and never again.
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = VILLAGE_LAYOUT.spawn.yaw; // facing the fountain
    player.connected = true;
    player.role = ROLE_STUDENT; // the village has no admin
    player.area = "village";
    this.seatPlayer(client, player); // state + tracking (createTracking below)
    this.fishing.set(client.sessionId, createFishingState());
    client.send(VillageServerMsg.ServerTime, this.serverTime());
    const snapshot = transitSnapshotAt(this.wallClock());
    client.send(MessageType.BusState, snapshot);
    client.send(MessageType.BusRideState, { boarded: false, tripId: snapshot.tripId } satisfies BusRideStatePayload);
    this.sendFishingState(client, this.fishing.get(client.sessionId)!);
  }

  /**
   * A dropped visitor is back (same session): besides clearing the ghost flag (PlayerRoom), re-send the server's
   * clock. `onJoin` does not run on a reconnect, and the client binds its clock handler to the room again, so
   * without this a device that was never synced would wait up to 5 minutes for the next broadcast (Task 7A review m-c).
   */
  override onReconnect(client: Client): void {
    super.onReconnect(client);
    client.send(VillageServerMsg.ServerTime, this.serverTime());
    const snapshot = transitSnapshotAt(this.wallClock());
    client.send(MessageType.BusState, snapshot);
    const track = this.tracking.get(client.sessionId);
    const tripId = track?.busTripId ?? snapshot.tripId;
    client.send(MessageType.BusRideState, { boarded: track?.busBoarded === true, tripId } satisfies BusRideStatePayload);
    const state = this.fishing.get(client.sessionId);
    if (state) this.sendFishingState(client, state);
  }

  /** The village map: the open village plus the memorial hall's sealed interior. */
  protected geometry(): MapGeometry {
    return villageGeometry;
  }

  /** On the fountain plaza, within the layout's jitter of the spawn point, clamped into the bounds. */
  protected spawnPosition(): { x: number; z: number } {
    const { spawn } = VILLAGE_LAYOUT;
    return spawnInDisk(spawn.x, spawn.z, spawn.jitter, this.geometry());
  }

  /** The base bookkeeping plus the door-use cap. */
  protected createTracking(now: number): VillageTracking {
    return {
      ...baseTracking(now),
      doorRate: new RateWindow(DOOR_RATE.count, DOOR_RATE.windowMs),
      candleRate: new RateWindow(CANDLE_RATE.count, CANDLE_RATE.windowMs),
      busBoarded: false,
      busTripId: null,
      keypadRate: initialKeypadRate(),
    };
  }

  /** Clients to skip for one chat line or candle (those in another area); reused so a message costs no allocation. */
  private readonly otherArea: Client[] = [];

  /** Broadcast to the clients whose player is in `area` (one encode; the others are the `except` list). */
  private broadcastToArea(area: string, type: string, message: unknown): void {
    const skip = this.otherArea;
    skip.length = 0;
    for (const c of this.clients) {
      if (this.state.players.get(c.sessionId)?.area !== area) skip.push(c);
    }
    this.broadcast(type, message, skip.length > 0 ? { except: skip } : undefined);
    skip.length = 0;
  }

  /**
   * Chat is scoped by area (ruling): the line goes only to the clients in the sender's area, the sender
   * included. One broadcast (encoded once) with the other area's clients as `except`, like ClassRoom's hall
   * chat. A client with no seat yet counts as elsewhere.
   */
  protected deliverChat(client: Client, player: Player, text: string): void {
    const line: ChatBroadcast = { sid: client.sessionId, name: player.nickname, text };
    this.broadcastToArea(player.area, MessageType.Chat, line);
  }

  /** The memorial hall is quiet: no emoji, no jumping there (chat and walking are fine). */
  protected isQuiet(player: Player): boolean {
    return player.area === "hall";
  }

  /** Seated on a bench → Move and Jump are dropped silently: getting up is an explicit Stand. */
  protected canMove(player: Player): boolean {
    return player.seatIndex < 0 && !this.busRiders.has(player);
  }

  /**
   * Permanent departure (a consented leave or an expired reconnection window): free the bench seat FIRST, then the
   * base removes the player. A transient drop does not come here (the base's onDrop opens a window), so a ghost keeps
   * its seat until it is back or gone.
   */
  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) this.busRiders.delete(player);
    this.releaseSeat(client.sessionId);
    this.fishing.delete(client.sessionId);
    super.onLeave(client);
  }

  /** Publish the scheduled route and clear riders once their three-minute lap returns. */
  private broadcastTransit(): void {
    const now = this.wallClock();
    const snapshot = transitSnapshotAt(now);
    for (const client of this.clients) {
      const track = this.tracking.get(client.sessionId);
      if (!track?.busBoarded || track.busTripId === null) continue;
      // A rider stays on one lap only. Once the bus is back at the stop, the
      // placeholder ride ends and the player can board the next hourly trip.
      if (snapshot.status !== "inTransit" || snapshot.tripId !== track.busTripId) {
        track.busBoarded = false;
        track.busTripId = null;
        const player = this.state.players.get(client.sessionId);
        if (player) this.busRiders.delete(player);
        client.send(MessageType.BusRideState, { boarded: false, tripId: snapshot.tripId } satisfies BusRideStatePayload);
      }
    }
    this.broadcast(MessageType.BusState, snapshot);
  }

  /** Validate one board/leave request against the authoritative player pose and schedule. */
  private handleBusRide(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    const decision = validateBusRide(payload, {
      boarded: track.busBoarded,
      area: player.area,
      x: player.x,
      z: player.z,
    }, this.wallClock());
    if (!decision.ok) {
      client.send(MessageType.BusRejected, { reason: decision.notice });
      return;
    }
    const action = payload !== null && typeof payload === "object" ? (payload as { action?: unknown }).action : undefined;
    if (action === "board") {
      track.busBoarded = true;
      track.busTripId = decision.tripId;
      this.busRiders.add(player);
      client.send(MessageType.BusRideState, { boarded: true, tripId: decision.tripId } satisfies BusRideStatePayload);
      return;
    }
    // `leave` is accepted only for an existing rider by validateBusRide.
    track.busBoarded = false;
    track.busTripId = null;
    this.busRiders.delete(player);
    client.send(MessageType.BusRideState, { boarded: false, tripId: transitSnapshotAt(this.wallClock()).tripId } satisfies BusRideStatePayload);
  }

  /**
   * Sit pipeline (the world's, on the village's benches): sender must have a seat in state → the pure `validateSit`
   * on VILLAGE_SEATS (garbage / already seated / beyond SEAT_REACH → SILENT drop; taken by someone else → personal
   * Korean notice). On success, claim the seat, put the player on it (its spot and facing) and reset the move-clock
   * baseline so the seated span cannot later be spent as a one-shot displacement budget (D1). The client sees itself
   * seated once `seatIndex` syncs.
   */
  private handleSit(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const result = validateSit(
      { x: player.x, z: player.z, seatIndex: player.seatIndex },
      payload,
      this.occupancy,
      client.sessionId,
      VILLAGE_SEATS,
    );
    if (result === null) return; // malformed / already seated / out of reach → silent
    if ("reason" in result) {
      client.send(MessageType.SitRejected, { reason: result.reason }); // first come, first seated
      return;
    }

    const seat = VILLAGE_SEATS[result.seatIndex];
    // The distance gate already keeps a bench in the other area out of reach (the hall is hundreds of metres away);
    // the area check states it.
    if (seat.area !== player.area) return;
    this.occupancy.set(result.seatIndex, client.sessionId);
    player.seatIndex = result.seatIndex;
    player.x = seat.x;
    player.z = seat.z;
    player.yaw = seat.yaw;
    track.lastAcceptedAt = this.now();
  }

  /**
   * Stand pipeline: only a SEATED sender is served (else silent drop). The player is put on the seat's dismount spot
   * (clear of every collider, in front of the bench), the seat is freed, and the move-clock baseline is reset.
   */
  private handleStand(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    if (player.seatIndex < 0) return; // not seated → silent drop

    const seat = VILLAGE_SEATS[player.seatIndex];
    if (seat) {
      player.x = seat.standX;
      player.z = seat.standZ;
    }
    this.releaseSeat(client.sessionId);
    track.lastAcceptedAt = this.now();
  }

  /**
   * The ONE place a bench seat is freed: the occupancy entry (only if this session still owns it) and the synced
   * `seatIndex`. From Stand and onLeave — never from onDrop. A standing player is a no-op.
   */
  private releaseSeat(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.seatIndex < 0) return;
    if (this.occupancy.get(player.seatIndex) === sessionId) this.occupancy.delete(player.seatIndex);
    player.seatIndex = -1;
  }

  /**
   * Door pipeline (binding order): sender must have a seat → the pure rule `useDoor` decides from the
   * player's AUTHORITATIVE area and position (the payload is never read: a client cannot name a place or
   * claim to stand at the door); no door within reach → SILENT drop → per-client rate cap (1 per second;
   * checked after the distance so a press made too early does not use up the slot) → teleport.
   *
   * The teleport writes the new position, facing and area straight into state, so the speed check never
   * sees a jump, and resets the move-clock baseline (the same anti-teleport pattern as sitting and the
   * maze portal): the next Move is measured from the new spot, and a Move that still names the old spot
   * is hundreds of metres away and dropped. Server-authoritative: the client sees its new place when the
   * state syncs (its existing large-correction snap applies it).
   */
  private handleUseDoor(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop
    if (player.seatIndex >= 0) return; // sitting on a bench: stand up first (silent drop)

    const arrival = useDoor(player.area, player.x, player.z);
    if (arrival === null) return; // no door within reach → silent drop

    const now = this.now();
    if (!track.doorRate.tryAccept(now)) return; // flood → silent drop

    player.x = arrival.x;
    player.z = arrival.z;
    player.yaw = arrival.yaw;
    player.area = arrival.area;
    track.lastAcceptedAt = now;
  }

  /**
   * Candle pipeline (Task 9): sender must have a seat → the pure rule `candleCubby` decides from the player's
   * AUTHORITATIVE area and position and the named cubby (in the hall, within 1.5 m of its anchor on the ground) → SILENT
   * drop otherwise → per-client rate cap (1 per 5 seconds; after the distance, like the door) → `CandleLit` to every
   * client in the hall, the lighter included. Nothing is stored: each client burns the candle for 60 s itself.
   */
  private handleLightCandle(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    const cubby = payload !== null && typeof payload === "object" ? (payload as { cubby?: unknown }).cubby : undefined;
    const anchor = candleCubby(player.area, player.x, player.z, cubby);
    if (anchor === null) return;
    if (!track.candleRate.tryAccept(this.now())) return;
    const lit: CandleLitPayload = { cubby: anchor.id, by: player.nickname };
    this.broadcastToArea("hall", VillageServerMsg.CandleLit, lit);
  }

  /** Project the private state without exposing future bite timestamps to the browser. */
  private fishingPayload(state: FishingState, now = this.now()): FishingStatePayload {
    return {
      phase: state.phase,
      rodRented: state.rodRented,
      castId: state.castId,
      lastResult: state.lastResult,
      catch: state.catch ? { ...state.catch } : null,
      serverNowMs: now,
    };
  }

  private sendFishingState(client: Client, state: FishingState, now = this.now()): void {
    client.send(VillageServerMsg.FishingState, this.fishingPayload(state, now));
  }

  private sendFishingResult(client: Client, state: FishingState, event: FishingResultPayload["event"], now: number): void {
    client.send(VillageServerMsg.FishingResult, { ...this.fishingPayload(state, now), event } satisfies FishingResultPayload);
  }

  private sendFishingRejected(client: Client, reason: FishingRejectedPayload["reason"]): void {
    client.send(VillageServerMsg.FishingRejected, { reason } satisfies FishingRejectedPayload);
  }

  private fishingPlayer(client: Client): { player: Player; state: FishingState } | null {
    const player = this.state.players.get(client.sessionId);
    const state = this.fishing.get(client.sessionId);
    if (!player || !state || player.area !== "village" || player.seatIndex >= 0) return null;
    return { player, state };
  }

  private nearFishingSpot(player: Player, spot: { x: number; z: number }, reach: number): boolean {
    return distanceSquared({ x: player.x, z: player.z }, spot) <= reach * reach + 1e-9;
  }

  private handleFishingRentRod(client: Client): void {
    const found = this.fishingPlayer(client);
    if (!found) return;
    const now = this.now();
    const result = rentRod(found.state, now, this.nearFishingSpot(found.player, FISHING_SPOTS.rental, FISHING_RENTAL_REACH_M));
    if (!result.ok) {
      this.sendFishingRejected(client, result.reject!);
      return;
    }
    this.fishing.set(client.sessionId, result.state);
    this.sendFishingState(client, result.state, now);
  }

  private handleFishingCast(client: Client): void {
    const found = this.fishingPlayer(client);
    if (!found) return;
    const now = this.now();
    const result = castLine(
      found.state,
      now,
      this.nearFishingSpot(found.player, FISHING_SPOTS.pond, FISHING_POND_REACH_M),
    );
    if (!result.ok) {
      this.sendFishingRejected(client, result.reject!);
      return;
    }
    this.fishing.set(client.sessionId, result.state);
    this.sendFishingResult(client, result.state, "cast", now);
  }

  private handleFishingReel(client: Client): void {
    const found = this.fishingPlayer(client);
    if (!found) return;
    const now = this.now();
    const result = reelLine(found.state, now);
    if (!result.ok) {
      this.fishing.set(client.sessionId, result.state);
      this.sendFishingRejected(client, result.reject!);
      if (result.state !== found.state) this.sendFishingState(client, result.state, now);
      return;
    }
    this.fishing.set(client.sessionId, result.state);
    const event = result.event;
    if (event && event !== "rod_rented") this.sendFishingResult(client, result.state, event, now);
    else this.sendFishingState(client, result.state, now);
  }

  /** Advance only the sessions that are waiting; no state is persisted beyond the room lifetime. */
  private tickFishingSessions(): void {
    const now = this.now();
    for (const [sessionId, state] of this.fishing) {
      const stepped = tickFishing(state, now);
      if (!stepped.ok || !stepped.event) continue;
      this.fishing.set(sessionId, stepped.state);
      let client: Client | undefined;
      for (const candidate of this.clients) {
        if (candidate.sessionId === sessionId) {
          client = candidate;
          break;
        }
      }
      if (!client) continue;
      if (stepped.event === "bite" || stepped.event === "missed") {
        this.sendFishingResult(client, stepped.state, stepped.event, now);
      } else {
        this.sendFishingState(client, stepped.state, now);
    }
  }

  /** House keypad: authoritative position + server-only code digest, then a placeholder hall teleport until house GLBs exist. */
  private handleKeypad(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || player.seatIndex >= 0 || player.area !== "village") return;
    const body = payload !== null && typeof payload === "object" ? (payload as { buildingId?: unknown; code?: unknown }) : {};
    if (typeof body.buildingId !== "string" || typeof body.code !== "string") return;
    const result = checkHouseKeypad({
      buildingId: body.buildingId,
      playerId: client.sessionId,
      area: player.area,
      x: player.x,
      z: player.z,
      code: body.code,
      nowMs: this.now(),
      rate: track.keypadRate,
    });
    track.keypadRate = result.state;
    const decision = result.decision;
    const response: KeypadResultPayload = decision.ok
      ? { ok: true, buildingId: decision.buildingId, area: "hall", placeholder: true }
      : {
          ok: false,
          buildingId: body.buildingId,
          reason:
            decision.reason === "invalid_request" || decision.reason === "not_keypad_building"
              ? "invalid_request"
              : decision.reason === "rate_limited"
                ? "wrong_code"
                : decision.reason,
          retryAfterMs: decision.retryAfterMs,
        };
    client.send(VillageServerMsg.KeypadResult, response);
    if (!decision.ok) return;
    const now = this.now();
    const spawn = VILLAGE_LAYOUT.memorial.interior.spawn;
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.area = "hall";
    track.lastAcceptedAt = now;
  }
}

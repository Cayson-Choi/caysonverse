import type { Client } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { BusRideStatePayload, ChatBroadcast } from "@caysonverse/shared/messages";
import { PATCH_RATE_MS, PLAYER_RADIUS, VILLAGE_MAX_CLIENTS } from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import {
  CANDLE_RATE,
  SERVER_TIME_INTERVAL_MS,
  VillageMsg,
  VillageServerMsg,
  type CandleStatePayload,
  type KeypadResultPayload,
  type ServerTimePayload,
} from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, isHouseArea, isLotArea, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_PLACES, HOUSE_POLICY, houseFloorArea, houseNumberOf, parseHouseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { houseIsReady } from "@caysonverse/shared/village/housesGeometry";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { arrivalArea, freeSpawnSpot, spreadArrival } from "@caysonverse/shared/village/arrivalSpot";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "./PlayerRoom";
import { validateJoinOptions } from "./joinValidation";
import { RateWindow } from "./rateLimit";
import { DOOR_RATE, HOUSE_ENTRY_RESCUE_M, useDoor, useHouseExit, useStair } from "./villageDoor";
import { useLotDoor } from "@caysonverse/shared/village/villageLots";
import { candleCubby } from "./villageCandle";
import { memorial } from "../memorial/service";
import { MemorialServerMsg } from "@caysonverse/shared/memorial/messages";
import { CANDLES, type CandleBook } from "./candleBook";
import { chooseStandSpot, validateSit } from "./seating";
import { STAND_BLOCKED } from "@caysonverse/shared/village/standSpot";
import { VillageFishing } from "./villageFishing";
import {
  BUS_STATE_RATE_MS,
  riderOnTrip,
  transitSnapshotAt,
  validateBusRide,
} from "./transitRuntime";
import { BUS_DRIVER, BusDriver, busDriveTrip } from "@caysonverse/shared/village/busDrive";
import { busDismountSpot } from "@caysonverse/shared/village/busSeats";
import { VillageCoaster } from "./villageCoaster";
import { rideScheduleKey } from "@caysonverse/shared/land/rides";

import { parkGeometry, useParkDoor } from "@caysonverse/shared/village/parkArea";
import {
  BUS_CAPACITY,
  BUS_SEATS,
  busPlaceOf,
  busRiderWorldPose,
  freeBusEntry,
  seatStandUpSpot,
  type BusRiderPoseFull,
} from "@caysonverse/shared/village/busCabin";
import { validateBusMove, validateBusSit } from "./busCabinMove";
import { pushOutOfBus, type BusBodyPose } from "@caysonverse/shared/village/busBody";
import { isBlocked } from "@caysonverse/shared/collision";
import type { TransitPoint } from "@caysonverse/shared/village/transit";
import { checkHouseKeypad, initialKeypadRate, nearHouseDoor } from "./villageKeypad";
import type { KeypadRateState } from "@caysonverse/shared/village/buildingAccess";

/** Per-client bookkeeping (not part of synced state): the base's, plus the door-use cap. */
/** Most BusMove messages a second a rider may send (the client sends ten while it walks) and most sit / stand messages. */
const BUS_MOVE_MAX_PER_SEC = 14;
const BUS_ACT_MAX_PER_SEC = 6;

interface VillageTracking extends Tracking {
  /** Sliding-window rate cap for door uses (1 per second). */
  doorRate: RateWindow;
  /** The assigned entry spot and its nominal door position while a house or lot interior loads. */
  interiorEntry: { area: string; placed: TransitPoint; nominal: TransitPoint } | null;
  /** Sliding-window rate cap for lighting candles (1 per 5 seconds, Task 9). */
  candleRate: RateWindow;
  /** Whether this session has been accepted onto the current scheduled trip. */
  busBoarded: boolean;
  /** Trip id assigned at boarding; a rider is cleared when that trip returns. */
  busTripId: number | null;
  /** Server-only state for house keypad failures and lockout. */
  keypadRate: KeypadRateState;
  /** When the last step inside the bus was accepted (ms, the room clock): the walk speed budget. */
  busMoveAt: number;
  /** Caps on the bus messages: the steps (BusMove) and the rest (sit, stand): a flood never speeds a rider up or buys CPU. */
  busMoveRate: RateWindow;
  busActRate: RateWindow;
  /**
   * SHA-256 of the device key sent at join (memorial stage B), or null. Server memory only — never in the synced state. The
   * key maps to an `owner` through the DB (memorial/service.ts); memorial-2 W1/W3 read it with `memorialKeyHash`.
   */
  keyHash: string | null;
  /** The joining tab's own id (client/src/net/tabId.ts), or null: a fresh join of the same tab replaces its old session (`onJoin`). */
  tabId: string | null;
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
/**
 * Players per village room: VILLAGE_MAX_CLIENTS, or `CV_VILLAGE_MAX_CLIENTS` (a positive integer up to 200) for a load test
 * (scripts/loadtest-bots.mjs --max-clients). Read when a room is made.
 */
export function villageMaxClients(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CV_VILLAGE_MAX_CLIENTS);
  return Number.isInteger(n) && n > 0 && n <= 200 ? n : VILLAGE_MAX_CLIENTS;
}

export class VillageRoom extends PlayerRoom<WorldState, VillageTracking> {
  maxClients = villageMaxClients();
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
  /**
   * The bus's driver (shared busDrive.ts): the timetable's lap, stopping for anyone standing in its way. Created on the
   * first tick (the room's clock is a test seam that may be replaced after construction).
   */
  private busDriver: BusDriver | null = null;
  private lastBusBroadcast = 0;
  /** The avatars on the road this tick (reused). */
  private readonly busObstacles: TransitPoint[] = [];
  /** The fishing lake's rules (villageFishing.ts): room memory only, a disconnect loses the rod and the catch. */
  private readonly fishing: VillageFishing = new VillageFishing({
    now: () => this.now(),
    wallClock: () => this.wallClock(),
    player: (sid) => this.state.players.get(sid),
    clients: () => this.clients,
    sit: (client, seatIndex) => this.handleSit(client, { seatIndex }),
    stand: (client) => this.handleStand(client),
    onMessage: (type, handler) => {
      this.onMessage(type, handler);
    },
  });

  /** The 별똥별 급행 (villageCoaster.ts): who sits where; the train is the wall clock's. */
  private readonly coaster: VillageCoaster = new VillageCoaster({
    wallClock: () => this.wallClock(),
    player: (sid) => this.state.players.get(sid),
    players: () => this.state.players.entries(),
    clients: () => this.clients,
    onMessage: (type, handler) => {
      this.onMessage(type, handler);
    },
  });

  /** The process's candles (every room's hall shows the same ones); a test may swap in its own. */
  protected candles: CandleBook = CANDLES;
  private offCandles: (() => void) | null = null;
  private offClaims: (() => void) | null = null;

  onCreate(): void {
    // A candle lit in ANY room's hall burns in this room's hall too (the book is shared by every shard).
    this.offCandles = this.candles.onLit((c) => this.broadcastToArea("hall", VillageServerMsg.CandleLit, c));
    // A cubby claimed, edited or given an approved photo in ANY room (or over HTTPS) → every hall refetches that cubby.
    this.offClaims = memorial()?.onClaimUpdated((p) => this.broadcastToArea("hall", MemorialServerMsg.ClaimUpdated, p)) ?? null;
    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.onMessage(MessageType.Sit, (client, payload) => {
      this.handleSit(client, payload);
    });
    this.onMessage(MessageType.Stand, (client) => {
      this.handleStand(client);
    });
    this.onMessage(VillageMsg.UseDoor, (client, payload: unknown) => {
      this.handleUseDoor(client, payload);
    });
    this.onMessage(VillageMsg.UseStair, (client) => {
      this.handleUseStair(client);
    });
    this.onMessage(VillageMsg.LightCandle, (client, payload: unknown) => {
      this.handleLightCandle(client, payload);
    });
    this.onMessage(MessageType.BusRide, (client, payload: unknown) => {
      this.handleBusRide(client, payload);
    });
    this.onMessage(MessageType.BusMove, (client, payload: unknown) => {
      this.handleBusMove(client, payload);
    });
    this.onMessage(MessageType.BusSit, (client, payload: unknown) => {
      this.handleBusSit(client, payload);
    });
    this.onMessage(MessageType.BusStand, (client) => {
      this.handleBusStand(client);
    });
    this.fishing.register(); // the fishing messages (villageFishing.ts)
    this.coaster.register(); // RideBoard / RideLeave (villageCoaster.ts)
    this.onMessage(VillageMsg.Keypad, (client, payload: unknown) => {
      this.handleKeypad(client, payload);
    });
    // The time of day: everyone's clock offset is refreshed every 5 minutes (drift, a device clock changed meanwhile).
    this.clock.setInterval(() => this.broadcastServerTime(), SERVER_TIME_INTERVAL_MS);
    // The bus is server-clocked. A 250 ms cadence keeps the render smooth while the
    // client interpolates between snapshots and every client sees the same signal.
    // The driver looks ahead every BUS_DRIVER.tickMs: a brake, a re-start or a horn is published at once.
    this.clock.setInterval(() => this.tickBus(), BUS_DRIVER.tickMs);
    // The fishing stages that end by themselves (nibble, bite, the fight, ...). The client never chooses these transitions.
    this.clock.setInterval(() => this.fishing.tick(), 100);
    // The coaster's laps that are over unload (the train and its stations are the wall clock's; only the seats are state).
    this.clock.setInterval(() => this.coaster.tick(), 500);
  }

  /** The server's wall clock (Unix epoch ms, UTC). A seam for tests; the door and move caps use `now()`. */
  protected wallClock(): number {
    // DEV only (never in production): CV_DEV_CLOCK_OFFSET_MS shifts the village's clock, to see the hourly bus run and the
    // crosswalk signals without waiting for the hour (the clients follow it: they read the time from the server).
    const dev = process.env.NODE_ENV === "production" ? 0 : Number(process.env.CV_DEV_CLOCK_OFFSET_MS ?? 0);
    return Date.now() + (Number.isFinite(dev) ? dev : 0);
  }

  /**
   * How many may ride the bus (busCabin.ts BUS_CAPACITY: 10 seats + 16 standing places = 26). DEV only (never in production):
   * CV_DEV_BUS_CAPACITY lowers it, so the e2e can fill the bus with a few browsers and see the next rider refused.
   */
  protected busCapacity(): number {
    const dev = process.env.NODE_ENV === "production" ? NaN : Number(process.env.CV_DEV_BUS_CAPACITY ?? NaN);
    return Number.isInteger(dev) && dev > 0 ? Math.min(dev, BUS_CAPACITY) : BUS_CAPACITY;
  }

  /** The server's clock for one visitor (on join; queued until their join completes) or for everyone. */
  private serverTime(): ServerTimePayload {
    return { serverTimeMs: this.wallClock(), rideSchedule: rideScheduleKey() };
  }

  onDispose(): void {
    this.offCandles?.();
    this.offCandles = null;
    this.offClaims?.();
    this.offClaims = null;
  }

  /** The candles burning now, to one client (it came into the hall, or came back inside it). */
  private sendCandles(client: Client): void {
    const msg: CandleStatePayload = { candles: this.candles.snapshot(this.wallClock()) };
    client.send(VillageServerMsg.CandleState, msg);
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
    player.area = "village";
    this.seatPlayer(client, player); // state + tracking (createTracking below)
    const track = this.tracking.get(client.sessionId);
    if (track) {
      track.keyHash = result.deviceKeyHash;
      track.tabId = result.tabId;
    }
    this.replaceOldSessionsOfTab(client.sessionId, result.tabId);
    client.send(VillageServerMsg.ServerTime, this.serverTime());
    const snapshot = this.busSnapshot(this.wallClock());
    client.send(MessageType.BusState, snapshot);
    client.send(MessageType.BusRideState, { boarded: false, tripId: snapshot.tripId } satisfies BusRideStatePayload);
    this.fishing.join(client);
  }

  /**
   * A dropped visitor is back (same session): besides clearing the ghost flag (PlayerRoom), re-send the server's
   * clock. `onJoin` does not run on a reconnect, and the client binds its clock handler to the room again, so
   * without this a device that was never synced would wait up to 5 minutes for the next broadcast (Task 7A review m-c).
   */
  override onReconnect(client: Client): void {
    super.onReconnect(client);
    client.send(VillageServerMsg.ServerTime, this.serverTime());
    const snapshot = this.busSnapshot(this.wallClock());
    client.send(MessageType.BusState, snapshot);
    const track = this.tracking.get(client.sessionId);
    const tripId = track?.busTripId ?? snapshot.tripId;
    client.send(MessageType.BusRideState, { boarded: track?.busBoarded === true, tripId } satisfies BusRideStatePayload);
    this.fishing.resend(client);
    if (this.state.players.get(client.sessionId)?.area === "hall") this.sendCandles(client);
  }

  /** The village map: the open village, the memorial hall's sealed interior and the twenty rooms of the ten houses (one coordinate space). */
  protected geometry(): MapGeometry {
    return villageGeometry;
  }

  /** The park (케이슨랜드) is its own place with its own frame and solids; every other area walks on the village geometry. */
  protected override geometryFor(player: Player): MapGeometry {
    return player.area === "park" ? parkGeometry : villageGeometry;
  }

  /**
   * On the fountain plaza, within the layout's jitter of the spawn point, clamped into the bounds — and never on top of
   * someone already in the village: a random draw that lands within `ARRIVAL_SPACING_M` of a player is drawn again, and
   * when a dozen draws all land on someone the nearest free spot round the spawn point is used (shared arrivalSpot.ts).
   */
  protected spawnPosition(): { x: number; z: number } {
    const { spawn } = VILLAGE_LAYOUT;
    const at = freeSpawnSpot(
      () => spawnInDisk(spawn.x, spawn.z, spawn.jitter, this.geometry()),
      spawn,
      arrivalArea("village"),
      this.playersIn("village"),
    );
    return { x: at.x, z: at.z };
  }

  /**
   * Where the players of `area` stand (all of them, a ghost waiting out its reconnection window included: it comes back
   * where it was), minus `except` (the one arriving). What an arrival is spread against.
   */
  private playersIn(area: string, except?: string): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    this.state.players.forEach((p, sid) => {
      if (sid !== except && p.area === area) out.push({ x: p.x, z: p.z });
    });
    return out;
  }

  /** The base bookkeeping plus the door-use cap. */
  protected createTracking(now: number): VillageTracking {
    return {
      ...baseTracking(now),
      doorRate: new RateWindow(DOOR_RATE.count, DOOR_RATE.windowMs),
      interiorEntry: null,
      candleRate: new RateWindow(CANDLE_RATE.count, CANDLE_RATE.windowMs),
      busBoarded: false,
      busTripId: null,
      keypadRate: initialKeypadRate(),
      busMoveAt: now,
      busMoveRate: new RateWindow(BUS_MOVE_MAX_PER_SEC),
      busActRate: new RateWindow(BUS_ACT_MAX_PER_SEC),
      keyHash: null,
      tabId: null,
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
    // Inside a house the line is heard on BOTH floors of that house (owner Q2, HOUSE_POLICY.chatScope "house"); everywhere else in the area.
    const house = HOUSE_POLICY.chatScope === "house" ? parseHouseFloorArea(player.area) : null;
    if (house) this.broadcastToHouse(house.buildingId, MessageType.Chat, line);
    else this.broadcastToArea(player.area, MessageType.Chat, line);
  }

  /** Broadcast to the clients whose player is on either floor of house `buildingId` (one encode; the others are the `except` list). */
  private broadcastToHouse(buildingId: string, type: string, message: unknown): void {
    const skip = this.otherArea;
    skip.length = 0;
    for (const c of this.clients) {
      const here = parseHouseFloorArea(this.state.players.get(c.sessionId)?.area ?? "");
      if (here?.buildingId !== buildingId) skip.push(c);
    }
    this.broadcast(type, message, skip.length > 0 ? { except: skip } : undefined);
    skip.length = 0;
  }

  /** How many players are in house `buildingId` (both floors, a ghost waiting out its reconnection window included), minus `except`. */
  private houseOccupants(buildingId: string, except?: string): number {
    let n = 0;
    this.state.players.forEach((p, sid) => {
      if (sid !== except && parseHouseFloorArea(p.area)?.buildingId === buildingId) n++;
    });
    return n;
  }

  /** The memorial hall is quiet: no emoji, no jumping there (chat and walking are fine). */
  protected isQuiet(player: Player): boolean {
    return player.area !== "village";
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
    this.freeSession(client.sessionId);
    super.onLeave(client);
  }

  /** Everything a session holds besides its Player: the bus place, a bench, the rod, a ride seat. Safe to repeat. */
  private freeSession(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (player) {
      this.busRiders.delete(player);
      player.busSeat = -1;
    }
    this.releaseSeat(sessionId);
    this.fishing.leave(sessionId);
    this.coaster.leave(sessionId);
  }

  /**
   * A tab that joins again (the resilience driver's phase 2: its token reconnect failed, or the page was reloaded after its
   * phone slept) must not leave its OLD session behind: the old player is a ghost for the whole reconnection window (20 s) - on the
   * bus, a ride seat or a bench - beside the new avatar of the same person on everyone's screen. The old session goes at once: seat
   * freed, avatar gone for everyone (the framework's later window expiry finds nothing left to do).
   */
  private replaceOldSessionsOfTab(newSessionId: string, tabId: string | null): void {
    if (tabId === null) return;
    for (const [sid, track] of [...this.tracking]) {
      if (sid === newSessionId || track.tabId !== tabId) continue;
      this.freeSession(sid);
      this.unseatPlayer(sid);
      this.clients.find((c) => c.sessionId === sid)?.leave();
    }
  }

  /** The room's bus driver, brought up to `now` (created on first use). */
  private driverAt(now: number): BusDriver {
    if (!this.busDriver) this.busDriver = new BusDriver(now);
    return this.busDriver;
  }

  /** The bus snapshot at `now` by the room's driver. */
  private busSnapshot(now: number): ReturnType<typeof transitSnapshotAt> {
    const driver = this.driverAt(now);
    return transitSnapshotAt(now, driver.drive, { blocked: driver.blocked, horn: driver.horn });
  }

  /**
   * One look ahead by the bus's driver with every avatar standing in the village (not the riders: they are on the bus),
   * a ghost waiting out its reconnection window included (its body is still drawn there). A changed drive is published
   * at once; otherwise the snapshot goes out every BUS_STATE_RATE_MS.
   */
  tickBus(): void {
    const now = this.wallClock();
    const driver = this.driverAt(now);
    const obstacles = this.busObstacles;
    obstacles.length = 0;
    this.state.players.forEach((p) => {
      if (p.area === "village" && !this.busRiders.has(p)) obstacles.push({ x: p.x, z: p.z });
    });
    const changed = driver.step(now, obstacles);
    obstacles.length = 0;
    // The moving bus is solid (checker r2: walking at its flank went inside it, and it drove on with them in it): whoever
    // its body overlaps now is put out on the nearest free side, every client sees them there (shared busBody.ts).
    const pose = this.busBodyPose(now);
    this.state.players.forEach((p) => {
      if (this.busRiders.has(p)) this.placeRider(p, pose);
      else this.pushOffBus(p, pose);
    });
    if (changed || now - this.lastBusBroadcast >= BUS_STATE_RATE_MS || now < this.lastBusBroadcast) this.broadcastTransit();
  }

  /**
   * The bus's body pose at `now`, wherever it is (parked at the stop or out on the road). The bus is one moving solid and
   * no static collider (2026-11-15: a static slice left an invisible wall at the empty stop that trapped a person and
   * blocked the returning bus), so it pushes at its stop and on the lap alike.
   */
  private busBodyPose(now: number): BusBodyPose {
    return busDriveTrip(this.driverAt(now).drive, now).pose;
  }

  /**
   * Put a walker the moving bus's body overlaps back outside it (shared busBody.ts pushOutOfBus: the nearest side free
   * of the map's colliders, never the bus's front). Riders, someone on a bench and the other areas are left alone. The
   * echoed move clock is kept: the push is under a step's size, so the mover's own client (which pushes itself the
   * same way every frame) never snaps, and the viewers walk the avatar there smoothly.
   */
  private pushOffBus(player: Player, pose: BusBodyPose): void {
    if (player.area !== "village" || player.seatIndex >= 0 || this.busRiders.has(player)) return;
    const obstacles = this.geometryFor(player).obstacles;
    const out = pushOutOfBus(pose, player.x, player.z, PLAYER_RADIUS, (x, z) => isBlocked(x, z, PLAYER_RADIUS, obstacles));
    if (!out) return;
    player.x = out.x;
    player.z = out.z;
  }

  /** Every accepted step is checked against the moving bus too: nobody's step ends inside it (the tick catches the rest). */
  protected afterMove(_client: Client, player: Player, _track: VillageTracking, _now: number): void {
    this.pushOffBus(player, this.busBodyPose(this.wallClock()));
  }

  /** Publish the bus and clear riders once their lap returns. */
  private broadcastTransit(): void {
    const now = this.wallClock();
    this.lastBusBroadcast = now;
    const snapshot = this.busSnapshot(now);
    // Everyone tracked, not only the connected clients: a rider whose connection dropped (the reconnect window is still open)
    // used to stay aboard through the lap, holding a seat and riding as a ghost in the next lap's bus (review r1).
    for (const [sessionId, track] of this.tracking) {
      if (!track.busBoarded || track.busTripId === null) continue;
      // A rider stays on one lap only: from boarding (the 3 min before the departure, the trip's own id) through the lap. Once
      // the bus is back at the stop (or a later trip is up), the ride ends and the player can board the next hourly trip.
      // (It used to end at once for anyone who boarded before the hour: the status was "boarding", not "inTransit".)
      if (!riderOnTrip(snapshot, track.busTripId)) {
        const player = this.state.players.get(sessionId);
        if (player) this.getOffBus(player, track);
        else {
          track.busBoarded = false;
          track.busTripId = null;
        }
        this.clients.find((c) => c.sessionId === sessionId)?.send(MessageType.BusRideState, { boarded: false, tripId: snapshot.tripId } satisfies BusRideStatePayload);
      }
    }
    this.broadcast(MessageType.BusState, snapshot);
  }

  /**
   * A rider off the bus (a leave at the stop, or the lap over): out of its place, put down on the pavement outside the
   * middle door (busSeats.ts busDismountSpot, clear of the parked bus and the shelter), facing the pad, with the
   * move-clock baseline reset (the server placed them: the next Move is measured from here).
   */
  private getOffBus(player: Player, track: VillageTracking): void {
    track.busBoarded = false;
    track.busTripId = null;
    this.busRiders.delete(player);
    if (player.busSeat < 0) return;
    // spread along the pavement, one spot after another
    const spot = busDismountSpot(this.dismountSlot++);
    player.busSeat = -1;
    player.busAhead = 0;
    player.busRight = 0;
    player.busYaw = 0;
    player.x = spot.x;
    player.z = spot.z;
    player.yaw = spot.yaw;
    player.moveT = 0;
    track.lastAcceptedAt = this.now();
  }

  /** The next pavement spot a rider getting off is put on (busSeats.ts busDismountSpot spreads them). */
  private dismountSlot = 0;

  /** Put an aboard rider at the world pose of their place in the bus (x/z/yaw follow it; written only when it moved over 2 cm). */
  private readonly riderPose: BusRiderPoseFull = { x: 0, z: 0, yaw: 0, y: 0, seated: false };
  private placeRider(player: Player, bus: BusBodyPose): void {
    if (player.busSeat < 0) return;
    const w = busRiderWorldPose(bus, player.busSeat, player.busAhead, player.busRight, player.busYaw, this.riderPose);
    if (Math.hypot(w.x - player.x, w.z - player.z) > 0.02) {
      player.x = w.x;
      player.z = w.z;
    }
    const yaw = Math.atan2(Math.sin(w.yaw), Math.cos(w.yaw));
    if (Math.abs(Math.atan2(Math.sin(yaw - player.yaw), Math.cos(yaw - player.yaw))) > 0.02) player.yaw = yaw;
  }

  /** Where the other riders stand in the bus (bus-local): the bodies a step, a stand-up or a hold may not end inside. */
  private otherBusPoints(except: Player): { ahead: number; right: number }[] {
    const out: { ahead: number; right: number }[] = [];
    this.state.players.forEach((p) => {
      if (p === except || !this.busRiders.has(p) || p.busSeat < 0) return;
      // seated riders are inside their seat's solid already (walkers never reach it); free ones are bodies
      if (busPlaceOf(p.busSeat).kind !== "seat") out.push({ ahead: p.busAhead, right: p.busRight });
    });
    return out;
  }

  /** The busSeat numbers other riders sit in. */
  private takenBusSpots(except: Player): Set<number> {
    const taken = new Set<number>();
    this.state.players.forEach((p) => {
      if (p !== except && this.busRiders.has(p) && p.busSeat > 0) taken.add(p.busSeat);
    });
    return taken;
  }

  /** A step inside the bus (shared busCabin.ts): checked against the cabin, then written; a refused one is dropped (the schema is the echo). */
  private handleBusMove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || !this.busRiders.has(player)) return;
    const now = this.now();
    if (!track.busMoveRate.tryAccept(now)) return;
    const decision = validateBusMove({ busSeat: player.busSeat, ahead: player.busAhead, right: player.busRight }, payload, now - track.busMoveAt, this.otherBusPoints(player));
    if (!decision.ok) return;
    track.busMoveAt = now;
    player.busAhead = decision.ahead;
    player.busRight = decision.right;
    player.busYaw = decision.yaw;
    this.placeRider(player, this.busBodyPose(this.wallClock()));
  }

  /** Sit in a free seat. A refusal says why to the rider (a taken seat, the wrong side of a backed seat). */
  private handleBusSit(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || !this.busRiders.has(player)) return;
    if (!track.busActRate.tryAccept(this.now())) return;
    const decision = validateBusSit({ busSeat: player.busSeat, ahead: player.busAhead, right: player.busRight }, payload, this.takenBusSpots(player));
    if (!decision.ok) {
      if (decision.notice) client.send(MessageType.BusRejected, { reason: decision.notice });
      return;
    }
    const spot = BUS_SEATS[decision.index]!;
    player.busSeat = decision.busSeat;
    player.busAhead = spot.ahead;
    player.busRight = spot.right;
    player.busYaw = spot.yaw;
    this.placeRider(player, this.busBodyPose(this.wallClock()));
  }

  /** From a seat back on one's feet in the aisle. */
  private handleBusStand(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || !this.busRiders.has(player)) return;
    if (!track.busActRate.tryAccept(this.now())) return;
    const place = busPlaceOf(player.busSeat);
    if (place.kind === "free") return;
    if (place.kind === "seat") {
      const spot = seatStandUpSpot(BUS_SEATS[place.index]!, this.otherBusPoints(player));
      // never behind the seat's back; nothing free in front or beside it: still seated, and told why (owner 2026-11-17)
      if (!spot) {
        client.send(MessageType.BusRejected, { reason: STAND_BLOCKED });
        return;
      }
      player.busAhead = spot.ahead;
      player.busRight = spot.right;
      player.busYaw = spot.yaw;
    }
    player.busSeat = 0;
    track.busMoveAt = this.now();
    this.placeRider(player, this.busBodyPose(this.wallClock()));
  }

  /** Validate one board/leave request against the authoritative player pose and schedule. */
  private handleBusRide(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    // Bus v3 (owner 2026-11-16): only as many ride as the bus holds (busCabin.ts BUS_CAPACITY: the seats + the standing places)
    const others: Array<{ ahead: number; right: number }> = [];
    let aboard = 0;
    this.state.players.forEach((p) => {
      if (p === player || !this.busRiders.has(p)) return;
      aboard++;
      if (p.busSeat === 0) others.push({ ahead: p.busAhead, right: p.busRight });
    });
    const entry = freeBusEntry(others);
    const decision = validateBusRide(payload, {
      boarded: track.busBoarded,
      area: player.area,
      x: player.x,
      z: player.z,
      aboard,
      capacity: this.busCapacity(),
      standingFree: entry !== null,
    }, this.wallClock(), busDriveTrip(this.driverAt(this.wallClock()).drive, this.wallClock()));
    if (!decision.ok) {
      client.send(MessageType.BusRejected, { reason: decision.notice });
      return;
    }
    const action = payload !== null && typeof payload === "object" ? (payload as { action?: unknown }).action : undefined;
    if (action === "board") {
      // Boarding from the shelter's bench: up off it first (the rider sits in the bus now, not on the bench).
      this.releaseSeat(client.sessionId);
      track.busBoarded = true;
      track.busTripId = decision.tripId;
      this.busRiders.add(player);
      // Aboard and free on the first standing place nobody stands on (busCabin.ts BUS_STANDING_SPOTS, from the front door),
      // facing back down the aisle: the rider walks or sits from here; every client draws them in the bus wherever it goes.
      const at = entry!;
      player.busSeat = 0;
      player.busAhead = at.ahead;
      player.busRight = at.right;
      player.busYaw = at.yaw;
      track.busMoveAt = this.now();
      this.placeRider(player, this.busBodyPose(this.wallClock()));
      client.send(MessageType.BusRideState, { boarded: true, tripId: decision.tripId } satisfies BusRideStatePayload);
      return;
    }
    // `leave` is accepted only for an existing rider, and only while the bus stands at the stop, by validateBusRide.
    this.getOffBus(player, track);
    client.send(MessageType.BusRideState, { boarded: false, tripId: this.busSnapshot(this.wallClock()).tripId } satisfies BusRideStatePayload);
  }

  /**
   * Sit pipeline (the world's, on the village's benches): sender must have a seat in state → the pure `validateSit`
   * on VILLAGE_SEATS (garbage / already seated / beyond SEAT_REACH → SILENT drop; taken by someone else → personal
   * Korean notice). On success, claim the seat, put the player on it (its spot and facing) and reset the move-clock
   * baseline so the seated span cannot later be spent as a one-shot displacement budget (D1). The client sees itself
   * seated once `seatIndex` syncs.
   */
  private handleSit(client: Client, payload: unknown): "seated" | "taken" | "dropped" {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return "dropped"; // no seat yet / already left → drop

    const result = validateSit(
      { x: player.x, z: player.z, seatIndex: player.seatIndex },
      payload,
      this.occupancy,
      client.sessionId,
      VILLAGE_SEATS,
    );
    if (result === null) return "dropped"; // malformed / already seated / out of reach → silent
    if ("reason" in result) {
      client.send(MessageType.SitRejected, { reason: result.reason }); // first come, first seated
      return "taken";
    }

    const seat = VILLAGE_SEATS[result.seatIndex];
    // The distance gate already keeps a bench in the other area out of reach (the hall is hundreds of metres away);
    // the area check states it.
    if (seat.area !== player.area) return "dropped";
    this.occupancy.set(result.seatIndex, client.sessionId);
    player.seatIndex = result.seatIndex;
    player.x = seat.x;
    player.z = seat.z;
    player.yaw = seat.yaw;
    track.lastAcceptedAt = this.now();
    this.fishing.onSeated(client.sessionId, result.seatIndex); // a fishing chair with a rod: ready
    return "seated";
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
      // in front of the seat — its stand point, else front-left / front-right, else further forward — never behind its backrest;
      // nothing free (another visitor standing there, the furniture): still seated, and told why (owner 2026-11-17, standSpot.ts)
      const others: { x: number; z: number }[] = [];
      this.state.players.forEach((o, id) => {
        if (id !== client.sessionId && o.area === player.area) others.push({ x: o.x, z: o.z });
      });
      const spot = chooseStandSpot(seat, player.area, others);
      if (!spot) {
        client.send(MessageType.StandRejected, { reason: STAND_BLOCKED });
        return;
      }
      player.x = spot.x;
      player.z = spot.z;
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
    this.fishing.onStood(sessionId); // a fishing chair: the line comes out, the rod goes back on the shoulder
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
  private handleUseDoor(client: Client, payload?: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop
    if (player.seatIndex >= 0) return; // sitting on a bench: stand up first (silent drop)

    // the village's memorial door and the hall's way out (useDoor), or a house's way out to its porch (useHouseExit)
    const loadFailed = payload !== null && typeof payload === "object" && (payload as { loadFailed?: unknown }).loadFailed === true;
    const entry = track.interiorEntry;
    const from = loadFailed && entry?.area === player.area && Math.hypot(player.x - entry.placed.x, player.z - entry.placed.z) <= HOUSE_ENTRY_RESCUE_M
      ? entry.nominal
      : player;
    // …or a lot building's door and its room's way out (L5v2, villageLots.ts useLotDoor: the same reach and in-front rules)
    const arrival = useDoor(player.area, player.x, player.z) ?? useHouseExit(player.area, from.x, from.z, loadFailed) ?? useLotDoor(player.area, from.x, from.z) ?? useParkDoor(player.area, player.x, player.z);
    if (arrival === null) return; // no door within reach → silent drop

    const now = this.now();
    if (!track.doorRate.tryAccept(now)) return; // flood → silent drop

    // The door's own spot if it is free, else the nearest free one beside it: two visitors through the door in the
    // same second (or one walking in while another still stands at the spawn) never appear inside each other.
    const at = spreadArrival(arrival.area, arrival, this.playersIn(arrival.area, client.sessionId));
    track.interiorEntry = isLotArea(arrival.area) ? { area: arrival.area, placed: at, nominal: arrival } : null;
    player.x = at.x;
    player.z = at.z;
    player.yaw = at.yaw;
    player.area = arrival.area;
    track.lastAcceptedAt = now;
    if (arrival.area === "hall") this.sendCandles(client); // the candles already burning, and who lit them
  }

  /**
   * Stair pipeline (집 실내 G): the door's rules on a house floor's stair pad — sender must have a seat, not be sitting, the pure `useStair`
   * decides from the AUTHORITATIVE area and position (`padUsableFrom`), the 1-per-second cap (the door's: one counter for both, so a
   * stair and a door cannot be used within the same second), then the player is put on the other floor's arrival spot (spread from whoever
   * stands there) and `area` flips. Both floors count for the house's occupant limit, so a stair never changes it.
   */
  private handleUseStair(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    if (player.seatIndex >= 0) return; // sitting: stand up first
    const arrival = useStair(player.area, player.x, player.z);
    if (arrival === null) return;
    const now = this.now();
    if (!track.doorRate.tryAccept(now)) return;
    const at = spreadArrival(arrival.area, arrival, this.playersIn(arrival.area, client.sessionId));
    track.interiorEntry = null;
    player.x = at.x;
    player.z = at.z;
    player.yaw = at.yaw;
    player.area = arrival.area;
    track.lastAcceptedAt = now;
  }

  /**
   * Candle pipeline (Task 9): sender must have a seat → the pure rule `candleCubby` decides from the player's
   * AUTHORITATIVE area and position and the named cubby (in the hall, within 1.5 m of its anchor on the ground) → SILENT
   * drop otherwise → per-client rate cap (1 per 5 seconds; after the distance, like the door) → the process's candle book keeps
   * it for an hour (refused while that cubby's candle still burns) → `CandleLit` to every client in the hall of EVERY room
   * (the book's listeners), the lighter included.
   */
  private handleLightCandle(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return;
    const cubby = payload !== null && typeof payload === "object" ? (payload as { cubby?: unknown }).cubby : undefined;
    const anchor = candleCubby(player.area, player.x, player.z, cubby, undefined, (id) => memorial()?.isClaimed(id) === true);
    if (anchor === null) return;
    if (this.candles.burning(anchor.id, this.wallClock())) return; // already burning: the card shows who lit it
    if (!track.candleRate.tryAccept(this.now())) return;
    this.candles.light(anchor.id, player.nickname, this.wallClock());
  }

  /**
   * The device-key hash a session joined with (null: none / an old client). Survives a reconnect (same tracking). The memorial-2
   * room features (flowers, the ceremony candle) key their once-a-day limits on it.
   */
  memorialKeyHash(sessionId: string): string | null {
    return this.tracking.get(sessionId)?.keyHash ?? null;
  }

  /**
   * House keypad (집 실내 G): authoritative position + server-only code digest, then in through the front door onto the entrance floor
   * (`HOUSE_PLACES[n].spawnIn`, spread from whoever stands there). Refused without touching the code: while sitting or on the bus, away
   * from the village, or for a house with no interior yet ("not_ready": its door stays locked). The code is checked (rate limit and lockout
   * as before), and only a right code can learn that the house is full — eight players at most, both floors together ("full").
   */
  private handleKeypad(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track || player.area !== "village") return;
    const body = payload !== null && typeof payload === "object" ? (payload as { buildingId?: unknown; code?: unknown }) : {};
    if (typeof body.buildingId !== "string" || typeof body.code !== "string") return;
    const reply = (r: KeypadResultPayload) => client.send(VillageServerMsg.KeypadResult, r);
    if (player.seatIndex >= 0 || this.busRiders.has(player)) {
      reply({ ok: false, buildingId: body.buildingId, reason: "busy" });
      return;
    }
    const n = houseNumberOf(body.buildingId);
    if (n !== null && !houseIsReady(n)) {
      // before the code is looked at: a house nobody can enter must not burn the player's attempts, nor say whether the code was right
      reply({ ok: false, buildingId: body.buildingId, reason: nearHouseDoor(player, body.buildingId) ? "not_ready" : "too_far" });
      return;
    }
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
    if (!decision.ok) {
      reply({
        ok: false,
        buildingId: body.buildingId,
        reason:
          decision.reason === "invalid_request" || decision.reason === "not_keypad_building"
            ? "invalid_request"
            : decision.reason === "rate_limited"
              ? "wrong_code"
              : decision.reason,
        retryAfterMs: decision.retryAfterMs,
      });
      return;
    }
    const house = houseNumberOf(decision.buildingId);
    if (house === null) {
      reply({ ok: false, buildingId: body.buildingId, reason: "invalid_request" });
      return;
    }
    if (this.houseOccupants(decision.buildingId, client.sessionId) >= HOUSE_POLICY.maxOccupants) {
      reply({ ok: false, buildingId: decision.buildingId, reason: "full" });
      return;
    }
    const now = this.now();
    const spot = HOUSE_PLACES[house].spawnIn;
    const area = houseFloorArea(house, 1);
    // The same spread as the hall's door: a visitor coming in after another lands beside them, not inside.
    const at = spreadArrival(area, spot, this.playersIn(area, client.sessionId));
    track.interiorEntry = { area, placed: at, nominal: spot };
    player.x = at.x;
    player.z = at.z;
    player.yaw = at.yaw;
    player.area = area;
    track.lastAcceptedAt = now;
    reply({ ok: true, buildingId: decision.buildingId, area });
  }
}

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import {
  VILLAGE_ROOM,
  VILLAGE_MAX_CLIENTS,
  WORLD_ROOM,
  PATCH_RATE_MS,
  RECONNECT_WINDOW_S,
  ROLE_STUDENT,
  PLAYER_RADIUS,
  TYPING_RATE,
} from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast, EmojiBroadcast, JumpBroadcast } from "@caysonverse/shared/messages";
import {
  SERVER_TIME_INTERVAL_MS,
  VillageMsg,
  VillageServerMsg,
  type CandleLitPayload,
  type ServerTimePayload,
} from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import { SAMPLE_FILLED_IDS } from "@caysonverse/shared/village/sampleFill";
import { APPEARANCE_FIELDS, APPEARANCE_RANGES, DEFAULT_APPEARANCE, pickAppearance, type Appearance } from "@caysonverse/shared/appearance";
import type { Player } from "@caysonverse/shared/schema";
import { rooms, type VillageRoom, type WorldRoom } from "./index";
import type { Tracking } from "./PlayerRoom";

/**
 * VillageRoom (케이슨 마을 1단계 Task 2). ONE boot for the whole file, on its own port. The brief named 2574,
 * but reconnectWindow.integration.test.ts already boots on 2574 and vitest runs files in parallel, so this
 * file takes the next free one (2568 WorldRoom, 2569 ClassRoom, 2570 EscapeRoom, 2571 escapeFlow,
 * 2572 PlayerRoom, 2573 banditAi, 2574 reconnectWindow, 2575 this file).
 *
 * Time-sensitive checks (door cap, speed budget) run on a test clock: the room's `now()` is replaced, so
 * they do not wait in real time or depend on the machine's speed. Joins use the production verb
 * (`joinOrCreate`) where sharding is the point, and the harness's join-by-id elsewhere.
 */
const PORT = 2575;

const JOIN = { nickname: "케이슨", appearance: DEFAULT_APPEARANCE };
const JOIN_BOB = { nickname: "밥이", appearance: DEFAULT_APPEARANCE };
const JOIN_CAROL = { nickname: "캐럴", appearance: DEFAULT_APPEARANCE };

const L = VILLAGE_LAYOUT;
const OUT_PAD = L.memorial.exterior.doorPad;
const IN_PAD = L.memorial.interior.doorPad;
const HALL_SPAWN = L.memorial.interior.spawn;
/** Where the way out puts a visitor: the layout's exterior arrival (south of the memorial door pad, facing away from the building). */
const OUTSIDE_ARRIVAL = L.memorial.exterior.arrival;
/** Half the fountain collider's side: its edge's distance from the plaza centre (the fountain stands at the centre). */
const FOUNTAIN_EDGE = L.plaza.fountain.collider.x / 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Let broadcast/personal messages propagate to the in-process test clients. */
const flush = () => sleep(60);

/** Poll a getter until it is truthy (or timeout), then return its value. */
async function pollFor<T>(read: () => T, timeoutMs = 2000, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = read();
  }
  return v;
}

/** `pollFor` for an async getter. */
async function pollForAsync(read: () => Promise<boolean>, timeoutMs = 3000, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let v = await read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = await read();
  }
  return v;
}

let colyseus: ColyseusTestServer;

/** What these tests use of a connected client (the SDK's room handle, whichever room it is typed for). */
interface Visitor {
  sessionId: string;
  roomId: string;
  send(type: string | number, message?: unknown): void;
  onMessage(type: string, callback: (payload: any) => void): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  leave(consented?: boolean): Promise<number>;
}

/** Wait for a message of `type` that `match` accepts, with a deadline: a lost message fails the test instead of hanging it. */
function waitForMessage<P>(client: Visitor, type: string, match: (payload: P) => boolean, timeoutMs = 3000): Promise<P> {
  return new Promise<P>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no "${type}" message within ${timeoutMs} ms`));
    }, timeoutMs);
    const off = client.onMessage(type, (payload: P) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

let sentinelCount = 0;
/**
 * A sentinel round trip for a NEGATIVE assertion about the server's state or its personal replies: the client sends
 * itself a chat line (the village scopes chat by area, so a sender always hears its own) and waits for the echo.
 * One client's messages are handled in order, so once the echo is back everything it sent before has been handled
 * and answered; unlike a fixed sleep it cannot pass before the server has looked at the message.
 */
async function settle(client: Visitor): Promise<void> {
  const text = `확인 ${(sentinelCount += 1)}`;
  const echo = waitForMessage<ChatBroadcast>(client, MessageType.Chat, (m) => m.sid === client.sessionId && m.text === text);
  client.send(MessageType.Chat, { text });
  await echo;
}

/**
 * The same for what `from` makes the server send to `to`: `from` types (a typing event goes to everyone but the typist,
 * in every area, on the same wire as chat, emoji and jump) and `to` waits for it. Anything `from` caused before that,
 * and addressed to `to`, was queued ahead of it, so it is already here. `clock` (the room's test clock) is moved past the
 * 1-per-3-s typing cap when the sentinel is used again by the same client; leave it out to keep the clock still.
 */
async function roundTrip(from: Visitor, to: Visitor, clock?: { t: number }): Promise<void> {
  if (clock) clock.t += TYPING_RATE.windowMs + 1;
  const seen = waitForMessage<{ sid: string; on: boolean }>(to, MessageType.Typing, (m) => m.sid === from.sessionId && m.on);
  from.send(MessageType.Typing, { on: true });
  await seen;
  from.send(MessageType.Typing, { on: false }); // tidy: the next sentinel starts from "not typing"
}

beforeAll(async () => {
  colyseus = await boot(config({ rooms }), PORT);
});

afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  await colyseus.cleanup();
});

afterEach(() => {
  delete process.env.CV_RECONNECT_WINDOW_S;
});

/** A room's test clock: `now()` answers `t`, which only the test moves. Starts at the real time. */
function useClock(room: VillageRoom): { t: number } {
  const clock = { t: Date.now() };
  (room as unknown as { now: () => number }).now = () => clock.t;
  return clock;
}

/** White-box handle on the base's per-session bookkeeping. */
function trackingOf(room: VillageRoom, sid: string): Tracking {
  return (room as unknown as { tracking: Map<string, Tracking> }).tracking.get(sid)!;
}

/** Put a player straight onto a spot (white-box state edit, like the world's seat tests do). */
function placeAt(player: Player, x: number, z: number): void {
  player.x = x;
  player.z = z;
}

/** A visitor in a fresh village room. */
async function visitor(opts: { join?: typeof JOIN } = {}) {
  const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
  const client = await colyseus.connectTo(room, opts.join ?? JOIN);
  const player = room.state.players.get(client.sessionId)!;
  return { room, client, player };
}

describe("VillageRoom setup (integration)", () => {
  it("registers the room with 30 seats, the 10 Hz patch rate, auto-dispose and the world's 20 s window", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    expect(room.maxClients).toBe(VILLAGE_MAX_CLIENTS);
    expect(room.maxClients).toBe(30);
    expect(room.patchRate).toBe(PATCH_RATE_MS);
    expect(room.autoDispose).toBe(true);
    expect((room as unknown as { reconnectWindowSeconds: () => number }).reconnectWindowSeconds()).toBe(RECONNECT_WINDOW_S);
    expect(RECONNECT_WINDOW_S).toBe(20);
  });

  it("is not a pre-created singleton: no village room exists until the first visitor asks for one", async () => {
    expect(await matchMaker.query({ name: VILLAGE_ROOM })).toHaveLength(0);
    const first = await colyseus.sdk.joinOrCreate(VILLAGE_ROOM, JOIN);
    expect(await matchMaker.query({ name: VILLAGE_ROOM })).toHaveLength(1);
    await first.leave(true);
  });

  it("seats a visitor on the fountain plaza, facing the fountain, in the village, with their look", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const look = {} as Appearance;
    for (const field of APPEARANCE_FIELDS) look[field] = APPEARANCE_RANGES[field] - 1;
    const client = await colyseus.connectTo(room, { nickname: "케이슨", appearance: look });

    expect(room.state.players.size).toBe(1);
    const p = room.state.players.get(client.sessionId)!;
    expect(p.nickname).toBe("케이슨");
    expect(pickAppearance(p)).toEqual(look);
    expect(p.area).toBe("village");
    expect(p.role).toBe(ROLE_STUDENT);
    expect(p.connected).toBe(true);
    expect(p.seatIndex).toBe(-1);
    // Within the layout's jitter of the spawn point, clear of the fountain's collider.
    expect(Math.hypot(p.x - L.spawn.x, p.z - L.spawn.z)).toBeLessThanOrEqual(L.spawn.jitter + 1e-6);
    expect(p.z).toBeGreaterThan(L.plaza.fountain.collider.z / 2 + PLAYER_RADIUS);
    expect(p.yaw).toBeCloseTo(Math.PI, 6); // facing north, toward the fountain
  });

  it("rejects a join with an invalid nickname or look, with the world's Korean messages", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    await expect(colyseus.connectTo(room, { nickname: "a", appearance: DEFAULT_APPEARANCE })).rejects.toThrow("닉네임");
    await expect(colyseus.connectTo(room, { nickname: "케이슨" })).rejects.toThrow();
    expect(room.state.players.size).toBe(0);
  });

  it("syncs the area to other clients and starts with an empty banner (no admin: announce and kick are stray messages)", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    expect(await pollFor(() => bob.state?.players?.get(alice.sessionId))).toBeDefined();
    expect(bob.state.players.get(alice.sessionId)!.area).toBe("village");
    expect(room.state.announcement).toBe("");

    let leaveCode: number | null = null;
    alice.onLeave((code) => {
      leaveCode = code;
    });
    alice.send(MessageType.Announce, { text: "공지" });
    alice.send(MessageType.Kick, { sid: bob.sessionId });
    await roundTrip(alice, bob); // both were handled (and dropped) before this typing event went out
    expect(room.state.announcement).toBe("");
    expect(room.state.players.has(bob.sessionId)).toBe(true);
    expect(leaveCode).toBeNull();
  });
});

describe("VillageRoom server time (integration, Task 7A)", () => {
  it("a visitor hears the server's clock right after joining (the client's handler is armed as the join resolves)", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const before = Date.now();
    const client = await colyseus.connectTo(room, JOIN);
    // Armed synchronously after the join resolves, as the game's client does (resilience.ts): the server queues its
    // personal message until the join is acknowledged, so it cannot arrive before this handler exists.
    const got = await waitForMessage<ServerTimePayload>(client, VillageServerMsg.ServerTime, () => true);
    const after = Date.now();
    expect(typeof got.serverTimeMs).toBe("number");
    expect(got.serverTimeMs).toBeGreaterThanOrEqual(before);
    expect(got.serverTimeMs).toBeLessThanOrEqual(after);
  });

  it("the clock is the server's own: a room whose wall clock reads 3 h ahead sends that, and re-sends it to everyone", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const skew = 3 * 3_600_000;
    (room as unknown as { wallClock: () => number }).wallClock = () => Date.now() + skew;
    const alice = await colyseus.connectTo(room, JOIN);
    const first = await waitForMessage<ServerTimePayload>(alice, VillageServerMsg.ServerTime, () => true);
    expect(Math.abs(first.serverTimeMs - (Date.now() + skew))).toBeLessThan(2000);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    await waitForMessage<ServerTimePayload>(bob, VillageServerMsg.ServerTime, () => true);
    // The periodic refresh (every SERVER_TIME_INTERVAL_MS) reaches every client in the room.
    const toAlice = waitForMessage<ServerTimePayload>(alice, VillageServerMsg.ServerTime, () => true);
    const toBob = waitForMessage<ServerTimePayload>(bob, VillageServerMsg.ServerTime, () => true);
    room.broadcastServerTime();
    for (const m of await Promise.all([toAlice, toBob])) expect(Math.abs(m.serverTimeMs - (Date.now() + skew))).toBeLessThan(2000);
    expect(SERVER_TIME_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe("VillageRoom door (integration)", () => {
  it("a visitor walks legally from the plaza to the memorial's door pad, uses the door and is inside the hall at the layout's inside spawn", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);

    // Every step is an ordinary Move, judged by the same speed and collision rules as anyone's walk:
    // steps of 4 m, 500 ms apart (the ceiling of one move's time budget: 6.4 m/s x 0.5 s x 1.5 = 4.8 m).
    const walkTo = async (to: { x: number; z: number }) => {
      for (;;) {
        const dx = to.x - player.x;
        const dz = to.z - player.z;
        const dist = Math.hypot(dx, dz);
        const step = Math.min(dist, 4);
        const next = { x: player.x + (dx / dist) * step, z: player.z + (dz / dist) * step };
        clock.t += 500;
        client.send(MessageType.Move, { ...next, yaw: Math.atan2(dx, dz) });
        const accepted = await pollFor(() => Math.hypot(player.x - next.x, player.z - next.z) < 1e-6);
        expect(accepted, `move to (${next.x.toFixed(1)}, ${next.z.toFixed(1)}) accepted`).toBe(true);
        if (dist <= 4) return;
      }
    };
    // Round the fountain on its east side, 2.5 m off its box (inside the ring of benches at 11 m: the model's bench
    // boxes stay 1 m away), back to the plaza's north axis, then up the lane to the door in the building's recess.
    const around = FOUNTAIN_EDGE + 2.5;
    await walkTo({ x: 0, z: around });
    await walkTo({ x: around, z: around });
    await walkTo({ x: around, z: -around });
    await walkTo({ x: 0, z: -around });
    await walkTo({ x: OUT_PAD.centre.x, z: OUT_PAD.centre.z });
    expect(player.area).toBe("village");

    clock.t += 500;
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "hall")).toBe(true);
    expect(player.x).toBe(HALL_SPAWN.x);
    expect(player.z).toBe(HALL_SPAWN.z);
    expect(player.yaw).toBeCloseTo(Math.PI, 6); // faces -z, into the room

    // And the client hears it through the state sync.
    expect(await pollFor(() => client.state?.players?.get(client.sessionId)?.area === "hall")).toBe(true);
    expect(client.state.players.get(client.sessionId)!.x).toBeCloseTo(HALL_SPAWN.x, 3);
    expect(client.state.players.get(client.sessionId)!.z).toBeCloseTo(HALL_SPAWN.z, 3);
  });

  it("the way out puts the visitor at the layout's exterior arrival, 2.2 m south of the door pad, facing south, away from the building", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);
    player.area = "hall";
    placeAt(player, IN_PAD.centre.x, IN_PAD.centre.z); // stands on the inside pad

    clock.t += 1000;
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "village")).toBe(true);
    expect(player.x).toBeCloseTo(OUTSIDE_ARRIVAL.x, 9);
    expect(player.z).toBeCloseTo(OUTSIDE_ARRIVAL.z, 6);
    expect(player.z).toBeCloseTo(OUT_PAD.centre.z + 2.2, 6);
    expect(player.yaw).toBe(OUTSIDE_ARRIVAL.yaw); // +z: away from the building to its north
  });

  it("refuses the door from 5 m away: nothing changes, and the refusal uses up no door slot", async () => {
    const { client, player } = await visitor();
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z + 5);

    // Too far; a payload that CLAIMS to stand at the door and to be anywhere is never read.
    client.send(VillageMsg.UseDoor, {});
    client.send(VillageMsg.UseDoor, { x: OUT_PAD.centre.x, z: OUT_PAD.centre.z, area: "village", to: "hall" });
    await settle(client);
    expect(player.area).toBe("village");
    expect(player.x).toBe(OUT_PAD.centre.x);
    expect(player.z).toBe(OUT_PAD.centre.z + 5);

    // The same visitor from where they spawned: also far.
    placeAt(player, L.spawn.x, L.spawn.z);
    client.send(VillageMsg.UseDoor, {});
    await settle(client);
    expect(player.area).toBe("village");

    // Having been refused, they step up to the door and use it at once, on the same clock reading.
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z);
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "hall")).toBe(true);
  });

  it("allows the door out to the pad radius + 0.9 m (2.5 m) and refuses just beyond", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);
    const reach = OUT_PAD.radius + 0.9;

    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z + reach + 0.05);
    client.send(VillageMsg.UseDoor, {});
    await settle(client);
    expect(player.area).toBe("village");

    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z + reach - 0.05);
    clock.t += 1000;
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "hall")).toBe(true);
  });

  it("two door uses inside one second: the second is refused (real clock, back to back)", async () => {
    const { client, player } = await visitor();
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z);

    // The first goes in; the hall spawn is within reach of the way out, so a second press is a valid
    // request by distance and only the rate cap stops it from sending the visitor straight back out.
    client.send(VillageMsg.UseDoor, {});
    client.send(VillageMsg.UseDoor, {});
    await settle(client);
    expect(player.area).toBe("hall");
    expect(player.x).toBe(HALL_SPAWN.x);
    expect(player.z).toBe(HALL_SPAWN.z);
  });

  it("the door cap is exactly one use per second: refused at +999 ms, allowed at +1001 ms", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z);

    client.send(VillageMsg.UseDoor, {}); // t0: in
    expect(await pollFor(() => player.area === "hall")).toBe(true);

    clock.t += 999;
    client.send(VillageMsg.UseDoor, {});
    await settle(client);
    expect(player.area).toBe("hall"); // still inside: refused

    clock.t += 2; // +1001 ms since the accepted use
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "village")).toBe(true);
    expect(player.z).toBeCloseTo(OUTSIDE_ARRIVAL.z, 6);
  });

  it("the door is per client: another visitor's use does not eat my slot", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const a = room.state.players.get(alice.sessionId)!;
    const b = room.state.players.get(bob.sessionId)!;
    placeAt(a, OUT_PAD.centre.x - 0.5, OUT_PAD.centre.z);
    placeAt(b, OUT_PAD.centre.x + 0.5, OUT_PAD.centre.z);

    alice.send(VillageMsg.UseDoor, {});
    bob.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => a.area === "hall" && b.area === "hall")).toBe(true);
  });

  it("an arrival's movement baseline is reset: a Move from the old place is dropped, a step from the new place is accepted", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z);
    // A stale baseline: without the reset the 400 ms of "time since the last accepted move" would
    // still be spendable as a displacement budget after the teleport.
    trackingOf(room, client.sessionId).lastAcceptedAt = clock.t - 400;

    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "hall")).toBe(true);
    expect(trackingOf(room, client.sessionId).lastAcceptedAt).toBe(clock.t);

    // The speed exploit: ask to be back at the village spot (or anywhere far) — dropped whole.
    clock.t += 100;
    client.send(MessageType.Move, { x: OUT_PAD.centre.x, z: OUT_PAD.centre.z, yaw: 0 });
    client.send(MessageType.Move, { x: HALL_SPAWN.x, z: 0, yaw: 0 }); // 3.6 m inside the hall: 100 ms allows ~1 m, not 3.6
    await settle(client);
    expect(player.x).toBe(HALL_SPAWN.x);
    expect(player.z).toBe(HALL_SPAWN.z);
    expect(player.area).toBe("hall");

    // An ordinary step from the new place (0.5 m in 100 ms: inside the 0.96 m budget) is accepted.
    const stepZ = HALL_SPAWN.z - 0.5;
    client.send(MessageType.Move, { x: HALL_SPAWN.x, z: stepZ, yaw: Math.PI });
    expect(await pollFor(() => player.z === stepZ)).toBe(true);
  });

  it("moves are judged on the village map: the fountain's box stops a step into it, a step beside it is accepted", async () => {
    const { room, client, player } = await visitor();
    const clock = useClock(room);
    const start = FOUNTAIN_EDGE + 2; // east of the fountain's box
    placeAt(player, start, 0);

    clock.t += 500;
    client.send(MessageType.Move, { x: FOUNTAIN_EDGE - 1.5, z: 0, yaw: -Math.PI / 2 }); // inside the box: dropped
    await settle(client);
    expect(player.x).toBe(start);

    const beside = FOUNTAIN_EDGE + PLAYER_RADIUS + 0.3; // 0.3 m of body clearance from the edge
    clock.t += 500;
    client.send(MessageType.Move, { x: beside, z: 0, yaw: -Math.PI / 2 }); // accepted
    expect(await pollFor(() => player.x === beside)).toBe(true);
  });
});

describe("VillageRoom quiet hall (integration)", () => {
  it("in the village emoji and jump go out; inside the hall they are refused silently, and chat stays in the hall", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const clock = useClock(room);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const carol = await colyseus.connectTo(room, JOIN_CAROL);
    const a = room.state.players.get(alice.sessionId)!;
    const c = room.state.players.get(carol.sessionId)!;
    const emojis = { bob: [] as EmojiBroadcast[], carol: [] as EmojiBroadcast[] };
    const jumps = { bob: [] as JumpBroadcast[], carol: [] as JumpBroadcast[] };
    const chats = { alice: [] as ChatBroadcast[], bob: [] as ChatBroadcast[], carol: [] as ChatBroadcast[] };
    const aliceNotices: unknown[] = [];
    const personal: unknown[] = [];
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.bob.push(m));
    carol.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.carol.push(m));
    bob.onMessage(MessageType.Jump, (m: JumpBroadcast) => jumps.bob.push(m));
    carol.onMessage(MessageType.Jump, (m: JumpBroadcast) => jumps.carol.push(m));
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => chats.alice.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => chats.bob.push(m));
    carol.onMessage(MessageType.Chat, (m: ChatBroadcast) => chats.carol.push(m));
    alice.onMessage(MessageType.ChatRejected, (m: unknown) => aliceNotices.push(m));
    alice.onMessage(MessageType.SitRejected, (m: unknown) => personal.push(m));

    // Control: in the village everyone is together, and emoji and jump reach the others.
    alice.send(MessageType.Emoji, { index: 1 });
    alice.send(MessageType.Jump, {});
    expect(await pollFor(() => emojis.bob.length === 1 && jumps.bob.length === 1 && emojis.carol.length === 1 && jumps.carol.length === 1)).toBe(true);
    expect(emojis.bob).toEqual([{ sid: alice.sessionId, index: 1 }]);
    expect(jumps.bob).toEqual([{ sid: alice.sessionId }]);

    // Alice and carol go into the hall; bob stays on the plaza.
    for (const [client, p] of [[alice, a], [carol, c]] as const) {
      placeAt(p, OUT_PAD.centre.x, OUT_PAD.centre.z);
      client.send(VillageMsg.UseDoor, {});
    }
    expect(await pollFor(() => a.area === "hall" && c.area === "hall")).toBe(true);
    clock.t += 1000; // past the emoji cap (500 ms) and the jump cap (800 ms) of the control sends

    // Quiet: both are refused silently. The sentinel (typing is unscoped, so it reaches the village and the hall) proves
    // the server handled them and had nothing to send to bob or carol.
    alice.send(MessageType.Emoji, { index: 2 });
    alice.send(MessageType.Jump, {});
    await roundTrip(alice, bob, clock);
    await roundTrip(alice, carol, clock);
    expect(emojis.bob).toHaveLength(1); // nothing new went out
    expect(jumps.bob).toHaveLength(1);
    expect(emojis.carol).toHaveLength(1);
    expect(jumps.carol).toHaveLength(1);
    expect(aliceNotices).toEqual([]); // and the refusal said nothing to her either
    expect(personal).toEqual([]);

    // Chat is scoped by area. Alice speaks in the hall: she and carol hear it, bob on the plaza does not.
    alice.send(MessageType.Chat, { text: "조용히 인사해요" });
    const line: ChatBroadcast = { sid: alice.sessionId, name: "케이슨", text: "조용히 인사해요" };
    expect(await pollFor(() => chats.alice.length === 1 && chats.carol.length === 1)).toBe(true);
    expect(chats.carol).toEqual([line]);
    expect(chats.alice).toEqual([line]);
    await roundTrip(alice, bob, clock); // had the line gone to bob it would have arrived before this
    expect(chats.bob).toEqual([]);

    // And the other way: bob speaks on the plaza, and nobody in the hall hears it.
    bob.send(MessageType.Chat, { text: "광장에서 안녕" });
    expect(await pollFor(() => chats.bob.length === 1)).toBe(true);
    expect(chats.bob[0]).toEqual({ sid: bob.sessionId, name: "밥이", text: "광장에서 안녕" });
    await roundTrip(bob, alice, clock);
    await roundTrip(bob, carol, clock);
    expect(chats.alice).toEqual([line]);
    expect(chats.carol).toEqual([line]);

    // She can still walk in the hall: 0.3 m north in a fresh step.
    alice.send(MessageType.Move, { x: a.x, z: a.z - 0.3, yaw: Math.PI });
    expect(await pollFor(() => Math.abs(a.z - (HALL_SPAWN.z - 0.3)) < 1e-6)).toBe(true);
  });

  it("coming back out ends the quiet: emoji and jump work again at once, and the refused ones used no cap slot", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const a = room.state.players.get(alice.sessionId)!;
    const clock = useClock(room);
    const emojis: EmojiBroadcast[] = [];
    const jumps: JumpBroadcast[] = [];
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));
    bob.onMessage(MessageType.Jump, (m: JumpBroadcast) => jumps.push(m));

    a.area = "hall";
    placeAt(a, IN_PAD.centre.x, IN_PAD.centre.z);
    alice.send(MessageType.Emoji, { index: 0 });
    alice.send(MessageType.Jump, {});
    await roundTrip(alice, bob); // the clock stays still: the first typing event is inside its cap
    expect(emojis).toEqual([]);
    expect(jumps).toEqual([]);

    alice.send(VillageMsg.UseDoor, {}); // her first door use: no cap to wait out, so the clock does not move
    expect(await pollFor(() => a.area === "village")).toBe(true);

    // The clock has not moved since the refused ones: had they used a cap slot, these would be rate-dropped.
    alice.send(MessageType.Emoji, { index: 0 });
    alice.send(MessageType.Jump, {});
    expect(await pollFor(() => emojis.length === 1 && jumps.length === 1)).toBe(true);
    expect(emojis).toEqual([{ sid: alice.sessionId, index: 0 }]);
    expect(jumps).toEqual([{ sid: alice.sessionId }]);
    expect(clock.t).toBeGreaterThan(0);
  });

  it("the quiet is the village's own: the legacy world still relays emoji and jump whatever the area field says", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const a = room.state.players.get(alice.sessionId)!;
    expect(a.area).toBe("village"); // the world never sets it: the default
    a.area = "hall";
    const emojis: EmojiBroadcast[] = [];
    const jumps: JumpBroadcast[] = [];
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));
    bob.onMessage(MessageType.Jump, (m: JumpBroadcast) => jumps.push(m));

    alice.send(MessageType.Emoji, { index: 3 });
    alice.send(MessageType.Jump, {});
    expect(await pollFor(() => emojis.length === 1 && jumps.length === 1)).toBe(true);
    expect(emojis).toEqual([{ sid: alice.sessionId, index: 3 }]);
    expect(jumps).toEqual([{ sid: alice.sessionId }]);
  });
});

describe("VillageRoom reconnection (integration)", () => {
  it("a drop and a reconnect inside the window keeps the visitor in the hall, at the same spot, still quiet", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const client = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const sid = client.sessionId;
    const token = client.reconnectionToken;
    const player = room.state.players.get(sid)!;
    placeAt(player, OUT_PAD.centre.x, OUT_PAD.centre.z);
    client.send(VillageMsg.UseDoor, {});
    expect(await pollFor(() => player.area === "hall")).toBe(true);

    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    expect(room.state.players.get(sid)!.area).toBe("hall"); // a ghost stands where it was

    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(sid);
    expect(await pollFor(() => room.state.players.get(sid)?.connected === true)).toBe(true);
    expect(room.state.players.get(sid)!.area).toBe("hall");
    expect(room.state.players.get(sid)!.x).toBe(HALL_SPAWN.x);
    expect(room.state.players.get(sid)!.z).toBe(HALL_SPAWN.z);

    // Still the quiet hall after the reconnect.
    const emojis: EmojiBroadcast[] = [];
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));
    back.send(MessageType.Emoji, { index: 0 });
    await roundTrip(back, bob);
    expect(emojis).toEqual([]);
  });

  it("a reconnect hears the server's clock again (onJoin does not run on a reconnect; Task 7A review m-c)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const skew = 2 * 3_600_000;
    (room as unknown as { wallClock: () => number }).wallClock = () => Date.now() + skew;
    const client = await colyseus.connectTo(room, JOIN);
    await waitForMessage<ServerTimePayload>(client, VillageServerMsg.ServerTime, () => true);
    const sid = client.sessionId;
    const token = client.reconnectionToken;
    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    const back = (await colyseus.sdk.reconnect(token)) as unknown as Visitor;
    // Armed as the reconnect resolves, as the game's client does (resilience.ts binds on every new room).
    const got = await waitForMessage<ServerTimePayload>(back, VillageServerMsg.ServerTime, () => true);
    expect(Math.abs(got.serverTimeMs - (Date.now() + skew))).toBeLessThan(2000);
  });

  it("a window that runs out removes the visitor, and with them the shard disposes when it was the last one", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "0.2";
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const client = await colyseus.connectTo(room, JOIN);
    const sid = client.sessionId;
    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    expect(await pollFor(() => !room.state.players.has(sid), 3000)).toBe(true);
    // autoDispose: the empty shard goes away.
    expect(await pollForAsync(async () => (await matchMaker.query({ name: VILLAGE_ROOM })).length === 0)).toBe(true);
  });
});

describe("VillageRoom sharding (integration)", () => {
  const join = (i: number) => colyseus.sdk.joinOrCreate(VILLAGE_ROOM, { nickname: `방문객${i}`, appearance: DEFAULT_APPEARANCE }) as unknown as Promise<Visitor>;
  /**
   * Every client still connected leaves, whether the test passed or failed (a failed one must not leave 31 sockets behind).
   * Each leave is raced against a short timer, so a client that is already gone cannot hang the clean-up.
   */
  const leaveAll = (clients: readonly Visitor[]) =>
    Promise.allSettled(clients.map((c) => Promise.race([c.leave(true), new Promise((r) => setTimeout(r, 1500))])));

  it("fills a room to 30 and the 31st visitor gets a second room", async () => {
    const joined: Visitor[] = [];
    try {
      for (let i = 0; i < 31; i += 1) joined.push(await join(i));

      const listing = await matchMaker.query({ name: VILLAGE_ROOM });
      expect(listing).toHaveLength(2);
      const byFill = [...listing].sort((a, b) => b.clients - a.clients);
      expect(byFill.map((r) => r.clients)).toEqual([30, 1]);
      expect(byFill[0].maxClients).toBe(30);
      expect(byFill[0].locked).toBe(true); // full: matchmaking skips it
      expect(byFill[1].locked).toBe(false);

      // The first 30 share one room, the 31st is alone in the other.
      const roomIds = joined.map((c) => c.roomId);
      expect(new Set(roomIds).size).toBe(2);
      expect(roomIds.slice(0, 30).every((id) => id === roomIds[0])).toBe(true);
      expect(roomIds[30]).not.toBe(roomIds[0]);
      expect(roomIds[30]).toBe(byFill[1].roomId);
    } finally {
      await leaveAll(joined);
    }
  }, 30_000);

  it("31 visitors arriving at once also end up as 30 + 1, never 31 in one room", async () => {
    const joined: Visitor[] = [];
    try {
      joined.push(...(await Promise.all(Array.from({ length: 31 }, (_, i) => join(i)))));
      const listing = await matchMaker.query({ name: VILLAGE_ROOM });
      expect(listing).toHaveLength(2);
      expect(listing.map((r) => r.clients).sort((a, b) => b - a)).toEqual([30, 1]);
      expect(new Set(joined.map((c) => c.roomId)).size).toBe(2);
    } finally {
      await leaveAll(joined);
    }
  }, 30_000);

  it("a visitor goes to the fullest room that still has a seat, not the first one found", async () => {
    const joined: Visitor[] = [];
    try {
      // The emptier room is created FIRST, so a matchmaker without the sort would hand it the visitor.
      const sparse = await join(0);
      joined.push(sparse);
      const busy = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
      for (let i = 1; i <= 24; i += 1) joined.push(await colyseus.connectTo(busy, { nickname: `방문객${i}`, appearance: DEFAULT_APPEARANCE }));
      expect(sparse.roomId).not.toBe(busy.roomId);

      const next = await join(99);
      joined.push(next);
      expect(next.roomId).toBe(busy.roomId);
      expect(busy.clients.length).toBe(25);
    } finally {
      await leaveAll(joined);
    }
  }, 30_000);

  it("when a seat frees up in a full room, the room opens again and the next visitor fills it", async () => {
    const joined: Visitor[] = [];
    try {
      for (let i = 0; i < 31; i += 1) joined.push(await join(i));
      const firstId = joined[0].roomId;
      const secondId = joined[30].roomId;
      expect((await matchMaker.query({ roomId: firstId }))[0].locked).toBe(true);

      // One leaves the full room: it has 29 and is open; the other has 1. The next visitor fills the 29.
      const left = joined.shift()!; // already gone: not part of the clean-up
      await left.leave(true);
      expect(await pollForAsync(async () => (await matchMaker.query({ roomId: firstId }))[0]?.locked === false)).toBe(true);
      const next = await join(99);
      joined.push(next);
      expect(next.roomId).toBe(firstId);
      expect(next.roomId).not.toBe(secondId);
      expect((await matchMaker.query({ roomId: firstId }))[0].clients).toBe(30);
    } finally {
      await leaveAll(joined);
    }
  }, 30_000);
});

describe("VillageRoom candles (integration, Task 9)", () => {
  /**
   * A filled cubby on the back wall (row 3; only a filled cubby takes a candle, final fix), an empty one on the same
   * row, and the spots 0.8 m in front of them (inside the 1.5 m reach, clear of the unit).
   */
  const NORTH = cubbyAnchors(L).filter((a) => a.id.startsWith("n_3_"));
  const CUBBY = NORTH.find((a) => SAMPLE_FILLED_IDS.has(a.id))!;
  const EMPTY = NORTH.find((a) => !SAMPLE_FILLED_IDS.has(a.id))!;
  /** Another filled row of CUBBY's column (the same spot on the floor). */
  const SECOND = cubbyAnchors(L).find((a) => a.id !== CUBBY.id && a.id.startsWith("n_") && a.id.endsWith(`_${CUBBY.id.split("_")[2]}`) && SAMPLE_FILLED_IDS.has(a.id))!;
  const FRONT = { x: CUBBY.x, z: CUBBY.z + 0.8 };

  /** Alice and carol in the hall (alice in front of the cubby), bob on the plaza; every CandleLit each one hears. */
  async function hallParty() {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const clock = useClock(room);
    const alice = await colyseus.connectTo(room, JOIN);
    const bob = await colyseus.connectTo(room, JOIN_BOB);
    const carol = await colyseus.connectTo(room, JOIN_CAROL);
    const a = room.state.players.get(alice.sessionId)!;
    const c = room.state.players.get(carol.sessionId)!;
    a.area = "hall";
    c.area = "hall";
    placeAt(a, FRONT.x, FRONT.z);
    placeAt(c, HALL_SPAWN.x, HALL_SPAWN.z);
    const heard = { alice: [] as CandleLitPayload[], bob: [] as CandleLitPayload[], carol: [] as CandleLitPayload[] };
    alice.onMessage(VillageServerMsg.CandleLit, (m: CandleLitPayload) => heard.alice.push(m));
    bob.onMessage(VillageServerMsg.CandleLit, (m: CandleLitPayload) => heard.bob.push(m));
    carol.onMessage(VillageServerMsg.CandleLit, (m: CandleLitPayload) => heard.carol.push(m));
    return { room, clock, alice, bob, carol, a, heard };
  }

  it("in front of the cubby: everyone in the hall hears CandleLit { cubby, by } (the lighter too), nobody on the plaza", async () => {
    const { alice, bob, heard } = await hallParty();
    alice.send(VillageMsg.LightCandle, { cubby: CUBBY.id });
    expect(await pollFor(() => heard.alice.length === 1 && heard.carol.length === 1)).toBe(true);
    expect(heard.carol).toEqual([{ cubby: CUBBY.id, by: "케이슨" }]);
    expect(heard.alice).toEqual([{ cubby: CUBBY.id, by: "케이슨" }]);
    await roundTrip(alice, bob); // had it gone to bob it would have arrived before this
    expect(heard.bob).toEqual([]);
  });

  it("far from the cubby (the spawn, 9 m away), an empty or unknown cubby or a bad payload: refused silently, and no slot is used", async () => {
    const { clock, alice, carol, a, heard } = await hallParty();
    placeAt(a, HALL_SPAWN.x, HALL_SPAWN.z);
    alice.send(VillageMsg.LightCandle, { cubby: CUBBY.id });
    await settle(alice); // handled (and dropped) from the spawn before she steps up
    placeAt(a, FRONT.x, FRONT.z);
    placeAt(a, EMPTY.x, EMPTY.z + 0.8);
    alice.send(VillageMsg.LightCandle, { cubby: EMPTY.id }); // right in front of it, but nobody rests there
    await settle(alice);
    placeAt(a, FRONT.x, FRONT.z);
    alice.send(VillageMsg.LightCandle, { cubby: "n_9_99" });
    alice.send(VillageMsg.LightCandle, { cubby: 7 });
    alice.send(VillageMsg.LightCandle, "n_3_10");
    alice.send(VillageMsg.LightCandle);
    await roundTrip(alice, carol, clock);
    expect(heard.carol).toEqual([]);
    expect(heard.alice).toEqual([]);
    // the refusals used up nothing: right away, from the right spot, it goes through
    alice.send(VillageMsg.LightCandle, { cubby: CUBBY.id });
    expect(await pollFor(() => heard.carol.length === 1)).toBe(true);
  });

  it("is rate-limited to one per 5 seconds", async () => {
    const { clock, alice, carol, heard } = await hallParty();
    alice.send(VillageMsg.LightCandle, { cubby: CUBBY.id });
    expect(await pollFor(() => heard.carol.length === 1)).toBe(true);
    clock.t += 4000;
    alice.send(VillageMsg.LightCandle, { cubby: SECOND.id });
    await roundTrip(alice, carol); // the clock stays still: the typing sentinel is not needed twice
    expect(heard.carol).toHaveLength(1);
    clock.t += 1001;
    alice.send(VillageMsg.LightCandle, { cubby: SECOND.id });
    expect(await pollFor(() => heard.carol.length === 2)).toBe(true);
    expect(heard.carol[1]).toEqual({ cubby: SECOND.id, by: "케이슨" });
  });

  it("from the village (even standing at the right x, z) the candle is refused", async () => {
    const { alice, carol, a, heard } = await hallParty();
    a.area = "village";
    alice.send(VillageMsg.LightCandle, { cubby: CUBBY.id });
    await roundTrip(alice, carol);
    expect(heard.carol).toEqual([]);
    expect(heard.alice).toEqual([]);
  });
});

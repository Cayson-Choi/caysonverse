import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { defineRoom, type Client } from "colyseus";
import { VILLAGE_ROOM, PLAYER_RADIUS, CHAT_MAX_LENGTH } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type {
  ChatBroadcast,
  ChatRejectedPayload,
  JumpBroadcast,
  TypingBroadcast,
} from "@caysonverse/shared/messages";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { Player, WorldState } from "@caysonverse/shared/schema";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { PlayerRoom, baseTracking, type Tracking } from "./PlayerRoom";
import { CHAT_NOT_NICE, type ProfanityResult } from "./profanity";
import { rooms, type VillageRoom } from "./index";

/**
 * The shared PlayerRoom base (escape phase 1, Task 2). Its own port: every integration test
 * file boots its own in-process server, and vitest runs files in parallel.
 */
const PORT = 2572;

const JOIN_A = { nickname: "앨리스", appearance: DEFAULT_APPEARANCE };
const JOIN_B = { nickname: "밥이", appearance: DEFAULT_APPEARANCE };

/** Let broadcast/personal messages propagate to the in-process test clients. */
const flush = () => new Promise((r) => setTimeout(r, 60));

// ── A minimal room on the base: what ClassRoom / EscapeRoom will look like ──

/** A small room with one prop; the legacy world would accept moves this map drops. */
const PROBE_GEO: MapGeometry = {
  id: "village",
  bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
  obstacles: [{ minX: 1, maxX: 2, minZ: -1, maxZ: 1 }],
  cameraBoxes: [],
};
const PROBE_ROOM = "probe";
const GUARD_ROOM = "guard";

/** The room widens the per-client bookkeeping (ruling E14), like WorldRoom's lastEscapeAt. */
interface ProbeTracking extends Tracking {
  accepted: number;
}

class ProbeRoom extends PlayerRoom<WorldState, ProbeTracking> {
  state = new WorldState();
  /** canMove() answers !frozen for everyone. */
  frozen = false;
  /** When true, deliverChat hands the line to the sender only (a "team chat" stand-in). */
  privateChat = false;
  /** Every afterMove call, in order. */
  readonly afterMoves: Array<{ sid: string; x: number; z: number; accepted: number }> = [];

  onCreate(): void {
    this.registerPlayerMessages();
  }

  onJoin(client: Client, options: { nickname?: string }): void {
    const player = new Player();
    player.nickname = options?.nickname ?? "probe";
    const spawn = this.spawnPosition();
    player.x = spawn.x;
    player.z = spawn.z;
    this.seatPlayer(client, player);
  }

  protected geometry(): MapGeometry {
    return PROBE_GEO;
  }

  protected spawnPosition(): { x: number; z: number } {
    return { x: 0, z: 0 };
  }

  protected createTracking(now: number): ProbeTracking {
    return { ...baseTracking(now), accepted: 0 };
  }

  protected canMove(): boolean {
    return !this.frozen;
  }

  protected afterMove(client: Client, player: Player, track: ProbeTracking): void {
    track.accepted += 1;
    this.afterMoves.push({ sid: client.sessionId, x: player.x, z: player.z, accepted: track.accepted });
  }

  protected deliverChat(client: Client, player: Player, text: string): void {
    if (!this.privateChat) return super.deliverChat(client, player, text);
    client.send(MessageType.Chat, { sid: client.sessionId, name: player.nickname, text });
  }
}

/**
 * What a ClassRoom / EscapeRoom will look like for the profanity hooks (Task 3): it learns of
 * every blocked line through onChatBlocked, and a room may opt out of the filter by overriding
 * checkProfanity (the one line the world would need).
 */
class GuardRoom extends ProbeRoom {
  /** false → this room opts out of the filter entirely. */
  filterOn = true;
  /** Every onChatBlocked call, in order. */
  readonly blocked: Array<{ sid: string; nickname: string; masked: string }> = [];

  protected checkProfanity(text: string): ProfanityResult {
    return this.filterOn ? super.checkProfanity(text) : { ok: true };
  }

  /** true → onChatBlocked records the line and then throws (a buggy override). */
  throwOnBlock = false;

  protected onChatBlocked(client: Client, player: Player, masked: string): void {
    this.blocked.push({ sid: client.sessionId, nickname: player.nickname, masked });
    if (this.throwOnBlock) throw new Error("onChatBlocked override failed");
  }
}

/** White-box handle on the base's per-session bookkeeping. */
function trackingOf(room: ProbeRoom): Map<string, ProbeTracking> {
  return (room as unknown as { tracking: Map<string, ProbeTracking> }).tracking;
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  const extraRooms = { [PROBE_ROOM]: defineRoom(ProbeRoom), [GUARD_ROOM]: defineRoom(GuardRoom) };
  colyseus = await boot(config({ rooms: { ...rooms, ...extraRooms } }), PORT);
});

afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  await colyseus.cleanup();
});

// Ruling E6: a message type no handler is registered for (a stale client, a legacy "Sit"
// sent to a room without chairs) is DROPPED. Without the catch-all, production Colyseus
// answers it with client.leave(4002 WITH_ERROR) — the player would be thrown out.
describe("PlayerRoom stray messages (VillageRoom)", () => {
  it("drops an unregistered message type without closing the sender", async () => {
    const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);
    alice.reconnection.enabled = false; // a close must show up as a leave, not be healed

    let leaveCode: number | null = null;
    alice.onLeave((code) => {
      leaveCode = code;
    });
    const bChats: ChatBroadcast[] = [];
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => bChats.push(m));

    alice.send("no_such_type", { anything: 1 });
    alice.send(4242, "numeric type, string payload");
    await flush();
    await flush();

    // Still connected and still in the village...
    expect(leaveCode).toBeNull();
    expect(room.state.players.get(alice.sessionId)?.connected).toBe(true);
    expect(room.clients.getById(alice.sessionId)).toBeDefined();

    // ...and the connection keeps working: a chat after the stray message is relayed.
    alice.send(MessageType.Chat, { text: "아직 여기 있어요" });
    await room.waitForNextMessage();
    await flush();
    expect(bChats).toEqual([{ sid: alice.sessionId, name: JOIN_A.nickname, text: "아직 여기 있어요" }]);
  });

  it("drops a stray message in any room built on the base, too", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    alice.reconnection.enabled = false;
    let leaveCode: number | null = null;
    alice.onLeave((code) => {
      leaveCode = code;
    });

    // "sit" is a real world message, but this room has no chairs and no handler for it.
    alice.send(MessageType.Sit, { seatIndex: 0 });
    await flush();
    await flush();

    expect(leaveCode).toBeNull();
    expect(room.state.players.get(alice.sessionId)?.connected).toBe(true);
  });
});

describe("PlayerRoom hooks (a room built on the base)", () => {
  it("validates moves against the room's geometry(), not the legacy world", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const player = room.state.players.get(alice.sessionId)!;
    const track = trackingOf(room).get(alice.sessionId)!;

    // (0,0) → (0.8,0): open floor in the legacy world's door gap, but the body reaches this
    // map's prop at x = 1 → dropped.
    track.lastAcceptedAt = Date.now() - 200;
    alice.send(MessageType.Move, { x: 0.8, z: 0, yaw: 0.3 });
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBe(0);
    expect(player.yaw).toBe(0); // dropped whole, not partially applied

    // A legal-speed overshoot past this map's east edge clamps to ITS bounds (6 − radius).
    player.x = 5.5;
    track.lastAcceptedAt = Date.now() - 200;
    alice.send(MessageType.Move, { x: 5.9, z: 0, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBeCloseTo(6 - PLAYER_RADIUS, 5);
  });

  it("a burst of moves queued behind a late frame is absorbed, and the sender's clock reaches the others as moveT", async () => {
    // fix/remote-move-snapback: the old rule reset the budget on every accepted move, so the moves queued
    // behind a late frame (arriving ~0 ms apart) were all dropped: the server fell metres behind the mover,
    // who was then yanked back by its own large-divergence snap, and everyone else saw it freeze and jump.
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const bob = await colyseus.connectTo(room, { nickname: "밥이" });
    const player = room.state.players.get(alice.sessionId)!;
    const track = trackingOf(room).get(alice.sessionId)!;
    player.x = -5.5;
    track.lastAcceptedAt = Date.now() - 500; // the link froze for half a second...
    for (let k = 1; k <= 8; k++) {
      // ...then eight 100 ms walk steps arrive back to back, each stamped with the sender's clock
      alice.send(MessageType.Move, { x: -5.5 + 0.4 * k, z: 0, yaw: 0, t: 90_000 + 100 * k });
    }
    for (let k = 0; k < 8; k++) await room.waitForNextMessage();
    await flush();
    expect(player.x).toBeCloseTo(-5.5 + 3.2, 4); // all eight (3.2 m of a 4.8 m budget) — not just the first
    expect(player.moveT).toBe(90_800);
    expect(room.afterMoves).toHaveLength(8);
    // Bob (any viewer) gets the clock with the pose, in the same patch.
    for (let k = 0; k < 20 && bob.state.players.get(alice.sessionId)?.moveT !== 90_800; k++) await flush();
    expect(bob.state.players.get(alice.sessionId)!.moveT).toBe(90_800);
    expect(bob.state.players.get(alice.sessionId)!.x).toBeCloseTo(-5.5 + 3.2, 4);

    // A refused move (here: far beyond the budget) is dropped whole, and clears the echoed clock, so the
    // sender's client judges the divergence from where it stands instead of trusting the stamp.
    alice.send(MessageType.Move, { x: 5, z: 0, yaw: 0, t: 90_900 });
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBeCloseTo(-5.5 + 3.2, 4);
    expect(player.moveT).toBe(0);

    // A move with no clock (an older client) is still accepted, and says "no clock" (0).
    alice.send(MessageType.Move, { x: -2.1, z: 0, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBeCloseTo(-2.1, 4);
    expect(player.moveT).toBe(0);
  });

  it("canMove() false drops Move and Jump silently; true lets them through", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const bob = await colyseus.connectTo(room, { nickname: "밥이" });
    const bJumps: JumpBroadcast[] = [];
    bob.onMessage(MessageType.Jump, (m: JumpBroadcast) => bJumps.push(m));
    const player = room.state.players.get(alice.sessionId)!;

    room.frozen = true;
    alice.send(MessageType.Move, { x: -0.05, z: 0, yaw: 0.5 });
    await room.waitForNextMessage();
    alice.send(MessageType.Jump, {});
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBe(0);
    expect(player.yaw).toBe(0);
    expect(bJumps).toHaveLength(0);
    expect(room.afterMoves).toHaveLength(0);

    room.frozen = false;
    alice.send(MessageType.Move, { x: -0.05, z: 0, yaw: 0.5 });
    await room.waitForNextMessage();
    alice.send(MessageType.Jump, {});
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBeCloseTo(-0.05, 5);
    expect(bJumps).toEqual([{ sid: alice.sessionId }]);
  });

  it("afterMove runs once per ACCEPTED move with the room's own (widened) tracking", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });

    alice.send(MessageType.Move, { x: -0.05, z: 0, yaw: 0 }); // accepted
    await room.waitForNextMessage();
    alice.send(MessageType.Move, { x: 500, z: 0, yaw: 0 }); // teleport → dropped
    await room.waitForNextMessage();
    alice.send(MessageType.Move, { x: -0.1, z: 0, yaw: 0 }); // accepted
    await room.waitForNextMessage();
    await flush();

    expect(room.afterMoves.map((m) => m.accepted)).toEqual([1, 2]);
    expect(room.afterMoves[1].sid).toBe(alice.sessionId);
    expect(room.afterMoves[1].x).toBeCloseTo(-0.1, 5); // runs after the move is applied
    expect(trackingOf(room).get(alice.sessionId)!.accepted).toBe(2);
  });

  it("deliverChat decides who hears a line; the base still rate-limits and sanitizes first", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const bob = await colyseus.connectTo(room, { nickname: "밥이" });
    const aChats: ChatBroadcast[] = [];
    const bChats: ChatBroadcast[] = [];
    const aRejected: ChatRejectedPayload[] = [];
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => aChats.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => bChats.push(m));
    alice.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => aRejected.push(m));

    // Default: everyone hears it.
    alice.send(MessageType.Chat, { text: "  모두 안녕  " });
    await room.waitForNextMessage();
    await flush();
    const hello = { sid: alice.sessionId, name: "앨리스", text: "모두 안녕" };
    expect(aChats).toEqual([hello]);
    expect(bChats).toEqual([hello]);

    // Overridden: only the sender hears it. Garbage is still dropped before the hook (it
    // spends a rate slot, as in the world), and the 4th line inside the 5 s window still gets
    // the personal rate notice instead of reaching the hook.
    room.privateChat = true;
    alice.send(MessageType.Chat, { text: "   " }); // slot 2 — sanitized away
    await room.waitForNextMessage();
    alice.send(MessageType.Chat, { text: "나만 봐요" }); // slot 3 — sender only
    await room.waitForNextMessage();
    alice.send(MessageType.Chat, { text: "하나 더" }); // 4th — rate notice
    await room.waitForNextMessage();
    await flush();
    expect(aChats.map((m) => m.text)).toEqual(["모두 안녕", "나만 봐요"]);
    expect(bChats).toEqual([hello]);
    expect(aRejected).toHaveLength(1);
    expect(aRejected[0].reason).toContain("너무 빨라요");
  });

  it("seatPlayer/unseatPlayer keep state and tracking in step (join, consented leave)", async () => {
    const room = await colyseus.createRoom<ProbeRoom>(PROBE_ROOM);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const sid = alice.sessionId;

    expect(room.state.players.has(sid)).toBe(true);
    expect(trackingOf(room).get(sid)).toMatchObject({ typing: false, accepted: 0 });

    await alice.leave(true);
    await flush();
    expect(room.state.players.has(sid)).toBe(false);
    expect(trackingOf(room).has(sid)).toBe(false);
  });
});

// Escape phase 1, Task 3: the Korean profanity filter sits in the base's chat path, after the
// rate cap and the sanitizer and before deliverChat. Two hooks: onChatBlocked (a room learns of a
// blocked line, masked) and checkProfanity (a room may opt out).
describe("PlayerRoom profanity filter (a room built on the base)", () => {
  const SWEAR = "너 진짜 시발 왜 그래";
  const SWEAR_MASKED = "너 진짜 ●● 왜 그래";

  async function chatPair(roomName: string = GUARD_ROOM) {
    const room = await colyseus.createRoom<GuardRoom>(roomName);
    const alice = await colyseus.connectTo(room, { nickname: "앨리스" });
    const bob = await colyseus.connectTo(room, { nickname: "밥이" });
    const seen = {
      aChats: [] as ChatBroadcast[],
      bChats: [] as ChatBroadcast[],
      aRejected: [] as ChatRejectedPayload[],
      bRejected: [] as ChatRejectedPayload[],
      bTyping: [] as TypingBroadcast[],
    };
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => seen.aChats.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => seen.bChats.push(m));
    alice.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => seen.aRejected.push(m));
    bob.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => seen.bRejected.push(m));
    bob.onMessage(MessageType.Typing, (m: TypingBroadcast) => seen.bTyping.push(m));
    const say = async (who: typeof alice, text: string) => {
      who.send(MessageType.Chat, { text });
      await room.waitForNextMessage();
      await flush();
    };
    return { room, alice, bob, seen, say };
  }

  it("holds a blocked line back: nobody hears it, only the sender is told, the hook gets the masked line", async () => {
    const { room, alice, seen, say } = await chatPair();

    await say(alice, SWEAR);

    expect(seen.aChats).toEqual([]);
    expect(seen.bChats).toEqual([]);
    expect(seen.aRejected).toEqual([{ reason: CHAT_NOT_NICE }]);
    expect(seen.bRejected).toEqual([]);
    expect(room.blocked).toEqual([{ sid: alice.sessionId, nickname: "앨리스", masked: SWEAR_MASKED }]);
    // What reaches the hook (a teacher's screen later) never carries the swear itself.
    expect(JSON.stringify(room.blocked)).not.toContain("시발");
  });

  it("lets a clean line through to deliverChat and never calls onChatBlocked", async () => {
    const { room, alice, seen, say } = await chatPair();

    await say(alice, "안녕, 같이 풀어 보자");

    const line = { sid: alice.sessionId, name: "앨리스", text: "안녕, 같이 풀어 보자" };
    expect(seen.aChats).toEqual([line]);
    expect(seen.bChats).toEqual([line]);
    expect(seen.aRejected).toEqual([]);
    expect(room.blocked).toEqual([]);
  });

  it("filters AFTER the rate cap: a blocked line spends a slot, and the 4th gets the rate notice, not the filter's", async () => {
    const { room, alice, seen, say } = await chatPair();

    await say(alice, SWEAR); // slot 1
    await say(alice, "ㅅㅂ"); // slot 2
    await say(alice, "병신"); // slot 3
    await say(alice, SWEAR); // 4th inside the window → rate notice; the filter never sees it

    expect(seen.aRejected.map((m) => m.reason)).toEqual([
      CHAT_NOT_NICE,
      CHAT_NOT_NICE,
      CHAT_NOT_NICE,
      expect.stringContaining("너무 빨라요"),
    ]);
    expect(room.blocked.map((b) => b.masked)).toEqual([SWEAR_MASKED, "●●", "●●"]);
    expect(seen.bChats).toEqual([]);
  });

  it("filters AFTER the sanitizer: garbage and oversized lines are dropped silently, even if they swear", async () => {
    const { room, alice, seen, say } = await chatPair();

    await say(alice, `시발 ${"가".repeat(CHAT_MAX_LENGTH)}`); // oversized → silent drop, no notice
    await say(alice, "  \u200b  "); // blank after the strip → silent drop

    expect(seen.aRejected).toEqual([]);
    expect(seen.aChats).toEqual([]);
    expect(seen.bChats).toEqual([]);
    expect(room.blocked).toEqual([]);
  });

  it("a blocked line ends the sender's typing state, like an accepted one", async () => {
    const { room, alice, seen, say } = await chatPair();
    const track = () => trackingOf(room).get(alice.sessionId)!;

    alice.send(MessageType.Typing, { on: true });
    await room.waitForNextMessage();
    await flush();
    expect(track().typing).toBe(true);
    expect(seen.bTyping).toEqual([{ sid: alice.sessionId, on: true }]);

    await say(alice, SWEAR);
    expect(track().typing).toBe(false);

    // The client's late OFF is dropped, exactly as after an accepted chat.
    alice.send(MessageType.Typing, { on: false });
    await room.waitForNextMessage();
    await flush();
    expect(seen.bTyping).toEqual([{ sid: alice.sessionId, on: true }]);
  });

  it("clears the typing flag BEFORE the hooks run, so a throwing onChatBlocked cannot leave typing on", async () => {
    const { room, alice } = await chatPair();
    const track = trackingOf(room).get(alice.sessionId)!;
    track.typing = true;
    room.throwOnBlock = true;

    // Drive the handler directly: Colyseus would route a throwing handler into its transport.
    const handleChat = (room as unknown as { handleChat(c: Client, payload: unknown): void }).handleChat.bind(room);
    const serverSide = room.clients.getById(alice.sessionId)!;
    expect(() => handleChat(serverSide, { text: SWEAR })).toThrow("onChatBlocked override failed");

    expect(room.blocked).toHaveLength(1); // the hook did run (and fail)
    expect(track.typing).toBe(false);
  });

  it("a room opts out of the filter with one checkProfanity override", async () => {
    const { room, alice, seen, say } = await chatPair();
    room.filterOn = false;

    await say(alice, SWEAR);

    const line = { sid: alice.sessionId, name: "앨리스", text: SWEAR };
    expect(seen.aChats).toEqual([line]);
    expect(seen.bChats).toEqual([line]);
    expect(seen.aRejected).toEqual([]);
    expect(room.blocked).toEqual([]);
  });

  it("a room that overrides nothing still filters, and its default onChatBlocked is harmless", async () => {
    const { room, alice, seen, say } = await chatPair(PROBE_ROOM);

    await say(alice, SWEAR);
    expect(seen.aChats).toEqual([]);
    expect(seen.bChats).toEqual([]);
    expect(seen.aRejected).toEqual([{ reason: CHAT_NOT_NICE }]);

    await say(alice, "고마워요");
    expect(seen.bChats.map((m) => m.text)).toEqual(["고마워요"]);
    expect(room.clients.getById(alice.sessionId)).toBeDefined(); // not thrown out
  });
});

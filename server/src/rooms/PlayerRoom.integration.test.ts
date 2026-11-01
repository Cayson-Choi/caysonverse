import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { defineRoom, type Client } from "colyseus";
import { WORLD_ROOM, PLAYER_RADIUS } from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type {
  ChatBroadcast,
  ChatRejectedPayload,
  JumpBroadcast,
} from "@caysonverse/shared/messages";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { Player, WorldState } from "@caysonverse/shared/schema";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { PlayerRoom, baseTracking, type Tracking } from "./PlayerRoom";
import { rooms, type WorldRoom } from "./index";

/**
 * The shared PlayerRoom base (escape phase 1, Task 2). Its own port: every integration test
 * file boots its own in-process server, and vitest runs files in parallel (ruling E1 —
 * WorldRoom keeps the default 2568; ClassRoom/EscapeRoom take 2569–2571).
 */
const PORT = 2572;

const JOIN_A = { nickname: "앨리스", appearance: DEFAULT_APPEARANCE };
const JOIN_B = { nickname: "밥이", appearance: DEFAULT_APPEARANCE };

/** Let broadcast/personal messages propagate to the in-process test clients. */
const flush = () => new Promise((r) => setTimeout(r, 60));

// ── A minimal room on the base: what ClassRoom / EscapeRoom will look like ──

/** A small room with one prop; the legacy world would accept moves this map drops. */
const PROBE_GEO: MapGeometry = {
  id: "counsel",
  bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
  obstacles: [{ minX: 1, maxX: 2, minZ: -1, maxZ: 1 }],
  cameraBoxes: [],
};
const PROBE_ROOM = "probe";

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

/** White-box handle on the base's per-session bookkeeping. */
function trackingOf(room: ProbeRoom): Map<string, ProbeTracking> {
  return (room as unknown as { tracking: Map<string, ProbeTracking> }).tracking;
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(config({ rooms: { ...rooms, [PROBE_ROOM]: defineRoom(ProbeRoom) } }), PORT);
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
describe("PlayerRoom stray messages (WorldRoom)", () => {
  it("drops an unregistered message type without closing the sender", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
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

    // Still connected and still in the world...
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

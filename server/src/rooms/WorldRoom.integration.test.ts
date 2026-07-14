import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import {
  WORLD_ROOM,
  MAX_CLIENTS,
  PATCH_RATE_MS,
  WORLD_BOUNDS,
  CHAT_MAX_LENGTH,
  EMOJIS,
} from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type {
  ChatBroadcast,
  ChatRejectedPayload,
  EmojiBroadcast,
} from "@caysonverse/shared/messages";
import { rooms, type WorldRoom } from "./index";

const VALID_JOIN = { nickname: "케이슨", character: 1, tint: 2 };
const JOIN_A = { nickname: "앨리스", character: 0, tint: 0 };
const JOIN_B = { nickname: "밥이", character: 1, tint: 1 };

/** Let broadcast/personal messages propagate to the in-process test clients. */
const flush = () => new Promise((r) => setTimeout(r, 60));

describe("WorldRoom (integration)", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    // Passing a tools config object (not a Server) makes boot() suppress the
    // greet banner and logs, keeping test output pristine.
    colyseus = await boot(config({ rooms }));
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("registers the room with the configured maxClients and patch rate", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    expect(room.maxClients).toBe(MAX_CLIENTS);
    expect(room.patchRate).toBe(PATCH_RATE_MS);
  });

  it("adds a player with the given nickname, spawned within bounds", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);

    expect(room.state.players.size).toBe(1);
    const player = room.state.players.get(client.sessionId);
    expect(player).toBeDefined();
    expect(player!.nickname).toBe("케이슨");
    expect(player!.character).toBe(1);
    expect(player!.tint).toBe(2);
    expect(player!.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX);
    expect(player!.x).toBeLessThanOrEqual(WORLD_BOUNDS.maxX);
    expect(player!.z).toBeGreaterThanOrEqual(WORLD_BOUNDS.minZ);
    expect(player!.z).toBeLessThanOrEqual(WORLD_BOUNDS.maxZ);
  });

  it("rejects a join with an invalid nickname", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    await expect(
      colyseus.connectTo(room, { nickname: "a", character: 0, tint: 0 }),
    ).rejects.toThrow("닉네임");
    expect(room.state.players.size).toBe(0);
  });

  it("applies a valid move to the player's state", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);
    const player = room.state.players.get(client.sessionId)!;

    // A tiny step (well within even the elapsed-floor speed budget) plus a new
    // facing — independent of how much wall-clock elapsed since join.
    const target = { x: player.x + 0.02, z: player.z, yaw: 1.2 };
    client.send(MessageType.Move, target);
    await room.waitForNextMessage();

    expect(player.x).toBeCloseTo(target.x, 4);
    expect(player.z).toBeCloseTo(target.z, 4);
    expect(player.yaw).toBeCloseTo(1.2, 4);
  });

  it("drops a teleport move and leaves the player position unchanged", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);
    const player = room.state.players.get(client.sessionId)!;
    const startX = player.x;
    const startZ = player.z;

    client.send(MessageType.Move, { x: startX + 1000, z: startZ + 1000, yaw: 0.5 });
    await room.waitForNextMessage();

    expect(player.x).toBe(startX);
    expect(player.z).toBe(startZ);
  });

  it("relays a chat message to every client tagged with the sender's sid + name", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const aChats: ChatBroadcast[] = [];
    const bChats: ChatBroadcast[] = [];
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => aChats.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => bChats.push(m));

    alice.send(MessageType.Chat, { text: "  안녕하세요!  " }); // trimmed by the server
    await room.waitForNextMessage();
    await flush();

    const expected = { sid: alice.sessionId, name: JOIN_A.nickname, text: "안녕하세요!" };
    expect(aChats).toEqual([expected]); // sender receives its own message too
    expect(bChats).toEqual([expected]);
  });

  it("drops an oversized chat message without broadcasting to anyone", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const chats: ChatBroadcast[] = [];
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => chats.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => chats.push(m));

    alice.send(MessageType.Chat, { text: "가".repeat(CHAT_MAX_LENGTH + 1) });
    await room.waitForNextMessage();
    await flush();

    expect(chats).toHaveLength(0);
  });

  it("rejects the 4th chat inside the window, notifying only the sender", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const aChats: ChatBroadcast[] = [];
    const bChats: ChatBroadcast[] = [];
    const aRejected: ChatRejectedPayload[] = [];
    const bRejected: ChatRejectedPayload[] = [];
    alice.onMessage(MessageType.Chat, (m: ChatBroadcast) => aChats.push(m));
    bob.onMessage(MessageType.Chat, (m: ChatBroadcast) => bChats.push(m));
    alice.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => aRejected.push(m));
    bob.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => bRejected.push(m));

    // Four sends land within milliseconds — all inside the 5s window.
    for (let i = 0; i < 4; i++) {
      alice.send(MessageType.Chat, { text: `메시지 ${i}` });
      await room.waitForNextMessage();
    }
    await flush();

    // First 3 accepted → broadcast to both; the 4th is rate-dropped with a
    // personal notice to the sender only.
    expect(aChats).toHaveLength(3);
    expect(bChats).toHaveLength(3);
    expect(aRejected).toHaveLength(1);
    expect(aRejected[0].reason).toContain("너무 빨라요");
    expect(bRejected).toHaveLength(0);
  });

  it("relays an emoji reaction to every client tagged with the sender's sid", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const aEmojis: EmojiBroadcast[] = [];
    const bEmojis: EmojiBroadcast[] = [];
    alice.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => aEmojis.push(m));
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => bEmojis.push(m));

    alice.send(MessageType.Emoji, { index: 3 });
    await room.waitForNextMessage();
    await flush();

    const expected = { sid: alice.sessionId, index: 3 };
    expect(aEmojis).toEqual([expected]); // sender receives its own reaction too
    expect(bEmojis).toEqual([expected]);
  });

  it("drops an out-of-range emoji index without broadcasting to anyone", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const emojis: EmojiBroadcast[] = [];
    alice.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));

    alice.send(MessageType.Emoji, { index: EMOJIS.length });
    await room.waitForNextMessage();
    await flush();

    expect(emojis).toHaveLength(0);
  });

  it("drops a malformed emoji payload without broadcasting to anyone", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const emojis: EmojiBroadcast[] = [];
    alice.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => emojis.push(m));

    alice.send(MessageType.Emoji, { index: 1.5 });
    await room.waitForNextMessage();
    await flush();

    expect(emojis).toHaveLength(0);
  });

  it("rejects a burst of 3 emoji within 500ms — only the first is broadcast", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const aEmojis: EmojiBroadcast[] = [];
    const bEmojis: EmojiBroadcast[] = [];
    alice.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => aEmojis.push(m));
    bob.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => bEmojis.push(m));

    // Three sends land within milliseconds — all inside the 500ms window.
    for (let i = 0; i < 3; i++) {
      alice.send(MessageType.Emoji, { index: i });
      await room.waitForNextMessage();
    }
    await flush();

    // Only the first is accepted (count: 1, windowMs: 500); the rest are
    // silently dropped — no personal notice, unlike chat's rate rejection.
    expect(aEmojis).toEqual([{ sid: alice.sessionId, index: 0 }]);
    expect(bEmojis).toEqual([{ sid: alice.sessionId, index: 0 }]);
  });
});

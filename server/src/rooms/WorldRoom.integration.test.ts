import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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

// Task 9 admin fixtures.
const ADMIN_CODE = "관리자-s3cret-9";
const ADMIN_JOIN = { nickname: "선생님", character: 0, tint: 0 };
const ANNOUNCE_TEXT = "오늘 수업은 8시 시작!";

/** Poll a getter until it is truthy (or timeout), then return its value. */
async function pollFor<T>(read: () => T, timeoutMs = 2000, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
    v = read();
  }
  return v;
}

// One shared in-process server for the whole file. Two separate boot() calls in
// one process race on Colyseus's module-level matchmaker singleton (observed as
// a "fetch failed" on the second boot's first request), so both describe blocks
// use these file-scoped hooks instead of booting their own server.
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

// Restore the env after EVERY test so ADMIN_CODE never leaks between tests.
afterEach(() => {
  delete process.env.ADMIN_CODE;
});

describe("WorldRoom (integration)", () => {

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

// ── Task 9: admin auth + announce banner + kick ──

describe("WorldRoom admin (integration)", () => {
  it("documents the installed-Colyseus IP availability (server-side marker only)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);
    const marker = room.clients[0].userData as { isAdmin: boolean; ip: string | null };

    // The admin marker is a per-connection server-side object, NEVER schema.
    expect(marker.isAdmin).toBe(false);
    // IP availability finding: the @colyseus/testing harness populates the auth
    // context with the socket loopback (e.g. "::ffff:127.0.0.1"), so per-IP
    // keying is exercised here. In production the real HTTP matchmake route
    // sources ip ONLY from x-forwarded-for/x-client-ip/x-real-ip headers — so
    // without a reverse proxy it is undefined and the code falls back to the
    // global limiter key + nickname-only denySet. Robust to either shape:
    expect(marker.ip === null || typeof marker.ip === "string").toBe(true);
    // Admin status must NOT be observable in synced state.
    expect(JSON.stringify(client.state.toJSON())).not.toContain("isAdmin");
  });

  it("admits an admin with the correct code and marks them server-side only", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });

    expect(room.state.players.size).toBe(1);
    const marker = room.clients[0].userData as { isAdmin: boolean };
    expect(marker.isAdmin).toBe(true);
    // No admin flag anywhere in the synced player/root state.
    expect(JSON.stringify(admin.state.toJSON())).not.toContain("isAdmin");
  });

  it("rejects a join with a wrong admin code (Korean typo error)", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    await expect(
      colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: "틀린코드" }),
    ).rejects.toThrow("관리자 코드가 올바르지 않습니다");
    expect(room.state.players.size).toBe(0);
  });

  it("rejects any admin code when ADMIN_CODE env is unset (admin impossible)", async () => {
    // afterEach guarantees ADMIN_CODE is unset here.
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    await expect(
      colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: "아무코드" }),
    ).rejects.toThrow("관리자 코드가 올바르지 않습니다");
    expect(room.state.players.size).toBe(0);
  });

  it("still admits a NORMAL join (no adminCode) when the env is unset", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    expect(room.state.players.size).toBe(1);
    expect((room.clients[0].userData as { isAdmin: boolean }).isAdmin).toBe(false);
    void client;
  });

  it("blocks brute force: the 6th wrong code within a minute gets a generic error", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    // Keep the room alive: a room that empties (every join failing) is disposed
    // by the matchmaker, after which further connects fail with "room not found".
    await colyseus.connectTo(room, JOIN_A);

    // 5 wrong attempts each get the specific typo error…
    for (let i = 0; i < 5; i++) {
      await expect(
        colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: `틀림${i}` }),
      ).rejects.toThrow("관리자 코드가 올바르지 않습니다");
    }
    // …the 6th is blocked with the generic rate-limit error (no compare).
    await expect(
      colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE }),
    ).rejects.toThrow("시도가 너무 많습니다");
  });

  it("sets the announcement banner in schema state that a second client sees", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });
    const viewer = await colyseus.connectTo(room, JOIN_A);

    admin.send(MessageType.Announce, { text: ANNOUNCE_TEXT });
    await room.waitForNextMessage();
    await flush();

    expect(room.state.announcement).toBe(ANNOUNCE_TEXT);
    expect(room.state.announcedAt).toBeGreaterThan(0);
    // The second client's SYNCED state carries the banner (it is schema state).
    expect(await pollFor(() => viewer.state.announcement === ANNOUNCE_TEXT)).toBe(true);
  });

  it("shows the current banner to a LATE joiner automatically", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });

    admin.send(MessageType.Announce, { text: ANNOUNCE_TEXT });
    await room.waitForNextMessage();
    await flush();

    // Someone who joins AFTER the announce still receives it via state sync.
    const late = await colyseus.connectTo(room, JOIN_B);
    expect(await pollFor(() => late.state.announcement === ANNOUNCE_TEXT)).toBe(true);
  });

  it("clears the banner when the admin sends an empty announcement", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });

    admin.send(MessageType.Announce, { text: ANNOUNCE_TEXT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.announcement).toBe(ANNOUNCE_TEXT);

    admin.send(MessageType.Announce, { text: "   " }); // whitespace-only → clear
    await room.waitForNextMessage();
    await flush();
    expect(room.state.announcement).toBe("");
  });

  it("drops an Announce from a NON-admin (banner unchanged)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const normal = await colyseus.connectTo(room, JOIN_A);

    normal.send(MessageType.Announce, { text: "허가되지 않은 공지" });
    await room.waitForNextMessage();
    await flush();

    expect(room.state.announcement).toBe("");
  });

  it("kicks a target: closes with 4001 and blocks a same-nickname rejoin", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });
    const bob = await colyseus.connectTo(room, JOIN_B);

    let leaveCode: number | null = null;
    bob.onLeave((code) => {
      leaveCode = code;
    });

    admin.send(MessageType.Kick, { sid: bob.sessionId });
    await room.waitForNextMessage();

    expect(await pollFor(() => leaveCode !== null)).toBe(true);
    expect(leaveCode).toBe(4001);
    await flush();
    expect(room.state.players.has(bob.sessionId)).toBe(false);

    // Rejoining with the SAME nickname is blocked by the denySet (nickname key).
    await expect(colyseus.connectTo(room, JOIN_B)).rejects.toThrow("입장이 제한되었습니다");
  });

  it("drops a Kick from a NON-admin (target stays connected)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    let bobLeft = false;
    bob.onLeave(() => {
      bobLeft = true;
    });

    alice.send(MessageType.Kick, { sid: bob.sessionId });
    await room.waitForNextMessage();
    await flush();

    expect(bobLeft).toBe(false);
    expect(room.state.players.has(bob.sessionId)).toBe(true);
  });

  it("ignores an admin attempting to kick themselves", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });

    let adminLeft = false;
    admin.onLeave(() => {
      adminLeft = true;
    });

    admin.send(MessageType.Kick, { sid: admin.sessionId });
    await room.waitForNextMessage();
    await flush();

    expect(adminLeft).toBe(false);
    expect(room.state.players.has(admin.sessionId)).toBe(true);
  });
});

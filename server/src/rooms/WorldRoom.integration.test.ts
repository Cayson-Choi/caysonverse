import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import {
  WORLD_ROOM,
  MAX_CLIENTS,
  PATCH_RATE_MS,
  WORLD_BOUNDS,
  CHAT_MAX_LENGTH,
  EMOJIS,
  MOVE_MAX_MSGS_PER_SEC,
} from "@caysonverse/shared/constants";
import { MessageType } from "@caysonverse/shared/messages";
import type {
  ChatBroadcast,
  ChatRejectedPayload,
  EmojiBroadcast,
  SitRejectedPayload,
  SystemBroadcast,
} from "@caysonverse/shared/messages";
import { SEATS } from "@caysonverse/shared/worldMap";
import { MAZE_GOAL, MAZE_PORTAL, MAZE_RETURN, ESCAPE_COOLDOWN_MS } from "@caysonverse/shared/maze";
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

// Restore the env after EVERY test so test-only overrides never leak between
// tests (ADMIN_CODE, and the Task 11 reconnection-window / maxClients overrides).
afterEach(() => {
  delete process.env.ADMIN_CODE;
  delete process.env.CV_RECONNECT_WINDOW_S;
  delete process.env.CV_MAX_CLIENTS;
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

  // Anti-teleport, final-review D1: `elapsed = now - lastAcceptedAt` must be
  // CAPPED. Without the ceiling a client that idles (or reconnects) then sends one
  // move would get a world-spanning displacement budget and clamp-accept anywhere
  // on open floor. We simulate the idle by backdating the client's last-accepted
  // clock (white-box reach into the private tracking map — the ceiling is room
  // timing, not the pure validator).
  it("caps the elapsed budget so a big move after a long idle gap is DROPPED", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);
    const player = room.state.players.get(client.sessionId)!;
    const startX = player.x;
    const startZ = player.z;

    // Backdate 60s: an UNCAPPED budget (4 m/s * 60s * 1.5) would allow ~360 m,
    // clamp-accepting any in-bounds target. The ceiling must cut this to ~3 m.
    const tracking = (room as unknown as {
      tracking: Map<string, { lastAcceptedAt: number }>;
    }).tracking;
    tracking.get(client.sessionId)!.lastAcceptedAt = Date.now() - 60_000;

    // A 10 m step NORTH to open lounge floor (in-bounds, no obstacle — the
    // spawn→gallery-door corridor is kept clear by the map invariants; SOUTH
    // would now meet the central sofa set, design 32): beyond the capped ~3 m
    // budget → dropped. It is NOT dropped for bounds/obstacle reasons.
    client.send(MessageType.Move, { x: startX, z: startZ - 10, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(player.x).toBe(startX);
    expect(player.z).toBe(startZ);

    // The SAME idle gap still permits a normal in-budget step (~1 m < 3 m cap):
    // capping the budget does not blanket-block moves after an idle.
    client.send(MessageType.Move, { x: startX, z: startZ - 1, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(player.z).toBeCloseTo(startZ - 1, 4);
  });

  // Gap closed (Task 12 audit): the pure RateWindow class was already exhaustively
  // unit-tested (rateLimit.test.ts), but nothing proved the ROOM actually wires it
  // to moves — the design's explicit "30 msg/s 초과 드롭" behavior. Mirrors the
  // existing chat/emoji rate-cap integration tests below.
  it("drops move messages beyond the 30 msg/s rate cap", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, VALID_JOIN);
    const player = room.state.players.get(client.sessionId)!;
    const startX = player.x;

    // Each step is tiny — the displacement budget is never the limiting factor
    // here, only the per-second message-count cap is under test.
    const STEP = 0.001;
    const BURST = MOVE_MAX_MSGS_PER_SEC + 3; // past the cap, still a fast burst
    for (let i = 1; i <= BURST; i++) {
      client.send(MessageType.Move, { x: startX + i * STEP, z: player.z, yaw: 0 });
      await room.waitForNextMessage();
    }
    await flush();

    // At most MOVE_MAX_MSGS_PER_SEC of the burst could land inside one window —
    // the rest were rate-dropped, so x can be at most that many steps past start.
    expect(player.x).toBeLessThanOrEqual(startX + MOVE_MAX_MSGS_PER_SEC * STEP + 1e-9);
    expect(player.x).toBeGreaterThan(startX); // some of the burst DID get through
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

  // Gap closed (Task 12 audit): handleKick's "malformed payload" and "target
  // must exist" branches (see WorldRoom.ts) had no test exercising them.
  it("ignores a Kick with a malformed payload (wrong type / missing sid)", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });
    const bob = await colyseus.connectTo(room, JOIN_B);

    admin.send(MessageType.Kick, { sid: 123 }); // wrong type
    await room.waitForNextMessage();
    admin.send(MessageType.Kick, {}); // missing sid
    await room.waitForNextMessage();
    admin.send(MessageType.Kick, { sid: "" }); // empty sid
    await room.waitForNextMessage();
    await flush();

    // Nobody was removed — both connections are untouched.
    expect(room.state.players.size).toBe(2);
    expect(room.state.players.has(bob.sessionId)).toBe(true);
  });

  it("ignores a Kick naming a session id that does not exist", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });

    admin.send(MessageType.Kick, { sid: "no-such-session-id" });
    await room.waitForNextMessage();
    await flush();

    // Only the admin is in the room — the bogus target simply had no effect.
    expect(room.state.players.size).toBe(1);
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

// ── Task 11: reconnection lifecycle (onDrop / onReconnect / onLeave) + capacity ──
//
// Verified Colyseus 0.17 server API (from @colyseus/core Room):
//   onDrop(client, code): unexpected close → allowReconnection(client, seconds).
//   onReconnect(client):  the SAME session re-established within the window.
//   onLeave(client, code): permanent departure (consented / kick / window expiry).
// A drop is forced in-process by closing the client transport with a non-consented
// code (MAY_TRY_RECONNECT=4010); a reconnect uses colyseus.sdk.reconnect(token).

describe("WorldRoom reconnection (integration)", () => {
  it("keeps a dropped player as connected=false, then a reconnect restores it with the SAME position", async () => {
    // A 5s window: long enough to reconnect within, short enough that the pending
    // seat timeout is cleared by the successful reconnect (no dangling timer).
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    const sid = client.sessionId;
    const token = client.reconnectionToken;
    const player = room.state.players.get(sid)!;
    const x0 = player.x;
    const z0 = player.z;
    expect(player.connected).toBe(true);

    // Force an ABNORMAL drop (not a consented leave). Disable the test client's
    // own auto-reconnect so ONLY our explicit reconnect drives recovery.
    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");

    // The player stays in state, flagged disconnected → drives the ghost render.
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    expect(room.state.players.has(sid)).toBe(true);

    // Reconnect the SAME session within the window → ghost clears, pose preserved
    // (the player never left state, so x/z are byte-identical).
    const reconnected = await colyseus.sdk.reconnect(token);
    expect(reconnected.sessionId).toBe(sid);
    expect(await pollFor(() => room.state.players.get(sid)?.connected === true)).toBe(true);
    expect(room.state.players.get(sid)!.x).toBe(x0);
    expect(room.state.players.get(sid)!.z).toBe(z0);
  });

  it("removes the player when the reconnection window expires (no reconnect)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "0.2"; // sub-second expiry — no 20s wait
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    const sid = client.sessionId;

    client.reconnection.enabled = false;
    client.connection.close(4010, "test drop");

    // First it lingers disconnected…
    expect(await pollFor(() => room.state.players.get(sid)?.connected === false)).toBe(true);
    // …then, with no reconnect inside the 0.2s window, it is removed permanently.
    expect(await pollFor(() => !room.state.players.has(sid), 3000)).toBe(true);
  });

  it("removes a player immediately on a CONSENTED leave (no reconnection window)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    const sid = client.sessionId;

    await client.leave(true); // consented → onLeave, immediate removal
    expect(await pollFor(() => !room.state.players.has(sid))).toBe(true);
  });

  it("kicks immediately with NO reconnection window — a kicked client cannot reconnect", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });
    const bob = await colyseus.connectTo(room, JOIN_B);
    const sid = bob.sessionId;
    const token = bob.reconnectionToken;
    bob.reconnection.enabled = false;

    admin.send(MessageType.Kick, { sid });
    await room.waitForNextMessage();

    // Removed PROMPTLY (not held for a 20s ghost window like an abnormal drop).
    expect(await pollFor(() => !room.state.players.has(sid), 2000)).toBe(true);
    // No window was opened, so reconnecting with the kicked token is rejected.
    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
  });

  it("rejects a client.join to a FULL world room (521 no-rooms-found → capacity notice)", async () => {
    // Exercise the ACTUAL production join verb: the client uses `client.join`
    // (join-existing-only, NEVER joinOrCreate — see connection.ts / resilience.ts),
    // so a full world must be REJECTED here rather than silently spawning a second
    // parallel room. Using the SDK client's `join` (colyseus.sdk) instead of the
    // harness `connectTo` (which is join-by-id) is the whole point of this test.
    process.env.CV_MAX_CLIENTS = "1"; // test-only shrink; production stays MAX_CLIENTS
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    expect(room.maxClients).toBe(1);

    // Fill via the same verb the client uses → the singleton locks.
    await colyseus.sdk.join(WORLD_ROOM, JOIN_A);

    // A second client.join finds no AVAILABLE (unlocked) room named "world" and is
    // rejected with MATCHMAKE_INVALID_CRITERIA (521) + "no rooms found …". Crucially
    // it does NOT create a second room. The client maps 521 to the Korean capacity
    // notice (see client reconnectPolicy.isCapacityError).
    let caught: unknown;
    try {
      await colyseus.sdk.join(WORLD_ROOM, JOIN_B);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: unknown }).code).toBe(521);
    expect(String((caught as { message?: unknown }).message)).toMatch(/no rooms/i);

    // No second world was spawned by the rejected join — still exactly one room.
    const worldRooms = await matchMaker.query({ name: WORLD_ROOM });
    expect(worldRooms.length).toBe(1);
  });

  it("keeps the world room alive when empty (autoDispose off — singleton survives 0 players)", async () => {
    // The singleton topology requires the world room to survive 0-player periods
    // (so a mass reconnect after a lull still finds the ONE room). WorldRoom sets
    // autoDispose = false; an auto-disposing room would vanish here and the rejoin
    // below would fail with "room not found".
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    expect(room.autoDispose).toBe(false);

    const first = await colyseus.connectTo(room, JOIN_A);
    await first.leave(true); // consented → onLeave removes the only player
    expect(await pollFor(() => room.state.players.size === 0)).toBe(true);

    // The empty room was NOT disposed: a fresh join-by-id to the SAME instance
    // still succeeds (proving it survived being empty).
    await new Promise((r) => setTimeout(r, 100));
    const second = await colyseus.connectTo(room, JOIN_B);
    expect(room.state.players.has(second.sessionId)).toBe(true);
  });
});

// ── v2 Task 1: seating (sit / stand / occupancy / cleanup) ──
//
// A seat is only sittable within SEAT_REACH of its centre; players spawn in the
// lounge, far from every chair. To keep these deterministic we place the player
// directly on the target seat's clear dismount point (white-box state edit — the
// long walk itself is exercised by the two-tab E2E), then drive the real Sit/
// Stand/Move message handlers.
describe("WorldRoom seating (integration)", () => {
  const SEAT = 1; // a front-row student chair
  const seat = SEATS[SEAT];

  /** Put `sid` on `seat`'s dismount point so a Sit for it is in range. */
  function placeAtDismount(room: WorldRoom, sid: string, s = seat): void {
    const player = room.state.players.get(sid)!;
    player.x = s.standX;
    player.z = s.standZ;
  }

  it("seats a player: snaps position + facing to the seat and syncs seatIndex", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    placeAtDismount(room, client.sessionId);

    client.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.seatIndex).toBe(SEAT);
    expect(player.x).toBeCloseTo(seat.x, 6);
    expect(player.z).toBeCloseTo(seat.z, 6);
    expect(player.yaw).toBeCloseTo(seat.yaw, 6); // faces the screen (+X)
  });

  it("drops an out-of-range Sit (player far from the seat) silently", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    // Left at the lounge spawn — nowhere near seat SEAT.
    const before = room.state.players.get(client.sessionId)!;
    const x0 = before.x;
    const z0 = before.z;

    client.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();

    expect(before.seatIndex).toBe(-1);
    expect(before.x).toBe(x0);
    expect(before.z).toBe(z0);
  });

  it("rejects the second sitter on an occupied seat — notice to that client ONLY", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);
    placeAtDismount(room, alice.sessionId);
    placeAtDismount(room, bob.sessionId);

    const aRejected: SitRejectedPayload[] = [];
    const bRejected: SitRejectedPayload[] = [];
    alice.onMessage(MessageType.SitRejected, (m: SitRejectedPayload) => aRejected.push(m));
    bob.onMessage(MessageType.SitRejected, (m: SitRejectedPayload) => bRejected.push(m));

    alice.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    bob.send(MessageType.Sit, { seatIndex: SEAT }); // seat now taken by alice
    await room.waitForNextMessage();
    await flush();

    expect(room.state.players.get(alice.sessionId)!.seatIndex).toBe(SEAT);
    expect(room.state.players.get(bob.sessionId)!.seatIndex).toBe(-1); // bob stayed standing
    expect(bRejected).toHaveLength(1);
    expect(bRejected[0].reason).toBe("이미 사용 중인 자리예요");
    expect(aRejected).toHaveLength(0); // the winner is never notified
  });

  it("drops a Move while seated — the seated position is unchanged", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    placeAtDismount(room, client.sessionId);
    client.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();

    const player = room.state.players.get(client.sessionId)!;
    // A tiny, otherwise-legal step: dropped only because the sender is seated.
    client.send(MessageType.Move, { x: seat.x + 0.05, z: seat.z, yaw: 0.3 });
    await room.waitForNextMessage();
    await flush();

    expect(player.seatIndex).toBe(SEAT);
    expect(player.x).toBeCloseTo(seat.x, 6);
    expect(player.z).toBeCloseTo(seat.z, 6);
  });

  it("stands a player to the dismount point, frees the seat, lets another sit", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);
    placeAtDismount(room, alice.sessionId);
    placeAtDismount(room, bob.sessionId);

    alice.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();

    alice.send(MessageType.Stand, {});
    await room.waitForNextMessage();
    await flush();

    const a = room.state.players.get(alice.sessionId)!;
    expect(a.seatIndex).toBe(-1);
    expect(a.x).toBeCloseTo(seat.standX, 6);
    expect(a.z).toBeCloseTo(seat.standZ, 6);

    // The freed seat is now sittable by bob.
    bob.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.players.get(bob.sessionId)!.seatIndex).toBe(SEAT);
  });

  it("drops a Stand from a standing player (silent)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const client = await colyseus.connectTo(room, JOIN_A);
    const player = room.state.players.get(client.sessionId)!;
    const x0 = player.x;
    const z0 = player.z;

    client.send(MessageType.Stand, {});
    await room.waitForNextMessage();
    await flush();

    expect(player.seatIndex).toBe(-1);
    expect(player.x).toBe(x0);
    expect(player.z).toBe(z0);
  });

  it("frees the seat on a consented leave while seated (another player can sit)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);
    placeAtDismount(room, bob.sessionId);

    placeAtDismount(room, alice.sessionId);
    alice.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.players.get(alice.sessionId)!.seatIndex).toBe(SEAT);

    await alice.leave(true); // consented → onLeave frees the seat
    expect(await pollFor(() => !room.state.players.has(alice.sessionId))).toBe(true);

    bob.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.players.get(bob.sessionId)!.seatIndex).toBe(SEAT);
  });

  it("frees the seat when a seated player is kicked (another player can sit)", async () => {
    process.env.ADMIN_CODE = ADMIN_CODE;
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const admin = await colyseus.connectTo(room, { ...ADMIN_JOIN, adminCode: ADMIN_CODE });
    const bob = await colyseus.connectTo(room, JOIN_B);
    placeAtDismount(room, bob.sessionId);

    placeAtDismount(room, bob.sessionId, seat); // ensure bob is in range too
    // Seat bob, then have the admin kick him — the seat must be freed on removal.
    bob.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.players.get(bob.sessionId)!.seatIndex).toBe(SEAT);

    admin.send(MessageType.Kick, { sid: bob.sessionId });
    await room.waitForNextMessage();
    expect(await pollFor(() => !room.state.players.has(bob.sessionId))).toBe(true);
    await flush();

    // The admin (placed in range) can now take the freed seat.
    placeAtDismount(room, admin.sessionId, seat);
    admin.send(MessageType.Sit, { seatIndex: SEAT });
    await room.waitForNextMessage();
    await flush();
    expect(room.state.players.get(admin.sessionId)!.seatIndex).toBe(SEAT);
  });
});

// ── v2 Task 3: maze goal-escape broadcast + return portal ──
//
// Goal/portal are judged on the accepted-move path. Walking the whole maze in a
// test is impractical, so (like the seating tests) we white-box place the player
// on the goal/portal floor and drive ONE real Move that lands on it. The move
// clock is white-box read/written where a specific elapsed budget is needed.
describe("WorldRoom maze goal/portal (integration)", () => {
  const goalCenter = { x: (MAZE_GOAL.minX + MAZE_GOAL.maxX) / 2, z: (MAZE_GOAL.minZ + MAZE_GOAL.maxZ) / 2 };
  const portalCenter = { x: (MAZE_PORTAL.minX + MAZE_PORTAL.maxX) / 2, z: (MAZE_PORTAL.minZ + MAZE_PORTAL.maxZ) / 2 };

  /** White-box handle on the private per-session move/escape clocks. */
  function trackingOf(room: WorldRoom, sid: string) {
    return (room as unknown as {
      tracking: Map<string, { lastAcceptedAt: number; lastEscapeAt: number }>;
    }).tracking.get(sid)!;
  }

  it("broadcasts the escape notice ONCE, then the 30s cooldown suppresses repeats", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const bob = await colyseus.connectTo(room, JOIN_B);

    const aSys: SystemBroadcast[] = [];
    const bSys: SystemBroadcast[] = [];
    alice.onMessage(MessageType.System, (m: SystemBroadcast) => aSys.push(m));
    bob.onMessage(MessageType.System, (m: SystemBroadcast) => bSys.push(m));

    // Place alice on the goal floor; a tiny in-goal step is an accepted move.
    const p = room.state.players.get(alice.sessionId)!;
    p.x = goalCenter.x;
    p.z = goalCenter.z;

    alice.send(MessageType.Move, { x: goalCenter.x + 0.02, z: goalCenter.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();

    // Fires once, to EVERYONE, tagged with the escaper's sid + Korean text.
    expect(aSys).toHaveLength(1);
    expect(bSys).toHaveLength(1);
    expect(aSys[0].sid).toBe(alice.sessionId);
    expect(aSys[0].text).toContain(JOIN_A.nickname);
    expect(aSys[0].text).toContain("미로를 탈출했습니다");

    // A second accepted move still inside the goal within the cooldown → NO repeat.
    alice.send(MessageType.Move, { x: goalCenter.x + 0.04, z: goalCenter.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(aSys).toHaveLength(1);
    expect(bSys).toHaveLength(1);

    // Backdate this session's escape clock past the cooldown → it fires again.
    trackingOf(room, alice.sessionId).lastEscapeAt = Date.now() - ESCAPE_COOLDOWN_MS - 1000;
    alice.send(MessageType.Move, { x: goalCenter.x + 0.06, z: goalCenter.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(aSys).toHaveLength(2);
    expect(bSys).toHaveLength(2);
  });

  it("stepping on the pad NO LONGER teleports; the explicit PortalReturn does (design 34 후속)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const p = room.state.players.get(alice.sessionId)!;

    // No System notice on a pure portal step (portal ≠ goal).
    const sys: SystemBroadcast[] = [];
    alice.onMessage(MessageType.System, (m: SystemBroadcast) => sys.push(m));

    p.x = portalCenter.x;
    p.z = portalCenter.z;
    alice.send(MessageType.Move, { x: portalCenter.x + 0.02, z: portalCenter.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();

    // 발주자: 가운데 도달만으로는 포탈되지 않는다 — 큐리와 먼저 만나야 하니까.
    expect(p.x).toBeCloseTo(portalCenter.x + 0.02, 4);
    expect(p.z).toBeCloseTo(portalCenter.z, 6);
    expect(sys).toHaveLength(0);

    // The EXPLICIT request (큐리 panel button) from inside the chamber teleports.
    alice.send(MessageType.PortalReturn, {});
    await room.waitForNextMessage();
    await flush();
    expect(p.x).toBeCloseTo(MAZE_RETURN.x, 6);
    expect(p.z).toBeCloseTo(MAZE_RETURN.z, 6);

    // Baseline reset: the clock is `now`, so a huge next step is DROPPED (the
    // ~21 m teleport did not seed an exploitable one-shot budget)…
    alice.send(MessageType.Move, { x: MAZE_RETURN.x + 8, z: MAZE_RETURN.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(p.x).toBeCloseTo(MAZE_RETURN.x, 6); // dropped — unchanged

    // …yet a normal in-budget step from the return spot is accepted.
    trackingOf(room, alice.sessionId).lastAcceptedAt = Date.now() - 200; // ~1.2 m budget
    alice.send(MessageType.Move, { x: MAZE_RETURN.x + 0.5, z: MAZE_RETURN.z, yaw: 0 });
    await room.waitForNextMessage();
    await flush();
    expect(p.x).toBeCloseTo(MAZE_RETURN.x + 0.5, 4);
  });

  it("ignores PortalReturn sent away from the goal chamber (tampered client)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const p = room.state.players.get(alice.sessionId)!;
    const beforeX = p.x;
    const beforeZ = p.z;

    // From the lounge spawn — far outside the chamber radius: silent no-op.
    alice.send(MessageType.PortalReturn, {});
    await room.waitForNextMessage();
    await flush();
    expect(p.x).toBeCloseTo(beforeX, 6);
    expect(p.z).toBeCloseTo(beforeZ, 6);
  });

  it("drops a move that tunnels through a maze wall (existing obstacle check)", async () => {
    const room = await colyseus.createRoom<WorldRoom>(WORLD_ROOM);
    const alice = await colyseus.connectTo(room, JOIN_A);
    const p = room.state.players.get(alice.sessionId)!;

    // Entrance-cell centre; straight west is an internal maze wall (x ≈ -32.4).
    p.x = -31.2;
    p.z = 0;
    trackingOf(room, alice.sessionId).lastAcceptedAt = Date.now() - 400; // ~2.4 m budget
    alice.send(MessageType.Move, { x: -32.4, z: 0, yaw: 0 });
    await room.waitForNextMessage();
    await flush();

    // The body would overlap the wall → the move is dropped, position unchanged.
    expect(p.x).toBe(-31.2);
    expect(p.z).toBe(0);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { RECONNECT_WINDOW_S } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { CLASS_RECONNECT_WINDOW_S, CLASS_ROOM, PLACE_ESCAPE } from "@caysonverse/shared/escape/constants";
import { ClassMsg, EscapeMsg, type EscapeTicketPayload } from "@caysonverse/shared/escape/messages";
import { HUB_DOORS, TEAM_ZONE } from "@caysonverse/shared/school/hubMap";
import { MessageType } from "@caysonverse/shared/messages";
import { rooms, WorldRoom } from "../rooms";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import type { Tracking } from "../rooms/PlayerRoom";
import { EscapeRoom } from "../escape/EscapeRoom";
import { ClassRoom } from "./ClassRoom";
import { classRegistry, type ClassCreateOptions } from "./classRegistry";
import type { VerifiedKey } from "./teacherKeys";

/**
 * Final review I3: a phone that locks (or switches apps) for longer than the world's 20 s window must
 * not lose its team. A class and its team classrooms hold a dropped player for CLASS_RECONNECT_WINDOW_S
 * (180 s); the world keeps 20 s. Its own boot on its own port (2568 WorldRoom, 2569 ClassRoom,
 * 2570 EscapeRoom, 2571 escapeFlow, 2572 PlayerRoom, 2573 banditAi, 2574 this file).
 *
 * The main test waits for real — about 30 s, past the world's window — with NO test override of the
 * window: the production values decide.
 */
const PORT = 2574;
/** How long the phone is "asleep": well past the world's 20 s, well inside the class's 180 s. */
const ASLEEP_MS = 30_000;

const OPENER = { id: "t1", group: "saebit", label: "새빛초 4-2" };
const T1: VerifiedKey = { id: "t1", label: "새빛초 4-2", group: "saebit", operator: false };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = () => sleep(60);

async function pollFor<T>(read: () => T, timeoutMs = 3000, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = read();
  }
  return v;
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(config({ rooms }), PORT);
});

afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  await colyseus.cleanup();
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.CV_RECONNECT_WINDOW_S;
  vi.restoreAllMocks();
});

type SdkRoom = Awaited<ReturnType<typeof colyseus.sdk.joinById>>;

/** One student's class connection and the tickets it was sent. */
interface Kid {
  client: SdkRoom;
  sid: string;
  tickets: EscapeTicketPayload[];
}

async function join(room: ClassRoom, nickname: string, extra: Record<string, unknown> = {}): Promise<Kid> {
  const client = (await colyseus.connectTo(room, {
    classCode: room.state.classCode,
    nickname,
    appearance: DEFAULT_APPEARANCE,
    ...extra,
  })) as unknown as SdkRoom;
  const kid: Kid = { client, sid: client.sessionId, tickets: [] };
  client.onMessage(ClassMsg.EscapeTicket, (m: EscapeTicketPayload) => kid.tickets.push(m));
  client.onMessage("*", () => {});
  await flush();
  return kid;
}

async function sendTo(room: ClassRoom, client: { send(type: string, payload?: unknown): void }, type: string, payload?: unknown) {
  const handled = room.waitForNextMessage();
  client.send(type, payload);
  await handled;
  await flush();
}

function trackingOf(room: ClassRoom): Map<string, Tracking> {
  return (room as unknown as { tracking: Map<string, Tracking> }).tracking;
}

const COUNSEL = HUB_DOORS.find((d) => d.room === "counsel")!;
const RUG = { x: (TEAM_ZONE.minX + TEAM_ZONE.maxX) / 2, z: (TEAM_ZONE.minZ + TEAM_ZONE.maxZ) / 2 };

/** Stand just off the counsel pad and walk onto it with one legal Move (the pad hook runs). */
async function stepOnCounsel(room: ClassRoom, k: Kid): Promise<void> {
  const p = room.state.players.get(k.sid)!;
  p.x = COUNSEL.x;
  p.z = Math.sign(COUNSEL.returnPoint.z) * 0.5;
  trackingOf(room).get(k.sid)!.lastAcceptedAt = Date.now() - 200;
  await sendTo(room, k.client, MessageType.Move, { x: COUNSEL.x, z: COUNSEL.returnPoint.z, yaw: 0 });
}

/** A member's connection to the team classroom. */
async function goIn(t: EscapeTicketPayload): Promise<SdkRoom> {
  const client = await colyseus.sdk.joinById(t.roomId, { ticket: t.ticket });
  client.onMessage("*", () => {});
  client.onMessage(EscapeMsg.Event, () => {});
  await flush();
  return client;
}

/** The phone locks: the connection closes without consent (the server keeps a ghost). */
function cut(client: SdkRoom): string {
  const token = client.reconnectionToken;
  client.reconnection.enabled = false;
  client.connection.close(4010, "phone asleep");
  return token;
}

/** The production window of a room class (no instance: only the prototype's methods run). */
function windowOf(proto: object): number {
  return (Object.create(proto) as { reconnectWindowSeconds(): number }).reconnectWindowSeconds();
}

describe("the reconnection window per room class (final review I3)", () => {
  it("the world keeps 20 s; a class and its team classrooms hold a dropped player 180 s; the test override still wins", () => {
    expect(RECONNECT_WINDOW_S).toBe(20);
    expect(CLASS_RECONNECT_WINDOW_S).toBe(180);
    expect(windowOf(WorldRoom.prototype)).toBe(RECONNECT_WINDOW_S);
    expect(windowOf(ClassRoom.prototype)).toBe(CLASS_RECONNECT_WINDOW_S);
    expect(windowOf(EscapeRoom.prototype)).toBe(CLASS_RECONNECT_WINDOW_S);
    process.env.CV_RECONNECT_WINDOW_S = "0.5";
    for (const proto of [WorldRoom.prototype, ClassRoom.prototype, EscapeRoom.prototype]) expect(windowOf(proto)).toBe(0.5);
  });

  it(
    "a student whose phone sleeps ~30 s comes back to the same team and the same classroom; the team saw them away meanwhile",
    async () => {
      const room = await colyseus.createRoom<ClassRoom>(CLASS_ROOM, {
        spawnToken: SPAWN_TOKEN,
        classCode: "SL2EEP",
        textLevel: "easy",
        opener: OPENER,
      } satisfies ClassCreateOptions);
      const teacher = await join(room, "선생님", { teacherPass: classRegistry.issuePass("SL2EEP", T1, Date.now()) });
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "start" });
      const a = await join(room, "가람");
      const b = await join(room, "다온");
      for (const k of [a, b]) {
        const p = room.state.players.get(k.sid)!;
        p.x = RUG.x;
        p.z = RUG.z;
      }
      await sendTo(room, a.client, ClassMsg.TeamCreate, { nameIndex: 0, colorIndex: 5 });
      const teamId = room.state.players.get(a.sid)!.teamId;
      await sendTo(room, b.client, ClassMsg.TeamJoin, { teamId });
      const team = room.state.teams.get(teamId)!;
      expect([...team.members]).toEqual([a.sid, b.sid]);

      // Into the team's classroom together.
      await stepOnCounsel(room, a);
      await stepOnCounsel(room, b);
      await sendTo(room, a.client, ClassMsg.EnterRoom, { room: "counsel" });
      expect(await pollFor(() => a.tickets.length === 1 && b.tickets.length === 1)).toBe(true);
      const ia = await goIn(a.tickets[0]);
      await goIn(b.tickets[0]);
      const esc = matchMaker.getLocalRoomById(team.escapeRoomId) as EscapeRoom;
      expect(await pollFor(() => room.state.players.get(a.sid)?.place === PLACE_ESCAPE)).toBe(true);
      expect(esc.state.solo).toBe(false);

      // A's phone locks: both connections drop without consent.
      const classWindows = vi.spyOn(room, "allowReconnection");
      const escapeWindows = vi.spyOn(esc, "allowReconnection");
      const classToken = cut(a.client);
      const escapeToken = cut(ia);
      expect(await pollFor(() => room.state.players.get(a.sid)?.connected === false)).toBe(true);
      expect(await pollFor(() => esc.state.players.get(ia.sessionId)?.connected === false)).toBe(true);
      expect(classWindows).toHaveBeenCalledWith(expect.anything(), CLASS_RECONNECT_WINDOW_S);
      expect(escapeWindows).toHaveBeenCalledWith(expect.anything(), CLASS_RECONNECT_WINDOW_S);
      // Meanwhile the teammate sees A away: a ghost, and the puzzle counts B alone (solo).
      expect(await pollFor(() => esc.state.solo)).toBe(true);

      await sleep(ASLEEP_MS);

      // Past the world's 20 s: A is still in the class, in the team (same seat), inside the classroom.
      const ghost = room.state.players.get(a.sid);
      expect(ghost?.connected).toBe(false);
      expect(ghost?.teamId).toBe(teamId);
      expect(ghost?.place).toBe(PLACE_ESCAPE);
      expect(room.state.teams.get(teamId)).toBe(team);
      expect([...team.members]).toEqual([a.sid, b.sid]);
      expect(team.escapeRoomId).toBe(esc.roomId);
      expect(esc.state.players.get(ia.sessionId)?.connected).toBe(false);

      // The phone wakes: the client restores both sessions with their tokens (Phase 1).
      const back = await colyseus.sdk.reconnect(classToken);
      back.onMessage("*", () => {});
      const backInside = await colyseus.sdk.reconnect(escapeToken);
      backInside.onMessage("*", () => {});
      expect(back.sessionId).toBe(a.sid);
      expect(backInside.sessionId).toBe(ia.sessionId);
      expect(await pollFor(() => room.state.players.get(a.sid)?.connected === true)).toBe(true);
      expect(await pollFor(() => esc.state.players.get(ia.sessionId)?.connected === true)).toBe(true);
      expect(room.state.players.get(a.sid)?.teamId).toBe(teamId);
      expect(room.state.players.get(a.sid)?.place).toBe(PLACE_ESCAPE);
      expect([...team.members]).toEqual([a.sid, b.sid]);
      expect(await pollFor(() => !esc.state.solo)).toBe(true);
    },
    ASLEEP_MS + 30_000,
  );
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { KICK_CLOSE_CODE, ROLE_STUDENT, ROLE_TEACHER } from "@caysonverse/shared/constants";
import { MessageType, type ChatBroadcast, type ChatRejectedPayload } from "@caysonverse/shared/messages";
import { APPEARANCE_FIELDS, APPEARANCE_RANGES, DEFAULT_APPEARANCE, pickAppearance, type Appearance } from "@caysonverse/shared/appearance";
import {
  CLASS_CLOSED_CODE,
  ESCAPE_ACTION_RATE,
  ESCAPE_INTRO_MS,
  ESCAPE_MAX_CLIENTS,
  ESCAPE_RETRY_EXTRA_S,
  ESCAPE_ROOM,
  ESCAPE_TIME_LIMIT_S,
  FINALE_COOLDOWN_MS,
  LOCK_SUBMIT_GAP_MS,
  TICKET_TTL_MS,
} from "@caysonverse/shared/escape/constants";
import {
  EscapeMsg,
  type EscapeEventPayload,
  type EscapedEvent,
  type InspectViewPayload,
  type RoomContent,
  type TeamChatMirrorPayload,
} from "@caysonverse/shared/escape/messages";
import { COUNSEL_ANCHORS } from "@caysonverse/shared/school/counselMap";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import { rooms } from "../rooms";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import { CHAT_NOT_NICE } from "../rooms/profanity";
import { publicContent, resolveText, secretStrings } from "./content";
import type { EngineState } from "./engine";
import { projectToSchema } from "./projection";
import { computeStars } from "./stars";
import { counsel } from "./rooms/counsel";
import { EscapeRoom, type ClassCallback, type EscapeCreateOptions, type EscapeResult } from "./EscapeRoom";

/**
 * EscapeRoom (escape phase 1, Task 10). ONE boot for the whole file, on its own port (ruling E1:
 * 2568 WorldRoom, 2569 ClassRoom, 2570 EscapeRoom, 2571 link test, 2572 PlayerRoom).
 *
 * The room is created the way ClassRoom will create it (matchMaker.createRoom with the spawn
 * token), members come in with tickets from `room.admit(...)`, and `report` (the remoteRoomCall to
 * the class) is spied — except in the test of `report` itself. Game time is moved with
 * `room.debugAdvance(ms)` (GameClock.skip + tick, tests only); a few checks use real time on purpose
 * (a pause must freeze the 1 s tick, the scheduled hold check must fire by itself).
 */
const PORT = 2570;
/** For the tests that wait in real time on purpose (a real 3 s hold, a paused 1 s tick, windows). */
const REAL_TIME_TEST_MS = 20_000;

const ERR = {
  spawn: "잘못된 접근이에요",
  create: "교실을 열 수 없어요: 교실을 여는 정보가 올바르지 않아요",
  ticket: "입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요.",
} as const;

const TEAM = { teamId: "team-1", teamName: "햇살(파랑)" } as const;
const BASE: Omit<EscapeCreateOptions, "spawnToken"> = {
  classRoomId: "test",
  ...TEAM,
  roomDefId: "counsel",
  textLevel: "easy",
  timeLimitS: ESCAPE_TIME_LIMIT_S,
  maxHintTier: 3,
};
/** A spot out of reach of every counsel object. */
const FAR = { x: 5.5, z: 4.5 } as const;
const LOCKED_HALF = (owner: string) => `글씨가 흐릿해요. 이 쪽지는 ${owner}님만 읽을 수 있어요.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Let personal/broadcast messages propagate to the in-process test clients. */
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

/** The error a refused join/create rejects with: its code and message. */
async function refusal(attempt: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await attempt;
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return { code: err.code, message: String(err.message) };
  }
  throw new Error("expected the attempt to be refused");
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
  // Dispose this test's rooms while their `report` spies still stand (a restored spy would send
  // their last reports to the made-up class id "test" and log the failure).
  await colyseus.cleanup();
  delete process.env.CV_RECONNECT_WINDOW_S;
  delete process.env.CV_ESCAPE_INTRO_MS;
  delete process.env.CV_ESCAPE_EMPTY_DISPOSE_MS;
  delete process.env.CV_ESCAPE_END_GRACE_MS;
  vi.restoreAllMocks();
});

type ReportFn = (method: ClassCallback, args: unknown[]) => Promise<void>;
type ReportSpy = MockInstance<ReportFn>;

/** What ClassRoom does (Task 11): create the team's instance with the spawn token. `report` is spied. */
async function openEscape(opts: Partial<EscapeCreateOptions> = {}): Promise<{ room: EscapeRoom; reports: ReportSpy }> {
  const room = await colyseus.createRoom<EscapeRoom>(ESCAPE_ROOM, { spawnToken: SPAWN_TOKEN, ...BASE, ...opts });
  const reports = vi.spyOn(room as unknown as { report: ReportFn }, "report").mockResolvedValue(undefined);
  return { room, reports };
}

/** The `args` of every report of one method, in order. */
function reported(reports: ReportSpy, method: ClassCallback): unknown[][] {
  return reports.mock.calls.filter(([m]) => m === method).map(([, args]) => args);
}

/** Everything one test client received from the room. */
interface Inbox {
  content: RoomContent[];
  views: InspectViewPayload[];
  events: EscapeEventPayload[];
  chats: ChatBroadcast[];
  rejected: ChatRejectedPayload[];
}

/** Join an escape room by id (what the client does with the ticket from its class). */
function connect(room: EscapeRoom, options: unknown) {
  return colyseus.connectTo(room, options);
}
type TestClient = Awaited<ReturnType<typeof connect>>;

/** Listen to the room's messages. Call right after the join/reconnect resolves (before any await). */
function listen(client: TestClient): Inbox {
  const inbox: Inbox = { content: [], views: [], events: [], chats: [], rejected: [] };
  client.onMessage(EscapeMsg.Content, (m: RoomContent) => inbox.content.push(m));
  client.onMessage(EscapeMsg.InspectView, (m: InspectViewPayload) => inbox.views.push(m));
  client.onMessage(EscapeMsg.Event, (m: EscapeEventPayload) => inbox.events.push(m));
  client.onMessage(EscapeMsg.Notice, () => {});
  client.onMessage(MessageType.Chat, (m: ChatBroadcast) => inbox.chats.push(m));
  client.onMessage(MessageType.ChatRejected, (m: ChatRejectedPayload) => inbox.rejected.push(m));
  return inbox;
}

interface Member {
  client: TestClient;
  sid: string;
  key: string;
  inbox: Inbox;
}

let ticketSeq = 0;
/** What ClassRoom does for one pad member: a one-time ticket bound to their memberKey. */
function admitTicket(room: EscapeRoom, key: string, extra: { role?: number; appearance?: Appearance } = {}): string {
  const ticket = `test-ticket-${++ticketSeq}-0123456789abcdef`;
  room.admit({
    ticket,
    memberKey: key,
    nickname: key,
    role: extra.role ?? ROLE_STUDENT,
    appearance: extra.appearance ?? { ...DEFAULT_APPEARANCE },
  });
  return ticket;
}

/** A member comes in with a fresh ticket (nickname = memberKey). */
async function enter(room: EscapeRoom, key: string): Promise<Member> {
  const client = await connect(room, { ticket: admitTicket(room, key) });
  const inbox = listen(client);
  await flush();
  return { client, sid: client.sessionId, key, inbox };
}

/** The same member after `colyseus.sdk.reconnect` (same session, new client object). */
async function reconnect(m: Member, token: string): Promise<Member> {
  const client = (await colyseus.sdk.reconnect(token)) as unknown as TestClient;
  const inbox = listen(client);
  await flush();
  return { client, sid: client.sessionId, key: m.key, inbox };
}

/** An abnormal close (tab closed / network): the server keeps a ghost for the reconnection window. */
async function drop(room: EscapeRoom, m: Member): Promise<string> {
  const token = m.client.reconnectionToken;
  m.client.reconnection.enabled = false;
  m.client.connection.close(4010, "test drop");
  expect(await pollFor(() => room.state.players.get(m.sid)?.connected === false)).toBe(true);
  return token;
}

/** Wait until the room has sent this round's after-patch messages (events go out after the state patch). */
async function afterPatch(room: EscapeRoom): Promise<void> {
  await room.waitForNextPatch();
  await sleep(40);
}

/** One client message, handled by the room, with its events delivered. */
async function act(room: EscapeRoom, m: Member, type: string, payload?: unknown): Promise<void> {
  const handled = room.waitForNextMessage();
  m.client.send(type, payload);
  await handled;
  await afterPatch(room);
}

/** White-box: the room's engine state. */
function engineOf(room: EscapeRoom): EngineState {
  return (room as unknown as { es: EngineState }).es;
}

/** White-box: set puzzle flags (a shortcut past earlier puzzles) and sync them like an action would. */
function setFlags(room: EscapeRoom, ...flags: string[]): void {
  const es = engineOf(room);
  for (const f of flags) es.flags.add(f);
  projectToSchema(es, room.state);
}

function anchor(id: string) {
  const a = COUNSEL_ANCHORS.find((x) => x.id === id);
  if (!a) throw new Error(`no anchor ${id}`);
  return a;
}

/** White-box: stand the member `dx` m east of an object (the server's position is what counts). */
function placeAt(room: EscapeRoom, m: Member, objectId: string, dx = 0): void {
  const a = anchor(objectId);
  const p = room.state.players.get(m.sid)!;
  p.x = a.x + dx;
  p.z = a.z;
}

function placeFar(room: EscapeRoom, m: Member): void {
  const p = room.state.players.get(m.sid)!;
  p.x = FAR.x;
  p.z = FAR.z;
}

/** Skip the intro (game time). */
function startPlay(room: EscapeRoom): void {
  room.debugAdvance(ESCAPE_INTRO_MS);
  expect(room.state.phase).toBe("play");
}

const eventsOf = <K extends EscapeEventPayload["e"]>(m: Member, e: K) =>
  m.inbox.events.filter((ev): ev is Extract<EscapeEventPayload, { e: K }> => ev.e === e);

/** The first three puzzles solved (shortcut), then two members turn the safe keys together: the last door. */
async function toFinale(room: EscapeRoom, a: Member, b: Member): Promise<void> {
  setFlags(room, "solved:cabinet_lock", "solved:cover_lock", "solved:board_lock", "safe_unlocked");
  placeAt(room, a, "safe_key_left");
  placeAt(room, b, "safe_key_right");
  await act(room, a, EscapeMsg.Press, { objectId: "safe_key_left" });
  await act(room, b, EscapeMsg.Press, { objectId: "safe_key_right" });
  expect(room.state.phase).toBe("finale");
}

/** Both members vote the right option of both steps. */
async function toEscape(room: EscapeRoom, a: Member, b: Member): Promise<void> {
  await toFinale(room, a, b);
  for (const optionId of ["privacy", "ask_first"]) {
    await act(room, a, EscapeMsg.Vote, { optionId });
    await act(room, b, EscapeMsg.Vote, { optionId });
  }
  expect(room.state.phase).toBe("escaped");
}

/** The client's decoded copy of the synced state. */
function seen(m: Member) {
  return m.client.state as unknown as {
    phase: string;
    flags: Iterable<string>;
    bag: Iterable<string>;
    lockInput: Map<string, string>;
    board: Map<string, string>;
    wrongAttempts: number;
    teamName: string;
    roomDefId: string;
    textLevel: string;
    solo: boolean;
  };
}

describe("EscapeRoom creation and admission", () => {
  it("refuses creation without the spawn token or with an unknown roomDefId", async () => {
    // No token / a guessed one, from server code or a client's matchmaking.
    expect((await refusal(matchMaker.createRoom(ESCAPE_ROOM, BASE))).message).toBe(ERR.spawn);
    expect((await refusal(matchMaker.createRoom(ESCAPE_ROOM, { ...BASE, spawnToken: "guess" }))).message).toBe(ERR.spawn);
    expect((await refusal(colyseus.sdk.create(ESCAPE_ROOM, { ticket: "x".repeat(24) }))).message).toBe(ERR.spawn);
    expect((await refusal(colyseus.sdk.joinOrCreate(ESCAPE_ROOM, {}))).message).toBe(ERR.spawn);

    // With the token: a room without puzzle data (a phase-2 door) or malformed options are refused
    // with one fixed message that never echoes the options (which carry the token).
    const bad: Record<string, unknown>[] = [
      { roomDefId: "library" },
      { roomDefId: "nope" },
      { textLevel: "medium" },
      { timeLimitS: 0 },
      { timeLimitS: 1.5 },
      { maxHintTier: 4 },
      { teamId: "" },
      { teamName: 7 },
      { classRoomId: undefined },
    ];
    for (const b of bad) {
      const r = await refusal(matchMaker.createRoom(ESCAPE_ROOM, { spawnToken: SPAWN_TOKEN, ...BASE, ...b }));
      expect(r.message, JSON.stringify(b)).toBe(ERR.create);
      expect(r.message).not.toContain(SPAWN_TOKEN);
    }
    expect(await matchMaker.query({ name: ESCAPE_ROOM })).toHaveLength(0);

    // A real one: the header (E14), the timer at the full limit, the intro, server-owned lifetime.
    const { room } = await openEscape({ textLevel: "hard", timeLimitS: 600 });
    expect(room.state.roomDefId).toBe("counsel");
    expect(room.state.teamName).toBe(TEAM.teamName);
    expect(room.state.textLevel).toBe("hard");
    expect(room.state.phase).toBe("intro");
    expect(room.state.timeLeftS).toBe(600);
    expect(room.state.lockInput.toJSON()).toEqual({ cabinet_lock: "0000", cover_lock: "0000" });
    expect(room.autoDispose).toBe(false);
    expect(room.maxClients).toBe(ESCAPE_MAX_CLIENTS);
    // Movement validates against the room's map, one stable object (no per-move allocation).
    const geometry = (room as unknown as { geometry(): unknown }).geometry();
    expect(geometry).toBe(ROOM_MAPS.counsel!.geometry);
    expect((room as unknown as { geometry(): unknown }).geometry()).toBe(geometry);
    // The listing carries nothing secret.
    expect(JSON.stringify(await matchMaker.query({ name: ESCAPE_ROOM }))).not.toContain(SPAWN_TOKEN);
  });

  it("a refused client create owns nothing: its onDispose reports nothing to any class", async () => {
    const report = vi
      .spyOn(EscapeRoom.prototype as unknown as { report: ReportFn }, "report")
      .mockResolvedValue(undefined);
    const original = EscapeRoom.prototype.onCreate;
    const orphans: EscapeRoom[] = [];
    vi.spyOn(EscapeRoom.prototype, "onCreate").mockImplementation(function (this: EscapeRoom, options) {
      orphans.push(this);
      return original.call(this, options);
    });
    // The orphan's options even name a class and a team: they must not reach anything.
    expect((await refusal(colyseus.sdk.create(ESCAPE_ROOM, { ...BASE, classRoomId: "victim" }))).message).toBe(ERR.spawn);
    expect(orphans).toHaveLength(1);
    await orphans[0].onDispose();
    expect(report).not.toHaveBeenCalled();
  });

  it("refuses a join without a valid ticket; a ticket works once; expires after TICKET_TTL_MS", async () => {
    const { room } = await openEscape();

    // No ticket, a made-up one.
    expect((await refusal(colyseus.connectTo(room, {}))).message).toBe(ERR.ticket);
    expect((await refusal(colyseus.connectTo(room, { ticket: "never-admitted-0123456789" }))).message).toBe(ERR.ticket);

    // A ticket works once. The player gets the admission's nickname, look and role, at the spawn.
    const look = {} as Appearance;
    for (const f of APPEARANCE_FIELDS) look[f] = APPEARANCE_RANGES[f] - 1;
    const ticket = admitTicket(room, "가람", { appearance: look, role: ROLE_TEACHER });
    const garam = await colyseus.connectTo(room, { ticket });
    const p = room.state.players.get(garam.sessionId)!;
    expect(p.nickname).toBe("가람");
    expect(pickAppearance(p)).toEqual(look);
    expect(p.role).toBe(ROLE_TEACHER);
    expect(p.connected).toBe(true);
    const map = ROOM_MAPS.counsel!;
    expect(Math.hypot(p.x - map.spawn.x, p.z - map.spawn.z)).toBeLessThanOrEqual(map.spawnJitter + 1e-6);
    expect((await refusal(colyseus.connectTo(room, { ticket }))).message).toBe(ERR.ticket);

    // TTL: a ticket issued TICKET_TTL_MS ago is dead; one issued 2 s short of that still works.
    const real = Date.now();
    const clock = vi.spyOn(room as unknown as { now(): number }, "now").mockReturnValue(real - TICKET_TTL_MS);
    const stale = admitTicket(room, "다온");
    clock.mockReturnValue(real - TICKET_TTL_MS + 2000);
    const fresh = admitTicket(room, "세온");
    clock.mockRestore();
    expect((await refusal(colyseus.connectTo(room, { ticket: stale }))).message).toBe(ERR.ticket);
    const seon = await colyseus.connectTo(room, { ticket: fresh });
    expect(room.state.players.get(seon.sessionId)?.nickname).toBe("세온");

    // A newer ticket for the same member revokes the older one (one live ticket per member).
    const first = admitTicket(room, "나래");
    const second = admitTicket(room, "나래");
    expect((await refusal(colyseus.connectTo(room, { ticket: first }))).message).toBe(ERR.ticket);
    await colyseus.connectTo(room, { ticket: second });

    // Malformed admissions are refused with a fixed message (nothing echoed).
    const valid = { ticket: "fine-ticket-0123456789abcd", memberKey: "하늘", nickname: "하늘", role: ROLE_STUDENT, appearance: DEFAULT_APPEARANCE };
    for (const broken of [
      { ...valid, ticket: "short" },
      { ...valid, memberKey: "" },
      { ...valid, role: 7 },
      { ...valid, appearance: { ...DEFAULT_APPEARANCE, hat: 999 } },
      null,
    ]) {
      expect(() => room.admit(broken as never)).toThrow();
      try {
        room.admit(broken as never);
      } catch (e) {
        expect(String((e as Error).message)).not.toContain("short");
      }
    }

    // Tickets live in server memory only: never in the synced state or the listing.
    await flush();
    const everywhere = JSON.stringify(room.state.toJSON()) + JSON.stringify(await matchMaker.query({ name: ESCAPE_ROOM }));
    for (const t of [ticket, stale, fresh, first, second]) expect(everywhere).not.toContain(t);
  });

  it("late admit of the same memberKey replaces the ghost and never reports a stale leave (Review Focus 1)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const { room, reports } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);

    // Progress the team made before the refresh: an item in the bag and an opened cabinet.
    placeAt(room, garam, "flashlight");
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    setFlags(room, "solved:cabinet_lock");
    expect([...room.state.bag]).toEqual(["flashlight"]);

    // The tab is closed: a ghost for the reconnection window; the remaining member is alone.
    const oldSid = garam.sid;
    const oldToken = await drop(room, garam);
    expect(room.state.solo).toBe(true);

    // The class hands out a new ticket for the same memberKey: the new tab takes the ghost's place.
    const fresh = await enter(room, "가람");
    expect(fresh.sid).not.toBe(oldSid);
    expect(room.state.players.has(oldSid)).toBe(false);
    expect([...room.state.players.keys()].sort()).toEqual([fresh.sid, daon.sid].sort());
    expect(room.state.solo).toBe(false);
    // It sees everything the team has: content, flags and bag.
    expect(fresh.inbox.content).toHaveLength(1);
    expect([...seen(fresh).bag]).toEqual(["flashlight"]);
    expect([...seen(fresh).flags]).toEqual(["picked:flashlight", "solved:cabinet_lock"]);

    // The old session cannot come back, and its late departure is not reported as a leave.
    await expect(colyseus.sdk.reconnect(oldToken)).rejects.toThrow();
    await flush();
    await flush();
    expect(room.state.players.has(fresh.sid)).toBe(true);
    expect(reported(reports, "escapeMemberLeft")).toEqual([]);
    expect(reported(reports, "escapeMemberEntered")).toEqual([
      [TEAM.teamId, "가람"],
      [TEAM.teamId, "다온"],
      [TEAM.teamId, "가람"],
    ]);

    // A real leave of the current session is reported, once.
    await fresh.client.leave(true);
    expect(await pollFor(() => reported(reports, "escapeMemberLeft").length === 1)).toBe(true);
    expect(reported(reports, "escapeMemberLeft")).toEqual([[TEAM.teamId, "가람"]]);
  });

  it("a new ticket for a member whose old connection is still open closes the old one (no ghost, no stale leave)", async () => {
    const { room, reports } = await openEscape();
    const old = await enter(room, "가람");
    const codes: number[] = [];
    old.client.reconnection.enabled = false;
    old.client.onLeave((code) => codes.push(code));

    const fresh = await enter(room, "가람");
    expect(await pollFor(() => codes.length === 1)).toBe(true);
    expect(codes).toEqual([4000]); // consented: the old tab gets no reconnection window
    expect([...room.state.players.keys()]).toEqual([fresh.sid]);
    expect(room.state.players.get(fresh.sid)?.connected).toBe(true);
    await flush();
    expect(reported(reports, "escapeMemberLeft")).toEqual([]);
    expect(room.state.solo).toBe(true);
  });

  it("a refreshed member keeps their slot: the split halves do not swap (stable slot order)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const { room } = await openEscape();
    const garam = await enter(room, "가람"); // slot 0 → half A
    const daon = await enter(room, "다온"); // slot 1 → half B
    startPlay(room);
    setFlags(room, "solved:cabinet_lock");

    async function views(a: Member, b: Member) {
      const out: Record<string, InspectViewPayload["split"]> = {};
      for (const [m, objectId] of [
        [a, "drawer_left"],
        [a, "drawer_right"],
        [b, "drawer_left"],
        [b, "drawer_right"],
      ] as const) {
        placeAt(room, m, objectId);
        const before = m.inbox.views.length;
        await act(room, m, EscapeMsg.Inspect, { objectId });
        expect(m.inbox.views.length).toBe(before + 1);
        out[`${m.key}/${objectId}`] = m.inbox.views[m.inbox.views.length - 1].split;
      }
      return out;
    }

    const before = await views(garam, daon);
    expect(before).toEqual({
      "가람/drawer_left": { text: "동 ○ 먼 ○" },
      "가람/drawer_right": { lockedText: LOCKED_HALF("다온") },
      "다온/drawer_left": { lockedText: LOCKED_HALF("가람") },
      "다온/drawer_right": { text: "○ 의 ○ 저" },
    });

    // 가람 refreshes: while the ghost waits, 다온 is alone and reads both halves (Review Focus 2)…
    await drop(room, garam);
    placeAt(room, daon, "drawer_left");
    await act(room, daon, EscapeMsg.Inspect, { objectId: "drawer_left" });
    expect(daon.inbox.views.at(-1)?.split).toEqual({ text: "동 ○ 먼 ○" });

    // …and the refreshed 가람 comes back into the ghost's slot, so nobody's half changes.
    const fresh = await enter(room, "가람");
    expect(await views(fresh, daon)).toEqual(before);
  });

  it("sends RoomContent on join; it contains none of secretStrings(counsel)", async () => {
    const { room } = await openEscape({ textLevel: "hard" });
    const garam = await enter(room, "가람");
    expect(await pollFor(() => garam.inbox.content.length === 1)).toBe(true);
    const content = garam.inbox.content[0];
    expect(content).toEqual(publicContent(counsel, "hard"));
    expect(content.introLines).toEqual(counsel.introLines);

    const secrets = secretStrings(counsel);
    expect(secrets.length).toBeGreaterThan(10);
    const sent = JSON.stringify(content);
    for (const s of secrets) expect(sent.includes(s), s).toBe(false);
    // Nor does the synced state (what every client decodes).
    const state = JSON.stringify(room.state.toJSON());
    for (const s of secrets) expect(state.includes(s), s).toBe(false);

    // The client's header (E14): which room, which team, which reading level.
    expect(seen(garam).roomDefId).toBe("counsel");
    expect(seen(garam).teamName).toBe(TEAM.teamName);
    expect(seen(garam).textLevel).toBe("hard");
  });
});

describe("EscapeRoom puzzles", () => {
  it("Inspect out of reach gets nothing; in reach gets InspectView; drawer halves differ by member; alone sees both", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");

    // During the intro every puzzle message is dropped, even in reach.
    placeAt(room, garam, "cabinet");
    await act(room, garam, EscapeMsg.Inspect, { objectId: "cabinet" });
    expect(garam.inbox.views).toEqual([]);
    startPlay(room);

    // Out of reach (2.3 m) → nothing; in reach (2.15 m) → the view, to the asker only.
    placeAt(room, garam, "cabinet", 2.3);
    await act(room, garam, EscapeMsg.Inspect, { objectId: "cabinet" });
    expect(garam.inbox.views).toEqual([]);
    placeAt(room, garam, "cabinet", 2.15);
    await act(room, garam, EscapeMsg.Inspect, { objectId: "cabinet" });
    expect(garam.inbox.views).toEqual([
      { objectId: "cabinet", title: "상담 기록 캐비닛", body: "숫자 네 개로 잠겨 있어요.", lockId: "cabinet_lock" },
    ]);
    expect(daon.inbox.views).toEqual([]);
    // Looking changes nothing.
    expect([...room.state.flags]).toEqual([]);
    // Garbage and unknown objects are dropped.
    await act(room, garam, EscapeMsg.Inspect, { objectId: 42 });
    await act(room, garam, EscapeMsg.Inspect, { objectId: "no_such_thing" });
    await act(room, garam, EscapeMsg.Inspect, null);
    expect(garam.inbox.views).toHaveLength(1);

    // Drawers: each member reads one half and is told who holds the other.
    setFlags(room, "solved:cabinet_lock");
    placeAt(room, garam, "drawer_left");
    placeAt(room, daon, "drawer_left");
    await act(room, garam, EscapeMsg.Inspect, { objectId: "drawer_left" });
    await act(room, daon, EscapeMsg.Inspect, { objectId: "drawer_left" });
    expect(garam.inbox.views.at(-1)?.split).toEqual({ text: "동 ○ 먼 ○" });
    expect(daon.inbox.views.at(-1)?.split).toEqual({ lockedText: LOCKED_HALF("가람") });

    // Alone (the other one left for good), one member reads both halves.
    await daon.client.leave(true);
    expect(await pollFor(() => room.state.solo)).toBe(true);
    placeAt(room, garam, "drawer_right");
    await act(room, garam, EscapeMsg.Inspect, { objectId: "drawer_right" });
    expect(garam.inbox.views.at(-1)?.split).toEqual({ text: "○ 의 ○ 저" });
  });

  it("pickup → combine updates bag for every member", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);

    // Out of reach → dropped.
    placeFar(room, garam);
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    expect([...room.state.bag]).toEqual([]);

    placeAt(room, garam, "flashlight");
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    placeAt(room, daon, "note_box");
    await act(room, daon, EscapeMsg.Pickup, { objectId: "note_box" });
    expect([...room.state.bag]).toEqual(["flashlight", "uv_film"]);
    expect([...seen(garam).bag]).toEqual(["flashlight", "uv_film"]);
    expect([...seen(daon).bag]).toEqual(["flashlight", "uv_film"]);
    for (const m of [garam, daon]) {
      expect(eventsOf(m, "picked")).toEqual([
        { e: "picked", item: "flashlight", by: garam.sid },
        { e: "picked", item: "uv_film", by: daon.sid },
      ]);
    }

    // Combining is a bag action (no object, no distance).
    placeFar(room, garam);
    await act(room, garam, EscapeMsg.Combine, { a: "flashlight" }); // malformed → dropped
    expect([...room.state.bag]).toEqual(["flashlight", "uv_film"]);
    await act(room, garam, EscapeMsg.Combine, { a: "flashlight", b: "uv_film" });
    expect([...room.state.bag]).toEqual(["uv_flashlight"]);
    expect([...seen(daon).bag]).toEqual(["uv_flashlight"]);
    expect([...seen(daon).flags]).toEqual(["picked:flashlight", "picked:uv_film", "made:uv_flashlight"]);
    expect(daon.inbox.events.slice(-2)).toEqual([
      { e: "combined", out: "uv_flashlight", by: garam.sid },
      { e: "say", lineId: "bandit_uv" },
    ]);
  });

  it("lock input is shared; a wrong submit increments wrongAttempts; solved flags sync", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);

    placeAt(room, garam, "cabinet");
    await act(room, garam, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "1234" });
    expect(seen(daon).lockInput.get("cabinet_lock")).toBe("1234");
    // Not a valid input (a letter, wrong length) or out of reach → unchanged.
    await act(room, garam, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "12a4" });
    await act(room, garam, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: 1234 });
    placeFar(room, daon);
    await act(room, daon, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "9999" });
    await act(room, daon, EscapeMsg.LockSubmit, { lockId: "cabinet_lock" });
    expect(room.state.lockInput.get("cabinet_lock")).toBe("1234");
    expect(room.state.wrongAttempts).toBe(0);

    // A wrong submit counts once, for everybody.
    await act(room, garam, EscapeMsg.LockSubmit, { lockId: "cabinet_lock" });
    expect(room.state.wrongAttempts).toBe(1);
    expect(seen(daon).wrongAttempts).toBe(1);
    expect(eventsOf(daon, "wrong")).toEqual([{ e: "wrong", lockId: "cabinet_lock" }]);

    // The other member types the answer into the same lock; the first one opens it.
    placeAt(room, daon, "cabinet", -1);
    await act(room, daon, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "4719" });
    expect(seen(garam).lockInput.get("cabinet_lock")).toBe("4719");
    room.debugAdvance(LOCK_SUBMIT_GAP_MS);
    await act(room, garam, EscapeMsg.LockSubmit, { lockId: "cabinet_lock" });
    expect([...room.state.flags]).toContain("solved:cabinet_lock");
    expect([...seen(daon).flags]).toContain("solved:cabinet_lock");
    expect(daon.inbox.events.slice(-2)).toEqual([
      { e: "solved", lockId: "cabinet_lock", by: garam.sid },
      { e: "say", lineId: "cabinet_open" },
    ]);
    expect(room.state.wrongAttempts).toBe(1);

    // The sort board's cards are shared the same way (map by card id).
    setFlags(room, "solved:cover_lock");
    engineOf(room).bag.push("sort_cards");
    placeAt(room, garam, "sort_board");
    await act(room, garam, EscapeMsg.BoardPlace, { lockId: "board_lock", cardId: "festival", bin: "ok" });
    await act(room, garam, EscapeMsg.BoardPlace, { lockId: "board_lock", cardId: "password", bin: "stop" });
    expect(seen(daon).board.get("festival")).toBe("ok");
    expect(seen(daon).board.get("password")).toBe("stop");
    await act(room, garam, EscapeMsg.BoardPlace, { lockId: "board_lock", cardId: "festival", bin: "" });
    expect(room.state.board.toJSON()).toEqual({ password: "stop" });
  });

  it("presses 1 s apart open the safe; 2.5 s apart do not; alone, a 3 s hold opens it", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);
    setFlags(room, "safe_unlocked");
    placeAt(room, garam, "safe_key_left");
    placeAt(room, daon, "safe_key_right");

    // 2.5 s apart: the first press has gone stale.
    await act(room, garam, EscapeMsg.Press, { objectId: "safe_key_left" });
    room.debugAdvance(2500);
    await act(room, daon, EscapeMsg.Press, { objectId: "safe_key_right" });
    expect([...room.state.flags]).not.toContain("safe_open");
    expect(eventsOf(garam, "coop")).toEqual([
      { e: "coop", objectId: "safe_key_left", by: garam.sid },
      { e: "coop", objectId: "safe_key_right", by: daon.sid },
    ]);

    // A switch press out of reach does nothing.
    placeFar(room, garam);
    await act(room, garam, EscapeMsg.Press, { objectId: "safe_key_left" });
    expect(eventsOf(garam, "coop")).toHaveLength(2);

    // 1 s apart: open → the chip, the last door.
    placeAt(room, garam, "safe_key_left");
    room.debugAdvance(1000);
    await act(room, garam, EscapeMsg.Press, { objectId: "safe_key_left" });
    expect([...room.state.flags]).toEqual(expect.arrayContaining(["safe_open", "finale_ready"]));
    expect([...seen(daon).bag]).toContain("memory_chip");
    expect(room.state.phase).toBe("finale");
    expect(eventsOf(daon, "coopDone")).toEqual([{ e: "coopDone", coopId: "safe_keys" }]);
    expect(eventsOf(daon, "finale")).toEqual([{ e: "finale", step: 0 }]);

    // Alone: a hold of 3 s. Released early → cancelled; held → the room's own check opens it.
    process.env.CV_ESCAPE_INTRO_MS = "1";
    const solo = await openEscape();
    const seon = await enter(solo.room, "세온");
    await pollFor(() => solo.room.state.phase === "play", 3000);
    expect(solo.room.state.phase).toBe("play");
    setFlags(solo.room, "safe_unlocked");
    placeAt(solo.room, seon, "safe_key_right");
    await act(solo.room, seon, EscapeMsg.Press, { objectId: "safe_key_right" }); // alone: a press does nothing
    expect(eventsOf(seon, "coop")).toEqual([]);
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_right" });
    solo.room.debugAdvance(2000);
    await act(solo.room, seon, EscapeMsg.HoldEnd, { objectId: "safe_key_right" });
    expect(eventsOf(seon, "hold")).toEqual([
      { e: "hold", objectId: "safe_key_right", by: seon.sid, on: true },
      { e: "hold", objectId: "safe_key_right", by: seon.sid, on: false },
    ]);
    expect([...solo.room.state.flags]).not.toContain("safe_open");

    // Walking away mid-hold cancels it (an accepted move out of reach), and a release sent from far
    // away is not dropped by the distance check: either way the hold cannot finish.
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_right" });
    const p = solo.room.state.players.get(seon.sid)!;
    p.x = 0;
    p.z = 2.8;
    await act(solo.room, seon, MessageType.Move, { x: 0.05, z: 2.8, yaw: 0 });
    expect(eventsOf(seon, "hold").at(-1)).toEqual({ e: "hold", objectId: "safe_key_right", by: seon.sid, on: false });
    placeAt(solo.room, seon, "safe_key_right");
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_right" });
    placeFar(solo.room, seon);
    await act(solo.room, seon, EscapeMsg.HoldEnd, { objectId: "safe_key_right" });
    expect(eventsOf(seon, "hold").at(-1)).toEqual({ e: "hold", objectId: "safe_key_right", by: seon.sid, on: false });
    solo.room.debugAdvance(5000);
    expect([...solo.room.state.flags]).not.toContain("safe_open");

    // Held for real: nobody advances game time, the room's scheduled check finishes it at 3 s.
    placeAt(solo.room, seon, "safe_key_right");
    const startedAt = Date.now();
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_right" });
    expect(await pollFor(() => solo.room.state.flags.includes("safe_open"), 5000)).toBe(true);
    const took = Date.now() - startedAt;
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(4500);
    expect(await pollFor(() => eventsOf(seon, "coopDone").length === 1)).toBe(true);
  }, REAL_TIME_TEST_MS);
});

describe("EscapeRoom time, pause and the last door", () => {
  it("intro → play; timer counts down; timeup drops actions; Retry adds 300 s and sets overtime", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    expect(room.state.phase).toBe("intro");
    expect(room.state.timeLeftS).toBe(ESCAPE_TIME_LIMIT_S);

    // The intro lasts ESCAPE_INTRO_MS of game time; the clock starts after it.
    room.debugAdvance(ESCAPE_INTRO_MS - 1000);
    expect(room.state.phase).toBe("intro");
    expect(room.state.timeLeftS).toBe(ESCAPE_TIME_LIMIT_S);
    room.debugAdvance(1000);
    expect(room.state.phase).toBe("play");
    room.debugAdvance(10_000);
    expect(room.state.timeLeftS).toBe(ESCAPE_TIME_LIMIT_S - 10);

    // Retry before the time is up does nothing.
    await act(room, garam, EscapeMsg.Retry, {});
    expect(room.state.overtime).toBe(false);

    // A hold in progress when the time runs out is cancelled, and every member hears it.
    setFlags(room, "safe_unlocked");
    placeAt(room, garam, "safe_key_left");
    await act(room, garam, EscapeMsg.HoldStart, { objectId: "safe_key_left" });
    room.debugAdvance((ESCAPE_TIME_LIMIT_S - 10) * 1000);
    expect(room.state.timeLeftS).toBe(0);
    expect(room.state.phase).toBe("timeup");
    await afterPatch(room);
    expect(eventsOf(garam, "hold").at(-1)).toEqual({ e: "hold", objectId: "safe_key_left", by: garam.sid, on: false });
    expect(engineOf(room).hold).toBeNull();

    // Time up: puzzle actions are dropped, and game time stands still while the team decides.
    placeAt(room, garam, "flashlight");
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    expect([...room.state.bag]).toEqual([]);
    await sleep(1300); // at least one real 1 s tick
    expect(room.state.phase).toBe("timeup");

    // Retry: exactly ESCAPE_RETRY_EXTRA_S more, overtime, and play goes on.
    await act(room, garam, EscapeMsg.Retry, {});
    expect(room.state.overtime).toBe(true);
    expect(room.state.phase).toBe("play");
    expect(room.state.timeLeftS).toBe(ESCAPE_RETRY_EXTRA_S);
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    expect([...room.state.bag]).toEqual(["flashlight"]);
    room.debugAdvance(60_000);
    expect(room.state.timeLeftS).toBe(ESCAPE_RETRY_EXTRA_S - 60);
  }, REAL_TIME_TEST_MS);

  it("pause freezes timeLeftS and the finale cooldown; actions are dropped while paused (Review Focus 4)", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);
    await toFinale(room, garam, daon);
    await act(room, garam, EscapeMsg.Vote, { optionId: "transparency" });
    await act(room, daon, EscapeMsg.Vote, { optionId: "transparency" });
    expect(room.state.cooldownS).toBe(FINALE_COOLDOWN_MS / 1000);
    room.debugAdvance(5000);
    expect(room.state.cooldownS).toBe(25);
    const left = room.state.timeLeftS;

    room.classCommand("pause");
    expect(room.state.paused).toBe(true);
    await sleep(1300); // real ticks pass; game time does not
    expect(room.state.timeLeftS).toBe(left);
    expect(room.state.cooldownS).toBe(25);

    // Every puzzle action is dropped while paused (the cooldown alone would not stop a hint).
    await act(room, garam, EscapeMsg.HintRequest, {});
    placeAt(room, garam, "cabinet");
    await act(room, garam, EscapeMsg.Inspect, { objectId: "cabinet" });
    expect(room.state.hintsUsed).toBe(0);
    expect(garam.inbox.views).toEqual([]);
    room.classCommand("pause"); // a second pause changes nothing
    expect(room.state.paused).toBe(true);

    room.classCommand("resume");
    expect(room.state.paused).toBe(false);
    room.debugAdvance(25_000);
    expect(room.state.cooldownS).toBe(0);
    await act(room, garam, EscapeMsg.Vote, { optionId: "privacy" });
    await act(room, daon, EscapeMsg.Vote, { optionId: "privacy" });
    expect(room.state.finaleStep).toBe(1);
    await act(room, garam, EscapeMsg.HintRequest, {});
    expect(room.state.hintsUsed).toBe(1);
    expect([...room.state.hints]).toEqual([counsel.stages.find((s) => s.id === "finale")!.hints[0]]);

    // A lone member's hold is cancelled by the pause (and cannot finish after the resume).
    const solo = await openEscape();
    const seon = await enter(solo.room, "세온");
    startPlay(solo.room);
    setFlags(solo.room, "safe_unlocked");
    placeAt(solo.room, seon, "safe_key_left");
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_left" });
    solo.room.classCommand("pause");
    await afterPatch(solo.room);
    expect(eventsOf(seon, "hold")).toEqual([
      { e: "hold", objectId: "safe_key_left", by: seon.sid, on: true },
      { e: "hold", objectId: "safe_key_left", by: seon.sid, on: false },
    ]);
    solo.room.classCommand("resume");
    solo.room.debugAdvance(5000);
    expect([...solo.room.state.flags]).not.toContain("safe_open");
    // A new hold after the resume runs on game time again (3 s of it, skipped here).
    await act(solo.room, seon, EscapeMsg.HoldStart, { objectId: "safe_key_left" });
    solo.room.debugAdvance(2500); // (+ the real time `act` took, well under 0.5 s)
    expect([...solo.room.state.flags]).not.toContain("safe_open");
    solo.room.debugAdvance(500);
    expect([...solo.room.state.flags]).toContain("safe_open");
  }, REAL_TIME_TEST_MS);

  it("finale: unanimous wrong → finaleWrong + cooldownS 30; right path → escaped event with stars; escapeResult reported", async () => {
    const { room, reports } = await openEscape({ textLevel: "hard" });
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);
    await toFinale(room, garam, daon);

    // One vote is not a decision.
    await act(room, garam, EscapeMsg.Vote, { optionId: "transparency" });
    expect(eventsOf(daon, "votes")).toHaveLength(1);
    expect(room.state.votes.toJSON()).toEqual({ [garam.sid]: "transparency" });
    // Unanimous and wrong: the explanation, a 30 s cool-down, a wrong attempt.
    await act(room, daon, EscapeMsg.Vote, { optionId: "transparency" });
    const step0 = counsel.finale.steps[0];
    expect(eventsOf(garam, "finaleWrong")).toEqual([
      {
        e: "finaleWrong",
        stepId: step0.id,
        optionId: "transparency",
        explain: step0.options.find((o) => o.id === "transparency")!.explain,
      },
    ]);
    expect(room.state.cooldownS).toBe(30);
    expect(room.state.wrongAttempts).toBe(1);
    expect(room.state.votes.size).toBe(0);
    // Votes during the cool-down are ignored.
    await act(room, garam, EscapeMsg.Vote, { optionId: "privacy" });
    expect(room.state.votes.size).toBe(0);

    room.debugAdvance(FINALE_COOLDOWN_MS);
    expect(room.state.cooldownS).toBe(0);
    for (const optionId of ["privacy", "ask_first"]) {
      await act(room, garam, EscapeMsg.Vote, { optionId });
      await act(room, daon, EscapeMsg.Vote, { optionId });
    }
    expect(room.state.phase).toBe("escaped");
    expect([...room.state.flags]).toContain("escaped");

    // The escaped event: the escape lines and summary at the team's level, the stars, the time.
    const escaped = eventsOf(daon, "escaped");
    expect(escaped).toHaveLength(1);
    const ev = escaped[0] as EscapedEvent;
    expect(ev.lines).toEqual(
      counsel.escapeLines.map((id) => ({ speaker: counsel.lines[id].speaker, text: resolveText(counsel.lines[id].text, "hard") })),
    );
    expect(ev.summary).toEqual({
      lines: counsel.summary.lines.map((t) => resolveText(t, "hard")),
      question: resolveText(counsel.summary.question, "hard"),
      source: counsel.summary.source,
    });
    expect(ev.elapsedS).toBeGreaterThanOrEqual(FINALE_COOLDOWN_MS / 1000);
    expect(ev.elapsedS).toBeLessThan(FINALE_COOLDOWN_MS / 1000 + 20);
    const remainingS = ESCAPE_TIME_LIMIT_S - ev.elapsedS;
    expect(ev.stars).toBe(computeStars({ escaped: true, overtime: false, remainingS, hintsUsed: 0, wrongAttempts: 1 }));
    expect(ev.stars).toBe(3);
    expect(eventsOf(garam, "escaped")).toEqual(escaped);
    // Time stops at the escape.
    room.debugAdvance(60_000);
    expect(room.state.timeLeftS).toBe(remainingS);

    // The result goes to the class exactly once.
    const result: EscapeResult = {
      ...TEAM,
      roomId: "counsel",
      members: ["가람", "다온"],
      escaped: true,
      overtime: false,
      elapsedS: ev.elapsedS,
      remainingS,
      hintsUsed: 0,
      wrongAttempts: 1,
      stars: 3,
      firstTry: { privacy: false },
    };
    expect(reported(reports, "escapeResult")).toEqual([[result]]);

    // After the escape, puzzle actions are dropped.
    await act(room, garam, EscapeMsg.HintRequest, {});
    expect(room.state.hintsUsed).toBe(0);
  });

  it("team chat reaches only this room and is reported to the class; profanity is blocked and reported filtered", async () => {
    const { room, reports } = await openEscape();
    const other = await openEscape({ teamId: "team-2", teamName: "풍선(빨강)" });
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    const seon = await enter(other.room, "세온");

    const before = Date.now();
    await act(room, garam, MessageType.Chat, { text: "서랍 먼저 열어 보자" });
    await flush();
    expect(daon.inbox.chats).toEqual([{ sid: garam.sid, name: "가람", text: "서랍 먼저 열어 보자" }]);
    expect(seon.inbox.chats).toEqual([]);
    const mirrors = reported(reports, "escapeChat") as [TeamChatMirrorPayload][];
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0][0]).toMatchObject({ ...TEAM, name: "가람", text: "서랍 먼저 열어 보자", filtered: false });
    expect(mirrors[0][0].at).toBeGreaterThanOrEqual(before);
    expect(reported(other.reports, "escapeChat")).toEqual([]);

    // A bad word: only the sender is told, nobody hears it, the teacher sees the masked line.
    await act(room, garam, MessageType.Chat, { text: "너 진짜 시발 왜 그래" });
    await flush();
    expect(garam.inbox.rejected).toEqual([{ reason: CHAT_NOT_NICE }]);
    expect(daon.inbox.chats).toHaveLength(1);
    const blocked = (reported(reports, "escapeChat") as [TeamChatMirrorPayload][])[1][0];
    expect(blocked).toMatchObject({ ...TEAM, name: "가람", text: "너 진짜 ●● 왜 그래", filtered: true });
    expect(JSON.stringify(reports.mock.calls)).not.toContain("시발");
  });

  it("an empty room disposes after ESCAPE_EMPTY_DISPOSE_MS and reports escapeDisposed", async () => {
    process.env.CV_ESCAPE_EMPTY_DISPOSE_MS = "300";

    // Opened, and nobody ever came: gone, with no result (there was no play).
    const never = await openEscape();
    expect(await pollFor(() => matchMaker.getLocalRoomById(never.room.roomId) === undefined)).toBe(true);
    expect(reported(never.reports, "escapeDisposed")).toEqual([[TEAM.teamId, never.room.roomId]]);
    expect(reported(never.reports, "escapeResult")).toEqual([]);

    // A team played a bit and left: a join inside the wait cancels it, the last leave starts it again.
    const { room, reports } = await openEscape();
    const garam = await enter(room, "가람");
    startPlay(room);
    placeAt(room, garam, "flashlight");
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });
    await garam.client.leave(true);
    await sleep(150);
    const daon = await enter(room, "다온");
    await sleep(450);
    expect(matchMaker.getLocalRoomById(room.roomId)).toBe(room);
    await daon.client.leave(true);
    expect(await pollFor(() => matchMaker.getLocalRoomById(room.roomId) === undefined)).toBe(true);
    await pollFor(() => reported(reports, "escapeDisposed").length === 1);

    const methods = reports.mock.calls.map(([m]) => m);
    expect(methods.filter((m) => m === "escapeResult" || m === "escapeDisposed")).toEqual(["escapeResult", "escapeDisposed"]);
    const [result] = reported(reports, "escapeResult")[0] as [EscapeResult];
    expect(result).toMatchObject({ ...TEAM, roomId: "counsel", members: ["가람", "다온"], escaped: false, stars: 0 });
    expect(reported(reports, "escapeDisposed")).toEqual([[TEAM.teamId, room.roomId]]);
  }, REAL_TIME_TEST_MS);
});

describe("EscapeRoom membership, rate and class controls", () => {
  it("membership follows every join, drop, reconnect and leave (E13, Review Focus 2)", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const { room, reports } = await openEscape();
    const garam = await enter(room, "가람");
    expect(room.state.solo).toBe(true);
    let daon = await enter(room, "다온");
    expect(room.state.solo).toBe(false);
    expect(await pollFor(() => seen(garam).solo === false)).toBe(true); // the client follows on the next patch
    startPlay(room);

    // A. Drop → alone: a long press starts; the teammate reconnects → the hold is cancelled.
    setFlags(room, "safe_unlocked");
    let token = await drop(room, daon);
    expect(room.state.solo).toBe(true);
    placeAt(room, garam, "safe_key_left");
    await act(room, garam, EscapeMsg.HoldStart, { objectId: "safe_key_left" });
    expect(eventsOf(garam, "hold")).toHaveLength(1);
    daon = await reconnect(daon, token);
    expect(room.state.solo).toBe(false);
    expect(await pollFor(() => eventsOf(garam, "hold").length === 2)).toBe(true);
    expect(eventsOf(garam, "hold")[1]).toEqual({ e: "hold", objectId: "safe_key_left", by: garam.sid, on: false });
    expect(engineOf(room).hold).toBeNull();
    // The reconnected session got the room content again.
    expect(daon.inbox.content).toHaveLength(1);

    // B. Last door: a member who drops without voting no longer blocks the remaining vote.
    await toFinale(room, garam, daon);
    await act(room, garam, EscapeMsg.Vote, { optionId: "privacy" });
    expect(room.state.finaleStep).toBe(0);
    token = await drop(room, daon);
    expect(await pollFor(() => room.state.finaleStep === 1)).toBe(true);
    expect(room.state.solo).toBe(true);
    daon = await reconnect(daon, token);
    expect(room.state.solo).toBe(false);

    // C. While the class is paused, a drop (and the expired window that follows) decides nothing;
    //    the resume does.
    await act(room, garam, EscapeMsg.Vote, { optionId: "ask_first" });
    room.classCommand("pause");
    process.env.CV_RECONNECT_WINDOW_S = "0.3";
    await drop(room, daon);
    expect(room.state.solo).toBe(true);
    expect(await pollFor(() => !room.state.players.has(daon.sid))).toBe(true); // window expired → left
    await sleep(1200);
    expect(room.state.phase).toBe("finale");
    expect(room.state.finaleStep).toBe(1);
    expect(eventsOf(garam, "escaped")).toEqual([]);
    room.classCommand("resume");
    expect(await pollFor(() => room.state.phase === "escaped")).toBe(true);
    expect(await pollFor(() => eventsOf(garam, "escaped").length === 1)).toBe(true);

    // Only the permanent leave was reported — none of the drops and reconnects.
    expect(reported(reports, "escapeMemberLeft")).toEqual([[TEAM.teamId, "다온"]]);
    expect(reported(reports, "escapeMemberEntered")).toEqual([
      [TEAM.teamId, "가람"],
      [TEAM.teamId, "다온"],
    ]);
  }, REAL_TIME_TEST_MS);

  it("a member who reconnects or rejoins after the escape gets the escape lines again", async () => {
    process.env.CV_RECONNECT_WINDOW_S = "5";
    const { room, reports } = await openEscape({ textLevel: "hard" });
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);
    await toEscape(room, garam, daon);
    expect(await pollFor(() => eventsOf(garam, "escaped").length === 1)).toBe(true);
    const escaped = eventsOf(garam, "escaped")[0];
    expect(escaped.lines.length).toBe(counsel.escapeLines.length);

    // Same session, reconnected.
    const token = await drop(room, daon);
    const back = await reconnect(daon, token);
    expect(await pollFor(() => eventsOf(back, "escaped").length === 1)).toBe(true);
    expect(eventsOf(back, "escaped")[0]).toEqual(escaped);

    // A refreshed tab (new session, new ticket).
    await drop(room, garam);
    const fresh = await enter(room, "가람");
    expect(await pollFor(() => eventsOf(fresh, "escaped").length === 1)).toBe(true);
    expect(eventsOf(fresh, "escaped")[0]).toEqual(escaped);
    expect(fresh.inbox.content).toEqual([publicContent(counsel, "hard")]);

    expect(reported(reports, "escapeResult")).toHaveLength(1);
  });

  it("puzzle actions beyond ESCAPE_ACTION_RATE per second are dropped, per client", async () => {
    const { room } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    startPlay(room);
    placeAt(room, garam, "cabinet");
    placeAt(room, daon, "cabinet");

    const burst = ESCAPE_ACTION_RATE.count + 3;
    for (let i = 1; i <= burst; i++) {
      garam.client.send(EscapeMsg.LockInput, { lockId: "cabinet_lock", value: String(i).padStart(4, "0") });
    }
    await sleep(300);
    expect(room.state.lockInput.get("cabinet_lock")).toBe(String(ESCAPE_ACTION_RATE.count).padStart(4, "0"));
    // Another member is not affected by garam's flood.
    await act(room, daon, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "4444" });
    expect(room.state.lockInput.get("cabinet_lock")).toBe("4444");
    // After the window, garam may act again.
    await sleep(ESCAPE_ACTION_RATE.windowMs);
    await act(room, garam, EscapeMsg.LockInput, { lockId: "cabinet_lock", value: "5555" });
    expect(room.state.lockInput.get("cabinet_lock")).toBe("5555");
  }, REAL_TIME_TEST_MS);

  it("kickMember removes a member for good; end reports the unfinished result and closes with CLASS_CLOSED_CODE", async () => {
    process.env.CV_ESCAPE_END_GRACE_MS = "300";
    const { room, reports } = await openEscape();
    const garam = await enter(room, "가람");
    const daon = await enter(room, "다온");
    const seon = await enter(room, "세온");
    startPlay(room);
    placeAt(room, garam, "flashlight");
    await act(room, garam, EscapeMsg.Pickup, { objectId: "flashlight" });

    // Kick: closed with the kick code, out of the state, reported as a leave; a ticket the member
    // still held is void.
    const pending = admitTicket(room, "세온");
    const codes: Record<string, number[]> = { 가람: [], 다온: [], 세온: [] };
    for (const m of [garam, daon, seon]) {
      m.client.reconnection.enabled = false;
      m.client.onLeave((code) => codes[m.key].push(code));
    }
    room.kickMember("세온");
    expect(await pollFor(() => codes["세온"].length === 1)).toBe(true);
    expect(codes["세온"]).toEqual([KICK_CLOSE_CODE]);
    expect(await pollFor(() => !room.state.players.has(seon.sid))).toBe(true);
    expect(reported(reports, "escapeMemberLeft")).toEqual([[TEAM.teamId, "세온"]]);
    expect((await refusal(colyseus.connectTo(room, { ticket: pending }))).message).toBe(ERR.ticket);
    room.kickMember("nobody"); // unknown → nothing

    // Unknown commands are ignored.
    room.classCommand("explode" as never);
    expect(room.state.phase).toBe("play");

    // End: the result of the unfinished room goes to the class first, then the room closes.
    room.classCommand("end");
    expect(room.state.phase).toBe("ended");
    expect(room.locked).toBe(true);
    const [result] = reported(reports, "escapeResult")[0] as [EscapeResult];
    expect(result).toMatchObject({
      ...TEAM,
      roomId: "counsel",
      members: ["가람", "다온"],
      escaped: false,
      overtime: false,
      hintsUsed: 0,
      wrongAttempts: 0,
      stars: 0,
      firstTry: {},
    });
    // Ended: puzzle actions are dropped, a second end changes nothing.
    await act(room, garam, EscapeMsg.HintRequest, {});
    expect(room.state.hintsUsed).toBe(0);
    room.classCommand("end");
    room.classCommand("resume");
    expect(room.state.phase).toBe("ended");
    expect(reported(reports, "escapeResult")).toHaveLength(1);
    // A late admit is refused.
    expect(() => admitTicket(room, "하늘")).toThrow();

    expect(await pollFor(() => codes["가람"].length === 1 && codes["다온"].length === 1, 3000)).toBe(true);
    expect([...codes["가람"], ...codes["다온"]]).toEqual([CLASS_CLOSED_CODE, CLASS_CLOSED_CODE]);
    expect(await pollFor(() => matchMaker.getLocalRoomById(room.roomId) === undefined)).toBe(true);
    expect(await pollFor(() => reported(reports, "escapeDisposed").length === 1)).toBe(true);
  }, REAL_TIME_TEST_MS);

  it("report calls the class room by remoteRoomCall; a failure logs one fixed line without the arguments", async () => {
    // A stand-in class room: any local room with the callback methods on it.
    const { room: classRoom } = await openEscape({ teamId: "class-stand-in" });
    const entered = vi.fn();
    (classRoom as unknown as Record<string, unknown>).escapeMemberEntered = entered;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    // The real report (not spied) of an instance created for that class.
    const room = await colyseus.createRoom<EscapeRoom>(ESCAPE_ROOM, {
      spawnToken: SPAWN_TOKEN,
      ...BASE,
      classRoomId: classRoom.roomId,
    });
    const garam = await enter(room, "가람");
    expect(await pollFor(() => entered.mock.calls.length === 1)).toBe(true);
    expect(entered).toHaveBeenCalledWith(TEAM.teamId, "가람");

    // The stand-in has no escapeChat: the call fails and only a fixed line is logged.
    await act(room, garam, MessageType.Chat, { text: "비밀 쪽지는 4719" });
    expect(await pollFor(() => errors.mock.calls.length >= 1)).toBe(true);
    expect(errors.mock.calls[0]).toEqual(["[caysonverse] escape room report to the class failed: escapeChat"]);

    // Same for the leave and the disposal when the room closes (the stand-in class is still there).
    const roomId = room.roomId;
    await room.disconnect();
    const line = (method: ClassCallback) => [`[caysonverse] escape room report to the class failed: ${method}`];
    expect(await pollFor(() => errors.mock.calls.length >= 3)).toBe(true);
    expect(errors.mock.calls).toEqual([line("escapeChat"), line("escapeMemberLeft"), line("escapeDisposed")]);
    const logged = JSON.stringify(errors.mock.calls);
    for (const leak of ["4719", "가람", TEAM.teamId, roomId]) expect(logged).not.toContain(leak);
  });
});

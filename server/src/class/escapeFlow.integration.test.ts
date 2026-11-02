import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { KICK_CLOSE_CODE } from "@caysonverse/shared/constants";
import { MessageType, type ChatBroadcast, type SystemBroadcast } from "@caysonverse/shared/messages";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import {
  CLASS_CLOSED_CODE,
  CLASS_ROOM,
  ESCAPE_INTRO_MS,
  ESCAPE_ROOM,
  PLACE_ESCAPE,
  PLACE_HUB,
} from "@caysonverse/shared/escape/constants";
import {
  ClassMsg,
  EscapeMsg,
  type EscapeEventPayload,
  type EscapeTicketPayload,
  type NoticePayload,
  type ResultsCsvPayload,
  type TeamChatMirrorPayload,
} from "@caysonverse/shared/escape/messages";
import { HUB_DOORS, TEAM_ZONE, doorAtPad } from "@caysonverse/shared/school/hubMap";
import { COUNSEL_ANCHORS } from "@caysonverse/shared/school/counselMap";
import type { Team } from "@caysonverse/shared/schema";
import { rooms } from "../rooms";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import type { Tracking } from "../rooms/PlayerRoom";
import { projectToSchema } from "../escape/projection";
import type { EngineState } from "../escape/engine";
import type { EscapeResult, EscapeRoom } from "../escape/EscapeRoom";
import { counsel } from "../escape/rooms/counsel";
import { ClassRoom } from "./ClassRoom";
import { classRegistry, type ClassCreateOptions } from "./classRegistry";
import type { VerifiedKey } from "./teacherKeys";

/**
 * The class ↔ team-classroom link (escape phase 1, Task 11): a real ClassRoom and real EscapeRooms,
 * joined through the ticket the class hands out. ONE boot for the whole file, on its own port
 * (ruling E1: 2568 WorldRoom, 2569 ClassRoom, 2570 EscapeRoom, 2571 this link test, 2572 PlayerRoom).
 */
const PORT = 2571;
/** For the tests that wait in real time on purpose (graces, reconnection windows, the ticket gap). */
const REAL_TIME_TEST_MS = 20_000;

const OPENER = { id: "t1", group: "saebit", label: "새빛초 4-2" };
const T1: VerifiedKey = { id: "t1", label: "새빛초 4-2", group: "saebit", operator: false };

/** The Korean copy the brief binds. */
const ENTER = {
  lobby: "선생님이 아직 시작하지 않았어요",
  paused: "잠깐! 선생님이 멈췄어요",
  notOpen: "이 교실은 아직 열리지 않았어요",
  elsewhere: "팀이 다른 교실에 있어요",
  escaped: "이미 탈출한 교실이에요",
  alone: "팀원이 2명 이상 모여야 해요",
  notLeader: "먼저 온 팀장이 눌러 주세요",
} as const;
const KICKED = "입장이 제한되었습니다";
/** nameIndex 0 = 햇살, colorIndex 5 = 파랑; nameIndex 1 = 풍선, colorIndex 0 = 빨강. */
const SUN = { nameIndex: 0, colorIndex: 5, name: "햇살(파랑)" } as const;
const BALLOON = { nameIndex: 1, colorIndex: 0, name: "풍선(빨강)" } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Let personal/broadcast messages propagate to the in-process test clients. */
const flush = () => sleep(60);

/** Poll a getter until it is truthy (or timeout), then return its value. */
async function pollFor<T>(read: () => T, timeoutMs = 3000, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let v = read();
  while (!v && Date.now() < deadline) {
    await sleep(stepMs);
    v = read();
  }
  return v;
}

/** The error a refused join rejects with. */
async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (e) {
    return String((e as { message?: unknown }).message);
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
  await colyseus.cleanup();
  delete process.env.CV_RECONNECT_WINDOW_S;
  delete process.env.CV_CLASS_END_GRACE_MS;
  delete process.env.CV_ESCAPE_END_GRACE_MS;
  delete process.env.CV_ESCAPE_EMPTY_DISPOSE_MS;
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────── Class side ───────────────────────────────────────────

function openClass(classCode: string, opts: Partial<ClassCreateOptions> = {}): Promise<ClassRoom> {
  const options: ClassCreateOptions = { spawnToken: SPAWN_TOKEN, classCode, textLevel: "easy", opener: OPENER, ...opts };
  return colyseus.createRoom<ClassRoom>(CLASS_ROOM, options);
}

function connectClass(room: ClassRoom, nickname: string, extra: Record<string, unknown> = {}) {
  return colyseus.connectTo(room, { classCode: room.state.classCode, nickname, appearance: DEFAULT_APPEARANCE, ...extra });
}
type ClassClient = Awaited<ReturnType<typeof connectClass>>;

/** One person in the class: the class connection and everything it received. */
interface Kid {
  client: ClassClient;
  sid: string;
  name: string;
  tickets: EscapeTicketPayload[];
  notices: string[];
  systems: string[];
  chats: ChatBroadcast[];
  mirrors: TeamChatMirrorPayload[];
  csvs: string[];
  /** In step with `csvs`: whether that CSV was the end-of-class copy the server pushed (`final`). */
  finals: boolean[];
  closed: number[];
}

/** Join the class and listen (handlers registered before any await). */
async function join(room: ClassRoom, nickname: string, extra: Record<string, unknown> = {}): Promise<Kid> {
  const client = await connectClass(room, nickname, extra);
  const kid: Kid = {
    client,
    sid: client.sessionId,
    name: nickname,
    tickets: [],
    notices: [],
    systems: [],
    chats: [],
    mirrors: [],
    csvs: [],
    finals: [],
    closed: [],
  };
  client.onMessage(ClassMsg.EscapeTicket, (m: EscapeTicketPayload) => kid.tickets.push(m));
  client.onMessage(ClassMsg.Notice, (m: NoticePayload) => kid.notices.push(m.text));
  client.onMessage(ClassMsg.TeamChatMirror, (m: TeamChatMirrorPayload) => kid.mirrors.push(m));
  client.onMessage(ClassMsg.ResultsCsv, (m: ResultsCsvPayload) => {
    kid.csvs.push(m.csv);
    kid.finals.push(m.final === true);
  });
  client.onMessage(MessageType.System, (m: SystemBroadcast) => kid.systems.push(m.text));
  client.onMessage(MessageType.Chat, (m: ChatBroadcast) => kid.chats.push(m));
  client.onMessage(MessageType.ChatRejected, () => {});
  client.onLeave((code) => kid.closed.push(code));
  await flush();
  return kid;
}

function teacherOf(room: ClassRoom): Promise<Kid> {
  return join(room, "선생님", { teacherPass: classRegistry.issuePass(room.state.classCode, T1, Date.now()) });
}

/** Send one message and wait until the room has handled it. */
async function sendTo(room: ClassRoom | EscapeRoom, client: { send(type: string, payload?: unknown): void }, type: string, payload?: unknown) {
  const handled = room.waitForNextMessage();
  client.send(type, payload);
  await handled;
  await flush();
}

function trackingOf(room: ClassRoom): Map<string, Tracking & { padDoor: string | null }> {
  return (room as unknown as { tracking: Map<string, Tracking & { padDoor: string | null }> }).tracking;
}

function playerOf(room: ClassRoom, k: Kid) {
  return room.state.players.get(k.sid)!;
}

function standAt(room: ClassRoom, k: Kid, x: number, z: number): void {
  const p = playerOf(room, k);
  p.x = x;
  p.z = z;
}

/** A spot on the team rug. */
const RUG = { x: (TEAM_ZONE.minX + TEAM_ZONE.maxX) / 2, z: (TEAM_ZONE.minZ + TEAM_ZONE.maxZ) / 2 } as const;
const COUNSEL = HUB_DOORS.find((d) => d.room === "counsel")!;
const LIBRARY = HUB_DOORS.find((d) => d.room === "library")!;
type Door = (typeof HUB_DOORS)[number];

/** Stand just off the door's pad and walk onto it with one legal Move (the room's pad hook runs). */
async function stepOn(room: ClassRoom, k: Kid, d: Door): Promise<void> {
  standAt(room, k, d.x, Math.sign(d.returnPoint.z) * 0.5);
  trackingOf(room).get(k.sid)!.lastAcceptedAt = Date.now() - 200;
  await sendTo(room, k.client, MessageType.Move, { x: d.x, z: d.returnPoint.z, yaw: 0 });
  expect(doorAtPad(playerOf(room, k).x, playerOf(room, k).z)).toBe(d.room);
}

/** Students on the rug make a team: the first creates it, the others join (real messages). */
async function makeTeam(room: ClassRoom, kids: Kid[], combo: { nameIndex: number; colorIndex: number } = SUN): Promise<Team> {
  for (const k of kids) standAt(room, k, RUG.x, RUG.z);
  await sendTo(room, kids[0].client, ClassMsg.TeamCreate, { nameIndex: combo.nameIndex, colorIndex: combo.colorIndex });
  const teamId = playerOf(room, kids[0]).teamId;
  expect(teamId).not.toBe("");
  for (const k of kids.slice(1)) await sendTo(room, k.client, ClassMsg.TeamJoin, { teamId });
  return room.state.teams.get(teamId)!;
}

/** A started class with a teacher and one team of `names` (SUN). */
async function classWithTeam(code: string, names: string[] = ["가람", "다온"], start = true) {
  const room = await openClass(code);
  const teacher = await teacherOf(room);
  if (start) await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "start" });
  const kids: Kid[] = [];
  for (const n of names) kids.push(await join(room, n));
  const team = await makeTeam(room, kids);
  return { room, teacher, kids, team };
}

async function enterRoom(room: ClassRoom, k: Kid, door: string = "counsel"): Promise<void> {
  await sendTo(room, k.client, ClassMsg.EnterRoom, { room: door });
}

/** The leader (first on the pad) presses "입장" and every listed member gets one ticket. */
async function padAndEnter(room: ClassRoom, kids: Kid[]): Promise<string> {
  for (const k of kids) await stepOn(room, k, COUNSEL);
  await enterRoom(room, kids[0]);
  expect(await pollFor(() => kids.every((k) => k.tickets.length === 1))).toBe(true);
  return kids[0].tickets[0].roomId;
}

// ─────────────────────────────────────────── Escape side ───────────────────────────────────────────

function escapeRoomById(roomId: string): EscapeRoom {
  const r = matchMaker.getLocalRoomById(roomId) as EscapeRoom | undefined;
  if (!r) throw new Error("no such escape room");
  return r;
}

/** A member's escape-room connection and what it received. */
interface Inside {
  client: Awaited<ReturnType<typeof colyseus.sdk.joinById>>;
  sid: string;
  events: EscapeEventPayload[];
  chats: ChatBroadcast[];
  closed: number[];
}

function listenInside(client: Inside["client"]): Inside {
  const inside: Inside = { client, sid: client.sessionId, events: [], chats: [], closed: [] };
  client.onMessage(EscapeMsg.Content, () => {});
  client.onMessage(EscapeMsg.InspectView, () => {});
  client.onMessage(EscapeMsg.Notice, () => {});
  client.onMessage(EscapeMsg.Event, (m: EscapeEventPayload) => inside.events.push(m));
  client.onMessage(MessageType.Chat, (m: ChatBroadcast) => inside.chats.push(m));
  client.onMessage(MessageType.ChatRejected, () => {});
  client.onLeave((code) => inside.closed.push(code));
  return inside;
}

/** What the client does with its ticket: join the escape room by id. */
async function goIn(t: EscapeTicketPayload): Promise<Inside> {
  const client = await colyseus.sdk.joinById(t.roomId, { ticket: t.ticket });
  const inside = listenInside(client);
  await flush();
  return inside;
}

/** The decoded escape state a member's client holds. */
function seenInside(m: Inside) {
  return m.client.state as unknown as { flags: Iterable<string>; bag: Iterable<string>; paused: boolean; phase: string };
}

function engineOf(room: EscapeRoom): EngineState {
  return (room as unknown as { es: EngineState }).es;
}

/** White box: a shortcut past earlier puzzles, synced the way an action would. */
function setFlags(room: EscapeRoom, ...flags: string[]): void {
  const es = engineOf(room);
  for (const f of flags) es.flags.add(f);
  projectToSchema(es, room.state);
}

function placeAt(room: EscapeRoom, m: Inside, objectId: string): void {
  const a = COUNSEL_ANCHORS.find((x) => x.id === objectId)!;
  const p = room.state.players.get(m.sid)!;
  p.x = a.x;
  p.z = a.z;
}

/** One escape-room message, handled, with its after-patch events delivered. */
async function act(room: EscapeRoom, m: Inside, type: string, payload?: unknown): Promise<void> {
  const handled = room.waitForNextMessage();
  m.client.send(type, payload);
  await handled;
  await room.waitForNextPatch();
  await sleep(40);
}

/** Skip the intro, solve the first puzzles (shortcut), turn the safe keys together, vote right twice. */
async function escapeTogether(room: EscapeRoom, a: Inside, b: Inside): Promise<void> {
  room.debugAdvance(ESCAPE_INTRO_MS);
  expect(room.state.phase).toBe("play");
  setFlags(room, "solved:cabinet_lock", "solved:cover_lock", "solved:board_lock", "safe_unlocked");
  placeAt(room, a, "safe_key_left");
  placeAt(room, b, "safe_key_right");
  await act(room, a, EscapeMsg.Press, { objectId: "safe_key_left" });
  await act(room, b, EscapeMsg.Press, { objectId: "safe_key_right" });
  expect(room.state.phase).toBe("finale");
  for (const optionId of ["privacy", "ask_first"]) {
    await act(room, a, EscapeMsg.Vote, { optionId });
    await act(room, b, EscapeMsg.Vote, { optionId });
  }
  expect(room.state.phase).toBe("escaped");
}

/** Close a connection abruptly (tab closed / network): the server keeps a ghost for the window. */
function cut(client: { reconnection: { enabled: boolean }; connection: { close(code: number, reason: string): void } }): void {
  client.reconnection.enabled = false;
  client.connection.close(4010, "tab closed");
}

/** White box: the class's set of teams whose classroom is being opened. */
function creatingOf(room: ClassRoom): Set<string> {
  return (room as unknown as { creating: Set<string> }).creating;
}

/**
 * Hold every classroom creation of this class until `release()` (the class may change meanwhile):
 * `waiting` counts the creations that reached the hold.
 */
function holdCreation(room: ClassRoom): { readonly waiting: number; release(): void } {
  type Create = (options: unknown) => Promise<string>;
  const target = room as unknown as { createEscapeRoom: Create };
  const original = target.createEscapeRoom.bind(room);
  const gates: (() => void)[] = [];
  let waiting = 0;
  vi.spyOn(target, "createEscapeRoom").mockImplementation(async (options) => {
    waiting++;
    await new Promise<void>((resolve) => gates.push(resolve));
    return original(options);
  });
  return {
    get waiting() {
      return waiting;
    },
    release() {
      for (const open of gates.splice(0)) open();
    },
  };
}

function escapeRoomCount(): Promise<number> {
  return matchMaker.query({ name: ESCAPE_ROOM }).then((l) => l.length);
}

/** A result row as an EscapeRoom reports it. */
function result(over: Partial<EscapeResult> = {}): EscapeResult {
  return {
    teamId: "team-1",
    teamName: SUN.name,
    roomId: "counsel",
    members: ["가람", "다온"],
    escaped: false,
    overtime: false,
    elapsedS: 300,
    remainingS: 600,
    hintsUsed: 1,
    wrongAttempts: 2,
    stars: 0,
    firstTry: {},
    ...over,
  };
}

// ─────────────────────────────────────────────── Tests ───────────────────────────────────────────────

describe("entering a team classroom", () => {
  it("the pad leader enters: one EscapeRoom, both pad members get tickets, join, and flip to place=1", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const { room, kids, team } = await classWithTeam("EN2TER", ["가람", "다온", "세온"]);
    const [a, b, c] = kids; // c stays on the rug
    await stepOn(room, a, COUNSEL);
    await stepOn(room, b, COUNSEL);
    expect([team.padDoor, team.padLeaderSid, team.padCount]).toEqual(["counsel", a.sid, 2]);

    await enterRoom(room, a);
    expect(await pollFor(() => a.tickets.length === 1 && b.tickets.length === 1)).toBe(true);
    await flush();
    expect(c.tickets).toEqual([]);
    expect(a.notices).toEqual([]);

    // One instance, named on the team, for that door, at the class's reading level.
    expect(await escapeRoomCount()).toBe(1);
    const roomId = a.tickets[0].roomId;
    expect(b.tickets[0].roomId).toBe(roomId);
    expect(team.escapeRoomId).toBe(roomId);
    expect(team.escapeDoor).toBe("counsel");
    const esc = escapeRoomById(roomId);
    expect([esc.state.teamName, esc.state.roomDefId, esc.state.textLevel]).toEqual([SUN.name, "counsel", "easy"]);
    // Tickets: 24 base64url symbols (18 random bytes), one per member.
    for (const t of [a.tickets[0], b.tickets[0]]) expect(t.ticket).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a.tickets[0].ticket).not.toBe(b.tickets[0].ticket);

    // Both go in: the class shows them inside (place 1), and the pad no longer counts them.
    const [ia, ib] = [await goIn(a.tickets[0]), await goIn(b.tickets[0])];
    expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE && playerOf(room, b).place === PLACE_ESCAPE)).toBe(true);
    expect(playerOf(room, c).place).toBe(PLACE_HUB);
    expect([team.padDoor, team.padCount]).toEqual(["", 0]);
    expect(esc.state.players.size).toBe(2);
    expect([...esc.state.players.values()].map((p) => p.nickname).sort()).toEqual(["가람", "다온"]);
    expect(ia.sid).not.toBe(ib.sid);
    // Everyone's class screen sees them inside.
    expect(await pollFor(() => (c.client.state as unknown as { players: Map<string, { place: number }> }).players.get(a.sid)?.place === PLACE_ESCAPE)).toBe(true);

    // A ticket is never in any state, listing or log.
    const secrets = [a.tickets[0].ticket, b.tickets[0].ticket];
    const listing = JSON.stringify(await matchMaker.query({}));
    for (const s of secrets) {
      expect(JSON.stringify(room.state.toJSON())).not.toContain(s);
      expect(JSON.stringify(esc.state.toJSON())).not.toContain(s);
      expect(listing).not.toContain(s);
      for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(s);
    }
    // Used once: the same ticket cannot be used again.
    expect(await refusal(colyseus.sdk.joinById(roomId, { ticket: a.tickets[0].ticket }))).toBe(
      "입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요.",
    );
  });

  it("double EnterRoom from the leader and a simultaneous one from a teammate create exactly one EscapeRoom (Review Focus 3)", async () => {
    const { room, kids, team } = await classWithTeam("DB2LEN");
    const [a, b] = kids;
    await stepOn(room, a, COUNSEL);
    await stepOn(room, b, COUNSEL);

    // Three presses in the same instant: two from the leader, one from the teammate.
    a.client.send(ClassMsg.EnterRoom, { room: "counsel" });
    a.client.send(ClassMsg.EnterRoom, { room: "counsel" });
    b.client.send(ClassMsg.EnterRoom, { room: "counsel" });
    expect(await pollFor(() => a.tickets.length >= 1 && b.tickets.length >= 1)).toBe(true);
    await sleep(300);
    expect(await escapeRoomCount()).toBe(1);
    expect(a.tickets).toHaveLength(1);
    expect(b.tickets).toHaveLength(1);
    // The teammate's press is refused (not the leader) or, when it lands after the room exists,
    // ignored (B is getting a ticket anyway) — never a second room, never a second ticket.
    expect(b.notices.filter((n) => n !== ENTER.notLeader)).toEqual([]);
    expect(b.notices.length).toBeLessThanOrEqual(1);
    expect(a.notices).toEqual([]);

    // Pressing again right after (still on the pad) neither opens a room nor revokes the ticket in use.
    await enterRoom(room, a);
    await sleep(150);
    expect(a.tickets).toHaveLength(1);
    expect(await escapeRoomCount()).toBe(1);
    const ia = await goIn(a.tickets[0]);
    expect(escapeRoomById(team.escapeRoomId).state.players.has(ia.sid)).toBe(true);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE)).toBe(true);
  });

  it("refusals carry the Korean reasons: lobby, paused, not open, alone, not leader, already escaped", async () => {
    const { room, teacher, kids, team } = await classWithTeam("RF2USE", ["가람", "다온"], false);
    const [a, b] = kids;
    const loner = await join(room, "세온"); // no team

    // Lobby: the class has not started (even right on the pad).
    await stepOn(room, a, COUNSEL);
    await stepOn(room, b, COUNSEL);
    await enterRoom(room, a);
    expect(a.notices).toEqual([ENTER.lobby]);

    // Paused.
    await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "start" });
    await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "pause" });
    await enterRoom(room, a);
    expect(a.notices.at(-1)).toBe(ENTER.paused);
    await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "resume" });

    // A door that is not open in phase 1.
    await stepOn(room, a, LIBRARY);
    await stepOn(room, b, LIBRARY);
    await enterRoom(room, a, "library");
    expect(a.notices.at(-1)).toBe(ENTER.notOpen);

    // Alone on the pad (the other member walked off), and a teamless student.
    await stepOn(room, a, COUNSEL);
    await enterRoom(room, a);
    expect(a.notices.at(-1)).toBe(ENTER.alone);
    await stepOn(room, loner, COUNSEL);
    await enterRoom(room, loner);
    expect(loner.notices).toEqual([ENTER.alone]);

    // Both on the pad: only the first one there (the leader) may press.
    await stepOn(room, b, COUNSEL);
    expect(team.padLeaderSid).toBe(a.sid);
    await enterRoom(room, b);
    expect(b.notices).toEqual([ENTER.notLeader]);

    // Already escaped from this room.
    team.escaped.push("counsel");
    await enterRoom(room, a);
    expect(a.notices.at(-1)).toBe(ENTER.escaped);
    team.escaped.clear();

    // The team is inside another room.
    team.escapeRoomId = "elsewhere";
    team.escapeDoor = "library";
    await enterRoom(room, a);
    expect(a.notices.at(-1)).toBe(ENTER.elsewhere);
    team.escapeRoomId = "";
    team.escapeDoor = "";

    // Dropped silently: malformed payloads, a teacher, a student inside a classroom, an ended class.
    const before = a.notices.length;
    for (const bad of [null, {}, { room: "nope" }, { room: 3 }, "counsel"]) await sendTo(room, a.client, ClassMsg.EnterRoom, bad);
    await stepOn(room, teacher, COUNSEL);
    await enterRoom(room, teacher);
    playerOf(room, b).place = PLACE_ESCAPE;
    await enterRoom(room, b);
    playerOf(room, b).place = PLACE_HUB;
    expect(a.notices).toHaveLength(before);
    expect(teacher.notices).toEqual([]);
    expect(b.notices).toEqual([ENTER.notLeader]);
    await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "end" });
    await enterRoom(room, a);
    expect(a.notices).toHaveLength(before);

    // Nothing was ever opened, nobody got a ticket.
    expect(await escapeRoomCount()).toBe(0);
    for (const k of [a, b, loner, teacher]) expect(k.tickets).toEqual([]);
  });

  it("a teammate who arrives later at the same pad gets a ticket to the same instance", async () => {
    const { room, kids, team } = await classWithTeam("LA2TER", ["가람", "다온", "세온"]);
    const [a, b, c] = kids;
    const roomId = await padAndEnter(room, [a, b]);
    await goIn(a.tickets[0]);
    await goIn(b.tickets[0]);
    expect(c.tickets).toEqual([]);

    // Away from the pad the press does nothing (no ticket, no notice).
    await enterRoom(room, c);
    await sleep(100);
    expect(c.tickets).toEqual([]);
    expect(c.notices).toEqual([]);

    // On the pad, but while the pad's tickets are still being handed out: wait (C may be next in line).
    await stepOn(room, c, COUNSEL);
    creatingOf(room).add(team.id);
    await enterRoom(room, c);
    await sleep(100);
    expect(c.tickets).toEqual([]);
    creatingOf(room).delete(team.id);

    // On the pad: alone is enough, into the team's own instance.
    await enterRoom(room, c);
    expect(await pollFor(() => c.tickets.length === 1)).toBe(true);
    expect(c.tickets[0].roomId).toBe(roomId);
    expect(c.notices).toEqual([]);
    const ic = await goIn(c.tickets[0]);
    const esc = escapeRoomById(roomId);
    expect(esc.state.players.has(ic.sid)).toBe(true);
    expect(esc.state.players.size).toBe(3);
    expect(await pollFor(() => playerOf(room, c).place === PLACE_ESCAPE)).toBe(true);
    expect(await escapeRoomCount()).toBe(1);
    expect(team.escapeRoomId).toBe(roomId);
  });

  it("after the escape, while the escaped classroom still runs, nobody of the team is let back in: alreadyEscaped (final fix B4)", async () => {
    const { room, kids, team } = await classWithTeam("RE2NTR", ["가람", "다온", "세온"]);
    const [a, b, c] = kids;
    const roomId = await padAndEnter(room, [a, b]);
    const [ia, ib] = [await goIn(a.tickets[0]), await goIn(b.tickets[0])];
    const esc = escapeRoomById(roomId);
    await escapeTogether(esc, ia, ib);
    expect(await pollFor(() => team.escaped.includes("counsel"))).toBe(true);
    expect(team.escapeRoomId).toBe(roomId); // the classroom is still open (it closes when empty)

    // A teammate who never went in walks onto the pad and presses 입장: refused, no ticket.
    await stepOn(room, c, COUNSEL);
    await enterRoom(room, c);
    expect(await pollFor(() => c.notices.length === 1)).toBe(true);
    expect(c.notices).toEqual([ENTER.escaped]);
    expect(c.tickets).toEqual([]);

    // A member who came out (back on the counsel pad) presses again: refused too.
    await ia.client.leave(true);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_HUB)).toBe(true);
    await enterRoom(room, a);
    expect(await pollFor(() => a.notices.length === 1)).toBe(true);
    expect(a.notices).toEqual([ENTER.escaped]);
    expect(a.tickets).toHaveLength(1); // only the ticket of the first entry
    expect(esc.state.players.has(ia.sid)).toBe(false);
  });

  it("never tickets a teacher: not on the pad, not in a team, not by EnterRoom or EscapeRejoin (controller ruling)", async () => {
    const { room, teacher, kids, team } = await classWithTeam("TE2ACH");
    const [a, b] = kids;
    await stepOn(room, a, COUNSEL);
    await stepOn(room, b, COUNSEL);
    await stepOn(room, teacher, COUNSEL);
    // Even if a teacher's session somehow sat in the team's member list, standing on the pad…
    team.members.push(teacher.sid);
    playerOf(room, teacher).teamId = team.id;
    await enterRoom(room, a);
    expect(await pollFor(() => a.tickets.length === 1 && b.tickets.length === 1)).toBe(true);
    await flush();
    // …the teacher gets no ticket; the instance knows only the two students.
    expect(teacher.tickets).toEqual([]);
    await goIn(a.tickets[0]);
    await goIn(b.tickets[0]);
    const esc = escapeRoomById(team.escapeRoomId);
    expect(esc.state.players.size).toBe(2);

    // The teacher's own presses: EnterRoom (rule 1: the team's door, on its pad) and EscapeRejoin.
    await enterRoom(room, teacher);
    playerOf(room, teacher).place = PLACE_ESCAPE;
    await sendTo(room, teacher.client, ClassMsg.EscapeRejoin, {});
    await sleep(150);
    expect(teacher.tickets).toEqual([]);
    expect(esc.state.players.size).toBe(2);
  });

  it(
    "the class changing while a classroom opens: paused → the new room starts paused; ended → no tickets and it closes; auto-assign leaves the team alone",
    async () => {
      process.env.CV_ESCAPE_END_GRACE_MS = "200";
      const { room, teacher, kids, team } = await classWithTeam("HD2LDS");
      const [a, b] = kids;
      const loose = [await join(room, "세온"), await join(room, "하늘"), await join(room, "보라")];
      const gate = holdCreation(room);

      // Paused while the room is being made: it is paused as soon as it exists.
      await stepOn(room, a, COUNSEL);
      await stepOn(room, b, COUNSEL);
      await enterRoom(room, a);
      expect(await pollFor(() => gate.waiting === 1)).toBe(true);
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "pause" });
      // A team on its way in counts as inside: a shuffle regroups only the others.
      await sendTo(room, teacher.client, ClassMsg.TeamAuto, { mode: "shuffle" });
      expect(room.state.teams.get(team.id)).toBe(team);
      expect([...team.members]).toEqual([a.sid, b.sid]);
      expect(loose.every((k) => playerOf(room, k).teamId !== "")).toBe(true);
      gate.release();
      expect(await pollFor(() => a.tickets.length === 1 && b.tickets.length === 1)).toBe(true);
      const first = escapeRoomById(team.escapeRoomId);
      expect(await pollFor(() => first.state.paused)).toBe(true);
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "resume" });
      expect(await pollFor(() => !first.state.paused)).toBe(true);

      // Ended while the room is being made: nobody is sent in and the new room closes by itself.
      // (The shuffle made the three loose students one team.)
      const team2 = room.state.teams.get(playerOf(room, loose[0]).teamId)!;
      expect([...team2.members].sort()).toEqual(loose.map((k) => k.sid).sort());
      for (const k of loose) await stepOn(room, k, COUNSEL);
      expect(team2.padLeaderSid).toBe(loose[0].sid);
      await enterRoom(room, loose[0]);
      expect(await pollFor(() => gate.waiting === 2)).toBe(true);
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "end" });
      gate.release();
      const deadline = Date.now() + 4000;
      while ((await escapeRoomCount()) > 0 && Date.now() < deadline) await sleep(50);
      expect(await escapeRoomCount()).toBe(0);
      await flush();
      for (const k of loose) expect(k.tickets).toEqual([]);
      expect(team2.escapeRoomId).toBe("");
      expect(team.escapeRoomId).toBe("");
    },
    REAL_TIME_TEST_MS,
  );
});

describe("staying in and coming back", () => {
  it(
    "refresh mid-room: a fresh class join with the same nickname receives a ticket and sees the same flags and bag (Review Focus 1)",
    async () => {
      process.env.CV_RECONNECT_WINDOW_S = "5";
      const { room, kids, team } = await classWithTeam("RF3RSH");
      const [a, b] = kids;
      const roomId = await padAndEnter(room, [a, b]);
      const ia = await goIn(a.tickets[0]);
      const ib = await goIn(b.tickets[0]);
      const esc = escapeRoomById(roomId);
      expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE)).toBe(true);

      // Some progress: a solved lock and an item in the team bag.
      const item = counsel.items[0].id;
      const es = engineOf(esc);
      es.bag.push(item);
      setFlags(esc, "solved:cabinet_lock");
      expect(await pollFor(() => [...seenInside(ia).flags].includes("solved:cabinet_lock"))).toBe(true);

      // The tab is refreshed: both of its connections drop at once.
      const oldEscapeSid = ia.sid;
      cut(a.client);
      cut(ia.client);
      expect(await pollFor(() => room.state.players.get(a.sid)?.connected === false)).toBe(true);
      expect(await pollFor(() => esc.state.players.get(oldEscapeSid)?.connected === false)).toBe(true);

      // The new tab types the same nickname: it takes the ghost over and is sent straight back in.
      const fresh = await join(room, "가람");
      expect(await pollFor(() => fresh.tickets.length === 1)).toBe(true);
      expect(fresh.tickets[0].roomId).toBe(roomId);
      expect(playerOf(room, fresh).place).toBe(PLACE_ESCAPE);
      expect(playerOf(room, fresh).teamId).toBe(team.id);
      expect([...team.members]).toEqual([fresh.sid, b.sid]);

      const back = await goIn(fresh.tickets[0]);
      // Same room, same progress; the ghost was replaced, not doubled.
      expect(await pollFor(() => [...seenInside(back).flags].includes("solved:cabinet_lock"))).toBe(true);
      expect([...seenInside(back).bag]).toEqual([item]);
      expect(esc.state.players.has(oldEscapeSid)).toBe(false);
      expect(esc.state.players.has(back.sid)).toBe(true);
      expect(esc.state.players.size).toBe(2);
      // The old sessions' late departures move nobody: the fresh member stays inside.
      await sleep(200);
      expect(playerOf(room, fresh).place).toBe(PLACE_ESCAPE);
      expect(room.state.players.has(a.sid)).toBe(false);
      expect(ib.closed).toEqual([]);
    },
    REAL_TIME_TEST_MS,
  );

  it(
    "EscapeRejoin: a member inside whose classroom connection was lost gets a fresh ticket; anyone else gets nothing",
    async () => {
      process.env.CV_RECONNECT_WINDOW_S = "5";
      const { room, kids, team } = await classWithTeam("RJ2NWT", ["가람", "다온", "세온"]);
      const [a, b, c] = kids;
      const roomId = await padAndEnter(room, [a, b]);
      await goIn(a.tickets[0]);
      const ib = await goIn(b.tickets[0]);
      const esc = escapeRoomById(roomId);
      expect(await pollFor(() => playerOf(room, b).place === PLACE_ESCAPE)).toBe(true);

      // Not inside a classroom → nothing (a member in the hall, a student without a team).
      await sendTo(room, c.client, ClassMsg.EscapeRejoin, {});
      const loner = await join(room, "하늘");
      await sendTo(room, loner.client, ClassMsg.EscapeRejoin, {});

      // B's classroom connection drops and cannot be restored; B's class connection is fine.
      cut(ib.client);
      expect(await pollFor(() => esc.state.players.get(ib.sid)?.connected === false)).toBe(true);
      await sleep(2100); // (past the repeat gap of B's entry ticket; the ghost window is 5 s)
      // The rejoin is answered with a new ticket to the same room…
      await sendTo(room, b.client, ClassMsg.EscapeRejoin, {});
      expect(await pollFor(() => b.tickets.length === 2)).toBe(true);
      expect(b.tickets[1].roomId).toBe(roomId);
      // …and a second rejoin right after it is not (a double press must not revoke the one in use).
      await sendTo(room, b.client, ClassMsg.EscapeRejoin, {});
      await sleep(100);
      expect(b.tickets).toHaveLength(2);
      const back = await goIn(b.tickets[1]);
      expect(esc.state.players.has(back.sid)).toBe(true);
      expect(esc.state.players.has(ib.sid)).toBe(false);
      expect(esc.state.players.size).toBe(2);
      expect(playerOf(room, b).place).toBe(PLACE_ESCAPE);
      expect(c.tickets).toEqual([]);
      expect(loner.tickets).toEqual([]);
      expect(team.escapeRoomId).toBe(roomId);
    },
    REAL_TIME_TEST_MS,
  );

  it("escape: litRooms has 'counsel', team escaped/stars set, System notice, members return to the counsel pad", async () => {
    const { room, teacher, kids, team } = await classWithTeam("ES2CPE");
    const [a, b] = kids;
    const hall = await join(room, "하늘");
    const roomId = await padAndEnter(room, [a, b]);
    const ia = await goIn(a.tickets[0]);
    const ib = await goIn(b.tickets[0]);
    const esc = escapeRoomById(roomId);
    expect(await pollFor(() => playerOf(room, b).place === PLACE_ESCAPE)).toBe(true);
    // From now on an empty instance closes quickly (read each time the room arms its timer).
    process.env.CV_ESCAPE_EMPTY_DISPOSE_MS = "300";

    await escapeTogether(esc, ia, ib);
    const escaped = ia.events.find((e) => e.e === "escaped");
    expect(escaped).toBeDefined();
    const stars = (escaped as { stars: number }).stars;

    // The class lights the room, records the team's escape and stars, and tells everyone.
    expect(await pollFor(() => room.state.litRooms.includes("counsel"))).toBe(true);
    expect([...room.state.litRooms]).toEqual(["counsel"]);
    expect([...team.escaped]).toEqual(["counsel"]);
    expect(team.stars.get("counsel")).toBe(stars);
    const notice = "햇살(파랑) 팀이 상담실을 탈출했어요!";
    for (const k of [teacher, a, b, hall]) expect(await pollFor(() => k.systems.includes(notice))).toBe(true);
    expect(hall.systems.filter((t) => t === notice)).toHaveLength(1);

    // The members leave the classroom: back in the hub on the counsel door's pad.
    const leftAt = Date.now();
    await ia.client.leave(true);
    await ib.client.leave(true);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_HUB && playerOf(room, b).place === PLACE_HUB)).toBe(true);
    for (const k of [a, b]) {
      const p = playerOf(room, k);
      expect(doorAtPad(p.x, p.z)).toBe("counsel");
      expect(Math.hypot(p.x - COUNSEL.returnPoint.x, p.z - COUNSEL.returnPoint.z)).toBeLessThanOrEqual(0.61);
      expect(trackingOf(room).get(k.sid)!.padDoor).toBe("counsel");
    }
    expect([team.padDoor, team.padCount]).toEqual(["counsel", 2]);
    // The move clock restarted at the return, and they can walk again from there.
    expect(trackingOf(room).get(a.sid)!.lastAcceptedAt).toBeGreaterThanOrEqual(leftAt);
    trackingOf(room).get(a.sid)!.lastAcceptedAt = Date.now() - 200;
    const from = { x: playerOf(room, a).x, z: playerOf(room, a).z };
    await sendTo(room, a.client, MessageType.Move, { x: from.x + 0.3, z: from.z, yaw: 0 });
    expect(playerOf(room, a).x).toBeCloseTo(from.x + 0.3, 4);

    // The empty instance closes; the team is free again, but this door stays done.
    expect(await pollFor(() => team.escapeRoomId === "")).toBe(true);
    expect(team.escapeDoor).toBe("counsel");
    expect(await escapeRoomCount()).toBe(0);
    await enterRoom(room, a);
    expect(a.notices).toEqual([ENTER.escaped]);

    // The CSV has the team's escape.
    await sendTo(room, teacher.client, ClassMsg.ResultsRequest, {});
    expect(await pollFor(() => teacher.csvs.length === 1)).toBe(true);
    expect(teacher.csvs[0]).toContain("햇살(파랑),가람·다온,상담실,탈출,");
    expect(teacher.csvs[0]).toContain(",프라이버시 보호 첫 시도\r\n");
    expect(teacher.csvs[0].trimEnd().endsWith(",정답")).toBe(true);
  });
});

describe("the teacher's view and controls", () => {
  it(
    "teacher pause/resume reaches every instance; end reports unfinished teams and closes everything (Review Focus 4)",
    async () => {
      process.env.CV_ESCAPE_END_GRACE_MS = "300";
      process.env.CV_CLASS_END_GRACE_MS = "1500";
      const { room, teacher, kids, team } = await classWithTeam("PA2USE");
      const [a, b] = kids;
      const [c, d] = [await join(room, "세온"), await join(room, "하늘")];
      const team2 = await makeTeam(room, [c, d], BALLOON);
      const id1 = await padAndEnter(room, [a, b]);
      const id2 = await padAndEnter(room, [c, d]);
      expect(id1).not.toBe(id2);
      expect(await escapeRoomCount()).toBe(2);
      const insides = [await goIn(a.tickets[0]), await goIn(b.tickets[0]), await goIn(c.tickets[0]), await goIn(d.tickets[0])];
      const [e1, e2] = [escapeRoomById(id1), escapeRoomById(id2)];
      e1.debugAdvance(ESCAPE_INTRO_MS);
      setFlags(e1, "solved:cabinet_lock");

      // Pause reaches both instances (and the members' screens); resume too.
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "pause" });
      expect(await pollFor(() => e1.state.paused && e2.state.paused)).toBe(true);
      expect(await pollFor(() => insides.every((m) => seenInside(m).paused))).toBe(true);
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "resume" });
      expect(await pollFor(() => !e1.state.paused && !e2.state.paused)).toBe(true);
      expect(room.state.phase).toBe("running");

      // End: both instances end and report their unfinished results before the class's grace, and the
      // teacher is sent that final CSV by itself (final review I1) — no ResultsRequest needed.
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "end" });
      expect(await pollFor(() => e1.state.phase === "ended" && e2.state.phase === "ended")).toBe(true);
      expect(await pollFor(() => teacher.csvs.length === 1)).toBe(true);
      expect(teacher.finals).toEqual([true]);
      for (const k of [a, b, c, d]) expect(k.csvs).toEqual([]);
      const csv = teacher.csvs[0];
      expect(csv).toContain("햇살(파랑),가람·다온,상담실,미탈출,");
      expect(csv).toContain("풍선(빨강),세온·하늘,상담실,미탈출,");
      expect(csv.split("\r\n").filter((l) => l.includes("미탈출"))).toHaveLength(2);

      // The classrooms close first (CLASS_CLOSED_CODE), everyone is back in the hub, the teams are free.
      expect(await pollFor(() => insides.every((m) => m.closed.length === 1))).toBe(true);
      for (const m of insides) expect(m.closed).toEqual([CLASS_CLOSED_CODE]);
      expect(await pollFor(() => team.escapeRoomId === "" && team2.escapeRoomId === "")).toBe(true);
      for (const k of [a, b, c, d]) expect(playerOf(room, k).place).toBe(PLACE_HUB);
      expect(await escapeRoomCount()).toBe(0);
      // Then the class itself.
      const everyone = [teacher, a, b, c, d];
      expect(await pollFor(() => everyone.every((k) => k.closed.length === 1), 5000)).toBe(true);
      for (const k of everyone) expect(k.closed).toEqual([CLASS_CLOSED_CODE]);
      expect(await pollFor(() => matchMaker.getLocalRoomById(room.roomId) === undefined)).toBe(true);
    },
    REAL_TIME_TEST_MS,
  );

  it(
    "end with one team escaped and one still inside: every teacher gets the final CSV by itself, the unfinished team's row included (final review I1)",
    async () => {
      process.env.CV_ESCAPE_END_GRACE_MS = "300";
      process.env.CV_CLASS_END_GRACE_MS = "1500";
      const { room, teacher, kids } = await classWithTeam("FN2CSV");
      const [a, b] = kids;
      const coTeacher = await join(room, "보조쌤", { teacherPass: classRegistry.issuePass("FN2CSV", T1, Date.now()) });
      const [c, d] = [await join(room, "세온"), await join(room, "하늘")];
      await makeTeam(room, [c, d], BALLOON);
      const id1 = await padAndEnter(room, [a, b]);
      const id2 = await padAndEnter(room, [c, d]);
      const [ia, ib] = [await goIn(a.tickets[0]), await goIn(b.tickets[0])];
      await goIn(c.tickets[0]);
      await goIn(d.tickets[0]);
      // Team 1 escapes; team 2 is still at it when the time is up.
      await escapeTogether(escapeRoomById(id1), ia, ib);
      expect(await pollFor(() => room.state.litRooms.includes("counsel"))).toBe(true);
      escapeRoomById(id2).debugAdvance(ESCAPE_INTRO_MS);

      // The teacher presses 끝내기 without asking for the CSV first.
      await sendTo(room, teacher.client, ClassMsg.Command, { cmd: "end" });
      expect(await pollFor(() => teacher.csvs.length === 1 && coTeacher.csvs.length === 1)).toBe(true);
      expect(teacher.finals).toEqual([true]);
      expect(coTeacher.csvs).toEqual(teacher.csvs);
      const rows = teacher.csvs[0].split("\r\n");
      expect(rows.some((r) => r.startsWith("풍선(빨강),세온·하늘,상담실,미탈출,"))).toBe(true);
      expect(rows.some((r) => r.startsWith("햇살(파랑),가람·다온,상담실,탈출,"))).toBe(true);
      // Students never get it; and it comes once, not again later in the grace.
      await sleep(400);
      expect(teacher.csvs).toHaveLength(1);
      for (const k of [a, b, c, d]) expect(k.csvs).toEqual([]);
    },
    REAL_TIME_TEST_MS,
  );

  it("team chat inside reaches teachers as TeamChatMirror and no student in the hall", async () => {
    const { room, teacher, kids, team } = await classWithTeam("CH2ATT");
    const [a, b] = kids;
    const hall = await join(room, "하늘");
    const roomId = await padAndEnter(room, [a, b]);
    const ia = await goIn(a.tickets[0]);
    const ib = await goIn(b.tickets[0]);
    const esc = escapeRoomById(roomId);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE && playerOf(room, b).place === PLACE_ESCAPE)).toBe(true);

    // Team chat: the team hears it in its room, the teacher gets a copy, the hall hears nothing.
    const before = Date.now();
    await act(esc, ia, MessageType.Chat, { text: "서랍 먼저 열어 보자" });
    expect(await pollFor(() => teacher.mirrors.length === 1)).toBe(true);
    expect(teacher.mirrors[0]).toMatchObject({ teamId: team.id, teamName: SUN.name, name: "가람", text: "서랍 먼저 열어 보자", filtered: false });
    expect(teacher.mirrors[0].at).toBeGreaterThanOrEqual(before);
    expect(ib.chats.map((m) => m.text)).toEqual(["서랍 먼저 열어 보자"]);
    // A held-back line reaches the teacher masked.
    await act(esc, ia, MessageType.Chat, { text: "너 진짜 시발 왜 그래" });
    expect(await pollFor(() => teacher.mirrors.length === 2)).toBe(true);
    expect(teacher.mirrors[1]).toMatchObject({ teamId: team.id, name: "가람", text: "너 진짜 ●● 왜 그래", filtered: true });
    await flush();
    for (const k of [a, b, hall]) expect(k.mirrors).toEqual([]);
    for (const k of [teacher, a, b, hall]) expect(k.chats).toEqual([]);

    // Hall chat (E13): to everyone in the hub, never to the members inside a classroom.
    await sendTo(room, hall.client, MessageType.Chat, { text: "다들 어디 있어?" });
    expect(await pollFor(() => teacher.chats.length === 1 && hall.chats.length === 1)).toBe(true);
    expect(teacher.chats[0]).toEqual({ sid: hall.sid, name: "하늘", text: "다들 어디 있어?" });
    await flush();
    expect(a.chats).toEqual([]);
    expect(b.chats).toEqual([]);
    expect(ia.chats.map((m) => m.text)).toEqual(["서랍 먼저 열어 보자"]); // only the team line, in the room
    expect(ib.chats).toHaveLength(1);
    // A member inside cannot talk in the hall through the class connection either.
    await sendTo(room, a.client, MessageType.Chat, { text: "여기 교실 안이야" });
    expect(hall.chats).toHaveLength(1);
    expect(teacher.chats).toHaveLength(1);
    // A blocked hall line: the teacher sees it masked under "중앙 홀", nobody else hears it.
    await sendTo(room, hall.client, MessageType.Chat, { text: "너 진짜 시발 왜 그래" });
    expect(await pollFor(() => teacher.mirrors.length === 3)).toBe(true);
    expect(teacher.mirrors[2]).toMatchObject({ teamId: "", teamName: "중앙 홀", name: "하늘", text: "너 진짜 ●● 왜 그래", filtered: true });
    expect(hall.chats).toHaveLength(1);
    expect(hall.mirrors).toEqual([]);
  });

  it("ResultsRequest: teacher gets the CSV, a student gets nothing", async () => {
    const room = await openClass("RS2ULT");
    const teacher = await teacherOf(room);
    const student = await join(room, "가람");

    // Results as the instances report them: the last one per (team, room) counts.
    room.escapeResult(result({ escaped: false, wrongAttempts: 9 }));
    room.escapeResult(result({ teamId: "team-2", teamName: BALLOON.name, members: ["=1+2", "세온"] }));
    room.escapeResult(result({ escaped: true, stars: 3, wrongAttempts: 1, firstTry: { privacy: true } }));

    await sendTo(room, student.client, ClassMsg.ResultsRequest, {});
    await sendTo(room, teacher.client, ClassMsg.ResultsRequest, {});
    expect(await pollFor(() => teacher.csvs.length === 1)).toBe(true);
    await flush();
    expect(student.csvs).toEqual([]);
    const csv = teacher.csvs[0];
    expect(csv.startsWith("\uFEFF팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별,프라이버시 보호 첫 시도\r\n")).toBe(true);
    expect(csv.split("\r\n").slice(1, -1)).toEqual([
      "햇살(파랑),가람·다온,상담실,탈출,300,600,1,1,3,정답",
      "풍선(빨강),'=1+2·세온,상담실,미탈출,300,600,1,2,0,-",
    ]);
    // Nicknames only: no session id of anyone in the class.
    for (const k of [teacher, student]) expect(csv).not.toContain(k.sid);
    // The escaped report lit the room and told the class, even with no such team in the hall.
    expect([...room.state.litRooms]).toEqual(["counsel"]);
    expect(await pollFor(() => student.systems.includes("햇살(파랑) 팀이 상담실을 탈출했어요!"))).toBe(true);
  });

  it("kicking a member inside an instance removes them from both rooms", async () => {
    const { room, teacher, kids, team } = await classWithTeam("KX2KCK");
    const [a, b] = kids;
    const roomId = await padAndEnter(room, [a, b]);
    const ia = await goIn(a.tickets[0]);
    const ib = await goIn(b.tickets[0]);
    const esc = escapeRoomById(roomId);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE)).toBe(true);

    await sendTo(room, teacher.client, MessageType.Kick, { sid: a.sid });
    expect(await pollFor(() => a.closed.length === 1 && ia.closed.length === 1)).toBe(true);
    expect(a.closed).toEqual([KICK_CLOSE_CODE]);
    expect(ia.closed).toEqual([KICK_CLOSE_CODE]);
    expect(await pollFor(() => !esc.state.players.has(ia.sid) && !room.state.players.has(a.sid))).toBe(true);
    // The teammate stays inside; the team goes on without the kicked member.
    expect([...team.members]).toEqual([b.sid]);
    expect(esc.state.players.has(ib.sid)).toBe(true);
    expect(playerOf(room, b).place).toBe(PLACE_ESCAPE);
    expect(ib.closed).toEqual([]);
    // No way back: not into the class, so no ticket either.
    expect(await refusal(connectClass(room, "가람"))).toBe(KICKED);
  });

  it("a member inside cannot walk in the hub: class moves are dropped until they come back", async () => {
    const { room, kids } = await classWithTeam("MV2WLK");
    const [a, b] = kids;
    await padAndEnter(room, [a, b]);
    await goIn(a.tickets[0]);
    expect(await pollFor(() => playerOf(room, a).place === PLACE_ESCAPE)).toBe(true);
    const at = { x: playerOf(room, a).x, z: playerOf(room, a).z };
    trackingOf(room).get(a.sid)!.lastAcceptedAt = Date.now() - 200;
    await sendTo(room, a.client, MessageType.Move, { x: at.x, z: at.z + 0.6, yaw: 0 });
    expect([playerOf(room, a).x, playerOf(room, a).z]).toEqual([at.x, at.z]);
    expect(trackingOf(room).get(a.sid)!.padDoor).toBe("counsel");
  });
});

describe("callbacks from the classrooms", () => {
  it("a missing team or member is ignored; escapeDisposed from an older instance is ignored", async () => {
    const { room, kids, team } = await classWithTeam("CB2ACK");
    const [a] = kids;
    // Unknown team / member: nothing happens, nothing throws.
    room.escapeMemberEntered("team-404", "가람");
    room.escapeMemberEntered(team.id, "누구");
    room.escapeMemberLeft("team-404", "가람");
    room.escapeDisposed("team-404", "x");
    room.escapeChat({ teamId: "team-404", teamName: "?", name: "?", text: "?", filtered: false, at: 0 });
    expect(playerOf(room, a).place).toBe(PLACE_HUB);

    // A stale disposal (an older instance of the same team) leaves the current one alone.
    team.escapeRoomId = "current";
    team.escapeDoor = "counsel";
    room.escapeMemberEntered(team.id, "가람");
    expect(playerOf(room, a).place).toBe(PLACE_ESCAPE);
    room.escapeDisposed(team.id, "older");
    expect(team.escapeRoomId).toBe("current");
    expect(playerOf(room, a).place).toBe(PLACE_ESCAPE);
    // The current one: the team is free, and a member still marked inside comes back to the door.
    room.escapeDisposed(team.id, "current");
    expect(team.escapeRoomId).toBe("");
    expect(playerOf(room, a).place).toBe(PLACE_HUB);
    expect(doorAtPad(playerOf(room, a).x, playerOf(room, a).z)).toBe("counsel");

    // The team's last member leaves the class: later reports about it change nothing.
    for (const k of kids) await k.client.leave(true);
    expect(await pollFor(() => !room.state.teams.has(team.id))).toBe(true);
    room.escapeMemberLeft(team.id, "가람");
    room.escapeDisposed(team.id, "current");
    room.escapeResult(result({ teamId: team.id, escaped: true, stars: 2 }));
    expect([...room.state.litRooms]).toEqual(["counsel"]);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { ROLE_STUDENT } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { ESCAPE_INTRO_MS, ESCAPE_ROOM, ESCAPE_TIME_LIMIT_S, HINT_GAP_MS } from "@caysonverse/shared/escape/constants";
import { EscapeMsg, type EscapeEventPayload } from "@caysonverse/shared/escape/messages";
import { rooms } from "../rooms";
import { SPAWN_TOKEN } from "../rooms/spawnToken";
import { createBanditAi } from "./banditAi";
import { counsel } from "./rooms/counsel";
import { EscapeRoom, type ClassCallback, type EscapeCreateOptions } from "./EscapeRoom";

/**
 * The 반딧 hint polish inside EscapeRoom (escape phase 1, Task 12). Its own boot, on its own port
 * (ruling E1: 2568 WorldRoom, 2569 ClassRoom, 2570 EscapeRoom, 2571 link test, 2572 PlayerRoom,
 * 2573 this file). The model is always a fake fetch; the real API is never called.
 */
const PORT = 2573;

const BASE: Omit<EscapeCreateOptions, "spawnToken"> = {
  classRoomId: "test",
  teamId: "team-1",
  teamName: "햇살(파랑)",
  roomDefId: "counsel",
  textLevel: "easy",
  timeLimitS: ESCAPE_TIME_LIMIT_S,
  maxHintTier: 3,
};

/** The first step's hints, as authored (the team starts at the "uv" step). */
const HINTS = counsel.stages[0].hints;
const POLISHED = "쪽지에 눈에 안 보이는 글씨가 숨어 있대요. 빛을 바꿔 비춰 볼까요?";
const POLISHED_2 = "두 가지 도구를 가방에서 합쳐 보면 어떨까요?";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollFor<T>(read: () => T, timeoutMs = 2000, stepMs = 20): Promise<T> {
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type ReportFn = (method: ClassCallback, args: unknown[]) => Promise<void>;
type ReportSpy = MockInstance<ReportFn>;

/** What ClassRoom does: create the team's instance with the spawn token. `report` is spied. */
async function openEscape(): Promise<{ room: EscapeRoom; reports: ReportSpy }> {
  const room = await colyseus.createRoom<EscapeRoom>(ESCAPE_ROOM, { spawnToken: SPAWN_TOKEN, ...BASE });
  const reports = vi.spyOn(room as unknown as { report: ReportFn }, "report").mockResolvedValue(undefined);
  return { room, reports };
}

/** White-box: whether the room holds a polish step. */
const hasBandit = (room: EscapeRoom) => (room as unknown as { bandit: unknown }).bandit !== null;

interface Member {
  sid: string;
  send(type: string, payload?: unknown): void;
  events: EscapeEventPayload[];
}

let ticketSeq = 0;
/** One student comes in and the intro is skipped: the room is in play. */
async function startPlaying(room: EscapeRoom): Promise<Member> {
  const ticket = `bandit-ticket-${++ticketSeq}-0123456789abcdef`;
  room.admit({ ticket, memberKey: "가람", nickname: "가람", role: ROLE_STUDENT, appearance: { ...DEFAULT_APPEARANCE } });
  const client = await colyseus.connectTo(room, { ticket });
  const events: EscapeEventPayload[] = [];
  client.onMessage(EscapeMsg.Event, (m: EscapeEventPayload) => events.push(m));
  client.onMessage(EscapeMsg.Content, () => {}); // (the SDK warns about a message type nobody listens to)
  client.onMessage(EscapeMsg.Notice, () => {});
  await sleep(60);
  room.debugAdvance(ESCAPE_INTRO_MS);
  expect(room.state.phase).toBe("play");
  return { sid: client.sessionId, send: (t, p) => client.send(t, p), events };
}

/** A hint request, handled by the room (the answer to it may still be on its way). */
async function askHint(room: EscapeRoom, m: Member): Promise<void> {
  const handled = room.waitForNextMessage();
  m.send(EscapeMsg.HintRequest, {});
  await handled;
}

const hintEvents = (m: Member) => m.events.filter((e): e is Extract<EscapeEventPayload, { e: "hint" }> => e.e === "hint");

/** A fake Groq that answers 200 with each of `answers` in turn (the last one repeats). */
function fakeGroq(...answers: string[]): typeof fetch {
  let n = 0;
  return vi.fn(async () => {
    const content = answers[Math.min(n++, answers.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}

/** A fake Groq whose Nth answer is held back until the test lets it go. */
function heldGroq(answers: string[], hold: ReadonlySet<number>) {
  const releases = new Map<number, () => void>();
  let n = 0;
  const fetch = vi.fn((): Promise<Response> => {
    const at = n++;
    const content = answers[Math.min(at, answers.length - 1)];
    const reply = () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    if (!hold.has(at)) return Promise.resolve(reply());
    return new Promise<Response>((resolve) => releases.set(at, () => resolve(reply())));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, release: (at: number) => releases.get(at)?.() };
}

const install = (room: EscapeRoom, f: typeof fetch, timeoutMs = 5000) =>
  room.debugUseBanditAi(createBanditAi({ BANDIT_AI: "1", GROQ_API_KEY: "fake-key" }, f, timeoutMs));

describe("EscapeRoom with the 반딧 hint polish", () => {
  it("is off by default: the authored hint, word for word, in the state and the event", async () => {
    vi.stubEnv("BANDIT_AI", "");
    vi.stubEnv("GROQ_API_KEY", "fake-key");
    const { room } = await openEscape();
    expect(hasBandit(room)).toBe(false); // a key alone does not turn it on
    const garam = await startPlaying(room);

    await askHint(room, garam);
    expect([...room.state.hints]).toEqual([HINTS[0]]); // synchronously, with the request
    await room.waitForNextPatch();
    await pollFor(() => hintEvents(garam).length);
    expect(hintEvents(garam)).toEqual([{ e: "hint", stageId: "uv", tier: 1, text: HINTS[0] }]);
  });

  it("is off with BANDIT_AI=1 but no key, and on with both (read when the room opens)", async () => {
    vi.stubEnv("BANDIT_AI", "1");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(hasBandit((await openEscape()).room)).toBe(false);
    vi.stubEnv("GROQ_API_KEY", "fake-key");
    expect(hasBandit((await openEscape()).room)).toBe(true);
  });

  it("sends the polished sentence to the whole team, and keeps it in the state for late joiners", async () => {
    const { room } = await openEscape();
    const fetch = fakeGroq(POLISHED);
    install(room, fetch);
    const garam = await startPlaying(room);

    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length)).toBe(1);
    expect([...room.state.hints]).toEqual([POLISHED]);
    await pollFor(() => hintEvents(garam).length);
    expect(hintEvents(garam)).toEqual([{ e: "hint", stageId: "uv", tier: 1, text: POLISHED }]);
    expect(room.state.hintsUsed).toBe(1);

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[1]).toEqual({ role: "user", content: HINTS[0] }); // only the authored hint goes out
    expect(JSON.stringify(body)).not.toContain("4719");
  });

  it("falls back to the authored hint when the model leaks the answer or a later hint", async () => {
    const { room } = await openEscape();
    install(room, fakeGroq("정답은 4719야!", counsel.stages[0].hints[2]));
    const garam = await startPlaying(room);

    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length)).toBe(1);
    expect([...room.state.hints]).toEqual([HINTS[0]]);

    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length > 1)).toBe(true);
    expect([...room.state.hints]).toEqual([HINTS[0], HINTS[1]]); // the model copied tier 3: refused
    await pollFor(() => hintEvents(garam).length > 1);
    expect(hintEvents(garam).map((e) => e.text)).toEqual([HINTS[0], HINTS[1]]);
  });

  it("falls back to the authored hint when the polish step throws or rejects, and logs nothing (final fix B5)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { room } = await openEscape();
    // A polish step that throws before it returns a promise…
    room.debugUseBanditAi({
      rephrase: () => {
        throw new Error("boom");
      },
    });
    const garam = await startPlaying(room);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length)).toBe(1);
    expect([...room.state.hints]).toEqual([HINTS[0]]);
    expect(await pollFor(() => hintEvents(garam).length)).toBe(1);
    expect(hintEvents(garam)).toEqual([{ e: "hint", stageId: "uv", tier: 1, text: HINTS[0] }]);

    // …and one whose promise rejects: the team still gets the hint the engine counted, as authored.
    room.debugUseBanditAi({ rephrase: () => Promise.reject(new Error("model down")) });
    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length > 1)).toBe(true);
    expect([...room.state.hints]).toEqual([HINTS[0], HINTS[1]]);
    expect(await pollFor(() => hintEvents(garam).length > 1)).toBe(true);
    expect(hintEvents(garam).map((e) => e.text)).toEqual([HINTS[0], HINTS[1]]);
    expect(room.state.hintsUsed).toBe(2);

    // A good answer after them still goes out (the chain was not broken).
    install(room, fakeGroq(POLISHED_2));
    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length > 2)).toBe(true);
    expect([...room.state.hints]).toEqual([HINTS[0], HINTS[1], POLISHED_2]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not hold up the room while the model thinks: the hint is counted and the next request answered at once", async () => {
    const { room } = await openEscape();
    const held = heldGroq([POLISHED], new Set([0]));
    install(room, held.fetch);
    const garam = await startPlaying(room);

    await askHint(room, garam);
    expect(room.state.hintsUsed).toBe(1); // the engine already spent it...
    expect(room.state.hints.length).toBe(0); // ...the sentence is still on its way

    await askHint(room, garam); // a second request meanwhile: told to wait, not queued behind the model
    expect(await pollFor(() => garam.events.some((e) => e.e === "hintWait"))).toBe(true);
    expect(room.state.hintsUsed).toBe(1);
    expect(hintEvents(garam)).toEqual([]);

    held.release(0);
    expect(await pollFor(() => room.state.hints.length)).toBe(1);
    expect([...room.state.hints]).toEqual([POLISHED]);
    expect(await pollFor(() => hintEvents(garam).length)).toBe(1);
  });

  it("gives the authored hint after the timeout when the model hangs, not much later", async () => {
    const { room } = await openEscape();
    const hangs = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    install(room, hangs, 200);
    const garam = await startPlaying(room);

    const asked = Date.now();
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length, 3000)).toBe(1);
    const waited = Date.now() - asked;
    expect([...room.state.hints]).toEqual([HINTS[0]]);
    expect(waited).toBeGreaterThanOrEqual(150);
    expect(waited).toBeLessThan(1500);
    expect(await pollFor(() => hintEvents(garam).length)).toBe(1);
  });

  it("keeps the hints in the order they were asked, even when the first answer is slower", async () => {
    const { room } = await openEscape();
    const held = heldGroq([POLISHED, POLISHED_2], new Set([0]));
    install(room, held.fetch);
    const garam = await startPlaying(room);

    await askHint(room, garam); // hint 1: its answer is held back
    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam); // hint 2: its answer is ready at once
    expect(room.state.hintsUsed).toBe(2);
    await sleep(150);
    expect(room.state.hints.length).toBe(0); // hint 2 waits for hint 1 (both within one timeout of their asking)

    held.release(0);
    expect(await pollFor(() => room.state.hints.length > 1)).toBe(true);
    expect([...room.state.hints]).toEqual([POLISHED, POLISHED_2]);
    expect(await pollFor(() => hintEvents(garam).length > 1)).toBe(true);
    expect(hintEvents(garam).map((e) => [e.tier, e.text])).toEqual([
      [1, POLISHED],
      [2, POLISHED_2],
    ]);
  });

  it("drops a late answer quietly when the room has closed meanwhile", async () => {
    const { room } = await openEscape();
    const held = heldGroq([POLISHED], new Set([0]));
    install(room, held.fetch);
    const garam = await startPlaying(room);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await askHint(room, garam);
    await room.disconnect();
    held.release(0);
    await sleep(150);

    expect(room.state.hints.length).toBe(0);
    expect(errors).not.toHaveBeenCalled(); // (an unhandled rejection would fail the run on its own)
  });

  it("logs nothing while it polishes, falls back or times out", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { room } = await openEscape();
    install(room, fakeGroq(POLISHED, "정답은 4719야!"), 200);
    const garam = await startPlaying(room);

    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length)).toBe(1);
    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length > 1)).toBe(true);

    const hangs = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    install(room, hangs, 100);
    room.debugAdvance(HINT_GAP_MS);
    await askHint(room, garam);
    expect(await pollFor(() => room.state.hints.length > 2)).toBe(true);

    expect([...room.state.hints]).toEqual([POLISHED, HINTS[1], HINTS[2]]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * classSync against a fake class room: the state is plain Maps / Arrays (what the sync reads
 * through get / forEach / size / length), patches are fired by hand, and the connection layer
 * (joinEscape / leaveEscape) and the browser save (downloadCsv) are mocked.
 */

const h = vi.hoisted(() => ({
  joinEscape: vi.fn(),
  leaveEscape: vi.fn(async () => undefined),
  downloadCsv: vi.fn(),
}));

vi.mock("./connection", () => ({ joinEscape: h.joinEscape, leaveEscape: h.leaveEscape }));
vi.mock("./download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./download")>()),
  downloadCsv: h.downloadCsv,
}));

import { PLACE_ESCAPE, PLACE_HUB } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { bindClassSync, startClassSync, takeHubSnap, unbindClassSync } from "./classSync";
import { resultsFilename } from "./download";
import { useClassStore } from "../stores/classStore";
import { useAppStore } from "../stores/appStore";
import { useEnterTransition } from "../escape/enterTransition";

interface P {
  nickname: string;
  place: number;
  teamId: string;
  x: number;
  z: number;
  yaw: number;
}

function fakeClassRoom(sid = "me") {
  const players = new Map<string, P>([
    [sid, { nickname: "나래", place: PLACE_HUB, teamId: "team-1", x: 1, z: 2, yaw: 0 }],
    ["s2", { nickname: "가람", place: PLACE_HUB, teamId: "team-1", x: 5, z: 5, yaw: 0 }],
  ]);
  const teams = new Map([
    [
      "team-1",
      {
        id: "team-1",
        nameIndex: 0,
        colorIndex: 5,
        members: [sid, "s2"],
        escapeRoomId: "",
        escapeDoor: "",
        escaped: [] as string[],
        stars: new Map<string, number>(),
        padDoor: "",
        padLeaderSid: "",
        padCount: 0,
      },
    ],
  ]);
  const state = {
    classCode: "AB2CDE",
    phase: "lobby",
    textLevel: "easy",
    players,
    teams,
    openRooms: ["counsel"],
    litRooms: [] as string[],
  };
  const patchCbs = new Set<() => void>();
  const handlers = new Map<string, (p: unknown) => void>();
  const room = {
    sessionId: sid,
    state,
    onStateChange: Object.assign((cb: () => void) => void patchCbs.add(cb), {
      remove: (cb: () => void) => void patchCbs.delete(cb),
    }),
    onMessage: (type: string, cb: (p: unknown) => void) => {
      handlers.set(type, cb);
      return () => void handlers.delete(type);
    },
  };
  return {
    room,
    state,
    patch: () => patchCbs.forEach((cb) => cb()),
    send: (type: string, payload: unknown) => handlers.get(type)?.(payload),
    listening: () => handlers.size + patchCbs.size,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  unbindClassSync();
  h.joinEscape.mockReset();
  h.leaveEscape.mockClear();
  h.downloadCsv.mockReset();
  useAppStore.setState({ screen: "hub", escapeEpoch: 0, escapeReconnecting: false, mainReconnecting: false });
  useAppStore.getState().enterHub({ nickname: "나래", appearance: DEFAULT_APPEARANCE, sessionId: "me" });
});

describe("startClassSync — state", () => {
  it("copies the class into the store at once, then only when something discrete changed", () => {
    const f = fakeClassRoom();
    let writes = 0;
    const unsub = useClassStore.subscribe(() => writes++);
    const stop = startClassSync(f.room as never);
    expect(useClassStore.getState().teams.map((t) => t.name)).toEqual(["햇살(파랑)"]);
    expect(useClassStore.getState().teams[0].mine).toBe(true);
    expect(writes).toBe(1);

    // Players walking: patches arrive, the store is not touched.
    for (let i = 0; i < 10; i++) {
      f.state.players.get("s2")!.x += 0.5;
      f.patch();
    }
    expect(writes).toBe(1);

    // The phase changes → one write.
    f.state.phase = "running";
    f.patch();
    expect(writes).toBe(2);
    expect(useClassStore.getState().phase).toBe("running");
    unsub();
    stop();
  });

  it("diffs arrays whole: a clear() + push() rewrite of members / litRooms is picked up", () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    const members = f.state.teams.get("team-1")!.members;
    // The server rewrites the member list in place (clear + push), same length, other sids.
    f.state.players.set("s3", { nickname: "세온", place: PLACE_ESCAPE, teamId: "team-1", x: 0, z: 0, yaw: 0 });
    members.length = 0;
    members.push("me", "s3");
    f.state.litRooms.push("counsel");
    f.patch();
    const row = useClassStore.getState().teams[0];
    expect(row.members.map((m) => [m.nickname, m.inEscape])).toEqual([
      ["나래", false],
      ["세온", true],
    ]);
    expect(useClassStore.getState().litRooms).toEqual(["counsel"]);
    stop();
  });

  it("place 1 → 0 (back from a classroom): the hall snaps to the server's position once", () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    const pose = { x: 0, z: 0, yaw: 0 };
    expect(takeHubSnap(pose)).toBe(false);

    const me = f.state.players.get("me")!;
    me.place = PLACE_ESCAPE;
    f.patch();
    expect(takeHubSnap(pose)).toBe(false); // going IN is not a snap

    me.place = PLACE_HUB;
    me.x = 30;
    me.z = -4;
    me.yaw = 1.5;
    f.patch();
    expect(takeHubSnap(pose)).toBe(true);
    expect(pose).toEqual({ x: 30, z: -4, yaw: 1.5 });
    expect(takeHubSnap(pose)).toBe(false); // once
    stop();
  });
});

describe("startClassSync — messages", () => {
  it("Notice → toast; TeamChatMirror → the teacher's mirror; ResultsCsv → the browser save", () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    f.send(ClassMsg.Notice, { text: "팀원이 2명 이상 모여야 해요" });
    expect(useClassStore.getState().toast?.text).toBe("팀원이 2명 이상 모여야 해요");

    const line = { teamId: "team-1", teamName: "햇살(파랑)", name: "가람", text: "여기 서랍!", filtered: false, at: 1 };
    f.send(ClassMsg.TeamChatMirror, line);
    expect(useClassStore.getState().mirror["team-1"]).toEqual([line]);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 31, 14, 5));
      f.send(ClassMsg.ResultsCsv, { csv: "팀,교실\n" });
      expect(h.downloadCsv).toHaveBeenCalledWith(resultsFilename("AB2CDE", new Date(2026, 9, 31, 14, 5)), "팀,교실\n");
      expect(h.downloadCsv.mock.calls[0][0]).toBe("AI학교탈출_AB2CDE_20261031-1405.csv");
    } finally {
      vi.useRealTimers();
    }
    // Malformed payloads change nothing.
    f.send(ClassMsg.ResultsCsv, {});
    f.send(ClassMsg.Notice, {});
    expect(h.downloadCsv).toHaveBeenCalledTimes(1);
    stop();
  });

  it("the end-of-class CSV the server pushes is saved by itself, once, as …_최종.csv (final review I1)", () => {
    h.downloadCsv.mockClear();
    const f = fakeClassRoom();
    f.room.state.classCode = "FN2LCS";
    const stop = startClassSync(f.room as never);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 2, 10, 40));
      // A copy the teacher asked for during the lesson: the usual name.
      f.send(ClassMsg.ResultsCsv, { csv: "팀,교실,중간" });
      // The end: the final copy, with every team — a second, more complete file named 최종.
      f.send(ClassMsg.ResultsCsv, { csv: "팀,교실,최종", final: true });
      // A repeat of the final copy (another binding, a resend) is not saved again.
      f.send(ClassMsg.ResultsCsv, { csv: "팀,교실,최종", final: true });
    } finally {
      vi.useRealTimers();
    }
    expect(h.downloadCsv.mock.calls).toEqual([
      ["AI학교탈출_FN2LCS_20261102-1040.csv", "팀,교실,중간"],
      ["AI학교탈출_FN2LCS_20261102-1040_최종.csv", "팀,교실,최종"],
    ]);
    stop();
  });

  it("EscapeTicket → joinEscape(roomId, ticket) → the classroom screen", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockResolvedValueOnce({});
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    expect(h.joinEscape).toHaveBeenCalledWith("esc-1", "t".repeat(24));
    expect(useAppStore.getState().screen).toBe("escape");
    expect(useAppStore.getState().escapeEpoch).toBe(1);
    stop();
  });

  it("a refused ticket shows the reason in the hall; a ticket after leaving the class is undone", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockRejectedValueOnce(new Error("입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요."));
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    expect(useAppStore.getState().screen).toBe("hub");
    expect(useClassStore.getState().toast?.text).toBe("입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요.");

    h.joinEscape.mockResolvedValueOnce({});
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "u".repeat(24) });
    useAppStore.getState().leaveToEntry("수업이 끝났어요. 함께해 줘서 고마워요!");
    await flush();
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().screen).toBe("entry");

    f.send(ClassMsg.EscapeTicket, { roomId: 5 }); // malformed: ignored
    await flush();
    expect(h.joinEscape).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("bindClassSync / unbindClassSync", () => {
  it("one binding per class connection; a reconnect's room replaces it and keeps the mirror; unbind forgets", () => {
    const a = fakeClassRoom();
    const b = fakeClassRoom();
    bindClassSync(a.room as never);
    bindClassSync(a.room as never); // same room: no second set of handlers
    expect(a.listening()).toBe(5); // 4 messages + the patch listener
    a.send(ClassMsg.TeamChatMirror, { teamId: "", teamName: "중앙 홀", name: "가람", text: "●●", filtered: true, at: 1 });

    bindClassSync(b.room as never);
    expect(a.listening()).toBe(0);
    expect(b.listening()).toBe(5);
    expect(useClassStore.getState().mirror[""]).toHaveLength(1); // the teacher's mirror survives a reconnect

    unbindClassSync();
    expect(b.listening()).toBe(0);
    expect(useClassStore.getState().mirror).toEqual({});
    expect(useClassStore.getState().teams).toEqual([]);
  });
});

describe("the entering card (Task 17)", () => {
  beforeEach(() => {
    useEnterTransition.getState().end();
  });

  it("a ticket raises the card named after the room, and a joined classroom marks it ready", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    let release: (v: unknown) => void = () => undefined;
    h.joinEscape.mockReturnValueOnce(new Promise((r) => (release = r)));
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    // The join is still running: the card is up, in the hall, named after the one open room.
    expect(useEnterTransition.getState()).toMatchObject({ phase: "joining", label: "상담실로 들어가는 중…" });
    expect(useAppStore.getState().screen).toBe("hub");
    release({});
    await flush();
    expect(useAppStore.getState().screen).toBe("escape");
    expect(useEnterTransition.getState().phase).toBe("ready");
    stop();
  });

  it("names the room by the team's door pad when several rooms are open", async () => {
    const f = fakeClassRoom();
    f.state.openRooms = ["counsel", "library"];
    f.state.teams.get("team-1")!.padDoor = "library";
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockResolvedValueOnce({});
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    expect(useEnterTransition.getState().label).toBe("도서관으로 들어가는 중…");
    stop();
  });

  it("says 교실 when no room can be told", async () => {
    const f = fakeClassRoom();
    f.state.openRooms = ["counsel", "library"];
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockResolvedValueOnce({});
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    expect(useEnterTransition.getState().label).toBe("교실로 들어가는 중…");
    stop();
  });

  it("a refused ticket drops the card at once", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockRejectedValueOnce(new Error("입장권이 만료됐어요. 문 앞에서 다시 들어가 주세요."));
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "t".repeat(24) });
    await flush();
    expect(useEnterTransition.getState().phase).toBe("idle");
    expect(useAppStore.getState().screen).toBe("hub");
    stop();
  });

  it("a ticket that lands after the class was left drops the card and the classroom", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    h.joinEscape.mockResolvedValueOnce({});
    f.send(ClassMsg.EscapeTicket, { roomId: "esc-1", ticket: "u".repeat(24) });
    useAppStore.getState().leaveToEntry("수업이 끝났어요. 함께해 줘서 고마워요!");
    await flush();
    expect(useEnterTransition.getState().phase).toBe("idle");
    expect(h.leaveEscape).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a malformed ticket raises no card", async () => {
    const f = fakeClassRoom();
    const stop = startClassSync(f.room as never);
    f.send(ClassMsg.EscapeTicket, { roomId: 5 });
    await flush();
    expect(useEnterTransition.getState().phase).toBe("idle");
    stop();
  });
});

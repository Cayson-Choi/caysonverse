import { describe, it, expect, beforeEach } from "vitest";
import type { EscapedEvent, RoomContent } from "@caysonverse/shared/escape/messages";
import { toEscapeView, useEscapeStore } from "./escapeStore";

// A plain stand-in for the decoded EscapeState (Map / Array for MapSchema / ArraySchema).
function escapeState() {
  return {
    players: new Map([
      ["a", { nickname: "가람", connected: true, role: 0 }],
      ["b", { nickname: "다온", connected: false, role: 0 }], // a ghost (dropped, window open)
      ["c", { nickname: "세온", connected: true, role: 0 }],
    ]),
    roomDefId: "counsel",
    teamName: "햇살(파랑)",
    textLevel: "hard",
    phase: "play",
    paused: false,
    solo: false,
    overtime: true,
    timeLeftS: 321,
    cooldownS: 4,
    flags: ["picked:flashlight", "solved:cabinet_lock"],
    bag: ["flashlight"],
    lockInput: new Map([["cover_lock", "12"]]),
    board: new Map([["card_a", "bin_1"]]),
    votes: new Map([["a", "opt_1"]]),
    finaleStep: 1,
    hintsUsed: 2,
    wrongAttempts: 3,
    hints: ["서랍을 먼저 열어 봐요"],
  };
}

describe("toEscapeView", () => {
  it("toEscapeView copies schema collections into plain arrays/records", () => {
    const state = escapeState();
    const view = toEscapeView(state as never);
    expect(view).toEqual({
      phase: "play",
      paused: false,
      solo: false,
      overtime: true,
      timeLeftS: 321,
      cooldownS: 4,
      flags: ["picked:flashlight", "solved:cabinet_lock"],
      bag: ["flashlight"],
      lockInput: { cover_lock: "12" },
      board: { card_a: "bin_1" },
      votes: { a: "opt_1" },
      finaleStep: 1,
      hintsUsed: 2,
      wrongAttempts: 3,
      hints: ["서랍을 먼저 열어 봐요"],
      // Connected players only, in arrival order (a ghost is not "here").
      members: [
        { sid: "a", nickname: "가람" },
        { sid: "c", nickname: "세온" },
      ],
      teamName: "햇살(파랑)",
      roomDefId: "counsel",
      textLevel: "hard",
    });
    // Plain copies: a later change of the schema collections does not reach the view.
    state.flags.push("escaped");
    state.lockInput.set("cover_lock", "99");
    expect(view.flags).toHaveLength(2);
    expect(view.lockInput.cover_lock).toBe("12");
    expect(Array.isArray(view.bag)).toBe(true);
    expect(Object.getPrototypeOf(view.votes)).toBe(Object.prototype);
  });

  it("an unknown room or reading level never leaks through", () => {
    const view = toEscapeView({ ...escapeState(), roomDefId: "", textLevel: "weird" } as never);
    expect(view.roomDefId).toBeNull();
    expect(view.textLevel).toBe("easy");
  });
});

describe("useEscapeStore", () => {
  beforeEach(() => useEscapeStore.getState().reset());

  const content = { roomId: "counsel", title: "상담실" } as unknown as RoomContent;
  const escaped: EscapedEvent = {
    e: "escaped",
    lines: [{ speaker: "ari", text: "해냈어요!" }],
    stars: 3,
    elapsedS: 600,
    summary: { lines: ["정리"], question: "질문", source: "출처" },
  };

  it("events: each one is the new lastEvent with a new sequence number; the escape is kept as summary", () => {
    const store = useEscapeStore.getState();
    store.pushEvent({ e: "wrong", lockId: "cover_lock", wrongCount: 1 });
    const seq1 = useEscapeStore.getState().eventSeq;
    store.pushEvent({ e: "wrong", lockId: "cover_lock", wrongCount: 1 });
    expect(useEscapeStore.getState().eventSeq).toBe(seq1 + 1);
    expect(useEscapeStore.getState().summary).toBeNull();
    store.pushEvent(escaped);
    expect(useEscapeStore.getState().lastEvent).toEqual(escaped);
    expect(useEscapeStore.getState().summary).toEqual(escaped);
  });

  it("content, inspect view and toast are set and cleared; reset forgets the room", () => {
    const store = useEscapeStore.getState();
    store.setContent(content);
    store.setInspect({ objectId: "drawer", title: "서랍", body: "..." });
    store.showToast("너무 멀어요");
    expect(useEscapeStore.getState().content).toBe(content);
    expect(useEscapeStore.getState().inspect?.objectId).toBe("drawer");
    const toast = useEscapeStore.getState().toast!;
    store.clearToast(toast.id);
    expect(useEscapeStore.getState().toast).toBeNull();
    store.setInspect(null);
    expect(useEscapeStore.getState().inspect).toBeNull();
    store.setView(toEscapeView(escapeState() as never));
    store.pushEvent(escaped);
    store.reset();
    const s = useEscapeStore.getState();
    expect([s.view, s.content, s.inspect, s.lastEvent, s.summary, s.toast]).toEqual([null, null, null, null, null, null]);
  });
});

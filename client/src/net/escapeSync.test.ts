import { describe, it, expect, beforeEach } from "vitest";
import { EscapeMsg, type EscapedEvent } from "@caysonverse/shared/escape/messages";
import { bindEscapeSync, startEscapeSync, unbindEscapeSync } from "./escapeSync";
import { useEscapeStore } from "../stores/escapeStore";

/** A fake classroom room: plain Maps / Arrays for the schema collections, patches fired by hand. */
function fakeEscapeRoom() {
  const state = {
    players: new Map([
      ["a", { nickname: "가람", connected: true, role: 0, x: 0, z: 0 }],
      ["b", { nickname: "다온", connected: true, role: 0, x: 1, z: 1 }],
    ]),
    roomDefId: "counsel",
    teamName: "햇살(파랑)",
    textLevel: "easy",
    phase: "intro",
    paused: false,
    solo: false,
    overtime: false,
    timeLeftS: 900,
    cooldownS: 0,
    flags: [] as string[],
    bag: [] as string[],
    lockInput: new Map<string, string>(),
    board: new Map<string, string>(),
    votes: new Map<string, string>(),
    finaleStep: 0,
    hintsUsed: 0,
    wrongAttempts: 0,
    hints: [] as string[],
  };
  const patchCbs = new Set<() => void>();
  const handlers = new Map<string, (p: unknown) => void>();
  const room = {
    sessionId: "a",
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

beforeEach(() => {
  unbindEscapeSync();
});

describe("startEscapeSync", () => {
  it("writes the view at once and again only when a discrete field changes (a second of the timer, a flag)", () => {
    const f = fakeEscapeRoom();
    let writes = 0;
    const unsub = useEscapeStore.subscribe(() => writes++);
    const stop = startEscapeSync(f.room as never);
    expect(useEscapeStore.getState().view?.timeLeftS).toBe(900);
    expect(writes).toBe(1);

    for (let i = 0; i < 10; i++) {
      f.state.players.get("b")!.x += 0.3; // a teammate walking
      f.patch();
    }
    expect(writes).toBe(1);

    f.state.timeLeftS = 899;
    f.patch();
    f.state.flags.push("picked:flashlight");
    f.state.lockInput.set("cover_lock", "1");
    f.patch();
    expect(writes).toBe(3);
    expect(useEscapeStore.getState().view).toMatchObject({
      timeLeftS: 899,
      flags: ["picked:flashlight"],
      lockInput: { cover_lock: "1" },
    });

    // A teammate drops (ghost): the member list changes.
    f.state.players.get("b")!.connected = false;
    f.patch();
    expect(useEscapeStore.getState().view?.members).toEqual([{ sid: "a", nickname: "가람" }]);
    unsub();
    stop();
  });

  it("Content, InspectView, Event and Notice land in the store", () => {
    const f = fakeEscapeRoom();
    const stop = startEscapeSync(f.room as never);
    f.send(EscapeMsg.Content, { roomId: "counsel", title: "상담실" });
    f.send(EscapeMsg.InspectView, { objectId: "drawer", title: "서랍", body: "..." });
    f.send(EscapeMsg.Event, { e: "solved", lockId: "cover_lock", by: "a" });
    f.send(EscapeMsg.Notice, { text: "조금 더 가까이 가 보세요" });
    const s = useEscapeStore.getState();
    expect(s.content).toEqual({ roomId: "counsel", title: "상담실" });
    expect(s.inspect?.objectId).toBe("drawer");
    expect(s.lastEvent).toEqual({ e: "solved", lockId: "cover_lock", by: "a" });
    expect(s.toast?.text).toBe("조금 더 가까이 가 보세요");

    // The escape (also re-sent after a reconnect) becomes the summary.
    const escaped: EscapedEvent = {
      e: "escaped",
      lines: [{ speaker: "ari", text: "해냈어요!" }],
      stars: 3,
      elapsedS: 500,
      summary: { lines: ["정리"], question: "질문", source: "출처" },
    };
    f.send(EscapeMsg.Event, escaped);
    expect(useEscapeStore.getState().summary).toEqual(escaped);
    // Malformed events are dropped.
    const seq = useEscapeStore.getState().eventSeq;
    f.send(EscapeMsg.Event, null);
    f.send(EscapeMsg.Event, { no: "e" });
    expect(useEscapeStore.getState().eventSeq).toBe(seq);
    stop();
  });

  it("bind replaces the previous classroom binding; unbind forgets the classroom", () => {
    const a = fakeEscapeRoom();
    const b = fakeEscapeRoom();
    bindEscapeSync(a.room as never);
    a.send(EscapeMsg.Content, { roomId: "counsel", title: "상담실" });
    bindEscapeSync(b.room as never);
    expect(a.listening()).toBe(0);
    expect(b.listening()).toBe(5);
    expect(useEscapeStore.getState().content).not.toBeNull(); // carried over a reconnect (re-sent anyway)
    unbindEscapeSync();
    expect(b.listening()).toBe(0);
    expect(useEscapeStore.getState().content).toBeNull();
    expect(useEscapeStore.getState().view).toBeNull();
  });
});

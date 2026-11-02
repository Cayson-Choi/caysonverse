import { describe, it, expect } from "vitest";
import type { EscapeEventPayload, RoomContent } from "@caysonverse/shared/escape/messages";
import type { EscapePhase } from "@caysonverse/shared/escape/constants";
import { FEED_START, feedDialogue, type FeedInput } from "./dialogueFeed";

function content(): RoomContent {
  return {
    roomId: "counsel",
    title: "상담실",
    objects: [],
    items: [],
    locks: [],
    stages: [],
    lines: {
      intro_1: { speaker: "narrator", text: "축제 전날 낮, 상담실 화면이 혼자 켜졌어요." },
      intro_2: { speaker: "ari", text: "안녕! 나는 아리야." },
      bandit_uv: { speaker: "bandit", text: "자외선 손전등 완성!" },
    },
    introLines: ["intro_1", "intro_2"],
    finale: { claim: "", steps: [] },
  };
}

const say = (lineId: string): EscapeEventPayload => ({ e: "say", lineId });

function input(over: Partial<FeedInput> & { phase?: EscapePhase | null }): FeedInput {
  const { phase, ...rest } = over;
  return {
    content: content(),
    phase: phase === undefined ? "intro" : phase,
    eventSeq: 0,
    lastEvent: null,
    ...rest,
  };
}

describe("feedDialogue", () => {
  it("pushes the intro lines once, when the room starts in its intro phase", () => {
    const first = feedDialogue(FEED_START, input({}));
    expect(first.lines.map((l) => l.text)).toEqual(["축제 전날 낮, 상담실 화면이 혼자 켜졌어요.", "안녕! 나는 아리야."]);
    expect(first.lines[1]).toMatchObject({ speaker: "ari", mood: "glitch" });

    // The same state again (the clock ticked, a flag changed): nothing more.
    const again = feedDialogue(first.next, input({}));
    expect(again.lines).toEqual([]);
  });

  it("skips the intro for a player who joins or refreshes after it (play, finale, escaped, ended)", () => {
    for (const phase of ["play", "finale", "timeup", "escaped", "ended"] as const) {
      const r = feedDialogue(FEED_START, input({ phase }));
      expect(r.lines, phase).toEqual([]);
      // ...and it is spent: going back to nothing special later does not bring it back.
      expect(feedDialogue(r.next, input({ phase: "intro" })).lines, phase).toEqual([]);
    }
  });

  it("waits for both the content and the view before deciding about the intro", () => {
    const noContent = feedDialogue(FEED_START, input({ content: null }));
    expect(noContent.lines).toEqual([]);
    const noView = feedDialogue(noContent.next, input({ phase: null }));
    expect(noView.lines).toEqual([]);
    // The content and the phase arrive: still in the intro, so the lines play.
    expect(feedDialogue(noView.next, input({})).lines).toHaveLength(2);
  });

  it("queues the line a say event names, once per event", () => {
    const start = feedDialogue(FEED_START, input({ phase: "play" })).next;
    const ev = feedDialogue(start, input({ phase: "play", eventSeq: 1, lastEvent: say("bandit_uv") }));
    expect(ev.lines).toEqual([{ speaker: "bandit", text: "자외선 손전등 완성!" }].map((l) => ({ ...l })));
    // The same event seen again (a re-render) is not replayed.
    expect(feedDialogue(ev.next, input({ phase: "play", eventSeq: 1, lastEvent: say("bandit_uv") })).lines).toEqual([]);
    // A second, equal event is a new event.
    expect(feedDialogue(ev.next, input({ phase: "play", eventSeq: 2, lastEvent: say("bandit_uv") })).lines).toHaveLength(1);
  });

  it("ignores events that are not say events, and say events naming no line", () => {
    const start = feedDialogue(FEED_START, input({ phase: "play" })).next;
    const picked = feedDialogue(start, input({ phase: "play", eventSeq: 1, lastEvent: { e: "picked", item: "flashlight", by: "a" } }));
    expect(picked.lines).toEqual([]);
    const combined = feedDialogue(picked.next, input({ phase: "play", eventSeq: 2, lastEvent: { e: "combined", out: "uv_flashlight", by: "a" } }));
    expect(combined.lines).toEqual([]);
    const unknown = feedDialogue(combined.next, input({ phase: "play", eventSeq: 3, lastEvent: say("no_such_line") }));
    expect(unknown.lines).toEqual([]);
    // Each ignored event was still consumed: the counter moved on.
    expect(unknown.next.seenEvent).toBe(3);
  });

  it("an event that was already there when the scene mounted is not replayed", () => {
    const r = feedDialogue({ ...FEED_START, seenEvent: 4 }, input({ phase: "play", eventSeq: 4, lastEvent: say("bandit_uv") }));
    expect(r.lines).toEqual([]);
  });
});

describe("feedDialogue: Bandit's hints", () => {
  const hint = (text: string): EscapeEventPayload => ({ e: "hint", stageId: "uv", tier: 1, text });

  it("a hint becomes a line Bandit says, once per event", () => {
    const start = feedDialogue(FEED_START, input({ phase: "play" })).next;
    const r = feedDialogue(start, input({ phase: "play", eventSeq: 1, lastEvent: hint("손전등과 필름을 합쳐 봐요!") }));
    expect(r.lines).toEqual([{ speaker: "bandit", text: "손전등과 필름을 합쳐 봐요!" }]);
    expect(feedDialogue(r.next, input({ phase: "play", eventSeq: 1, lastEvent: hint("손전등과 필름을 합쳐 봐요!") })).lines).toEqual([]);
  });

  it("is told in the finale and in the intro too", () => {
    for (const phase of ["finale", "intro"] as const) {
      const start = feedDialogue(FEED_START, input({ phase })).next;
      const r = feedDialogue(start, input({ phase, eventSeq: 1, lastEvent: hint("생각해 봐요") }));
      expect(r.lines, phase).toHaveLength(1);
    }
  });

  it("a hint that arrives after the escape or the end of the class is not told (it is still consumed)", () => {
    for (const phase of ["escaped", "ended"] as const) {
      const start = feedDialogue(FEED_START, input({ phase })).next;
      const r = feedDialogue(start, input({ phase, eventSeq: 1, lastEvent: hint("너무 늦은 힌트") }));
      expect(r.lines, phase).toEqual([]);
      expect(r.next.seenEvent, phase).toBe(1);
    }
  });

  it("ignores an empty hint", () => {
    const start = feedDialogue(FEED_START, input({ phase: "play" })).next;
    expect(feedDialogue(start, input({ phase: "play", eventSeq: 1, lastEvent: hint("") })).lines).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import type { RoomContent } from "@caysonverse/shared/escape/messages";
import { DialogueQueue, MAX_QUEUED, introLines, lineDurationMs, sayLine, type DialogueLine } from "./dialogue";

const ari = (text: string): DialogueLine => ({ speaker: "ari", text });
const bandit = (text: string): DialogueLine => ({ speaker: "bandit", text });

describe("lineDurationMs", () => {
  it("is 90 ms a character, but never under 2500 ms", () => {
    expect(lineDurationMs("가".repeat(10))).toBe(2500);
    expect(lineDurationMs("가".repeat(27))).toBe(2500);
    expect(lineDurationMs("가".repeat(28))).toBe(2520);
    expect(lineDurationMs("가".repeat(40))).toBe(3600);
  });
});

describe("DialogueQueue", () => {
  it("DialogueQueue advances on tap and auto-advances by length", () => {
    const q = new DialogueQueue();
    const first = ari("가".repeat(10)); // 2500 ms
    const second = bandit("나".repeat(40)); // 3600 ms
    q.push([first, second]);
    expect(q.current()).toBe(first);

    // The clock starts at the first tick that sees the line.
    q.tick(1000);
    q.tick(3499);
    expect(q.current()).toBe(first);
    q.tick(3500);
    expect(q.current()).toBe(second);

    // The second line's own clock starts when it came up (3500), not at 0.
    q.tick(7099);
    expect(q.current()).toBe(second);
    q.tick(7100);
    expect(q.current()).toBeNull();

    // A tap moves on at once, and the next line then gets its full time.
    q.push([first, second]);
    q.tick(8000);
    q.advance();
    expect(q.current()).toBe(second);
    q.tick(9000);
    q.tick(9000 + 3599);
    expect(q.current()).toBe(second);
    q.tick(9000 + 3600);
    expect(q.current()).toBeNull();
  });

  it("an empty queue has no current line, and tick/advance on it do nothing", () => {
    const q = new DialogueQueue();
    expect(q.current()).toBeNull();
    q.tick(100);
    q.advance();
    expect(q.current()).toBeNull();
    expect(q.size()).toBe(0);
  });

  it("lines pushed while one is showing wait their turn, in order", () => {
    const q = new DialogueQueue();
    const a = ari("하나");
    const b = bandit("둘");
    const c = ari("셋");
    q.push([a]);
    q.tick(0);
    q.push([b, c]);
    expect(q.current()).toBe(a);
    expect(q.size()).toBe(3);
    q.advance();
    expect(q.current()).toBe(b);
    q.advance();
    expect(q.current()).toBe(c);
    q.advance();
    expect(q.current()).toBeNull();
  });

  it("clear drops the showing line and the rest", () => {
    const q = new DialogueQueue();
    q.push([ari("하나"), ari("둘")]);
    q.tick(0);
    q.clear();
    expect(q.current()).toBeNull();
    expect(q.size()).toBe(0);
    // A line pushed after a clear starts a fresh clock.
    q.push([ari("셋")]);
    q.tick(50_000);
    q.tick(52_499);
    expect(q.current()?.text).toBe("셋");
  });

  it("stamps a version on every change so a view can tell without comparing lines", () => {
    const q = new DialogueQueue();
    const v0 = q.version();
    q.push([ari("하나")]);
    const v1 = q.version();
    expect(v1).not.toBe(v0);
    q.tick(0); // a tick that changes nothing
    expect(q.version()).toBe(v1);
    q.advance();
    expect(q.version()).not.toBe(v1);
  });

  it("keeps at most MAX_QUEUED lines: a flood drops the oldest waiting ones, never the showing one", () => {
    const q = new DialogueQueue();
    const showing = ari("지금 말하는 줄");
    q.push([showing]);
    q.tick(0);
    const flood = Array.from({ length: MAX_QUEUED + 5 }, (_, i) => bandit(`줄 ${i}`));
    q.push(flood);
    expect(q.size()).toBe(MAX_QUEUED);
    expect(q.current()).toBe(showing);
    q.advance();
    // The oldest of the flood were dropped; the newest is still there.
    expect(q.current()?.text).toBe(`줄 ${flood.length - (MAX_QUEUED - 1)}`);
  });

  it("an empty push changes nothing", () => {
    const q = new DialogueQueue();
    const v = q.version();
    q.push([]);
    expect(q.version()).toBe(v);
    expect(q.current()).toBeNull();
  });
});

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
    introLines: ["intro_1", "intro_2", "intro_missing"],
    finale: { claim: "", steps: [] },
  };
}

describe("introLines / sayLine", () => {
  it("introLines resolves the intro line ids in order, with Ari on the glitch face, and skips an unknown id", () => {
    expect(introLines(content())).toEqual([
      { speaker: "narrator", text: "축제 전날 낮, 상담실 화면이 혼자 켜졌어요." },
      { speaker: "ari", text: "안녕! 나는 아리야.", mood: "glitch" },
    ]);
  });

  it("sayLine turns a say event's line id into one line, Ari with a smile; an unknown id is nothing", () => {
    expect(sayLine(content(), "bandit_uv")).toEqual({ speaker: "bandit", text: "자외선 손전등 완성!" });
    expect(sayLine(content(), "intro_2")).toEqual({ speaker: "ari", text: "안녕! 나는 아리야.", mood: "smile" });
    expect(sayLine(content(), "nope")).toBeNull();
  });

  it("a line with no text is not worth showing", () => {
    const c = content();
    c.lines.blank = { speaker: "ari", text: "" };
    expect(sayLine(c, "blank")).toBeNull();
  });
});

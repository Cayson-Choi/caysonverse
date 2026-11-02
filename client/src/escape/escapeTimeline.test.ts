import { describe, it, expect } from "vitest";
import type { StoryLine } from "@caysonverse/shared/escape/messages";
import {
  ESCAPE_DONE_MS,
  ESCAPE_FX,
  ESCAPE_LINES_AT_MS,
  EscapeClock,
  FINISH_START,
  easeInOut,
  escapeDialogue,
  escapeFxLevels,
  escapeTimeline,
  stepFinish,
} from "./escapeTimeline";

describe("escapeTimeline", () => {
  it("escapeTimeline order", () => {
    expect(escapeTimeline(600)).toMatchObject({ doorOpen: 0, lights: 0.72, showLines: false });
    expect(escapeTimeline(2700).doorOpen).toBe(1);
    expect(escapeTimeline(4200)).toMatchObject({ lights: 1, showLines: true });
  });

  it("uses the three phase lengths of ESCAPE_FX back to back: glow, door, lights, then the story", () => {
    expect(ESCAPE_FX).toEqual({ doorGlowMs: 1200, doorOpenMs: 1500, lightsMs: 1500 });
    expect(ESCAPE_LINES_AT_MS).toBe(ESCAPE_FX.doorGlowMs + ESCAPE_FX.doorOpenMs + ESCAPE_FX.lightsMs);
    // the glow is full when the door starts to move, the door is full when the lights start to rise
    expect(escapeTimeline(1200).doorGlow).toBe(1);
    expect(escapeTimeline(1199).doorOpen).toBe(0);
    expect(escapeTimeline(2699).lights).toBe(0.72);
  });

  it("runs every value linearly between its two ends", () => {
    expect(escapeTimeline(600).doorGlow).toBeCloseTo(0.5, 10);
    expect(escapeTimeline(1950).doorOpen).toBeCloseTo(0.5, 10);
    expect(escapeTimeline(3450).lights).toBeCloseTo(0.86, 10);
  });

  it("holds the ends before the escape and long after it, and survives a broken clock", () => {
    for (const t of [-500, Number.NaN]) {
      expect(escapeTimeline(t)).toEqual({ doorGlow: 0, doorOpen: 0, lights: 0.72, showLines: false, showSummary: false });
    }
    expect(escapeTimeline(ESCAPE_DONE_MS)).toMatchObject({ doorGlow: 1, doorOpen: 1, lights: 1, showLines: true });
    expect(escapeTimeline(Number.POSITIVE_INFINITY)).toMatchObject({ doorOpen: 1, lights: 1 });
  });

  it("opens the story box at 4200 ms and the summary card only once the story has been told", () => {
    expect(escapeTimeline(4199).showLines).toBe(false);
    expect(escapeTimeline(4200).showLines).toBe(true);
    expect(escapeTimeline(9000).showSummary).toBe(false);
    expect(escapeTimeline(9000, true).showSummary).toBe(true);
    // "told" counts for nothing before the story is allowed to start
    expect(escapeTimeline(1000, true).showSummary).toBe(false);
  });
});

describe("the per-frame callers' own output objects", () => {
  it("fill and return the object they are given, with the same numbers as a fresh call", () => {
    const frame = { doorGlow: 9, doorOpen: 9, lights: 9, showLines: true, showSummary: true };
    expect(escapeTimeline(1950, false, frame)).toBe(frame);
    expect(frame).toEqual(escapeTimeline(1950));
    const levels = { sun: 9, spill: 9, sparkle: 9 };
    expect(escapeFxLevels(3000, levels)).toBe(levels);
    expect(levels).toEqual(escapeFxLevels(3000));
  });
});

describe("easeInOut", () => {
  it("is 0 and 1 at the ends, 0.5 in the middle and clamps outside", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(-2)).toBe(0);
    expect(easeInOut(7)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
  });
});

describe("escapeFxLevels", () => {
  it("starts dark, bursts as the door opens and settles down afterwards", () => {
    expect(escapeFxLevels(0)).toEqual({ sun: 0, spill: 0, sparkle: 0 });
    const open = escapeFxLevels(2700);
    expect(open.sun).toBe(1);
    expect(open.spill).toBe(1);
    expect(open.sparkle).toBe(1);
    expect(escapeFxLevels(4200).sun).toBeLessThan(1);
    expect(escapeFxLevels(4200).sun).toBeGreaterThan(0.5);
  });

  it("lets the sparkles fade out after the burst and the sun dim to a soft glow, never to negative", () => {
    expect(escapeFxLevels(ESCAPE_DONE_MS).sparkle).toBe(0);
    expect(escapeFxLevels(ESCAPE_DONE_MS).sun).toBeCloseTo(0.25, 10);
    for (const t of [-1, Number.NaN, 0, 800, 5000, 7500, 9000, 100000]) {
      const l = escapeFxLevels(t);
      for (const v of [l.sun, l.spill, l.sparkle]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("escapeDialogue", () => {
  const lines: StoryLine[] = [
    { speaker: "ari", text: "아, 비밀은 주인의 것이구나." },
    { speaker: "bandit", text: "상담실이 다시 환해졌어요!" },
    { speaker: "ari", text: "고마워!" },
  ];

  it("wakes Ari on her first line and lets her smile after that; the others speak as they are", () => {
    expect(escapeDialogue(lines)).toEqual([
      { speaker: "ari", text: "아, 비밀은 주인의 것이구나.", mood: "wake" },
      { speaker: "bandit", text: "상담실이 다시 환해졌어요!" },
      { speaker: "ari", text: "고마워!", mood: "smile" },
    ]);
  });

  it("drops empty and broken lines and does not change the input", () => {
    const messy = [
      { speaker: "ari", text: "" },
      { speaker: "robot", text: "x" },
      null,
      { speaker: "narrator", text: "끝!" },
    ] as unknown as StoryLine[];
    expect(escapeDialogue(messy)).toEqual([{ speaker: "narrator", text: "끝!" }]);
    expect(escapeDialogue([])).toEqual([]);
    expect(lines[0]).toEqual({ speaker: "ari", text: "아, 비밀은 주인의 것이구나." });
  });
});

describe("EscapeClock", () => {
  it("counts from the start, reads 0 before it and after a stop", () => {
    const c = new EscapeClock();
    expect(c.running()).toBe(false);
    expect(c.elapsed(5000)).toBe(0);
    c.start(1000);
    expect(c.running()).toBe(true);
    expect(c.elapsed(1000)).toBe(0);
    expect(c.elapsed(3500)).toBe(2500);
    expect(c.elapsed(500)).toBe(0); // a clock that ran backwards is not negative
    c.stop();
    expect(c.running()).toBe(false);
    expect(c.elapsed(9000)).toBe(0);
  });

  it("can start part-way through (reduced motion and a late joiner skip the show)", () => {
    const c = new EscapeClock();
    c.start(1000, ESCAPE_LINES_AT_MS);
    expect(c.elapsed(1000)).toBe(ESCAPE_LINES_AT_MS);
    expect(escapeTimeline(c.elapsed(1000)).showLines).toBe(true);
    c.start(1000, ESCAPE_DONE_MS);
    expect(escapeTimeline(c.elapsed(1000))).toMatchObject({ doorOpen: 1, lights: 1 });
  });
});

describe("stepFinish", () => {
  it("plays the escape of a team that was playing when it came (live)", () => {
    let m = FINISH_START;
    for (const phase of ["intro", "play", "finale"] as const) {
      const r = stepFinish(m, { phase, hasSummary: false });
      expect(r.start).toBe(null);
      m = r.next;
    }
    // The state patch comes first, the event a moment later: wait for the event.
    const patch = stepFinish(m, { phase: "escaped", hasSummary: false });
    expect(patch.start).toBe(null);
    const event = stepFinish(patch.next, { phase: "escaped", hasSummary: true });
    expect(event.start).toBe("live");
  });

  it("only shows the card to a player who comes in after the escape (replay)", () => {
    const r = stepFinish(FINISH_START, { phase: "escaped", hasSummary: true });
    expect(r.start).toBe("replay");
  });

  it("starts once: the escape re-sent, or a later phase, starts nothing more", () => {
    const live = stepFinish(stepFinish(FINISH_START, { phase: "finale", hasSummary: false }).next, {
      phase: "escaped",
      hasSummary: true,
    });
    expect(live.start).toBe("live");
    expect(stepFinish(live.next, { phase: "escaped", hasSummary: true }).start).toBe(null);
    expect(stepFinish(live.next, { phase: "ended", hasSummary: true }).start).toBe(null);
  });

  it("does not take a time-up for the escape, and remembers a game seen across a time-up retry", () => {
    const t = stepFinish(FINISH_START, { phase: "timeup", hasSummary: false });
    expect(t.start).toBe(null);
    const back = stepFinish(t.next, { phase: "finale", hasSummary: false });
    const done = stepFinish(back.next, { phase: "escaped", hasSummary: true });
    expect(done.start).toBe("live");
  });

  it("waits while the view is not here (null phase) and for a stale summary without the escaped phase", () => {
    expect(stepFinish(FINISH_START, { phase: null, hasSummary: true }).start).toBe(null);
    expect(stepFinish(FINISH_START, { phase: "play", hasSummary: true }).start).toBe(null);
  });
});

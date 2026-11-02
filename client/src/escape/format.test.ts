import { describe, it, expect } from "vitest";
import type { EscapeView } from "../stores/escapeStore";
import { enteringText, escapeOverlay, formatTime, hintInsetPx, isLowTime, timeupText } from "./format";

/** An EscapeView in play, with `over` laid on top. */
function view(over: Partial<EscapeView> = {}): EscapeView {
  return {
    phase: "play",
    paused: false,
    solo: false,
    overtime: false,
    timeLeftS: 900,
    cooldownS: 0,
    flags: [],
    bag: [],
    lockInput: {},
    board: {},
    votes: {},
    finaleStep: 0,
    hintsUsed: 0,
    wrongAttempts: 0,
    hints: [],
    members: [],
    teamName: "햇살(파랑)",
    roomDefId: "counsel",
    textLevel: "easy",
    ...over,
  };
}

describe("formatTime", () => {
  it("formatTime", () => {
    expect(formatTime(900)).toBe("15:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(-3)).toBe("0:00");
  });

  it("pads the seconds, never the minutes, and rounds a fraction down", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(59.9)).toBe("0:59");
  });

  it("reads a missing or broken number as no time left", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("reads 20:00 for a 15 minute room with the 5 minute retry on top", () => {
    expect(formatTime(900 + 300)).toBe("20:00");
  });
});

describe("isLowTime", () => {
  it("is red at one minute and under, not above", () => {
    expect(isLowTime(61)).toBe(false);
    expect(isLowTime(60)).toBe(true);
    expect(isLowTime(1)).toBe(true);
    expect(isLowTime(0)).toBe(true);
  });
});

describe("escapeOverlay", () => {
  it("escapeOverlay priority", () => {
    expect(escapeOverlay(view({ phase: "timeup", paused: true }))).toBe("paused");
    expect(escapeOverlay(view({ phase: "ended", paused: true }))).toBe("ended");
    expect(escapeOverlay(view({ phase: "play" }))).toBeNull();
  });

  it("ended beats paused beats timeup beats intro", () => {
    expect(escapeOverlay(view({ phase: "ended" }))).toBe("ended");
    expect(escapeOverlay(view({ phase: "timeup" }))).toBe("timeup");
    expect(escapeOverlay(view({ phase: "intro" }))).toBe("intro");
    expect(escapeOverlay(view({ phase: "intro", paused: true }))).toBe("paused");
    expect(escapeOverlay(view({ phase: "timeup", paused: false }))).toBe("timeup");
  });

  it("shows nothing while the team plays the finale or after it escaped", () => {
    expect(escapeOverlay(view({ phase: "finale" }))).toBeNull();
    expect(escapeOverlay(view({ phase: "escaped" }))).toBeNull();
  });
});

describe("hintInsetPx", () => {
  it("is the screen margin, the button and the gap to it", () => {
    expect(hintInsetPx(48)).toBe(68);
    expect(hintInsetPx(60)).toBe(80);
  });

  it("grows one for one with the button, so a bigger HUD button keeps the clock clear of it", () => {
    expect(hintInsetPx(72) - hintInsetPx(48)).toBe(24);
  });
});

describe("copy", () => {
  it("the time-up card carries the brief's words, with the retry minutes taken from the rule", () => {
    expect(timeupText()).toBe("시간이 다 됐어요. 그래도 괜찮아요! 5분을 더 받아 이어서 풀어 볼까요?");
  });

  it("enteringText picks 로 / 으로 by the room name's last sound", () => {
    expect(enteringText("상담실")).toBe("상담실로 들어가는 중…");
    expect(enteringText("도서관")).toBe("도서관으로 들어가는 중…");
    expect(enteringText("미디어실")).toBe("미디어실로 들어가는 중…");
    expect(enteringText("")).toBe("교실로 들어가는 중…");
  });
});

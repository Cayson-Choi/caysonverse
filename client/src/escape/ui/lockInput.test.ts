import { describe, expect, it } from "vitest";
import { SOLO_HOLD_MS } from "@caysonverse/shared/escape/constants";
import type { EscapeEventPayload } from "@caysonverse/shared/escape/messages";
import {
  coopEventText,
  cursorMove,
  cycleBin,
  dragSteps,
  fitValue,
  holdProgress,
  settleOverrides,
  spinDigit,
  spinWheel,
  typeDigit,
  wrongText,
} from "./lockInput";

describe("spinDigit", () => {
  it("spinDigit wraps", () => {
    expect(spinDigit("0900", 1, 1)).toBe("0000");
    expect(spinDigit("0000", 0, -1)).toBe("9000");
  });

  it("turns only the chosen wheel by one", () => {
    expect(spinDigit("3826", 0, 1)).toBe("4826");
    expect(spinDigit("3826", 3, -1)).toBe("3825");
    expect(spinDigit("3826", 2, 1)).toBe("3836");
  });

  it("leaves the value alone for a wheel that is not there", () => {
    expect(spinDigit("3826", -1, 1)).toBe("3826");
    expect(spinDigit("3826", 4, 1)).toBe("3826");
    expect(spinDigit("3826", 1.5, 1)).toBe("3826");
    expect(spinDigit("", 0, 1)).toBe("");
  });

  it("reads a character that is not a digit as 0 (a wheel never shows NaN)", () => {
    expect(spinDigit("3x26", 1, 1)).toBe("3126");
  });
});

describe("spinWheel", () => {
  it("spinWheel wraps by wheel length", () => {
    expect(spinWheel("0007", 3, 1, 8)).toBe("0000");
    expect(spinWheel("0000", 3, -1, 8)).toBe("0007");
  });

  it("never goes past a wheel's last letter, whatever the length", () => {
    expect(spinWheel("0004", 3, 1, 5)).toBe("0000");
    expect(spinWheel("0003", 3, 1, 5)).toBe("0004");
    expect(spinWheel("0009", 3, 1, 10)).toBe("0000");
    // one digit per wheel: a longer "wheel" is held to ten positions
    expect(spinWheel("0009", 3, 1, 40)).toBe("0000");
  });

  it("an index that is already out of range is folded back in", () => {
    expect(spinWheel("0009", 3, 1, 8)).toBe("0002"); // 9 % 8 = 1, then +1
  });

  it("ignores an empty wheel", () => {
    expect(spinWheel("0000", 0, 1, 0)).toBe("0000");
  });
});

describe("typeDigit", () => {
  it("typeDigit writes at the cursor and advances", () => {
    expect(typeDigit("0000", 1, "7")).toEqual({ value: "0700", cursor: 2 });
    expect(typeDigit("0000", 0, "4")).toEqual({ value: "4000", cursor: 1 });
  });

  it("stays on the last wheel instead of running off the end", () => {
    expect(typeDigit("3820", 3, "9")).toEqual({ value: "3829", cursor: 3 });
  });

  it("ignores a key that is not a single digit", () => {
    expect(typeDigit("0000", 1, "a")).toEqual({ value: "0000", cursor: 1 });
    expect(typeDigit("0000", 1, "12")).toEqual({ value: "0000", cursor: 1 });
    expect(typeDigit("0000", 1, "")).toEqual({ value: "0000", cursor: 1 });
    expect(typeDigit("0000", 1, "٣")).toEqual({ value: "0000", cursor: 1 }); // only ASCII 0-9
  });

  it("a cursor outside the lock is pulled back inside it", () => {
    expect(typeDigit("0000", 9, "5")).toEqual({ value: "0005", cursor: 3 });
    expect(typeDigit("0000", -2, "5")).toEqual({ value: "5000", cursor: 1 });
  });

  it("an empty value stays empty", () => {
    expect(typeDigit("", 0, "5")).toEqual({ value: "", cursor: 0 });
  });
});

describe("cursorMove", () => {
  it("steps left and right and stops at the ends", () => {
    expect(cursorMove(1, 1, 4)).toBe(2);
    expect(cursorMove(1, -1, 4)).toBe(0);
    expect(cursorMove(0, -1, 4)).toBe(0);
    expect(cursorMove(3, 1, 4)).toBe(3);
  });

  it("an empty lock keeps the cursor at 0", () => {
    expect(cursorMove(0, 1, 0)).toBe(0);
  });
});

describe("cycleBin", () => {
  it("cycleBin", () => {
    expect(cycleBin("", ["ok", "stop"])).toBe("ok");
    expect(cycleBin("ok", ["ok", "stop"])).toBe("stop");
    expect(cycleBin("stop", ["ok", "stop"])).toBe("");
  });

  it("a bin it does not know starts the cycle again; no bins stays out", () => {
    expect(cycleBin("gone", ["ok", "stop"])).toBe("ok");
    expect(cycleBin("ok", [])).toBe("");
    expect(cycleBin("", [])).toBe("");
  });
});

describe("holdProgress", () => {
  it("holdProgress clamps 0..1 over SOLO_HOLD_MS", () => {
    expect(holdProgress(1000, 1000)).toBe(0);
    expect(holdProgress(1000, 1000 + SOLO_HOLD_MS / 2)).toBe(0.5);
    expect(holdProgress(1000, 1000 + SOLO_HOLD_MS)).toBe(1);
    expect(holdProgress(1000, 1000 + SOLO_HOLD_MS * 4)).toBe(1);
    expect(holdProgress(1000, 400)).toBe(0); // the clock before the start
  });

  it("takes another length of hold", () => {
    expect(holdProgress(0, 500, 2000)).toBe(0.25);
  });

  it("never returns NaN (a zero length or a broken clock)", () => {
    expect(holdProgress(0, 100, 0)).toBe(1);
    expect(holdProgress(Number.NaN, 100)).toBe(0);
    expect(holdProgress(0, Number.NaN)).toBe(0);
  });
});

describe("dragSteps", () => {
  it("counts whole steps of a drag, upwards positive", () => {
    expect(dragSteps(0, 24)).toBe(0);
    expect(dragSteps(-30, 24)).toBe(1);
    expect(dragSteps(30, 24)).toBe(-1);
    expect(dragSteps(-71, 24)).toBe(2);
    expect(dragSteps(-23, 24)).toBe(0);
  });

  it("a step length of zero turns nothing", () => {
    expect(dragSteps(-100, 0)).toBe(0);
  });
});

describe("settleOverrides", () => {
  it("drops an override the server has caught up with", () => {
    expect(settleOverrides({ a: "1000" }, { a: "1000" })).toEqual({});
  });

  it("keeps an override the server has not reached yet", () => {
    const over = { a: "2000" };
    expect(settleOverrides(over, { a: "1000" })).toBe(over);
  });

  it("an override for a card the server has no entry for is settled by the empty bin", () => {
    expect(settleOverrides({ card: "" }, {})).toEqual({});
    expect(settleOverrides({ card: "ok" }, {})).toEqual({ card: "ok" });
  });

  it("hands back the same object when nothing settled (no extra render)", () => {
    const over = { a: "x", b: "y" };
    expect(settleOverrides(over, { a: "q", b: "w" })).toBe(over);
  });

  it("settles some and keeps others", () => {
    expect(settleOverrides({ a: "x", b: "y" }, { a: "x", b: "w" })).toEqual({ b: "y" });
  });

  it("does not change what it was given", () => {
    const over = { a: "x" };
    settleOverrides(over, { a: "x" });
    expect(over).toEqual({ a: "x" });
  });
});

describe("wrongText", () => {
  it("a sort board says how many cards are not in place", () => {
    expect(wrongText({ e: "wrong", lockId: "board_lock", wrongCount: 3 })).toBe("3장이 제자리가 아니에요");
    expect(wrongText({ e: "wrong", lockId: "board_lock", wrongCount: 1 })).toBe("1장이 제자리가 아니에요");
  });

  it("a sort board with cards still in the tray says so (not a wrong attempt)", () => {
    expect(wrongText({ e: "wrong", lockId: "board_lock", unplaced: 2 })).toBe("아직 놓지 않은 카드가 있어요");
  });

  it("unplaced wins when both are there", () => {
    expect(wrongText({ e: "wrong", lockId: "board_lock", unplaced: 1, wrongCount: 4 })).toBe("아직 놓지 않은 카드가 있어요");
  });

  it("a digits / letters lock just says it did not open", () => {
    expect(wrongText({ e: "wrong", lockId: "cabinet_lock" })).toBe("맞지 않아요. 다시 맞춰 봐요");
  });
});

describe("coopEventText", () => {
  const objects = [
    { id: "safe_key_left", label: "서쪽 열쇠" },
    { id: "safe_key_right", label: "동쪽 열쇠" },
  ];
  const members = [
    { sid: "s1", nickname: "가람" },
    { sid: "s2", nickname: "다온" },
  ];

  it("names who took which key and the 2 s window", () => {
    const ev: EscapeEventPayload = { e: "coop", objectId: "safe_key_left", by: "s1" };
    expect(coopEventText(ev, objects, members)).toBe("가람님이 서쪽 열쇠를 잡았어요! 2초 안에 함께 돌려요");
  });

  it("a member who has left reads as 팀원, an unknown object as 열쇠", () => {
    expect(coopEventText({ e: "coop", objectId: "nope", by: "gone" }, objects, members)).toBe(
      "팀원님이 열쇠를 잡았어요! 2초 안에 함께 돌려요",
    );
  });

  it("is null for an event that is not a coop press", () => {
    expect(coopEventText({ e: "hold", objectId: "safe_key_left", by: "s1", on: true }, objects, members)).toBeNull();
    expect(coopEventText({ e: "members" }, objects, members)).toBeNull();
  });
});

describe("fitValue", () => {
  it("pads a short input with zeros and cuts a long one, so every wheel has a position", () => {
    expect(fitValue("12", 4)).toBe("1200");
    expect(fitValue("123456", 4)).toBe("1234");
    expect(fitValue("3826", 4)).toBe("3826");
  });

  it("a missing input (the state has not arrived) is all zeros; a stray character reads as 0", () => {
    expect(fitValue(undefined, 4)).toBe("0000");
    expect(fitValue("a1", 2)).toBe("01");
  });

  it("no wheels, no value", () => {
    expect(fitValue("12", 0)).toBe("");
  });
});

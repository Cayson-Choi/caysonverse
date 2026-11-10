import { describe, expect, it } from "vitest";
import { CHAT_RATE } from "@caysonverse/shared/constants";
import {
  CHAT_PACE_SLACK_MS,
  IME_ENTER_TAIL_MS,
  chatKeyAction,
  chatPaceAllows,
  chatPaceWaitMs,
  hasChatText,
  insertPrefix,
  paceSend,
  pressLeavesChat,
  typeToChatAllowed,
} from "./chatBar";

const key = (k: string, isComposing = false) => ({ key: k, isComposing });

describe("chatKeyAction", () => {
  it("Enter with text sends (and the field stays focused — the caller never blurs on a send)", () => {
    expect(chatKeyAction(key("Enter"), "안녕")).toBe("send");
    expect(chatKeyAction(key("Enter"), "  hi  ")).toBe("send");
  });

  it("Enter on an empty or blank field leaves the chat, like Escape", () => {
    expect(chatKeyAction(key("Enter"), "")).toBe("leave");
    expect(chatKeyAction(key("Enter"), "   ")).toBe("leave");
    expect(chatKeyAction(key("Enter"), "　\t")).toBe("leave");
  });

  it("Escape always leaves, text or not", () => {
    expect(chatKeyAction(key("Escape"), "")).toBe("leave");
    expect(chatKeyAction(key("Escape"), "아직 쓰는 중")).toBe("leave");
  });

  it("nothing happens while an IME composition (Hangul) is in progress — the IME finishes first", () => {
    expect(chatKeyAction(key("Enter", true), "안녕하세요")).toBeNull();
    expect(chatKeyAction(key("Enter", true), "")).toBeNull();
    expect(chatKeyAction(key("Escape", true), "안")).toBeNull();
  });

  // Review (2026-11-10): Safari (macOS, and WebKit on iOS) ends a Hangul composition BEFORE the Enter's keydown
  // (WebKit bug 165004: compositionend, then keydown key "Enter" with keyCode 229 and isComposing false). Ignoring that
  // Enter — the usual "isComposing || 229" guard, made for Japanese where Enter only confirms — meant a Korean player
  // had to press Enter TWICE to send there. A Korean Enter commits the syllable AND sends, as everywhere else: the line
  // goes out once the IME has settled (sendAfterIme: the caller sends after the event, with the syllable in the field).
  it("an Enter with keyCode 229 and no composition (Safari: the IME already committed) sends once the IME settles", () => {
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 229 }, "안녕하세요")).toBe("sendAfterIme");
    // even when the field still reads empty: the committed syllable may land right after the keydown
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 229 }, "")).toBe("sendAfterIme");
    // an Escape the IME handled only cancels the syllable — it never leaves the chat
    expect(chatKeyAction({ key: "Escape", isComposing: false, keyCode: 229 }, "안")).toBeNull();
    // the plain Enter (keyCode 13) sends at once, as before
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13 }, "안녕하세요")).toBe("send");
  });

  it("…but not after a commit with no Hangul in it: there the Enter only confirmed a conversion (Japanese / Chinese IMEs)", () => {
    const ime229 = { key: "Enter", isComposing: false, keyCode: 229 };
    expect(chatKeyAction(ime229, "漢字", { lastCommit: "漢字" })).toBeNull();
    expect(chatKeyAction(ime229, "nihao 你好", { lastCommit: "你好" })).toBeNull();
    // a Hangul commit (or none seen at all, or an empty one) is a Korean Enter: it sends
    expect(chatKeyAction(ime229, "안녕하세요", { lastCommit: "요" })).toBe("sendAfterIme");
    expect(chatKeyAction(ime229, "안녕하세요", {})).toBe("sendAfterIme");
    expect(chatKeyAction(ime229, "안녕", { lastCommit: "" })).toBe("sendAfterIme");
    // a plain Enter after any commit sends as always
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13 }, "漢字", { lastCommit: "漢字" })).toBe("send");
  });

  it("…and the same press never acts twice: no second send while one is queued, no leave on the field it just emptied", () => {
    const enter = { key: "Enter", isComposing: false, keyCode: 13 };
    expect(chatKeyAction(enter, "안녕", { imeSendQueued: true })).toBeNull();
    expect(chatKeyAction({ ...enter, keyCode: 229 }, "안녕", { imeSendQueued: true })).toBeNull();
    // the tail of that press, a moment after its send emptied the field: not "empty Enter = leave"
    expect(chatKeyAction(enter, "", { sinceImeSend: 0 })).toBeNull();
    expect(chatKeyAction(enter, "", { sinceImeSend: IME_ENTER_TAIL_MS - 1 })).toBeNull();
    // a real second press later leaves as usual; one with text sends; Escape always leaves
    expect(chatKeyAction(enter, "", { sinceImeSend: IME_ENTER_TAIL_MS })).toBe("leave");
    expect(chatKeyAction(enter, "다음", { sinceImeSend: 0 })).toBe("send");
    expect(chatKeyAction({ key: "Escape", isComposing: false, keyCode: 27 }, "", { sinceImeSend: 0 })).toBe("leave");
    expect(IME_ENTER_TAIL_MS).toBeGreaterThanOrEqual(50);
    expect(IME_ENTER_TAIL_MS).toBeLessThanOrEqual(300);
  });

  // Review (2026-11-10): Enter held a little too long after sending threw the player out — the key's auto-repeat hit
  // the field just emptied by the send and read as "Enter on an empty field = leave". One action per physical press.
  it("an auto-repeat (a held Enter / Escape) does nothing: no second send, and never a leave", () => {
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13, repeat: true }, "")).toBeNull();
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13, repeat: true }, "   ")).toBeNull();
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13, repeat: true }, "hello")).toBeNull();
    expect(chatKeyAction({ key: "Escape", isComposing: false, keyCode: 27, repeat: true }, "")).toBeNull();
    // the press itself (repeat false) still sends / leaves
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13, repeat: false }, "hello")).toBe("send");
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13, repeat: false }, "")).toBe("leave");
  });

  it("every other key is the field's own (typing, WASD letters, arrows, Tab)", () => {
    for (const k of ["a", "w", "ArrowUp", "Tab", " ", "/", "Backspace", "Process"]) {
      expect(chatKeyAction(key(k), "text")).toBeNull();
    }
  });
});

describe("hasChatText", () => {
  it("a line counts only when it has something besides whitespace (what the server would accept)", () => {
    expect(hasChatText("a")).toBe(true);
    expect(hasChatText(" 요 ")).toBe(true);
    expect(hasChatText("")).toBe(false);
    expect(hasChatText("  \n\t")).toBe(false);
  });
});

describe("pressLeavesChat", () => {
  // A stand-in for the bar element: contains() answers for its own descendants.
  const inside = { id: "field" };
  const button = { id: "send" };
  const bar = { contains: (n: unknown) => n === inside || n === button || n === bar };

  it("a press inside the chat bar (the field, the send button, the bar itself) keeps the chat", () => {
    expect(pressLeavesChat(inside, bar)).toBe(false);
    expect(pressLeavesChat(button, bar)).toBe(false);
    expect(pressLeavesChat(bar, bar)).toBe(false);
  });

  it("a press anywhere else (the 3D view, a HUD button, a menu) leaves the chat", () => {
    expect(pressLeavesChat({ id: "canvas" }, bar)).toBe(true);
    expect(pressLeavesChat({ id: "hud" }, bar)).toBe(true);
  });

  it("no target, or no bar mounted: leave (never strand the keyboard in a field nobody can see)", () => {
    expect(pressLeavesChat(null, bar)).toBe(true);
    expect(pressLeavesChat(inside, null)).toBe(true);
  });
});

describe("typeToChatAllowed", () => {
  it("a typed key opens the world chat when nothing else is being typed into", () => {
    expect(typeToChatAllowed({ npcOpen: false, otherFieldFocused: false })).toBe(true);
  });

  it("not while the 조교 dialogue is open — the question must never go out to everyone by accident", () => {
    expect(typeToChatAllowed({ npcOpen: true, otherFieldFocused: false })).toBe(false);
  });

  it("not while another text field has the caret (it gets its own keys)", () => {
    expect(typeToChatAllowed({ npcOpen: false, otherFieldFocused: true })).toBe(false);
  });
});

// The server keeps CHAT_RATE.count lines per CHAT_RATE.windowMs and DROPS the next one. Now that the chat stays open,
// quick back-and-forth hits that: the dropped line had already been cleared from the field — lost. The client holds it.
describe("chatPaceAllows — the client keeps a line the server would drop", () => {
  const W = CHAT_RATE.windowMs + CHAT_PACE_SLACK_MS;

  it("the server's cap is what it mirrors (3 lines per 5 s), plus a little slack for the network", () => {
    expect(CHAT_RATE).toEqual({ count: 3, windowMs: 5000 });
    expect(CHAT_PACE_SLACK_MS).toBeGreaterThan(0);
    expect(CHAT_PACE_SLACK_MS).toBeLessThanOrEqual(1000);
  });

  it("up to three lines go out at once", () => {
    expect(chatPaceAllows([], 1000)).toBe(true);
    expect(chatPaceAllows([1000], 1150)).toBe(true);
    expect(chatPaceAllows([1000, 1150], 1300)).toBe(true);
  });

  it("a fourth line inside the window is held back (it stays in the field)", () => {
    expect(chatPaceAllows([1000, 1150, 1300], 1450)).toBe(false);
    expect(chatPaceAllows([1000, 1150, 1300], 1000 + CHAT_RATE.windowMs)).toBe(false); // the server would still count the first
    expect(chatPaceAllows([1000, 1150, 1300], 1000 + W)).toBe(false); // exactly at the edge: still counted
  });

  it("…and goes once the oldest line has left the window (with the slack)", () => {
    expect(chatPaceAllows([1000, 1150, 1300], 1000 + W + 1)).toBe(true);
    expect(chatPaceAllows([1000, 1150, 1300], 1300 + W + 1)).toBe(true);
  });

  it("only the recent lines count, in any order", () => {
    expect(chatPaceAllows([0, 100, 200, 9000, 9100], 9200)).toBe(true);
    expect(chatPaceAllows([9100, 0, 9000, 9050], 9200)).toBe(false);
  });
});

describe("chatPaceWaitMs — how long a held line has to wait", () => {
  const W = CHAT_RATE.windowMs + CHAT_PACE_SLACK_MS;

  it("0 while a line may go now", () => {
    expect(chatPaceWaitMs([], 1000)).toBe(0);
    expect(chatPaceWaitMs([1000, 1150], 1300)).toBe(0);
    expect(chatPaceWaitMs([0, 100, 200], 200 + W + 1)).toBe(0);
  });

  it("otherwise exactly until the line that blocks it has left the window: allowed then, not a moment before", () => {
    const sent = [1000, 1150, 1300];
    for (const now of [1450, 3000, 1000 + W - 1, 1000 + W]) {
      const wait = chatPaceWaitMs(sent, now);
      expect(wait, `now ${now}`).toBeGreaterThan(0);
      expect(chatPaceAllows(sent, now + wait), `now ${now}`).toBe(true);
      expect(chatPaceAllows(sent, now + wait - 1), `now ${now}`).toBe(false);
    }
    // more lines than the cap (old ones included, any order): the one that has to leave is the right one
    const many = [9100, 0, 9000, 9050];
    const wait = chatPaceWaitMs(many, 9200);
    expect(chatPaceAllows(many, 9200 + wait)).toBe(true);
    expect(chatPaceAllows(many, 9200 + wait - 1)).toBe(false);
  });

  it("agrees with chatPaceAllows everywhere", () => {
    const sent = [500, 900, 2000, 2100];
    for (let now = 2100; now < 9000; now += 37) expect(chatPaceWaitMs(sent, now) === 0, `now ${now}`).toBe(chatPaceAllows(sent, now));
  });
});

// Review (2026-11-10): while a quick 4th line was held back, EVERY further Enter / button press added the same notice to
// the log again; and on a phone (log folded away, bar on the keyboard) nothing on screen said why the send did nothing.
describe("paceSend — one notice per held line, and how long it is held", () => {
  const sent = [1000, 1150, 1300];

  it("a line that may go: send, no notice, nothing held", () => {
    expect(paceSend([], 1000, null)).toEqual({ send: true, notice: false, until: null });
    expect(paceSend(sent, 1300 + CHAT_RATE.windowMs + CHAT_PACE_SLACK_MS + 1, 7000)).toEqual({ send: true, notice: false, until: null });
  });

  it("the first refused press: held until it may go, WITH the notice", () => {
    const r = paceSend(sent, 1450, null);
    expect(r.send).toBe(false);
    expect(r.notice).toBe(true);
    expect(r.until).toBe(1450 + chatPaceWaitMs(sent, 1450));
  });

  it("pressing again while it is held: still held, NO second notice", () => {
    const first = paceSend(sent, 1450, null);
    const again = paceSend(sent, 2600, first.until);
    expect(again.send).toBe(false);
    expect(again.notice).toBe(false);
    expect(again.until).toBe(first.until);
  });

  it("a hold that already ran out counts as none (a new hold says so again)", () => {
    expect(paceSend(sent, 3000, 2999).notice).toBe(true);
  });
});

// "ㅡㅡ" typed without clicking: the first m was held back (hotkeys.ts stepHeld) and the chat opens on the second — the
// first goes into the field ahead of it, where the caret is.
describe("insertPrefix — the held letter goes in at the caret", () => {
  it("into an empty field", () => {
    expect(insertPrefix("", 0, 0, "m", 120)).toEqual({ value: "m", caret: 1 });
  });

  it("at the caret of an unsent line (replacing a selection), the caret after it", () => {
    expect(insertPrefix("abc", 3, 3, "m", 120)).toEqual({ value: "abcm", caret: 4 });
    expect(insertPrefix("abc", 1, 1, "M", 120)).toEqual({ value: "aMbc", caret: 2 });
    expect(insertPrefix("abcdef", 1, 4, "b", 120)).toEqual({ value: "abef", caret: 2 });
  });

  it("never past the length limit (nothing is inserted then)", () => {
    expect(insertPrefix("x".repeat(120), 120, 120, "m", 120)).toBeNull();
    expect(insertPrefix("x".repeat(119), 119, 119, "m", 120)).toEqual({ value: "x".repeat(119) + "m", caret: 120 });
  });

  it("a caret outside the text is clamped to it", () => {
    expect(insertPrefix("ab", 9, 9, "m", 120)).toEqual({ value: "abm", caret: 3 });
  });
});

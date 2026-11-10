import { describe, expect, it } from "vitest";
import { CHAT_RATE } from "@caysonverse/shared/constants";
import { CHAT_PACE_SLACK_MS, chatKeyAction, chatPaceAllows, hasChatText, pressLeavesChat, typeToChatAllowed } from "./chatBar";

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

  it("nor on the Enter that only COMMITS the syllable (keyCode 229 — Safari says isComposing false there)", () => {
    // Safari / macOS: the Enter that ends a Hangul composition comes as key "Enter", keyCode 229, isComposing false.
    // Sending on it would send "안녕하세요" and then the IME would commit "요" into the emptied field (a stray syllable).
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 229 }, "안녕하세요")).toBeNull();
    expect(chatKeyAction({ key: "Escape", isComposing: false, keyCode: 229 }, "안")).toBeNull();
    // the real Enter that follows (keyCode 13) sends
    expect(chatKeyAction({ key: "Enter", isComposing: false, keyCode: 13 }, "안녕하세요")).toBe("send");
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

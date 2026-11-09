import { describe, expect, it } from "vitest";
import { holdViewport, isTextEntry, keyboardLift, KEYBOARD_LIFT_GAP } from "./entryViewport";
import { stageLayout } from "./stageLayout";

describe("holdViewport — a phone keyboard does not change the entry layout", () => {
  const phone = { width: 412, height: 744 };

  it("keeps the height from before the keyboard while it is up (KakaoTalk / Android WebView shrink the viewport)", () => {
    expect(holdViewport(phone, { width: 412, height: 404 }, true)).toBe(phone);
    // That shrunken size alone would flip the builder into the side-sheet layout (the bug): the held one stays a phone.
    expect(stageLayout(412, 404).mode).toBe("side");
    expect(stageLayout(phone.width, phone.height).mode).toBe("phone");
  });

  it("takes the real size when nothing is typed (toolbar, split screen) or when the screen grows", () => {
    expect(holdViewport(phone, { width: 412, height: 600 }, false)).toEqual({ width: 412, height: 600 });
    expect(holdViewport(phone, { width: 412, height: 800 }, true)).toEqual({ width: 412, height: 800 });
    expect(holdViewport({ width: 412, height: 404 }, phone, false)).toEqual(phone); // keyboard closed again
  });

  it("follows a rotation or window resize even while a field has focus", () => {
    expect(holdViewport(phone, { width: 744, height: 412 }, true)).toEqual({ width: 744, height: 412 });
  });
});

describe("keyboardLift — the focused field stays above the keyboard", () => {
  it("does not move anything when the field is already visible", () => {
    expect(keyboardLift({ top: 269, bottom: 315 }, 404)).toBe(0);
    expect(keyboardLift({ top: 269, bottom: 404 - KEYBOARD_LIFT_GAP }, 404)).toBe(0);
  });

  it("raises the screen just enough to show the field with a small gap under it", () => {
    expect(keyboardLift({ top: 230, bottom: 272 }, 280)).toBe(272 + KEYBOARD_LIFT_GAP - 280);
    expect(keyboardLift({ top: 230.2, bottom: 272.4 }, 280)).toBe(5);
  });

  it("never pushes the top of the field off the screen", () => {
    expect(keyboardLift({ top: 100, bottom: 400 }, 200)).toBe(100 - KEYBOARD_LIFT_GAP);
    expect(keyboardLift({ top: 4, bottom: 300 }, 200)).toBe(0);
  });
});

describe("isTextEntry — what opens a phone keyboard", () => {
  it("counts text fields, text areas and editable elements", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "input", type: "password" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("does not count buttons, checkboxes or nothing", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "submit" })).toBe(false);
    expect(isTextEntry({ tagName: "BUTTON", type: "submit" })).toBe(false);
    expect(isTextEntry({ tagName: "BODY" })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

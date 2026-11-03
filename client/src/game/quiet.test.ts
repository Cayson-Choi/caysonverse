import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The components import the connection module, which builds a real SDK client at load (it needs a browser URL).
vi.mock("../net/connection", () => ({ getActiveRoom: () => null, sendEmoji: vi.fn(), sendJump: vi.fn() }));

import { isQuiet, setQuiet, subscribeQuiet } from "./quiet";
import { pressJump, publishLocalJump, resetLocalJump } from "./jump";
import { EmojiPalette, emojiMayFire } from "../ui/EmojiPalette";
import { EmojiFan } from "../ui/EmojiFan";
import { JumpButton } from "../ui/JumpButton";

afterEach(() => {
  setQuiet(false);
  resetLocalJump();
});

describe("the quiet hall on the client (케이슨 마을 — the server drops Emoji and Jump there)", () => {
  it("setQuiet flips the flag and tells subscribers once per change", () => {
    const seen: boolean[] = [];
    const off = subscribeQuiet(() => seen.push(isQuiet()));
    setQuiet(true);
    setQuiet(true);
    setQuiet(false);
    off();
    setQuiet(true);
    expect(seen).toEqual([true, false]);
  });

  it("pressJump plays and sends a hop outside, and does neither inside (and burns no cooldown)", () => {
    publishLocalJump(0, false); // an avatar that is free to jump
    const send = vi.fn();
    setQuiet(true);
    expect(pressJump("me", 10_000, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    setQuiet(false);
    expect(pressJump("me", 10_001, send)).toBe(true); // the refused press did not start the cooldown
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("an emoji may fire only outside the quiet place, and still inside the rate cap", () => {
    expect(emojiMayFire(10_000, Number.NEGATIVE_INFINITY, false)).toBe(true);
    expect(emojiMayFire(10_000, Number.NEGATIVE_INFINITY, true)).toBe(false);
    expect(emojiMayFire(10_100, 10_000, false)).toBe(false); // inside the 500 ms cap
    expect(emojiMayFire(10_600, 10_000, false)).toBe(true);
  });

  it("the emoji bar, the touch emoji button and the touch jump button are drawn outside and gone inside", () => {
    const palette = () => renderToStaticMarkup(createElement(EmojiPalette));
    const fan = () => renderToStaticMarkup(createElement(EmojiFan));
    const jump = () => renderToStaticMarkup(createElement(JumpButton, { sessionId: "me" }));

    expect(palette()).toContain("cv-emoji-palette");
    expect(fan()).toContain("cv-emoji-toggle");
    expect(jump()).toContain("cv-jump-btn");

    setQuiet(true);
    expect(palette()).toBe("");
    expect(fan()).toBe("");
    expect(jump()).toBe("");

    setQuiet(false);
    expect(palette()).toContain("cv-emoji-palette");
  });
});

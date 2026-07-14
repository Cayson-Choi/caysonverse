import { describe, it, expect } from "vitest";
import { EMOJI_DISPLAY_MS } from "@caysonverse/shared/constants";
import { EmojiRegistry } from "./emojiRegistry";

describe("EmojiRegistry", () => {
  it("stores and returns an active emoji for a session", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 2, 0);
    expect(reg.get("a", 0)?.index).toBe(2);
  });

  it("returns null for an unknown session", () => {
    const reg = new EmojiRegistry();
    expect(reg.get("nobody", 0)).toBeNull();
  });

  it("replaces the active emoji on a newer reaction from the same session", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 0, 0);
    const first = reg.get("a", 0)!;
    reg.set("a", 4, 100);
    const second = reg.get("a", 100)!;
    expect(second.index).toBe(4);
    // A newer reaction resets the seq forward so the avatar hook detects it.
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it("restarts the float animation clock on replace (does not inherit the old start)", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 0, 0);
    reg.set("a", 5, 2000); // replaced late in the first reaction's life
    const entry = reg.get("a", 2000)!;
    expect(entry.startedAt).toBe(2000);
    // Still visible a full EMOJI_DISPLAY_MS after the REPLACEMENT time, not
    // the original set time (which would have already expired by 2000+ms).
    expect(reg.get("a", 2000 + EMOJI_DISPLAY_MS - 1)?.index).toBe(5);
    expect(reg.get("a", 2000 + EMOJI_DISPLAY_MS)).toBeNull();
  });

  it("expires an emoji exactly EMOJI_DISPLAY_MS after it was set", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 1, 0);
    expect(reg.get("a", EMOJI_DISPLAY_MS - 1)?.index).toBe(1);
    expect(reg.get("a", EMOJI_DISPLAY_MS)).toBeNull();
  });

  it("removes an emoji on demand (leaving avatar)", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 1, 0);
    reg.remove("a");
    expect(reg.get("a", 0)).toBeNull();
  });

  it("clears every emoji", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 0, 0);
    reg.set("b", 1, 0);
    reg.clear();
    expect(reg.get("a", 0)).toBeNull();
    expect(reg.get("b", 0)).toBeNull();
  });

  it("snapshot returns only currently active emoji", () => {
    const reg = new EmojiRegistry();
    reg.set("a", 0, 0);
    reg.set("b", 1, 0);
    const active = reg.snapshot(EMOJI_DISPLAY_MS - 1);
    expect(active.map((e) => e.sid).sort()).toEqual(["a", "b"]);

    const expired = reg.snapshot(EMOJI_DISPLAY_MS);
    expect(expired).toEqual([]);
  });
});

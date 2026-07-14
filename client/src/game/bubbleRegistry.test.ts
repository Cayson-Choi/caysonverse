import { describe, it, expect } from "vitest";
import { SPEECH_BUBBLE_MS, MAX_VISIBLE_BUBBLES } from "@caysonverse/shared/constants";
import { BubbleRegistry } from "./bubbleRegistry";

describe("BubbleRegistry", () => {
  it("stores and returns a visible bubble for a session", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "안녕", 0);
    expect(reg.get("a", 0)?.text).toBe("안녕");
  });

  it("returns null for an unknown session", () => {
    const reg = new BubbleRegistry();
    expect(reg.get("nobody", 0)).toBeNull();
  });

  it("replaces the current bubble on a newer message from the same session", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    const first = reg.get("a", 0)!;
    reg.set("a", "bye", 100);
    const second = reg.get("a", 100)!;
    expect(second.text).toBe("bye");
    // A newer message resets the seq forward so followers can detect the change.
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it("refreshes the TTL when replaced (does not expire on the old timer)", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.set("a", "bye", 5000); // replaced late in the first bubble's life
    expect(reg.get("a", 5000)?.text).toBe("bye");
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS - 1)?.text).toBe("bye");
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("expires a bubble exactly SPEECH_BUBBLE_MS after it was set", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    expect(reg.get("a", SPEECH_BUBBLE_MS - 1)?.text).toBe("hi");
    expect(reg.get("a", SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("removes a bubble on demand (leaving avatar)", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.remove("a");
    expect(reg.get("a", 0)).toBeNull();
  });

  it("hides the oldest when more than MAX_VISIBLE_BUBBLES are active", () => {
    const reg = new BubbleRegistry();
    const total = MAX_VISIBLE_BUBBLES + 1;
    for (let i = 0; i < total; i++) reg.set(`s${i}`, `m${i}`, i); // all within TTL
    const now = total;

    // The very first (oldest) is hidden; every newer one stays visible.
    expect(reg.get("s0", now)).toBeNull();
    for (let i = 1; i < total; i++) {
      expect(reg.get(`s${i}`, now)?.text).toBe(`m${i}`);
    }
  });

  it("re-shows a replaced oldest bubble and evicts the new oldest", () => {
    const reg = new BubbleRegistry();
    const total = MAX_VISIBLE_BUBBLES + 1;
    for (let i = 0; i < total; i++) reg.set(`s${i}`, `m${i}`, i);

    // Replacing s0 makes it the newest → visible again; s1 is now the oldest.
    reg.set("s0", "again", total);
    const now = total;
    expect(reg.get("s0", now)?.text).toBe("again");
    expect(reg.get("s1", now)).toBeNull();
  });

  it("clears all bubbles", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.set("b", "yo", 0);
    reg.clear();
    expect(reg.get("a", 0)).toBeNull();
    expect(reg.get("b", 0)).toBeNull();
  });
});

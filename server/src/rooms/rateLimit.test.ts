import { describe, it, expect } from "vitest";
import { RateWindow } from "./rateLimit";

describe("RateWindow", () => {
  it("accepts up to the limit within a window", () => {
    const w = new RateWindow(3, 1000);
    expect(w.tryAccept(0)).toBe(true);
    expect(w.tryAccept(10)).toBe(true);
    expect(w.tryAccept(20)).toBe(true);
    // 4th within the 1s window exceeds the cap.
    expect(w.tryAccept(30)).toBe(false);
  });

  it("does not let dropped messages consume a slot", () => {
    const w = new RateWindow(2, 1000);
    expect(w.tryAccept(0)).toBe(true);
    expect(w.tryAccept(1)).toBe(true);
    expect(w.tryAccept(2)).toBe(false); // dropped
    expect(w.tryAccept(3)).toBe(false); // still dropped — drop didn't add a hit
  });

  it("slides: old hits leave the window", () => {
    const w = new RateWindow(2, 1000);
    expect(w.tryAccept(0)).toBe(true);
    expect(w.tryAccept(500)).toBe(true);
    expect(w.tryAccept(900)).toBe(false); // window holds [0, 500]
    // At t=1001 the hit at t=0 has expired (>1000ms old), freeing a slot.
    expect(w.tryAccept(1001)).toBe(true);
  });

  it("treats the window as inclusive of exactly windowMs-old hits", () => {
    const w = new RateWindow(1, 1000);
    expect(w.tryAccept(0)).toBe(true);
    // t=1000 is exactly 1000ms after t=0 — still inside the window.
    expect(w.tryAccept(1000)).toBe(false);
    // t=1001 is strictly older than the window -> the old hit expires.
    expect(w.tryAccept(1001)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { ROOM_IDS, type RoomId } from "@caysonverse/shared/escape/constants";
import { BOARD_FLASH_MS, STEADY_LIT_GLOW, WINDOW_COLORS, boardFlash, newlyLit } from "./boardTimeline";

describe("boardFlash (a window lighting up on the progress board)", () => {
  it("starts bright, with a halo, and settles to the steady glow with no halo and no pop", () => {
    const start = boardFlash(0);
    expect(start.glow).toBe(1);
    expect(start.halo).toBeGreaterThan(0);
    const end = boardFlash(BOARD_FLASH_MS);
    expect(end.glow).toBe(STEADY_LIT_GLOW);
    expect(end.halo).toBe(0);
    expect(end.pop).toBe(1);
    expect(end.haloScale).toBeGreaterThan(start.haloScale);
    // Past the end nothing moves any more (the frame loop can stop).
    expect(boardFlash(BOARD_FLASH_MS + 60_000)).toEqual(end);
  });

  it("the glow and the halo never come back up; the pop swells in the middle and returns to 1", () => {
    let glow = Infinity;
    let halo = Infinity;
    let peak = 1;
    for (let t = -100; t <= BOARD_FLASH_MS + 300; t += 5) {
      const f = boardFlash(t);
      expect(f.glow).toBeLessThanOrEqual(glow);
      expect(f.halo).toBeLessThanOrEqual(halo);
      expect(f.glow).toBeGreaterThanOrEqual(STEADY_LIT_GLOW);
      expect(f.glow).toBeLessThanOrEqual(1);
      glow = f.glow;
      halo = f.halo;
      peak = Math.max(peak, f.pop);
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(boardFlash(BOARD_FLASH_MS / 3).pop).toBeGreaterThan(1);
  });

  it("a time before the start reads as the start", () => {
    expect(boardFlash(-500)).toEqual(boardFlash(0));
  });

  it("writes into `out` when given (the per-frame path allocates nothing)", () => {
    const out = { glow: -1, halo: -1, haloScale: -1, pop: -1 };
    expect(boardFlash(BOARD_FLASH_MS / 2, out)).toBe(out);
    expect(out.glow).toBeGreaterThan(STEADY_LIT_GLOW);
    expect(out).toEqual(boardFlash(BOARD_FLASH_MS / 2));
  });
});

describe("newlyLit", () => {
  it("lists the rooms that are lit now and were not before, in the new list's order", () => {
    expect(newlyLit([], ["counsel"])).toEqual(["counsel"]);
    expect(newlyLit(["counsel"], ["counsel", "art", "library"])).toEqual(["art", "library"]);
    expect(newlyLit(["counsel"], ["counsel"])).toEqual([]);
    expect(newlyLit(["counsel", "art"], [])).toEqual([]);
  });
});

describe("window colours", () => {
  it("every room has its own bright colour", () => {
    const colors = ROOM_IDS.map((id: RoomId) => WINDOW_COLORS[id]);
    expect(colors.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
    expect(new Set(colors).size).toBe(ROOM_IDS.length);
  });
});

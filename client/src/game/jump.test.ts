import { describe, it, expect, beforeEach } from "vitest";
import { JUMP_DURATION_MS, JUMP_RATE } from "@caysonverse/shared/constants";
import {
  JUMP_CLIENT_COOLDOWN_MS,
  JUMP_HEIGHT_M,
  JumpRegistry,
  jumpOffsetY,
  jumpRegistry,
  jumpTimeScale,
  localJump,
  resetLocalJump,
} from "./jump";

describe("jump constants", () => {
  it("pin the owner-requested hop: 1 m high, 0.8 s long, server cap == duration", () => {
    expect(JUMP_HEIGHT_M).toBe(1.0);
    expect(JUMP_DURATION_MS).toBe(800);
    // Accepted jumps never overlap: the server lets one through per duration.
    expect(JUMP_RATE.windowMs).toBe(JUMP_DURATION_MS);
    expect(JUMP_RATE.count).toBe(1);
    // The client only sends what the server will accept, plus network slack.
    expect(JUMP_CLIENT_COOLDOWN_MS).toBe(JUMP_RATE.windowMs + 50);
    expect(JUMP_CLIENT_COOLDOWN_MS).toBe(850);
  });
});

describe("jumpOffsetY", () => {
  it("is 0 at both ends, peaks at JUMP_HEIGHT_M at the midpoint, 0 outside", () => {
    expect(jumpOffsetY(0)).toBe(0);
    expect(jumpOffsetY(JUMP_DURATION_MS / 2)).toBeCloseTo(JUMP_HEIGHT_M, 6);
    expect(jumpOffsetY(JUMP_DURATION_MS)).toBe(0);
    expect(jumpOffsetY(-1)).toBe(0);
    expect(jumpOffsetY(900)).toBe(0);
  });

  it("is a symmetric parabola 4h·t(1 − t) that never leaves [0, JUMP_HEIGHT_M]", () => {
    const quarter = jumpOffsetY(JUMP_DURATION_MS / 4);
    expect(quarter).toBeCloseTo(0.75 * JUMP_HEIGHT_M, 6); // 4h · 0.25 · 0.75
    expect(jumpOffsetY((3 * JUMP_DURATION_MS) / 4)).toBeCloseTo(quarter, 6);
    for (let ms = 0; ms <= JUMP_DURATION_MS; ms += 10) {
      const y = jumpOffsetY(ms);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(JUMP_HEIGHT_M + 1e-9);
    }
  });
});

describe("jumpTimeScale", () => {
  it("squeezes the Jump_Full_Short clip (1.167 s) into JUMP_DURATION_MS", () => {
    const clipSec = 1.167;
    const scale = jumpTimeScale(clipSec);
    expect(scale).toBeCloseTo(clipSec / (JUMP_DURATION_MS / 1000), 9);
    expect(scale).toBeGreaterThan(1);
    // Played at that speed the clip takes exactly JUMP_DURATION_MS of wall time.
    expect((clipSec / scale) * 1000).toBeCloseTo(JUMP_DURATION_MS, 6);
  });

  it("falls back to real time for a clip with no usable duration", () => {
    expect(jumpTimeScale(0)).toBe(1);
    expect(jumpTimeScale(Number.NaN)).toBe(1);
  });
});

describe("JumpRegistry", () => {
  it("is active for JUMP_DURATION_MS, a re-jump bumps seq, then expires", () => {
    const reg = new JumpRegistry();
    reg.set("a", 1000);
    const first = reg.get("a", 1000);
    expect(first).not.toBeNull();
    expect(first?.sid).toBe("a");
    expect(first?.startedAt).toBe(1000);

    // Still active one ms before the end, gone exactly at JUMP_DURATION_MS.
    expect(reg.get("a", 1000 + JUMP_DURATION_MS - 1)).not.toBeNull();
    expect(reg.get("a", 1000 + JUMP_DURATION_MS)).toBeNull();
    expect(reg.get("a", 1000 + JUMP_DURATION_MS + 1)).toBeNull(); // stays gone

    // A fresh jump while the previous is still in the air restarts the clock
    // and bumps seq, so the avatar replays the hop from the start.
    reg.set("b", 0);
    const before = reg.get("b", 0)!;
    reg.set("b", 300);
    const after = reg.get("b", 300)!;
    expect(after.seq).toBeGreaterThan(before.seq);
    expect(after.startedAt).toBe(300);
    expect(reg.get("b", 300 + JUMP_DURATION_MS - 1)).not.toBeNull();
    expect(reg.get("b", 300 + JUMP_DURATION_MS)).toBeNull();
  });

  it("returns null for an unknown session", () => {
    expect(new JumpRegistry().get("nobody", 0)).toBeNull();
  });

  it("get hands back the stored entry itself — no per-call allocation", () => {
    const reg = new JumpRegistry();
    reg.set("a", 0);
    expect(reg.get("a", 10)).toBe(reg.get("a", 20));
  });

  it("keeps sessions independent; remove drops one, clear drops all", () => {
    const reg = new JumpRegistry();
    reg.set("a", 0);
    reg.set("b", 0);
    reg.remove("a");
    expect(reg.get("a", 1)).toBeNull();
    expect(reg.get("b", 1)).not.toBeNull();
    reg.set("a", 0);
    reg.clear();
    expect(reg.get("a", 1)).toBeNull();
    expect(reg.get("b", 1)).toBeNull();
  });

  it("snapshot lists only the jumps still active at `now` (debug view)", () => {
    const reg = new JumpRegistry();
    reg.set("old", 0);
    reg.set("new", 500);
    const at = JUMP_DURATION_MS + 100; // "old" expired, "new" still airborne
    const snap = reg.snapshot(at);
    expect(snap.map((e) => e.sid)).toEqual(["new"]);
    expect(snap[0].startedAt).toBe(500);
    expect(reg.snapshot(500 + JUMP_DURATION_MS)).toEqual([]);
  });
});

describe("localJump", () => {
  beforeEach(() => {
    resetLocalJump();
    jumpRegistry.clear();
  });

  it("refuses while seated (Review Focus 4) and inside the client cooldown", () => {
    const sent: number[] = [];
    const send = () => sent.push(1);
    expect(localJump("me", true, 1000, send)).toBe(false);
    expect(localJump("me", false, 1000, send)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(jumpRegistry.get("me", 1001)).not.toBeNull();
    expect(localJump("me", false, 1000 + JUMP_RATE.windowMs, send)).toBe(false);
    expect(localJump("me", false, 1000 + JUMP_CLIENT_COOLDOWN_MS, send)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("a refused seated press neither sends, plays, nor burns the cooldown", () => {
    let sends = 0;
    const send = () => sends++;
    expect(localJump("me", true, 500, send)).toBe(false);
    expect(sends).toBe(0);
    expect(jumpRegistry.get("me", 501)).toBeNull();
    // Standing up right after must jump at once (the seated press set no timer).
    expect(localJump("me", false, 501, send)).toBe(true);
    expect(sends).toBe(1);
  });

  it("a press inside the cooldown sends nothing and does not restart the hop", () => {
    let sends = 0;
    const send = () => sends++;
    expect(localJump("me", false, 2000, send)).toBe(true);
    const first = jumpRegistry.get("me", 2000)!;
    // A held / mashed key: dozens of presses in the cooldown window.
    for (let t = 2001; t < 2000 + JUMP_CLIENT_COOLDOWN_MS; t += 7) {
      expect(localJump("me", false, t, send)).toBe(false);
    }
    expect(sends).toBe(1);
    expect(jumpRegistry.get("me", 2100)).toBe(first); // same entry, same seq
  });

  it("resetLocalJump forgets the cooldown (a new world starts fresh)", () => {
    let sends = 0;
    const send = () => sends++;
    expect(localJump("me", false, 3000, send)).toBe(true);
    expect(localJump("me", false, 3001, send)).toBe(false);
    resetLocalJump();
    expect(localJump("me", false, 3002, send)).toBe(true);
    expect(sends).toBe(2);
  });

  it("sends exactly what the server will accept: one hop per JUMP_RATE.windowMs at the cap", () => {
    let sends = 0;
    const send = () => sends++;
    // Mash every 50 ms for 10 s: the client may send at most one per cooldown.
    for (let t = 0; t <= 10_000; t += 50) localJump("me", false, t, send);
    expect(sends).toBeLessThanOrEqual(Math.ceil(10_000 / JUMP_CLIENT_COOLDOWN_MS) + 1);
    expect(sends).toBeGreaterThanOrEqual(Math.floor(10_000 / (JUMP_CLIENT_COOLDOWN_MS + 50)));
  });
});

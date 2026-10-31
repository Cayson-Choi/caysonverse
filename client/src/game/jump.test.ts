import { describe, it, expect, beforeEach } from "vitest";
import { JUMP_DURATION_MS, JUMP_RATE } from "@caysonverse/shared/constants";
import {
  JUMP_CLIENT_COOLDOWN_MS,
  JUMP_HEIGHT_M,
  JumpRegistry,
  currentJump,
  getLocalLift,
  isJumpBlocked,
  jumpOffsetY,
  jumpPhase,
  jumpRegistry,
  jumpTimeScale,
  localJump,
  pressJump,
  publishLocalJump,
  resetLocalJump,
} from "./jump";

describe("jump constants (the duration / rate pin lives in shared/src/constants.test.ts)", () => {
  it("the apex is the owner-requested 1 m; the client sends no faster than the server takes + slack", () => {
    expect(JUMP_HEIGHT_M).toBe(1.0);
    expect(JUMP_CLIENT_COOLDOWN_MS).toBe(JUMP_RATE.windowMs + 50);
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

describe("currentJump", () => {
  beforeEach(() => jumpRegistry.clear());

  it("returns the live entry while the avatar can jump, null once it expired", () => {
    jumpRegistry.set("a", 100);
    expect(currentJump("a", true, 100)?.startedAt).toBe(100);
    expect(currentJump("a", true, 100 + JUMP_DURATION_MS)).toBeNull();
  });

  it("an avatar that cannot jump drops the pending entry for good (no late replay)", () => {
    jumpRegistry.set("a", 100);
    expect(currentJump("a", false, 150)).toBeNull();
    // It can move again 300 ms later, well inside the old hop's window: nothing resumes.
    expect(currentJump("a", true, 400)).toBeNull();
    expect(jumpRegistry.get("a", 400)).toBeNull();
  });

  it("only touches the asked-for session", () => {
    jumpRegistry.set("a", 0);
    jumpRegistry.set("b", 0);
    currentJump("a", false, 10);
    expect(jumpRegistry.get("b", 10)).not.toBeNull();
  });
});

describe("jumpPhase (shared by LocalPlayer and RemotePlayer)", () => {
  const entry = (seq: number) => ({ sid: "a", startedAt: 0, seq });

  it("a hop we are not yet playing is a take-off; the one we play is air", () => {
    expect(jumpPhase(entry(5), true, -1)).toBe("takeoff");
    expect(jumpPhase(entry(5), true, 5)).toBe("air");
  });

  it("a re-jump (newer seq) while one is playing takes off again", () => {
    expect(jumpPhase(entry(6), true, 5)).toBe("takeoff");
  });

  it("the entry vanishing while a clip plays is a landing; with nothing playing it is idle", () => {
    expect(jumpPhase(null, true, 5)).toBe("landed");
    expect(jumpPhase(null, true, -1)).toBe("idle");
  });

  it("an avatar that cannot jump never takes off: it drops a playing clip, else stays idle", () => {
    expect(jumpPhase(entry(5), false, -1)).toBe("idle");
    expect(jumpPhase(entry(5), false, 5)).toBe("dropped");
    expect(jumpPhase(null, false, 5)).toBe("dropped");
    expect(jumpPhase(null, false, -1)).toBe("idle");
  });

  it("walks a whole hop: idle → takeoff → air → landed → idle", () => {
    jumpRegistry.clear();
    jumpRegistry.set("a", 1000);
    let playing = -1;
    const phases: string[] = [];
    for (const t of [1000, 1400, 1799, 1000 + JUMP_DURATION_MS, 1900]) {
      const e = currentJump("a", true, t);
      const p = jumpPhase(e, true, playing);
      phases.push(p);
      if (p === "takeoff" && e) playing = e.seq;
      if (p === "landed" || p === "dropped") playing = -1;
    }
    expect(phases).toEqual(["takeoff", "air", "air", "landed", "idle"]);
  });
});

describe("local lift + blocked flag (published by LocalPlayer each frame)", () => {
  beforeEach(() => resetLocalJump());

  it("starts blocked with no lift: no avatar yet, nothing to jump", () => {
    expect(isJumpBlocked()).toBe(true);
    expect(getLocalLift()).toBe(0);
  });

  it("publishLocalJump sets both; reset clears them", () => {
    publishLocalJump(0.42, false);
    expect(getLocalLift()).toBe(0.42);
    expect(isJumpBlocked()).toBe(false);
    resetLocalJump();
    expect(getLocalLift()).toBe(0);
    expect(isJumpBlocked()).toBe(true);
  });
});

describe("pressJump — the one gate Space and the touch button share", () => {
  beforeEach(() => {
    resetLocalJump();
    jumpRegistry.clear();
  });

  it("a blocked state refuses without sending, playing, or consuming the cooldown", () => {
    let sends = 0;
    const send = () => sends++;
    publishLocalJump(0, true); // seated, or in the ~1 s stand-up clip
    expect(pressJump("me", 5000, send)).toBe(false);
    expect(pressJump("me", 5100, send)).toBe(false);
    expect(sends).toBe(0);
    expect(jumpRegistry.get("me", 5100)).toBeNull();
    // The blocked presses burnt nothing: the very next frame it unblocks, a press jumps.
    publishLocalJump(0, false);
    expect(pressJump("me", 5101, send)).toBe(true);
    expect(sends).toBe(1);
    expect(jumpRegistry.get("me", 5102)).not.toBeNull();
  });

  it("is blocked by default (before LocalPlayer's first frame) and after a reset", () => {
    let sends = 0;
    expect(pressJump("me", 0, () => sends++)).toBe(false);
    publishLocalJump(0, false);
    resetLocalJump();
    expect(pressJump("me", 1, () => sends++)).toBe(false);
    expect(sends).toBe(0);
  });

  it("an unblocked press still obeys the client cooldown", () => {
    let sends = 0;
    const send = () => sends++;
    publishLocalJump(0, false);
    expect(pressJump("me", 0, send)).toBe(true);
    expect(pressJump("me", JUMP_CLIENT_COOLDOWN_MS - 1, send)).toBe(false);
    expect(pressJump("me", JUMP_CLIENT_COOLDOWN_MS, send)).toBe(true);
    expect(sends).toBe(2);
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

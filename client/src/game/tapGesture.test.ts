import { describe, it, expect, vi, afterEach } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, HeldWork, LookTapGate, canTapWalk, isDoubleTap, isLookHalf } from "./tapGesture";
import { isStickZone } from "./joystick";

describe("tapGesture — constants", () => {
  it("keeps the agreed window (300 ms) and slop (30 px)", () => {
    expect(DOUBLE_TAP_MS).toBe(300);
    expect(DOUBLE_TAP_PX).toBe(30);
  });
});

describe("isDoubleTap", () => {
  it("isDoubleTap: within 300 ms and 30 px only; a null prev is never a double", () => {
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 30, y: 0 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 301, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 31, y: 0 })).toBe(false);
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
  });

  it("measures distance in both axes (diagonal), sign-independent", () => {
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 118, y: 124 })).toBe(true); // hypot 30
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 82, y: 76 })).toBe(true); // same, other direction
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 50, x: 120, y: 123 })).toBe(false); // hypot ~30.5
  });

  it("a tap that is not later than the previous one is never a double", () => {
    expect(isDoubleTap({ t: 500, x: 0, y: 0 }, { t: 400, x: 0, y: 0 })).toBe(false);
  });

  it("two instant taps (same timestamp, same spot) count as a double", () => {
    expect(isDoubleTap({ t: 1000, x: 5, y: 5 }, { t: 1000, x: 5, y: 5 })).toBe(true);
  });
});

describe("isLookHalf", () => {
  it("right-handed: the look half is the right half, x >= vw/2", () => {
    expect(isLookHalf(187.4, 375)).toBe(false);
    expect(isLookHalf(187.4, 375, false)).toBe(false);
    expect(isLookHalf(188, 375)).toBe(true);
    expect(isLookHalf(375, 375)).toBe(true);
    expect(isLookHalf(0, 375)).toBe(false);
  });

  it("the exact midline belongs to the look half (x >= vw/2)", () => {
    expect(isLookHalf(200, 400)).toBe(true);
    expect(isLookHalf(199.9, 400)).toBe(false);
  });

  it("left-handed mirrors it: the look half is the left half", () => {
    expect(isLookHalf(10, 375, true)).toBe(true);
    expect(isLookHalf(187, 375, true)).toBe(true);
    expect(isLookHalf(200, 375, true)).toBe(false);
  });

  it("the two hands are exact complements (every x is in exactly one look half)", () => {
    for (const x of [0, 24, 100, 187, 187.5, 188, 300, 374, 375]) {
      expect(isLookHalf(x, 375, false)).toBe(!isLookHalf(x, 375, true));
    }
  });
});

describe("stick zone and look half share one handedness (Task 15 — one setting feeds both)", () => {
  it("below the middle, outside the 24 px edge strip, every x is the stick's OR the look half's, never both or neither", () => {
    const vw = 375;
    const vh = 812;
    for (const leftHanded of [false, true]) {
      for (let x = 24; x < vw - 24; x += 7) {
        const stick = isStickZone(x, 700, vw, vh, leftHanded);
        const look = isLookHalf(x, vw, leftHanded);
        expect(stick, `x=${x} leftHanded=${leftHanded}`).toBe(!look);
      }
    }
  });

  it("a stick-zone tap is therefore never a look-half tap (no double-tap recenter from the stick half)", () => {
    expect(isStickZone(280, 700, 375, 812, true)).toBe(true);
    expect(isLookHalf(280, 375, true)).toBe(false);
    expect(isStickZone(100, 700, 375, 812, false)).toBe(true);
    expect(isLookHalf(100, 375, false)).toBe(false);
  });
});

describe("canTapWalk — re-checked when the held-back single-tap walk fires", () => {
  it("walks when nothing changed while the tap waited for a possible second tap", () => {
    expect(canTapWalk("tp", false, false, false)).toBe(true);
    expect(canTapWalk("fp", false, false, false)).toBe(true);
  });

  it("does not walk once the overview map is open", () => {
    expect(canTapWalk("ov", false, false, false)).toBe(false);
  });

  it("does not walk while chat / a panel owns the keyboard", () => {
    expect(canTapWalk("tp", true, false, false)).toBe(false);
    expect(canTapWalk("fp", true, false, false)).toBe(false);
  });

  it("does not walk when the player sat down inside the window (it would stand them straight up)", () => {
    expect(canTapWalk("tp", false, false, true)).toBe(false);
    expect(canTapWalk("fp", false, false, true)).toBe(false);
  });

  it("a tap made while already seated still means 'stand up and walk there' (design 29)", () => {
    expect(canTapWalk("tp", false, true, true)).toBe(true);
    expect(canTapWalk("tp", true, true, true)).toBe(false); // ...unless the UI took the keyboard
    expect(canTapWalk("ov", false, true, true)).toBe(false);
  });

  it("walking after standing up inside the window is fine", () => {
    expect(canTapWalk("tp", false, true, false)).toBe(true);
  });
});

describe("canTapWalk — a tap dropped while it waited (round 3 review)", () => {
  it("does not walk once its ring was dropped meanwhile (a key, the stick, Esc, a sit): no ring that comes back later", () => {
    expect(canTapWalk("tp", false, false, false, true)).toBe(false);
    expect(canTapWalk("tp", false, true, false, true)).toBe(false);
    expect(canTapWalk("tp", false, false, false, false)).toBe(true);
  });
});

/**
 * The look half as CameraRig drives it, on fake timers: a tap's lift holds its pick back a moment and, from the pick,
 * its walk until DOUBLE_TAP_MS after the lift; a touch's down asks the gate whether it is a double tap's second; its
 * lift recenters when it was. Event times are the timers' own clock (the events are handled at once here).
 */
function lookHalf() {
  const gate = new LookTapGate();
  const log: string[] = [];
  let ring = false;
  let walking = false;
  let downAt = 0;
  const down = (id: number, x = 300, y = 500) => {
    downAt = Date.now();
    return gate.down(id, downAt, x, y);
  };
  /** A tap's pick (its ring shows), then its walk — after DOUBLE_TAP_MS from its lift (`wait`), or at once. */
  const walkOf = (upAt: number, wait: boolean) => {
    gate.work.hold(() => {
      ring = true; // the pick: the ring shows at once
      gate.work.hold(
        () => {
          walking = true;
          log.push(`walk@${Date.now()}`);
          gate.walked(() => {
            walking = false;
            log.push(`walk-undone@${Date.now()}`);
          });
        },
        wait ? Math.max(0, DOUBLE_TAP_MS - (Date.now() - upAt)) : 0,
        () => {
          ring = false;
        },
      );
    }, 0);
  };
  /**
   * The touch `id` lifts (a tap: it moved less than TAP_MAX_PX, held under CLICK_MAX_MS). A second touch lifted after
   * it turned into a drag (`dragged`) or was cancelled: no recenter, the first tap walks after all (CameraRig onUp).
   */
  const up = (id: number, second: boolean, x = 300, y = 500, dragged = false) => {
    const upAt = Date.now();
    if (second) {
      if (dragged) gate.dragged(id);
      if (gate.up(id) && !dragged) log.push(`recenter@${upAt}`);
      return;
    }
    gate.tap(upAt, x, y, () => walkOf(upAt, false));
    walkOf(upAt, true);
  };
  /** The touch `id` moved past TAP_MAX_PX: a look-drag (CameraRig onMove). */
  const drag = (id: number) => gate.dragged(id);
  return { gate, log, down, up, drag, state: () => ({ ring, walking }), downAt: () => downAt };
}

describe("LookTapGate — a double tap is decided when the second touch goes down (round 5 review)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One tap pair: first press `p1` ms, then `gap` ms from its lift to the second down, then a `p2` ms second press. */
  function pair(p1: number, gap: number, p2: number) {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    const first = h.down(1);
    vi.advanceTimersByTime(p1);
    h.up(1, first);
    vi.advanceTimersByTime(gap);
    const second = h.down(2, 304, 503);
    vi.advanceTimersByTime(p2);
    h.up(2, second);
    vi.advanceTimersByTime(2000);
    return { h, first, second };
  }

  it("the review's timeline: second down 250 ms, second lift 420 ms after the first down — recenter, never a walk", () => {
    // first press 60 ms, its lift at 60; the second touch down at 250 (190 ms after the lift), up at 420 — 360 ms after
    // the first lift, past the 300 ms the first tap's walk was waiting for
    const { h, first, second } = pair(60, 190, 170);
    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(h.log).toEqual(["recenter@420"]);
    expect(h.state()).toEqual({ ring: false, walking: false }); // the first tap's ring went with its walk
  });

  it("the review's other taps: 90/110 ms presses 170 ms apart, and a long second press — recenter only", () => {
    expect(pair(90, 170, 110).h.log).toEqual(["recenter@370"]);
    expect(pair(90, 235, 185).h.log).toEqual(["recenter@510"]);
    // however long the second touch is held, the first tap's walk never starts
    expect(pair(60, 200, 1500).h.log).toEqual(["recenter@1760"]);
  });

  it("the old quick double tap (40 ms taps, 110 ms apart) still recenters", () => {
    expect(pair(40, 70, 40).h.log).toEqual(["recenter@150"]);
  });

  it("a second touch more than DOUBLE_TAP_MS after the first lift, or far from it, is a tap of its own: the first walks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const late = lookHalf();
    late.up(1, late.down(1));
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 1);
    expect(late.log).toEqual([`walk@${DOUBLE_TAP_MS}`]);
    expect(late.down(2)).toBe(false);
    vi.useRealTimers();

    vi.useFakeTimers();
    vi.setSystemTime(0);
    const far = lookHalf();
    far.up(1, far.down(1));
    vi.advanceTimersByTime(100);
    expect(far.down(2, 300 + DOUBLE_TAP_PX + 5, 500)).toBe(false);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(far.log[0]).toBe(`walk@${DOUBLE_TAP_MS}`);
  });

  it("a second touch whose down is handled only after the first walk started (a busy page) takes that walk back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 40); // the walk fired at 300
    expect(h.state().walking).toBe(true);
    // the second touch went down at 280 (its event time), handled now at 340
    expect(h.gate.down(2, 280, 300, 500)).toBe(true);
    expect(h.state().walking).toBe(false);
    expect(h.log).toEqual([`walk@${DOUBLE_TAP_MS}`, `walk-undone@${DOUBLE_TAP_MS + 40}`]);
    expect(h.gate.up(2)).toBe(true);
  });

  it("a pinch (reset) drops the held walk and any pending double tap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(50);
    h.gate.reset();
    vi.advanceTimersByTime(1000);
    expect(h.log).toEqual([]);
    expect(h.state().ring).toBe(false);
    expect(h.down(2)).toBe(false); // no first tap to pair with any more
  });

  it("a tap, then a look-drag begun at once from the same spot: no double tap — the tap walks when the drag starts (round 6 review)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(120);
    expect(h.down(2)).toBe(true); // within 300 ms and 30 px of the lift: taken for a second tap — the walk dropped
    expect(h.state().ring).toBe(false);
    vi.advanceTimersByTime(60);
    h.drag(2); // it moved: a drag
    vi.advanceTimersByTime(1);
    expect(h.log).toEqual(["walk@181"]); // at once: its pick and its walk on the next timers
    expect(h.state()).toEqual({ ring: true, walking: true });
    vi.advanceTimersByTime(400);
    h.up(2, true, 300, 500, true); // the drag lifts: no recenter, no second walk
    vi.advanceTimersByTime(1000);
    expect(h.log).toEqual(["walk@181"]); // at once: its pick and its walk on the next timers
    // moving on and on (more moves) walks once
    h.drag(2);
    expect(h.log).toEqual(["walk@181"]); // at once: its pick and its walk on the next timers
  });

  it("a second touch that is cancelled walks the first tap too; one lifted as a tap still only recenters", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(100);
    h.down(2);
    vi.advanceTimersByTime(80);
    h.up(2, true, 300, 500, true); // pointercancel: handled as not-a-tap
    vi.advanceTimersByTime(1);
    expect(h.log).toEqual(["walk@181"]); // at once: its pick and its walk on the next timers
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const t = lookHalf();
    t.up(1, t.down(1));
    vi.advanceTimersByTime(100);
    t.down(2);
    vi.advanceTimersByTime(80);
    t.up(2, true);
    t.drag(2); // a stray move after the lift changes nothing
    vi.advanceTimersByTime(1000);
    expect(t.log).toEqual(["recenter@180"]);
  });

  it("a pinch while the second touch is down forgets the first tap: its drag walks nothing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(100);
    h.down(2);
    h.gate.reset(); // a second finger
    h.drag(2);
    vi.advanceTimersByTime(1000);
    expect(h.log).toEqual([]);
  });

  it("a new single tap replaces the held one (its walk and ring), and the second touch is disarmed by its lift", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const h = lookHalf();
    h.up(1, h.down(1));
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 100); // walked
    h.up(2, h.down(2, 500, 200)); // far away: a new single tap
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 10);
    expect(h.log).toEqual([`walk@${DOUBLE_TAP_MS}`, `walk@${2 * DOUBLE_TAP_MS + 100}`]);
    expect(h.gate.up(7)).toBe(false);
  });
});

describe("HeldWork", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs what it holds unless dropped; a dropped piece's onDrop runs, a piece that already ran is not dropped", () => {
    vi.useFakeTimers();
    const w = new HeldWork();
    const ran: string[] = [];
    w.hold(() => ran.push("a"), 10, () => ran.push("drop a"));
    w.hold(() => ran.push("b"), 50, () => ran.push("drop b"));
    expect(w.busy).toBe(true);
    vi.advanceTimersByTime(20);
    w.drop();
    vi.advanceTimersByTime(100);
    expect(ran).toEqual(["a", "drop b"]);
    expect(w.busy).toBe(false);
  });
});

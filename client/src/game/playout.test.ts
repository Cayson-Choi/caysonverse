import { describe, it, expect } from "vitest";
import { MOVE_SPEED, PATCH_RATE_MS, RUN_SPEED } from "@caysonverse/shared/constants";
import { sample, type Snapshot } from "./interpolation";
import { createMoveSender } from "./moveSender";
import { nextGait } from "./locomotion";
import type { Gait } from "./gait";
import {
  advancePlayout,
  createPlayout,
  playoutGaitSpeed,
  receivePose,
  targetLag,
  type Playout,
} from "./playout";
import {
  PLAYOUT_DEFAULT_BUFFER_MS,
  PLAYOUT_HOLD_IDLE_MS,
  PLAYOUT_MAX_BUFFER_MS,
  PLAYOUT_MAX_SLOWDOWN,
  PLAYOUT_MAX_SPEEDUP,
} from "./constants";

/** Deterministic PRNG (mulberry32) so every "jittery network" here is the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A network leg: each message is late by base + random·jitter ms, but never overtakes the one before (TCP). */
function leg(base: number, jitter: number, random: () => number) {
  let last = -Infinity;
  return (sentAt: number) => (last = Math.max(last, sentAt + base + random() * jitter));
}

interface Plan {
  /** Ground speed while moving (m/s). */
  speed: number;
  /** [start, stop] times (ms, mover clock - origin) during which the mover holds a key. */
  moves: Array<[number, number]>;
}

interface Run {
  /** Viewer frames: local time, drawn x, gait. */
  frames: Array<{ now: number; x: number; gait: Gait }>;
  /** The mover's true x at each of its frames (for the comparison). */
  truth: Array<{ t: number; x: number }>;
  /** Where the mover stopped (the server's final x). */
  stopX: number;
  playout: Playout;
}

/**
 * The whole pipeline, end to end, on a straight line: the mover's 60 fps frames feed the REAL moveSender (10 Hz,
 * stamped with the mover's clock); the uplink delivers each Move late and in order; the server applies them and
 * sends a patch every PATCH_RATE_MS carrying the latest pose + moveT; the downlink delivers patches late and in
 * order; the viewer takes each patch with receivePose and draws every frame with advancePlayout + sample.
 * The three clocks (mover, server, viewer) have unrelated origins, as real performance.now() values do.
 * `stamped: false` drops moveT (an older client or server): the arrival-time fallback.
 */
function pipeline(plan: Plan, net: { base: number; jitter: number; seed: number; stall?: [number, number] }, stamped = true): Run {
  const random = prng(net.seed);
  const MOVER_ORIGIN = 734_512.25; // the mover's performance.now() at simulation t = 0
  const VIEWER_ORIGIN = 81_037.5; // the viewer's
  const frame = 1000 / 60;
  const end = plan.moves[plan.moves.length - 1][1] + 3000;
  const stallHold = (t: number) => (net.stall && t >= net.stall[0] && t < net.stall[1] ? net.stall[1] : t);
  const up = leg(net.base, net.jitter, random);
  const down = leg(net.base, net.jitter, random);

  // 1) The mover: integrate x on its own frames, send through the real moveSender.
  const sent: Array<{ at: number; x: number; t: number }> = [];
  const truth: Array<{ t: number; x: number }> = [];
  let x = 0;
  let simT = 0;
  const sender = createMoveSender((p) => sent.push({ at: simT, x: p.x, t: p.t! }));
  for (simT = 0; simT <= end; simT += frame) {
    const moving = plan.moves.some(([a, b]) => simT >= a && simT < b);
    if (moving) x += plan.speed * (frame / 1000);
    truth.push({ t: simT, x });
    sender.update(MOVER_ORIGIN + simT, moving, { x, z: 0, yaw: 0 });
  }

  // 2) Uplink → server applies in arrival order → a patch every PATCH_RATE_MS with the latest pose.
  const arrivals = sent.map((m) => ({ ...m, atServer: up(stallHold(m.at)) }));
  const patches: Array<{ at: number; x: number; t: number }> = [];
  let applied: { x: number; t: number } | null = null;
  let lastPatched: { x: number; t: number } | null = null;
  let i = 0;
  for (let p = 7; p <= end + 1000; p += PATCH_RATE_MS) {
    while (i < arrivals.length && arrivals[i].atServer <= p) applied = arrivals[i++];
    if (applied && applied !== lastPatched) {
      patches.push({ at: down(stallHold(p)), x: applied.x, t: applied.t });
      lastPatched = applied;
    }
  }

  // 3) The viewer: patches in on arrival, a frame every 1/60 s on its own clock.
  const buf: Snapshot[] = [];
  const pl = createPlayout();
  receivePose(pl, buf, VIEWER_ORIGIN - 500, 0, 0, 0, 0); // the seed: standing at x = 0 when we joined
  const frames: Run["frames"] = [];
  let gait: Gait = "idle";
  let j = 0;
  for (let v = 0; v <= end + 1000; v += frame) {
    while (j < patches.length && patches[j].at <= v) {
      const pt = patches[j++];
      receivePose(pl, buf, VIEWER_ORIGIN + pt.at, stamped ? pt.t : 0, pt.x, 0, 0);
    }
    const r = advancePlayout(pl, buf, VIEWER_ORIGIN + v);
    gait = nextGait(gait, playoutGaitSpeed(pl, buf));
    frames.push({ now: v, x: sample(buf, r)!.x, gait });
  }
  return { frames, truth, stopX: x, playout: pl };
}

/** The worst step back (m) of the drawn x, and the furthest it ever got past the stop. */
function backAndOver(run: Run): { back: number; over: number } {
  let reach = -Infinity;
  let back = 0;
  for (const f of run.frames) {
    reach = Math.max(reach, f.x);
    back = Math.max(back, reach - f.x);
  }
  return { back, over: Math.max(0, reach - run.stopX) };
}

/** Drawn speed (m/s) frame by frame over [from, to] of viewer time. */
function drawnSpeeds(run: Run, from: number, to: number): number[] {
  const out: number[] = [];
  const fs = run.frames.filter((f) => f.now >= from && f.now <= to);
  for (let k = 1; k < fs.length; k++) out.push((fs[k].x - fs[k - 1].x) / ((fs[k].now - fs[k - 1].now) / 1000));
  return out;
}

const WALK: Plan = { speed: MOVE_SPEED, moves: [[200, 2200]] };
const RUN: Plan = { speed: RUN_SPEED, moves: [[200, 2200]] };
const STOP_START: Plan = { speed: MOVE_SPEED, moves: [[200, 480], [740, 1020], [1280, 1560], [1820, 2100]] };
const CLEAN = { base: 1, jitter: 0, seed: 1 };
const PHONE = { base: 40, jitter: 140, seed: 7 }; // 40-180 ms each way, bunched in order (the E2E's proxy)

describe("playout — the drawn remote only ever moves forward and stops exactly on the server's stop", () => {
  it.each([
    ["walk, clean", WALK, CLEAN],
    ["walk, jittery phone link", WALK, PHONE],
    ["run, clean", RUN, CLEAN],
    ["run, jittery phone link", RUN, PHONE],
    ["stop-start taps, clean", STOP_START, CLEAN],
    ["stop-start taps, jittery phone link", STOP_START, PHONE],
    ["run with a 900 ms freeze, then a burst", RUN, { ...CLEAN, stall: [900, 1800] as [number, number] }],
  ])("%s", (_name, plan, net) => {
    for (const stamped of [true, false]) {
      const run = pipeline(plan, net, stamped);
      const { back, over } = backAndOver(run);
      expect(back).toBeLessThanOrEqual(1e-9); // never a step back (the old code: 0.8-1.6 m)
      expect(over).toBeLessThanOrEqual(1e-9); // never past the stop (the old code: up to RUN_SPEED x 250 ms = 1.6 m)
      expect(run.frames[run.frames.length - 1].x).toBeCloseTo(run.stopX, 9); // and it ends exactly there
    }
  });
});

describe("playout — timed by the mover's clock, the walk keeps its real speed through network jitter", () => {
  /** Drawn speeds over the steady middle of the move on the viewer's screen (after the start, before the stop). */
  const steady = (run: Run) => {
    const startOnScreen = run.frames.find((f) => f.x > 0.05)!.now;
    const stopOnScreen = run.frames.find((f) => f.x >= run.stopX - 1e-9)!.now;
    return drawnSpeeds(run, startOnScreen + 300, stopOnScreen - 100);
  };
  /** Share of frames drawn within ±12% of the true speed. */
  const near = (v: number[], speed: number) => v.filter((s) => Math.abs(s - speed) <= speed * 0.12).length / v.length;
  const NETS = [CLEAN, PHONE, { base: 40, jitter: 140, seed: 11 }, { base: 20, jitter: 250, seed: 3 }];

  it.each([
    ["walk", WALK],
    ["run", RUN],
  ])("%s: never drawn faster than the 10%% catch-up, and >= 97%% of frames within the time-warp band", (_name, plan) => {
    for (const net of NETS) {
      const v = steady(pipeline(plan, net));
      expect(v.length).toBeGreaterThan(60);
      expect(Math.max(...v)).toBeLessThanOrEqual(plan.speed * (1 + PLAYOUT_MAX_SPEEDUP) + 1e-6); // no lurch, ever
      const inBand = v.filter((s) => s >= plan.speed * (1 - PLAYOUT_MAX_SLOWDOWN) - 1e-6).length / v.length;
      expect(inBand).toBeGreaterThanOrEqual(net.jitter === 0 ? 1 : 0.97); // a rare one-frame wait on a jittery link
    }
  });

  it("the same jittery links timed by arrival (no mover clock) are far less steady - what the clock fixes", () => {
    for (const net of NETS.slice(1)) {
      for (const plan of [WALK, RUN]) {
        const stamped = near(steady(pipeline(plan, net, true)), plan.speed);
        const arrival = near(steady(pipeline(plan, net, false)), plan.speed);
        expect(stamped).toBeGreaterThanOrEqual(0.95);
        expect(arrival).toBeLessThan(0.5);
      }
    }
  });

  it("the lag adapts: a clean link stays short, a jittery one buys buffer, and it is bounded", () => {
    const clean = pipeline(WALK, CLEAN).playout;
    const phone = pipeline(WALK, PHONE).playout;
    const base = (pl: Playout) => Math.min(...pl.offsets);
    const cleanBuffer = targetLag(clean) - base(clean);
    const phoneBuffer = targetLag(phone) - base(phone);
    // clean: the 100 ms patch grid + the ~117 ms send interval + margin
    expect(cleanBuffer).toBeLessThanOrEqual(260);
    expect(phoneBuffer).toBeGreaterThan(cleanBuffer);
    expect(phoneBuffer).toBeLessThanOrEqual(PLAYOUT_MAX_BUFFER_MS);
  });
});

describe("playout — stops, starts and holds", () => {
  it("stop-start taps do not inflate the lag: the pause between a stop and the next start asks for none", () => {
    const taps = pipeline(STOP_START, CLEAN).playout;
    const walk = pipeline(WALK, CLEAN).playout;
    const buffer = (pl: Playout) => targetLag(pl) - Math.min(...pl.offsets);
    expect(buffer(taps)).toBeLessThanOrEqual(buffer(walk) + 30);
  });

  it("a remote held on its newest pose goes idle after PLAYOUT_HOLD_IDLE_MS (no walking in place)", () => {
    const run = pipeline(WALK, CLEAN);
    const stopOnScreen = run.frames.find((f) => f.x >= run.stopX - 1e-9)!.now;
    const after = run.frames.filter((f) => f.now > stopOnScreen + PLAYOUT_HOLD_IDLE_MS + 20);
    expect(after.length).toBeGreaterThan(10);
    expect(after.every((f) => f.gait === "idle")).toBe(true);
    const during = run.frames.filter((f) => f.now > stopOnScreen - 800 && f.now < stopOnScreen - 100);
    expect(during.every((f) => f.gait === "walk")).toBe(true);
  });

  it("a late patch: the avatar waits on the newest pose and then carries on from exactly there", () => {
    const pl = createPlayout();
    const buf: Snapshot[] = [];
    // Steady 4 m/s on the mover's clock (t), arriving 50 ms later (local).
    for (let k = 0; k <= 10; k++) receivePose(pl, buf, 5000 + 100 * k + 50, 1000 + 100 * k, 0.4 * k, 0, 0);
    let now = 5000 + 100 * 10 + 50;
    let x = -Infinity;
    for (; now < 6500; now += 16) {
      const r = advancePlayout(pl, buf, now); // no new data: runs up to the newest and holds there
      const drawn = sample(buf, r)!.x;
      expect(drawn).toBeGreaterThanOrEqual(x);
      x = drawn;
    }
    expect(x).toBe(4.0); // holding the newest pose
    expect(pl.holdMs).toBeGreaterThan(0);
    receivePose(pl, buf, now, 1000 + 100 * 11, 4.4, 0, 0); // the late patch, just before this frame
    const next = sample(buf, advancePlayout(pl, buf, now))!.x;
    expect(next).toBeGreaterThanOrEqual(4.0);
    expect(next - 4.0).toBeLessThan(0.4 * 0.3); // a small step on from the hold, not a jump to 4.4
  });

  it("the first clock-stamped pose moves the timeline onto the mover's clock without moving the avatar", () => {
    const pl = createPlayout();
    const buf: Snapshot[] = [];
    receivePose(pl, buf, 1000, 0, 2, 3, 0); // seeded on arrival time
    const before = sample(buf, advancePlayout(pl, buf, 1140))!;
    receivePose(pl, buf, 1150, 987_654, 2.07, 3, 0); // its first move, stamped with an unrelated clock
    expect(pl.moverClock).toBe(true);
    const after = sample(buf, advancePlayout(pl, buf, 1156))!;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.08); // at most the one-frame step
  });

  it("a pose the server placed (no newer clock) goes after the newest on the timeline, never before it", () => {
    const pl = createPlayout();
    const buf: Snapshot[] = [];
    for (let k = 0; k < 5; k++) receivePose(pl, buf, 2000 + 100 * k + 60, 500 + 100 * k, 0.4 * k, 0, 0);
    receivePose(pl, buf, 2500, 900, 40, 40, 1); // a door teleport: same moveT as before (not newer)
    const ts = buf.map((s) => s.t);
    for (let k = 1; k < ts.length; k++) expect(ts[k]).toBeGreaterThan(ts[k - 1]);
    expect(buf[buf.length - 1].x).toBe(40);
  });

  it("a patch that changed no pose (connected, seat, area …) stores nothing", () => {
    const pl = createPlayout(300);
    const buf: Snapshot[] = [];
    expect(receivePose(pl, buf, 1000, 0, 1, 2, 0.5)).toBe(true);
    expect(receivePose(pl, buf, 1100, 300, 1, 2, 0.5)).toBe(false); // the moveT we were created with is not newer
    expect(buf).toHaveLength(1);
    expect(receivePose(pl, buf, 1200, 301, 1, 2, 0.5)).toBe(true); // a newer clock reading is a real sample
  });

  it("before any pair is measured, the buffer is PLAYOUT_DEFAULT_BUFFER_MS", () => {
    expect(targetLag(createPlayout())).toBe(PLAYOUT_DEFAULT_BUFFER_MS);
  });
});

describe("playout — a mover clock that stood still (fix: clock discontinuity)", () => {
  /**
   * A mover walks, stops, and its phone's screen is locked for `lockMs` within the reconnect window: the page is
   * suspended (nothing is sent) and its monotonic clock stands still, while the viewer's runs on. After the unlock
   * it walks again. Returns the viewer's frames over the second walk: drawn x and whether it was held on its newest
   * pose (waiting for data) — a held frame mid-walk is the step-slide.
   */
  function lockedPhone(lockMs: number, net = { base: 40, jitter: 60, seed: 5 }) {
    const random = prng(net.seed);
    const up = leg(net.base, net.jitter, random);
    const down = leg(net.base, net.jitter, random);
    const lock: [number, number] = [2600, 2600 + lockMs];
    const walks: Array<[number, number]> = [
      [200, 2200],
      [lock[1] + 500, lock[1] + 4500],
    ];
    const clock = (t: number) => 734_512.25 + (t < lock[1] ? t : t - lockMs); // stands still while locked
    const frame = 1000 / 60;
    const end = lock[1] + 6000;
    const sent: Array<{ at: number; x: number; t: number }> = [];
    let x = 0;
    let simT = 0;
    const sender = createMoveSender((p) => sent.push({ at: simT, x: p.x, t: p.t! }));
    for (simT = 0; simT <= end; simT += frame) {
      if (simT >= lock[0] && simT < lock[1]) continue; // suspended
      const moving = walks.some(([a, b]) => simT >= a && simT < b);
      if (moving) x += MOVE_SPEED * (frame / 1000);
      sender.update(clock(simT), moving, { x, z: 0, yaw: 0 });
    }
    const arrivals = sent.map((m) => ({ ...m, atServer: up(m.at) }));
    const patches: Array<{ at: number; x: number; t: number }> = [];
    let applied: { x: number; t: number } | null = null;
    let lastPatched: { x: number; t: number } | null = null;
    let i = 0;
    for (let p = 7; p <= end + 1000; p += PATCH_RATE_MS) {
      while (i < arrivals.length && arrivals[i].atServer <= p) applied = arrivals[i++];
      if (applied && applied !== lastPatched) {
        patches.push({ at: down(p), x: applied.x, t: applied.t });
        lastPatched = applied;
      }
    }
    const VIEWER_ORIGIN = 81_037.5;
    const buf: Snapshot[] = [];
    const pl = createPlayout();
    receivePose(pl, buf, VIEWER_ORIGIN - 500, 0, 0, 0, 0);
    const frames: Array<{ now: number; x: number; held: boolean }> = [];
    let j = 0;
    for (let v = 0; v <= end + 1000; v += frame) {
      while (j < patches.length && patches[j].at <= v) {
        const pt = patches[j++];
        receivePose(pl, buf, VIEWER_ORIGIN + pt.at, pt.t, pt.x, 0, 0);
      }
      const r = advancePlayout(pl, buf, VIEWER_ORIGIN + v);
      frames.push({ now: v, x: sample(buf, r)!.x, held: pl.holdMs > 0 });
    }
    const firstStop = MOVE_SPEED * 2;
    const startOnScreen = frames.find((f) => f.x > firstStop + 0.05)!.now;
    const stopOnScreen = frames.find((f) => f.x >= x - 1e-9)!.now;
    return frames.filter((f) => f.now >= startOnScreen && f.now < stopOnScreen - 150);
  }

  it.each([5000, 10000, 15000])("after a %i ms lock the walk is smooth again within ~0.5 s (it step-slid for ~4 s)", (lockMs) => {
    const walk = lockedPhone(lockMs);
    expect(walk.length).toBeGreaterThan(150);
    const held = walk.filter((f) => f.held);
    const heldMs = held.length * (1000 / 60);
    expect(heldMs).toBeLessThan(500);
    if (held.length > 0) expect(held[held.length - 1].now - walk[0].now).toBeLessThan(600);
    // ...and never a step back.
    for (let k = 1; k < walk.length; k++) expect(walk[k].x).toBeGreaterThanOrEqual(walk[k - 1].x);
  });

  it("re-anchors on a stamp more than PLAYOUT_MAX_BUFFER_MS further behind its arrival than the fastest one", () => {
    const pl = createPlayout();
    const buf: Snapshot[] = [];
    for (let k = 0; k < 12; k++) receivePose(pl, buf, 5000 + 100 * k + 60, 1000 + 100 * k, 0.4 * k, 0, 0);
    expect(Math.min(...pl.offsets)).toBe(4060);
    // 8 s later on our clock, but only 0.1 s later on the mover's (its clock stood still).
    receivePose(pl, buf, 5000 + 100 * 12 + 60 + 8000, 1000 + 100 * 12, 4.8, 0, 0);
    expect(pl.offsets).toEqual([4060 + 8000]); // the old offsets are gone...
    expect(pl.needs).toEqual([4060 + 8000 + 100]); // ...and so are the old needs: only this pair's, on the new base
    expect(targetLag(pl) - Math.min(...pl.offsets)).toBe(PLAYOUT_DEFAULT_BUFFER_MS); // learning anew
    // A merely late patch (within the largest buffer) is not a discontinuity.
    const pl2 = createPlayout();
    const buf2: Snapshot[] = [];
    for (let k = 0; k < 12; k++) receivePose(pl2, buf2, 5000 + 100 * k + 60, 1000 + 100 * k, 0.4 * k, 0, 0);
    receivePose(pl2, buf2, 5000 + 100 * 12 + 60 + PLAYOUT_MAX_BUFFER_MS - 50, 1000 + 100 * 12, 4.8, 0, 0);
    expect(pl2.offsets.length).toBe(13);
  });

  it("a long network stall (no clock change) still never steps back", () => {
    for (const stamped of [true, false]) {
      const run = pipeline(RUN, { ...CLEAN, stall: [700, 2300] as [number, number] }, stamped);
      const { back, over } = backAndOver(run);
      expect(back).toBeLessThanOrEqual(1e-9);
      expect(over).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe("playout — a placed pose (seat change)", () => {
  it("is stored even when the pose did not change, marked placed, after the newest on the timeline", () => {
    const pl = createPlayout(300);
    const buf: Snapshot[] = [];
    receivePose(pl, buf, 1000, 0, 1, 2, 0.5);
    expect(receivePose(pl, buf, 1100, 300, 1, 2, 0.5, true)).toBe(true);
    expect(buf).toHaveLength(2);
    expect(buf[1].placed).toBe(true);
    expect(buf[1].t).toBeGreaterThan(buf[0].t);
    expect(buf[0].placed).toBeUndefined();
  });
});

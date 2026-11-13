import { describe, it, expect, beforeEach } from "vitest";
import { MOVE_SPEED } from "@caysonverse/shared/constants";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import type { Seat } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { sample } from "./interpolation";
import { advancePlayout, createPlayout } from "./playout";
import { createMoveSender } from "./moveSender";
import { addRemote, clearRemotes, getRemoteRecord, receiveRemotePose } from "./remoteStore";
import {
  createSeatLine,
  createSeatMotion,
  pushSeatChange,
  seatLift,
  stepSeatMotion,
  takeDueSeatChange,
  type GroundPose,
  type SeatTransition,
} from "./remoteSeat";
import { SIT_GLIDE, STAND_GLIDE, glideAt, type Glide } from "./seatMotion";
import { normalizeAngle, stepYaw } from "./yaw";
import { TURN_SPEED } from "./constants";

/**
 * Sitting down on and getting up from a seat, as ANOTHER player sees it — the whole pipeline, end to end: the mover
 * (60 fps, the real moveSender, a LocalPlayer-like seat state machine) → uplink → a server that applies Move / Sit /
 * Stand the way VillageRoom / WorldRoom do (the seat's spot and facing; the dismount spot; `moveT` untouched) and
 * patches every 100 ms → downlink → the viewer: the real remote store (receiveRemotePose with the synced seat), the
 * real playout clock and sampling, and the real seat motion RemotePlayer runs every frame (stepSeatMotion).
 */

/** Sit_Chair_Down / Sit_Chair_StandUp in character.glb (s). */
const CLIP_SEC = 0.792;
const FRAME = 1000 / 60;

/** Deterministic PRNG (mulberry32), so every "jittery network" is the same on every run. */
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

interface Net {
  base: number;
  jitter: number;
  seed: number;
}
const CLEAN: Net = { base: 1, jitter: 0, seed: 1 };
const PHONE: Net = { base: 40, jitter: 140, seed: 7 }; // 40-180 ms each way (the E2E's jitter proxy)

interface Plan {
  seats: readonly Seat[];
  seat: number;
  /** Where the mover starts, and the spot it walks to (stops on) before it sits. */
  from: { x: number; z: number };
  stop: { x: number; z: number };
  /** ms after arriving at `stop` that Sit is sent (0: on the frame it arrives). */
  sitAfter: number;
  /** ms after the seat is confirmed that Stand is sent (0: on that very frame — W held down). */
  standAfter: number;
  /** After getting up (the stand-up glide over), walk this far (m) on along the seat's facing. */
  walkOff: number;
}

interface Frame {
  now: number;
  x: number;
  z: number;
  yaw: number;
  lift: number;
  mode: string;
}

interface Run {
  frames: Frame[];
  /** The server's pose when the Sit came (where the mover really was). */
  stopPose: GroundPose;
  /**
   * The newest pose the viewer received before the seat change. It is the stop pose, unless the mover's last Move
   * and its Sit reached the server within one patch — then the patch carries only the seat, and this is the Move
   * before the last one (at most one send interval of walking short of the stop).
   */
  preSeat: GroundPose;
  seat: Seat;
}

/** Run the whole pipeline for `plan` on `net`. */
function simulate(plan: Plan, net: Net): Run {
  const random = prng(net.seed);
  const up = leg(net.base, net.jitter, random);
  const downViewer = leg(net.base, net.jitter, random);
  const downMover = leg(net.base, net.jitter, random);
  const MOVER_ORIGIN = 734_512.25; // the mover's performance.now() at simulation t = 0
  const VIEWER_ORIGIN = 81_037.5; // the viewer's
  const seat = plan.seats[plan.seat];
  const end = 9000;

  // ── The server (state + an in-order inbox) ──
  type Msg = { at: number; kind: "move"; x: number; z: number; yaw: number; t: number } | { at: number; kind: "sit" | "stand" };
  const inbox: Msg[] = [];
  const server = { x: plan.from.x, z: plan.from.z, yaw: 0, moveT: 0, seatIndex: -1 };
  let stopPose: GroundPose = { x: plan.stop.x, z: plan.stop.z, yaw: 0 };
  const apply = (m: Msg) => {
    if (m.kind === "move") {
      if (server.seatIndex >= 0) return; // seated: moves are dropped
      server.x = m.x;
      server.z = m.z;
      server.yaw = m.yaw;
      server.moveT = m.t;
    } else if (m.kind === "sit") {
      if (server.seatIndex >= 0) return;
      stopPose = { x: server.x, z: server.z, yaw: server.yaw };
      server.seatIndex = plan.seat;
      server.x = seat.x;
      server.z = seat.z;
      server.yaw = seat.yaw;
    } else {
      if (server.seatIndex < 0) return;
      server.x = seat.standX;
      server.z = seat.standZ;
      server.seatIndex = -1;
    }
  };

  // ── The mover, frame by frame; its own patches confirm its seat ──
  const moverPatches: Array<{ at: number; seatIndex: number }> = [];
  let moverPatchIdx = 0;
  let mySeat = -1;
  const pose = { x: plan.from.x, z: plan.from.z, yaw: 0 };
  let arrivedAt = -1;
  let sitSent = false;
  let seatedAt = -1;
  let standSent = false;
  let standGlideUntil = -1;
  let walkOffTarget: { x: number; z: number } | null = null;
  const sender = createMoveSender((p) => inbox.push({ at: up(simT), kind: "move", x: p.x, z: p.z, yaw: p.yaw, t: p.t! }));
  let simT = 0;

  // ── Server patches → the viewer (and the mover), interleaved on one timeline ──
  const viewerPatches: Array<{ at: number; x: number; z: number; yaw: number; moveT: number; seatIndex: number }> = [];
  let last = "";
  let inboxIdx = 0;
  let nextPatch = 7;

  for (simT = 0; simT <= end; simT += FRAME) {
    // The server: take what has arrived, and patch on its grid.
    while (nextPatch <= simT) {
      inbox.sort((a, b) => a.at - b.at);
      while (inboxIdx < inbox.length && inbox[inboxIdx].at <= nextPatch) apply(inbox[inboxIdx++]);
      const key = `${server.x},${server.z},${server.yaw},${server.moveT},${server.seatIndex}`;
      if (key !== last) {
        last = key;
        viewerPatches.push({ at: downViewer(nextPatch), ...server });
        moverPatches.push({ at: downMover(nextPatch), seatIndex: server.seatIndex });
      }
      nextPatch += 100;
    }
    // The mover's own seat, as the schema confirms it.
    while (moverPatchIdx < moverPatches.length && moverPatches[moverPatchIdx].at <= simT) {
      const s = moverPatches[moverPatchIdx++].seatIndex;
      if (s >= 0 && mySeat < 0) seatedAt = simT;
      if (s < 0 && mySeat >= 0) standGlideUntil = simT + STAND_GLIDE.to * CLIP_SEC * 1000;
      mySeat = s;
    }
    // Input.
    let target: { x: number; z: number } | null = null;
    if (mySeat < 0 && seatedAt < 0) target = plan.stop;
    if (mySeat < 0 && seatedAt >= 0 && standGlideUntil >= 0 && simT >= standGlideUntil) {
      if (!walkOffTarget) {
        // The stand-up glide (LocalPlayer) has put the mover on the dismount spot, facing the way it sat.
        pose.x = seat.standX;
        pose.z = seat.standZ;
        pose.yaw = seat.yaw;
        walkOffTarget = {
          x: seat.standX + Math.sin(seat.yaw) * plan.walkOff,
          z: seat.standZ + Math.cos(seat.yaw) * plan.walkOff,
        };
      }
      target = walkOffTarget;
    }
    let moving = false;
    if (target) {
      const dx = target.x - pose.x;
      const dz = target.z - pose.z;
      const d = Math.hypot(dx, dz);
      const step = MOVE_SPEED * (FRAME / 1000);
      if (d > 1e-9) {
        moving = true;
        const k = Math.min(1, step / d);
        pose.x += dx * k;
        pose.z += dz * k;
        pose.yaw = stepYaw(pose.yaw, Math.atan2(dx, dz), TURN_SPEED * (FRAME / 1000));
      } else if (arrivedAt < 0 && target === plan.stop) arrivedAt = simT;
    }
    if (mySeat < 0 && (seatedAt < 0 || standGlideUntil >= 0)) sender.update(MOVER_ORIGIN + simT, moving, pose);
    if (!sitSent && arrivedAt >= 0 && simT >= arrivedAt + plan.sitAfter) {
      sitSent = true;
      inbox.push({ at: up(simT), kind: "sit" });
    }
    if (!standSent && mySeat >= 0 && simT >= seatedAt + plan.standAfter) {
      standSent = true;
      inbox.push({ at: up(simT), kind: "stand" });
    }
  }

  // ── The viewer: the real store, playout, sampling and seat motion ──
  clearRemotes();
  addRemote({
    sessionId: "mover",
    nickname: "mover",
    appearance: { ...DEFAULT_APPEARANCE },
    connected: true,
    seatIndex: -1,
    snapshots: [],
    playout: createPlayout(0),
  });
  receiveRemotePose("mover", VIEWER_ORIGIN - 500, 0, plan.from.x, plan.from.z, 0);
  const rec = getRemoteRecord("mover")!;
  const drawn: GroundPose = { x: plan.from.x, z: plan.from.z, yaw: 0 };
  const motion = createSeatMotion(-1, plan.seats, drawn);
  const transition = (what: SeatTransition) => (what === "sit" || what === "stand" ? CLIP_SEC : 0);
  const frames: Frame[] = [];
  let preSeat: GroundPose | null = null;
  let j = 0;
  for (let v = 0; v <= end + 1000; v += FRAME) {
    while (j < viewerPatches.length && viewerPatches[j].at <= v) {
      const p = viewerPatches[j++];
      receiveRemotePose("mover", VIEWER_ORIGIN + p.at, p.moveT, p.x, p.z, p.yaw, p.seatIndex);
      const n = rec.snapshots.length;
      if (!preSeat && rec.snapshots[n - 1].placed) preSeat = { ...rec.snapshots[n - 2] };
    }
    const renderT = advancePlayout(rec.playout, rec.snapshots, VIEWER_ORIGIN + v);
    const target = sample(rec.snapshots, renderT)!;
    stepSeatMotion(motion, rec.seatLine!, renderT, target, FRAME / 1000, plan.seats, drawn, transition);
    frames.push({ now: v, x: drawn.x, z: drawn.z, yaw: drawn.yaw, lift: seatLift(motion), mode: motion.mode });
  }
  return { frames, stopPose, preSeat: preSeat!, seat };
}

/** The frame index at which `mode` first starts. */
function firstFrame(run: Run, mode: string, from = 0): number {
  for (let i = Math.max(1, from); i < run.frames.length; i++) {
    if (run.frames[i].mode === mode && run.frames[i - 1].mode !== mode) return i;
  }
  return -1;
}

const step = (a: Frame, b: Frame) => Math.hypot(b.x - a.x, b.z - a.z);
const turn = (a: Frame, b: Frame) => Math.abs(normalizeAngle(b.yaw - a.yaw));

/** The largest per-frame move (m), turn (rad) and lift change (m) over frames [from, to). */
function worst(run: Run, from: number, to: number) {
  let move = 0;
  let yaw = 0;
  let lift = 0;
  for (let i = Math.max(1, from); i < Math.min(to, run.frames.length); i++) {
    const a = run.frames[i - 1];
    const b = run.frames[i];
    move = Math.max(move, step(a, b));
    yaw = Math.max(yaw, turn(a, b));
    lift = Math.max(lift, Math.abs(b.lift - a.lift));
  }
  return { move, yaw, lift };
}

/** The per-frame step of the local player's own sit glide from `from` onto `seat` (its fastest frame, m and rad). */
function localGlideMax(from: GroundPose, seat: Seat) {
  const g: Glide = { fromX: from.x, fromZ: from.z, fromYaw: from.yaw, toX: seat.x, toZ: seat.z, toYaw: seat.yaw, window: SIT_GLIDE };
  let move = 0;
  let yaw = 0;
  const prev = { x: from.x, z: from.z, yaw: from.yaw };
  const cur = { x: 0, z: 0, yaw: 0 };
  for (let e = FRAME / 1000; e <= CLIP_SEC; e += FRAME / 1000) {
    glideAt(g, e, CLIP_SEC, cur);
    move = Math.max(move, Math.hypot(cur.x - prev.x, cur.z - prev.z));
    yaw = Math.max(yaw, Math.abs(normalizeAngle(cur.yaw - prev.yaw)));
    Object.assign(prev, cur);
  }
  return { move, yaw };
}

// The plaza bench by the spawn (plaza_4): its front is -z. The mover comes from 5 m in front and stops 1.4 m from
// the seat (inside SEAT_REACH) — facing the bench, i.e. the opposite way to the seat's facing.
const BENCH = 6;
const bench = VILLAGE_SEATS[BENCH];
const ahead = (d: number) => ({ x: bench.x + Math.sin(bench.yaw) * d, z: bench.z + Math.cos(bench.yaw) * d });
const WALK_UP_AND_SIT: Plan = {
  seats: VILLAGE_SEATS,
  seat: BENCH,
  from: ahead(6.4),
  stop: ahead(1.4),
  sitAfter: 0,
  standAfter: 2000,
  walkOff: 3,
};

describe("a remote sits down when its avatar ARRIVES, not when the seat patch does", () => {
  beforeEach(() => clearRemotes());

  it.each([
    ["clean link", CLEAN],
    ["jittery phone link", PHONE],
  ])("%s: the sit-down starts on the spot the mover stopped on, standing still, and glides like the local player's", (_n, net) => {
    const run = simulate(WALK_UP_AND_SIT, net);
    const sit = firstFrame(run, "sitting");
    expect(sit).toBeGreaterThan(0);
    const before = run.frames[sit - 1];
    // Where the clip starts: on the newest pose received before the seat — where the mover stopped, or (Move and
    // Sit merged into one patch) one send interval short of it. The old code started it while the avatar was still
    // walking, a playout lag behind (0.2-0.5 m short here, 1.6-1.9 m from the seat when coming from further).
    expect(Math.hypot(before.x - run.preSeat.x, before.z - run.preSeat.z)).toBeLessThan(0.01);
    expect(Math.hypot(run.preSeat.x - run.stopPose.x, run.preSeat.z - run.stopPose.z)).toBeLessThanOrEqual(MOVE_SPEED * 0.117);
    // ...having walked there at walking pace (no lurch into the clip).
    expect(step(run.frames[sit - 2], before)).toBeLessThanOrEqual(MOVE_SPEED * (FRAME / 1000) * 1.1);
    // While the clip plays, the body moves no faster than the local player's own glide onto the seat.
    const seated = firstFrame(run, "seated", sit);
    const local = localGlideMax({ x: before.x, z: before.z, yaw: before.yaw }, run.seat);
    const w = worst(run, sit, seated + 1);
    expect(w.move).toBeLessThanOrEqual(local.move + 1e-9);
    expect(w.yaw).toBeLessThanOrEqual(local.yaw + 1e-9);
    // ...and ends exactly on the seat.
    const s = run.frames[seated];
    expect(Math.hypot(s.x - run.seat.x, s.z - run.seat.z)).toBeLessThan(1e-9);
  });
});

describe("getting up right after sitting down (W held: Stand on the frame the seat is confirmed)", () => {
  beforeEach(() => clearRemotes());

  it.each([
    ["clean link", CLEAN],
    ["jittery phone link", PHONE],
  ])("%s: the stand-up glides on from where the body is drawn — no jump back to the seat", (_n, net) => {
    const run = simulate({ ...WALK_UP_AND_SIT, standAfter: 0 }, net);
    const sit = firstFrame(run, "sitting");
    const stand = firstFrame(run, "standing", sit);
    expect(sit).toBeGreaterThan(0);
    expect(stand).toBeGreaterThan(sit);
    const end = firstFrame(run, "up", stand);
    const w = worst(run, sit, end + 30);
    const before = run.frames[sit - 1];
    const local = localGlideMax({ x: before.x, z: before.z, yaw: before.yaw }, run.seat);
    // The old code started the stand-up glide on the seat: a ~1 m jump in one frame.
    expect(w.move).toBeLessThanOrEqual(local.move + 1e-9);
    expect(w.lift).toBeLessThan(0.01); // no lift popping in for a body that never got onto the seat
  });
});

describe("standing still, then sitting: the facing does not spin in one frame", () => {
  beforeEach(() => clearRemotes());

  it.each([
    ["clean link", CLEAN],
    ["jittery phone link", PHONE],
  ])("%s: after 3 s on the spot, the turn onto the seat is the sit-down glide's", (_n, net) => {
    const run = simulate({ ...WALK_UP_AND_SIT, sitAfter: 3000 }, net);
    const sit = firstFrame(run, "sitting");
    const before = run.frames[sit - 1];
    const local = localGlideMax({ x: before.x, z: before.z, yaw: before.yaw }, run.seat);
    expect(local.yaw).toBeLessThan((20 * Math.PI) / 180);
    // From the moment the mover stopped until it is seated: never more than the glide's own turn per frame (the
    // old code turned ~150° in one frame, then slid backward onto the seat).
    const stopped = run.frames.findIndex((f) => Math.hypot(f.x - run.stopPose.x, f.z - run.stopPose.z) < 1e-9);
    const seated = firstFrame(run, "seated", sit);
    const w = worst(run, stopped, seated + 1);
    expect(w.yaw).toBeLessThanOrEqual(local.yaw + 1e-9);
    // Before the clip: still on the spot, still facing the bench.
    expect(run.frames[sit - 1].yaw).toBeCloseTo(run.frames[stopped].yaw, 9);
  });

  it("getting up after a long sit and walking off turns no faster than the mover's own body", () => {
    const run = simulate({ ...WALK_UP_AND_SIT, sitAfter: 500, standAfter: 3000 }, PHONE);
    const up = firstFrame(run, "up", firstFrame(run, "standing"));
    const w = worst(run, up, run.frames.length);
    expect(w.yaw).toBeLessThanOrEqual(TURN_SPEED * (FRAME / 1000) + 1e-6);
  });
});

// A chair without a seat height (no seatY): the server snaps the sitter onto it and back off to the aisle. Coming from the
// dismount side means coming through the chair's back.
const SEATS: readonly Seat[] = [{ x: 10, z: 20, yaw: Math.PI / 2, standX: 9.1, standZ: 20 }];
const CHAIR = 0;
const chair = SEATS[CHAIR];
const AT_CHAIR: Plan = {
  seats: SEATS,
  seat: CHAIR,
  from: { x: chair.standX - 4, z: chair.z },
  stop: { x: chair.x - 1.3, z: chair.z },
  sitAfter: 400,
  standAfter: 2000,
  walkOff: 0,
};

describe("a chair without a seat height snaps on and off — never a slide through its back", () => {
  beforeEach(() => clearRemotes());

  it.each([
    ["clean link", CLEAN],
    ["jittery phone link", PHONE],
  ])("%s", (_n, net) => {
    const run = simulate(AT_CHAIR, net);
    const sit = firstFrame(run, "sitting");
    const stand = firstFrame(run, "standing", sit);
    const arrived = run.frames.findIndex((f) => Math.hypot(f.x - run.stopPose.x, f.z - run.stopPose.z) < 1e-9);
    expect(arrived).toBeGreaterThan(0);
    expect(sit).toBeGreaterThan(arrived);
    // On the stop spot until the clip starts, then on the seat in one go (the old code slid 0.9-1.5 m across).
    for (let i = arrived; i < sit; i++) expect(Math.hypot(run.frames[i].x - run.stopPose.x, run.frames[i].z - run.stopPose.z)).toBe(0);
    for (let i = sit; i < stand; i++) {
      expect(run.frames[i].x).toBe(chair.x);
      expect(run.frames[i].z).toBe(chair.z);
      expect(run.frames[i].yaw).toBe(chair.yaw);
    }
    // ...and on the dismount spot the frame the stand-up starts.
    for (let i = stand; i < run.frames.length; i++) {
      expect(run.frames[i].x).toBeCloseTo(chair.standX, 9);
      expect(run.frames[i].z).toBeCloseTo(chair.standZ, 9);
    }
    expect(run.frames.every((f) => f.lift === 0)).toBe(true);
  });
});

describe("seat line (the stamped seat changes)", () => {
  it("hands out each change once the render time reaches its stamp, oldest first", () => {
    const line = createSeatLine(-1);
    pushSeatChange(line, 1000, 4);
    pushSeatChange(line, 1300, -1);
    expect(takeDueSeatChange(line, 999)).toBeUndefined();
    expect(line.drawn).toBe(-1);
    expect(takeDueSeatChange(line, 1000)).toEqual({ t: 1000, seat: 4 });
    expect(line.drawn).toBe(4);
    expect(takeDueSeatChange(line, 1200)).toBeUndefined();
    expect(takeDueSeatChange(line, 2000)).toEqual({ t: 1300, seat: -1 });
    expect(takeDueSeatChange(line, 2000)).toBeUndefined();
    expect(line.drawn).toBe(-1);
    expect(takeDueSeatChange(line, Number.NaN)).toBeUndefined();
  });

  it("the store takes seatIndex at once (prompts, occupancy) but stamps the change with the seat pose's time", () => {
    clearRemotes();
    addRemote({
      sessionId: "s",
      nickname: "s",
      appearance: { ...DEFAULT_APPEARANCE },
      connected: true,
      seatIndex: -1,
        snapshots: [],
      playout: createPlayout(0),
    });
    receiveRemotePose("s", 1000, 0, 0, 0, 0);
    receiveRemotePose("s", 1100, 0, 0, 0, 0, 3); // seated without the pose changing: still a placed snapshot
    const rec = getRemoteRecord("s")!;
    expect(rec.seatIndex).toBe(3);
    expect(rec.snapshots).toHaveLength(2);
    expect(rec.snapshots[1].placed).toBe(true);
    expect(rec.seatLine!.pending).toEqual([{ t: rec.snapshots[1].t, seat: 3 }]);
    expect(rec.seatLine!.drawn).toBe(-1); // not drawn seated yet
    receiveRemotePose("s", 1150, 0, 0, 0, 0, 3); // the seat listener after onChange: nothing new
    expect(rec.snapshots).toHaveLength(2);
    expect(rec.seatLine!.pending).toHaveLength(1);
  });

  it("a render time that jumps over a sit-down AND the stand-up (a resync after an outage) plays neither", () => {
    const line = createSeatLine(-1);
    pushSeatChange(line, 1000, BENCH);
    pushSeatChange(line, 1200, -1);
    const at = { x: bench.standX, z: bench.standZ, yaw: bench.yaw };
    const m = createSeatMotion(-1, VILLAGE_SEATS, at);
    const drawn = { x: 0, z: 0, yaw: 0 };
    const calls: SeatTransition[] = [];
    stepSeatMotion(m, line, 5000, at, FRAME / 1000, VILLAGE_SEATS, drawn, (w) => {
      calls.push(w);
      return CLIP_SEC;
    });
    expect(calls).toEqual([]);
    expect(m.mode).toBe("up");
    expect(drawn).toEqual(at);
    expect(line.pending).toEqual([]);
  });

  it("a remote seen already seated when it is added starts on its seat (no replayed sit-down)", () => {
    const at = { x: bench.x, z: bench.z, yaw: bench.yaw };
    const m = createSeatMotion(BENCH, VILLAGE_SEATS, at);
    expect(m.mode).toBe("seated");
    expect(seatLift(m)).toBeGreaterThan(0.03);
    const drawn = { x: 0, z: 0, yaw: 0 };
    const calls: SeatTransition[] = [];
    stepSeatMotion(m, createSeatLine(BENCH), 0, at, FRAME / 1000, VILLAGE_SEATS, drawn, (w) => {
      calls.push(w);
      return CLIP_SEC;
    });
    expect(calls).toEqual([]);
    expect(drawn).toEqual(at);
  });
});
